//! The pure half of the publish gate: turn approved private drafts into the Post a publication
//! writes, and the small private outcome file that records what happened (ADR 0022).
//!
//! [`assemble`] reads nothing but its arguments and writes nothing. It refuses unless
//! [`ApprovalSet::evaluate`] says every required author approved the content as it is now, then
//! builds the canonical Post from exactly the latest revisions those approvals were bound to. The
//! caller writes the result transactionally; a refusal carries only the display names of authors
//! whose approval is missing or out of date, never prose, revision numbers, digests or tokens.

use std::collections::BTreeMap;

use blake2::{Blake2s256, Digest};
use serde::{Deserialize, Serialize};

use crate::approval::{public_metadata, ApprovalSet, ApprovalSubject, Readiness, Section};
use crate::collaboration::{valid_admin_username, AuthorizationRole, SharedPublication};
use crate::draft::DraftSet;
use crate::frontmatter::{self, Value};
use crate::media_moment::MomentSet;
use crate::published_moment::{self, MomentsBlock};
use crate::reflection::{compose_bound, strip_part_markers, ComposedTurn, ReflectionStructure};
use crate::shared_series::{SERIES_KEY, SERIES_ORDER_KEY};
use crate::shared_source::{
    SharedAttribution, QUESTION_KEY, SOURCE_KIND_KEY, SOURCE_TITLE_KEY, SOURCE_URL_KEY,
};
use crate::slug;
use crate::synthesis::{self, ItemRule, SynthesisKind, SynthesisSet};

pub const OUTCOME_VERSION: u8 = 1;
pub const MAX_OUTCOME_BYTES: usize = 512 * 1024;
/// Between sections. The blank line before `---` matters: without it the rule would turn the
/// last line of the previous section into a heading.
const SECTION_BREAK: &str = "\n\n---\n\n";

/// Why a publication could not be assembled.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AssemblyError {
    /// A new reflection has a legacy section-only approval rule and must change it first.
    ApprovalScope,
    /// Required approvals are missing or no longer match the content. Holds display names, for a
    /// requester who already holds the publish grant.
    Blocked { missing: Vec<String> },
    /// The fixed numeric quorum has not yet been reached.
    QuorumBlocked { approved: usize, required: usize },
    /// The approval rule cannot be met by the authors as they are now, whatever anyone approves:
    /// a named participant (display names here) is no longer an author, or no author holds a
    /// listed role. Someone with the policy grant changes the rule, or the maintainer restores the
    /// person or gives the role (ADR 0052).
    RuleUnmet {
        named: Vec<String>,
        roles: Vec<AuthorizationRole>,
    },
    /// The record cannot make a Post: no title, no section, or an author without a profile.
    Invalid,
    /// The arrangement names a part or draft the current drafts no longer have (an author
    /// removed a part after it was arranged). Distinct from [`Self::Invalid`] because the fix is
    /// a coordinator's: arrange the piece again (#188). Reported only once the approvals are met,
    /// so it never tells someone who may not read the drafts whether a part exists (ADR 0031).
    ArrangementMismatch,
    /// A section contains raw HTML or a link or image with an active address (`javascript:`,
    /// `data:`). Native pages pass these through, which is right for the site owner's own posts
    /// but not for a co-author's prose, and the approved text must not be altered, so the piece
    /// is refused until the author removes it.
    UnsafeMarkup,
    /// A section heading claims an anchor the generated conversation block owns
    /// (`continuing-the-conversation`, `conversation-<category>[-<n>]`). Distinct from
    /// [`Self::UnsafeMarkup`] because the fix is to rename the heading, not remove markup.
    ReservedSectionAnchor,
    /// An approved continuing-conversation item breaks a rule for item Markdown (raw HTML, an
    /// unsafe link, a heading outside the item outline, or a reserved anchor). Distinct from
    /// [`Self::UnsafeMarkup`] so the refusal names the item rather than a section.
    UnsafeConversationItem(ItemRule, ItemRef),
    /// A media moment proposed for the piece no longer resolves against the record: its source
    /// is gone, or its locators no longer fit the source's kind (ADR 0062). Reported only once
    /// the approvals are met, like [`Self::ArrangementMismatch`], and it names no moment, so it
    /// tells nothing to someone who may not read the moments. Its owner edits or withdraws it.
    UnresolvedMoment,
    /// An approved moment's observation would change how another part of the piece renders (a
    /// reference definition or an open fence that reaches past it), or the moments could not be
    /// written so that every public form reads them back exactly (ADR 0066). Reported only once
    /// the approvals are met and it names no moment; its owner edits the observation.
    UnsafeMoment,
}

/// Which continuing-conversation item a refusal is about: its category and its place among the
/// published items of that category, counting from one (the same ordinal its anchor carries).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ItemRef {
    pub kind: SynthesisKind,
    pub ordinal: usize,
}

impl ItemRef {
    /// For example "the second question". Holds no author text, so it is safe to show.
    pub fn describe(self) -> String {
        const ORDINALS: [&str; 10] = [
            "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth",
            "tenth",
        ];
        let noun = match self.kind {
            SynthesisKind::Agreement => "shared takeaway",
            SynthesisKind::Difference => "difference",
            SynthesisKind::Question => "question",
            SynthesisKind::Application => "way to apply this",
            SynthesisKind::Uncertainty => "uncertainty",
        };
        match ORDINALS.get(self.ordinal.wrapping_sub(1)) {
            Some(word) => format!("the {word} {noun}"),
            None => format!("{noun} number {}", self.ordinal),
        }
    }
}

/// The canonical files one publication writes.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Assembly {
    /// `posts/<publication id>.md`, so the path is opaque and the same on every retry.
    pub path: String,
    pub source: String,
    /// The credit sidecar, one author credit per section in section order.
    pub credits_path: String,
    pub credits: String,
}

/// The path of the Post a publication writes. It carries no title and no date.
pub fn post_path(record: &SharedPublication) -> String {
    format!("posts/{}.md", record.publication_id)
}

/// Run `ask` against the approval subject for the active authors as the content is now. This is
/// the one place the subject is built from the record, arrangement, drafts, synthesis and media
/// moments, so the approval binding a preview hands out, the one the gate checks and the one a
/// route stores cannot drift apart. The metadata it binds is the public record fields, then the
/// public participant attribution, then the reflection `structure`'s prose-free
/// binding frame when there is one (layout, turn order, round
/// prompts and labels; ADR 0030), then the synthesis's prose-free binding frame (items, order,
/// attribution), then the `moments`' prose-free binding frame (one digest per moment proposed for
/// the piece, covering the source it shows; ADR 0063). A change to any of them makes standing
/// approvals stale exactly as a change of prose does; with no structure, and with no moment
/// proposed for the piece, nothing is appended for them, so approvals given before either existed
/// stay valid. The synthesis's attributed authors, and every participant with a moment proposed
/// for the piece, must each approve the piece whatever the policy (ADR 0024, 0025, 0063). Callers
/// that have not loaded moments pass an empty [`MomentSet`].
pub fn with_subject<R>(
    record: &SharedPublication,
    structure: Option<&ReflectionStructure>,
    drafts: &DraftSet,
    synthesis: &SynthesisSet,
    moments: &MomentSet,
    active: &[&str],
    ask: impl FnOnce(&ApprovalSubject<'_>) -> R,
) -> R {
    with_subject_for_participants(
        record, structure, drafts, synthesis, moments, active, active, ask,
    )
}

/// Build a subject with a distinct set of currently eligible participants.
#[allow(clippy::too_many_arguments)]
pub fn with_subject_for_participants<R>(
    record: &SharedPublication,
    structure: Option<&ReflectionStructure>,
    drafts: &DraftSet,
    synthesis: &SynthesisSet,
    moments: &MomentSet,
    active: &[&str],
    participants: &[&str],
    ask: impl FnOnce(&ApprovalSubject<'_>) -> R,
) -> R {
    with_subject_mode(
        record,
        structure,
        drafts,
        synthesis,
        moments,
        active,
        participants,
        false,
        ask,
    )
}

/// Build a subject covering every live contribution of each active author. Callers must also
/// show and publish every such contribution before issuing or accepting this subject's token.
#[allow(clippy::too_many_arguments)]
pub fn with_subject_for_all_contributions<R>(
    record: &SharedPublication,
    structure: Option<&ReflectionStructure>,
    drafts: &DraftSet,
    synthesis: &SynthesisSet,
    moments: &MomentSet,
    active: &[&str],
    participants: &[&str],
    ask: impl FnOnce(&ApprovalSubject<'_>) -> R,
) -> R {
    with_subject_mode(
        record,
        structure,
        drafts,
        synthesis,
        moments,
        active,
        participants,
        true,
        ask,
    )
}

#[allow(clippy::too_many_arguments)]
fn with_subject_mode<R>(
    record: &SharedPublication,
    structure: Option<&ReflectionStructure>,
    drafts: &DraftSet,
    synthesis: &SynthesisSet,
    moments: &MomentSet,
    active: &[&str],
    participants: &[&str],
    all_contributions: bool,
    ask: impl FnOnce(&ApprovalSubject<'_>) -> R,
) -> R {
    let authors: Vec<&str> = record
        .collaboration
        .participants
        .iter()
        .filter(|participant| active.contains(&participant.id.as_str()))
        .map(|participant| participant.id.as_str())
        .collect();
    let stamps: Vec<_> = authors
        .iter()
        .flat_map(|author| {
            let stamps = if all_contributions {
                drafts.stamps_for_owner(author)
            } else {
                drafts.current_stamp(author).into_iter().collect()
            };
            stamps.into_iter().map(move |stamp| (*author, stamp))
        })
        .collect();
    let sections: Vec<Section<'_>> = stamps
        .iter()
        .map(|(author, stamp)| Section {
            contribution_id: &stamp.contribution_id,
            owner: author,
            revision: stamp.number,
            digest: &stamp.digest,
        })
        .collect();
    let mut metadata = public_metadata(record);
    if drafts.order_revision() != 0 {
        metadata.push("contribution-order-revision-v1".to_string());
        metadata.push(drafts.order_revision().to_string());
    }
    metadata.push("participant-attribution-v1".to_string());
    for author in &authors {
        let participant = record
            .collaboration
            .participants
            .iter()
            .find(|participant| participant.id == *author)
            .expect("authors come from participants");
        metadata.push(participant.id.clone());
        metadata.push(participant.display_name.clone());
        metadata.push(participant.profile_url.clone().unwrap_or_default());
        if let Some(binding) = record
            .authorization
            .bindings
            .iter()
            .find(|binding| binding.participant_id == *author)
        {
            metadata.push("profile".to_string());
            metadata.push(binding.contributor_id.clone());
        } else {
            metadata.push("no-profile".to_string());
        }
    }
    if let Some(structure) = structure {
        metadata.push(format!("reflection-frame:{}", structure.binding_frame()));
    }
    metadata.extend(synthesis.binding_frame());
    metadata.extend(moments.binding_frame(&record.sources));
    let metadata: Vec<&str> = metadata.iter().map(String::as_str).collect();
    let mut attributed = synthesis.attributed_authors();
    for participant in moments.attributed_participants() {
        if !attributed.contains(&participant) {
            attributed.push(participant);
        }
    }
    // The roles each author holds, for role-based approval rules (ADR 0052).
    let roles: Vec<(&str, AuthorizationRole)> = authors
        .iter()
        .flat_map(|author| {
            record
                .authorization
                .bindings
                .iter()
                .filter(move |binding| binding.participant_id == *author)
                .flat_map(move |binding| binding.roles.iter().map(move |role| (*author, *role)))
        })
        .collect();
    ask(&ApprovalSubject {
        authors: &authors,
        participants,
        membership_revision: record.collaboration.revision,
        authorization_revision: record.authorization.revision,
        sections: &sections,
        metadata: &metadata,
        attributed: &attributed,
        roles: &roles,
    })
}

/// Build the same approval subject with the exact private credit choices and their revision bound
/// to it. Callers must also present the corresponding public credit projection in the preview.
#[allow(clippy::too_many_arguments)]
pub fn with_credit_subject_for_participants<R>(
    record: &SharedPublication,
    structure: Option<&ReflectionStructure>,
    drafts: &DraftSet,
    synthesis: &SynthesisSet,
    moments: &MomentSet,
    active: &[&str],
    participants: &[&str],
    choices: &crate::shared_credit::CreditChoices,
    ask: impl FnOnce(&ApprovalSubject<'_>) -> R,
) -> Result<R, crate::shared_credit::CreditChoiceError> {
    let binding = choices.binding()?;
    Ok(with_subject_for_participants(
        record,
        structure,
        drafts,
        synthesis,
        moments,
        active,
        participants,
        |subject| with_credit_binding(subject, &binding, ask),
    ))
}

/// Extend an existing subject with a previously validated credit-choice binding.
pub fn with_credit_binding<R>(
    subject: &ApprovalSubject<'_>,
    binding: &str,
    ask: impl FnOnce(&ApprovalSubject<'_>) -> R,
) -> R {
    let mut metadata = subject.metadata.to_vec();
    metadata.push("participant-credit-choices-v1");
    metadata.push(binding);
    ask(&ApprovalSubject {
        metadata: &metadata,
        ..*subject
    })
}

/// Prepare the names used in public rendering without changing the private record. Only active
/// participants whose draft, conversation attribution, or moment appears need a credit choice.
pub fn public_credit_projection(
    record: &SharedPublication,
    drafts: &DraftSet,
    synthesis: &SynthesisSet,
    moments: &MomentSet,
    active: &[&str],
    choices: &crate::shared_credit::CreditChoices,
) -> Result<(SharedPublication, crate::shared_credit::PublicCredits), AssemblyError> {
    let attributed = synthesis.attributed_authors();
    let noted = moments.attributed_participants();
    if attributed
        .iter()
        .chain(&noted)
        .any(|id| !active.contains(id))
    {
        return Err(AssemblyError::Invalid);
    }
    let people: Vec<&str> = record
        .collaboration
        .participants
        .iter()
        .map(|participant| participant.id.as_str())
        .filter(|id| {
            active.contains(id)
                && (drafts.current_stamp(id).is_some()
                    || attributed.contains(id)
                    || noted.contains(id))
        })
        .collect();
    if attributed
        .iter()
        .chain(&noted)
        .any(|id| !people.contains(id))
    {
        return Err(AssemblyError::Invalid);
    }
    let credits = choices
        .project(&people)
        .map_err(|_| AssemblyError::Invalid)?;
    let mut public_record = record.clone();
    for participant in &mut public_record.collaboration.participants {
        if let Some(name) = credits.display_name(&participant.id) {
            participant.display_name = name.to_string();
            participant.profile_url = None;
        }
    }
    Ok((public_record, credits))
}

/// Public credit order: first appearance in the arranged drafts, then any additional people
/// whose approved conversation or moments appear.
pub fn publication_credit_order(
    record: &SharedPublication,
    structure: Option<&ReflectionStructure>,
    drafts: &DraftSet,
    synthesis: &SynthesisSet,
    moments: &MomentSet,
    active: &[&str],
) -> Result<Vec<String>, AssemblyError> {
    let mut order = Vec::new();
    if let Some(structure) = structure {
        let entries = structure
            .reading_order(&record.collaboration, drafts)
            .map_err(|_| AssemblyError::ArrangementMismatch)?;
        for entry in entries {
            if active.contains(&entry.participant_id)
                && entry.markdown.is_some()
                && !order.iter().any(|id| id == entry.participant_id)
            {
                order.push(entry.participant_id.to_string());
            }
        }
    } else {
        for participant in &record.collaboration.participants {
            if active.contains(&participant.id.as_str())
                && drafts.current_stamp(&participant.id).is_some()
            {
                order.push(participant.id.clone());
            }
        }
    }
    for id in synthesis
        .attributed_authors()
        .into_iter()
        .chain(moments.attributed_participants())
    {
        if !order.iter().any(|existing| existing == id) {
            order.push(id.to_string());
        }
    }
    Ok(order)
}

/// Display names for participant ids, in the order given; unknown ids are skipped.
pub fn display_names<'a>(
    record: &SharedPublication,
    ids: impl IntoIterator<Item = &'a str>,
) -> Vec<String> {
    ids.into_iter()
        .filter_map(|id| {
            record
                .collaboration
                .participants
                .iter()
                .find(|participant| participant.id == id)
        })
        .map(|participant| participant.display_name.clone())
        .collect()
}

/// Authors who still owe approval of at least one item they are named on, in first-appearance
/// order. Empty when every item is fully approved (or there are none).
pub fn unapproved_item_authors(synthesis: &SynthesisSet) -> Vec<String> {
    let mut awaited: Vec<String> = Vec::new();
    for status in synthesis.all_item_statuses() {
        for author in status.awaiting {
            if !awaited.contains(&author) {
                awaited.push(author);
            }
        }
    }
    awaited
}

/// The section heading above everything a synthesis publishes. Its id is the stable permalink.
const CONVERSATION_HEADING: &str = "## Continuing the conversation {#continuing-the-conversation}";

/// Category order and heading, fixed so a reader finds the same shape in every piece. A kind
/// nobody wrote has no heading at all.
const CATEGORIES: [(SynthesisKind, &str, &str); 5] = [
    (SynthesisKind::Agreement, "agreement", "Shared takeaways"),
    (SynthesisKind::Difference, "difference", "Where we differ"),
    (
        SynthesisKind::Question,
        "question",
        "Questions we are left with",
    ),
    (
        SynthesisKind::Application,
        "application",
        "Ways to apply this",
    ),
    (
        SynthesisKind::Uncertainty,
        "uncertainty",
        "What we are still unsure about",
    ),
];

/// Backslash-escape every ASCII punctuation character, which CommonMark always reads as a literal.
/// A display name is a participant's text and must not become Markdown or HTML.
pub(crate) fn escape_markdown(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        if c.is_ascii_punctuation() {
            out.push('\\');
        }
        out.push(if c.is_control() { ' ' } else { c });
    }
    out
}

/// The Markdown that publishes a synthesis, as chunks: headings, attribution headings and item
/// prose, the flag marking the prose (untrusted, checked by [`assemble`]). Only items every
/// attributed author approved at their current digest are included, so an unapproved, withdrawn
/// or edited item has no path in. There is no consensus signal: each item names only the
/// authors it speaks for. Empty when nothing qualifies, so there is no empty heading.
pub fn conversation_parts(
    record: &SharedPublication,
    synthesis: &SynthesisSet,
) -> Vec<(String, bool)> {
    conversation_chunks(record, synthesis)
        .into_iter()
        .map(|(text, item)| (text, item.is_some()))
        .collect()
}

/// [`conversation_parts`] with each prose chunk carrying the item it belongs to.
fn conversation_chunks(
    record: &SharedPublication,
    synthesis: &SynthesisSet,
) -> Vec<(String, Option<ItemRef>)> {
    let mut parts: Vec<(String, Option<ItemRef>)> = Vec::new();
    for (kind, slug, heading) in CATEGORIES {
        let mut ordinal = 0;
        for item in synthesis.items().iter().filter(|item| item.kind() == kind) {
            let names = display_names(record, item.contributors().iter().map(String::as_str));
            if !item.is_approved() || names.is_empty() {
                continue;
            }
            if ordinal == 0 {
                if parts.is_empty() {
                    parts.push((CONVERSATION_HEADING.to_string(), None));
                }
                parts.push((format!("### {heading} {{#conversation-{slug}}}"), None));
            }
            ordinal += 1;
            let names: Vec<String> = names.iter().map(|name| escape_markdown(name)).collect();
            parts.push((
                format!(
                    "#### Speaking for {} {{#conversation-{slug}-{ordinal}}}",
                    names.join(", ")
                ),
                None,
            ));
            parts.push((
                item.markdown().trim().to_string(),
                Some(ItemRef { kind, ordinal }),
            ));
        }
    }
    parts
}

/// [`conversation_parts`] as one Markdown block. The Post body and the combined preview both
/// render exactly this through the production renderer.
pub fn conversation_markdown(record: &SharedPublication, synthesis: &SynthesisSet) -> String {
    conversation_parts(record, synthesis)
        .into_iter()
        .map(|(text, _)| text)
        .collect::<Vec<_>>()
        .join("\n\n")
}

/// Build the Post for `record` dated `date` (RFC 3339), or say why not. Pure. With a `structure`
/// the sections follow its reading order and are wrapped in the arranged markup of [`compose`]
/// (ADR 0031), and credits are one per participant at their first appearance (ADR 0030); without
/// one the sections are the participants' drafts in participant order. Part marker lines never
/// reach the Post either way. The approved conversation block follows the sections. `moments`
/// bind into the approvals the gate evaluates (ADR 0063), and a moment proposed for the piece that
/// no longer fits its source refuses it. Once the gate passes, every moment proposed for the
/// piece has been approved by every required author, and the moments are appended last, after a
/// section break, as their public projection ([`published_moment::block_markdown`], ADR 0066), so
/// the authors' prose and its reading order are untouched. Private moments never enter.
#[allow(clippy::too_many_arguments)]
pub fn assemble(
    record: &SharedPublication,
    structure: Option<&ReflectionStructure>,
    drafts: &DraftSet,
    synthesis: &SynthesisSet,
    moments: &MomentSet,
    approvals: &ApprovalSet,
    active: &[&str],
    date: &str,
) -> Result<Assembly, AssemblyError> {
    assemble_for_participants(
        record, structure, drafts, synthesis, moments, approvals, active, active, date,
    )
}

/// Assemble using the current participants eligible for whole-piece approval.
#[allow(clippy::too_many_arguments)]
pub fn assemble_for_participants(
    record: &SharedPublication,
    structure: Option<&ReflectionStructure>,
    drafts: &DraftSet,
    synthesis: &SynthesisSet,
    moments: &MomentSet,
    approvals: &ApprovalSet,
    active: &[&str],
    participants: &[&str],
    date: &str,
) -> Result<Assembly, AssemblyError> {
    assemble_inner(
        record,
        structure,
        drafts,
        synthesis,
        moments,
        approvals,
        active,
        participants,
        date,
        None,
    )
}

/// Assemble with explicit, approval-bound participant credit choices.
#[allow(clippy::too_many_arguments)]
pub fn assemble_for_participants_with_credits(
    record: &SharedPublication,
    structure: Option<&ReflectionStructure>,
    drafts: &DraftSet,
    synthesis: &SynthesisSet,
    moments: &MomentSet,
    approvals: &ApprovalSet,
    active: &[&str],
    participants: &[&str],
    date: &str,
    choices: &crate::shared_credit::CreditChoices,
) -> Result<Assembly, AssemblyError> {
    assemble_inner(
        record,
        structure,
        drafts,
        synthesis,
        moments,
        approvals,
        active,
        participants,
        date,
        Some(choices),
    )
}

#[allow(clippy::too_many_arguments)]
fn assemble_inner(
    record: &SharedPublication,
    structure: Option<&ReflectionStructure>,
    drafts: &DraftSet,
    synthesis: &SynthesisSet,
    moments: &MomentSet,
    approvals: &ApprovalSet,
    active: &[&str],
    participants: &[&str],
    date: &str,
    choices: Option<&crate::shared_credit::CreditChoices>,
) -> Result<Assembly, AssemblyError> {
    if !record.allows_approval_scope(approvals.policy().scope) {
        return Err(AssemblyError::ApprovalScope);
    }
    // The approvals are evaluated before anything reads a draft. Checking the arrangement against
    // the drafts first would refuse differently depending on whether a draft has a given part, an
    // oracle on unrevealed prose for a coordinator who may arrange but not read (ADR 0031). Only a
    // piece whose approvals are met can be refused as `ArrangementMismatch`, below.
    let readiness = match choices {
        Some(choices) => with_credit_subject_for_participants(
            record,
            structure,
            drafts,
            synthesis,
            moments,
            active,
            participants,
            choices,
            |subject| approvals.evaluate(subject),
        )
        .map_err(|_| AssemblyError::Invalid)?,
        None => with_subject_for_participants(
            record,
            structure,
            drafts,
            synthesis,
            moments,
            active,
            participants,
            |subject| approvals.evaluate(subject),
        ),
    };
    match readiness {
        Ok(Readiness::Ready) => {}
        Ok(Readiness::Blocked { gaps, .. }) if !gaps.is_empty() => {
            return Err(AssemblyError::RuleUnmet {
                named: display_names(record, gaps.named.iter().map(String::as_str)),
                roles: gaps.roles,
            })
        }
        Ok(Readiness::Blocked { missing, .. }) => {
            return Err(AssemblyError::Blocked {
                missing: display_names(record, missing.iter().map(String::as_str)),
            })
        }
        Ok(Readiness::QuorumBlocked { approved, required }) => {
            return Err(AssemblyError::QuorumBlocked { approved, required })
        }
        Err(_) => return Err(AssemblyError::Invalid),
    }
    // Shared prose publishes only with every named author's approval of that exact item.
    let awaited = unapproved_item_authors(synthesis);
    if !awaited.is_empty() {
        return Err(AssemblyError::Blocked {
            missing: display_names(record, awaited.iter().map(String::as_str)),
        });
    }
    if !moments.unresolved(&record.sources).is_empty() {
        return Err(AssemblyError::UnresolvedMoment);
    }
    let projected = choices
        .map(|choices| {
            public_credit_projection(record, drafts, synthesis, moments, active, choices)
        })
        .transpose()?;
    let public_record = projected.as_ref().map_or(record, |(record, _)| record);
    let title = record
        .title
        .as_deref()
        .map(str::trim)
        .filter(|title| !title.is_empty())
        .ok_or(AssemblyError::Invalid)?;

    let credit_for = |participant_id: &str| -> Result<serde_json::Value, AssemblyError> {
        let binding = record
            .authorization
            .bindings
            .iter()
            .find(|binding| binding.participant_id == participant_id)
            .ok_or(AssemblyError::Invalid)?;
        Ok(serde_json::json!({
            "contributor": binding.contributor_id,
            "roles": [{ "vocabulary": "crossref", "role": "author" }],
        }))
    };
    let mut prose = Vec::new();
    let mut credits = Vec::new();
    let mut arranged = None;
    if let Some(structure) = structure {
        // The same latest revisions the approval's binding covers, in the one reading order. A
        // turn naming a part an author has since removed is a coordinator's fix, so it gets its
        // own error; it is reached only once the approvals are met.
        let order = structure
            .reading_order(&public_record.collaboration, drafts)
            .map_err(|_| AssemblyError::ArrangementMismatch)?;
        let order: Vec<_> = order
            .into_iter()
            .filter(|entry| active.contains(&entry.participant_id) && entry.markdown.is_some())
            .collect();
        let placements = ReflectionStructure::placements(structure.layout, &order);
        let mut turns = Vec::new();
        let mut bound: Vec<Option<&str>> = Vec::new();
        let mut credited: Vec<&str> = Vec::new();
        for (entry, placement) in order.iter().zip(placements) {
            let text = entry.markdown.as_deref().unwrap_or_default().trim();
            if text.is_empty() {
                return Err(AssemblyError::Invalid);
            }
            if !credited.contains(&entry.participant_id) {
                credited.push(entry.participant_id);
                if choices.is_none() {
                    credits.push(credit_for(entry.participant_id)?);
                }
            }
            prose.push(text.to_string());
            bound.push(match &projected {
                Some((_, projection)) => projection.contributor_id(entry.participant_id),
                None => record
                    .authorization
                    .bindings
                    .iter()
                    .find(|binding| binding.participant_id == entry.participant_id)
                    .map(|binding| binding.contributor_id.as_str()),
            });
            turns.push(ComposedTurn {
                round: entry.round,
                round_prompt: structure.rounds[entry.round].round_prompt.as_deref(),
                display_name: entry.display_name,
                label: entry.label,
                placement,
                body: text.to_string(),
            });
        }
        arranged = Some(compose_bound(structure.layout, &turns, &bound));
    } else {
        for participant in &record.collaboration.participants {
            if !active.contains(&participant.id.as_str()) {
                continue;
            }
            // The same latest revision the approval's binding covers, because the gate above
            // just evaluated it against these drafts.
            let Some(view) = drafts.latest_view(&participant.id) else {
                continue;
            };
            if choices.is_none() {
                credits.push(credit_for(&participant.id)?);
            }
            prose.push(strip_part_markers(&view.markdown).trim().to_string());
        }
    }
    if prose.is_empty() || prose.iter().any(String::is_empty) {
        return Err(AssemblyError::Invalid);
    }

    let conversation = conversation_chunks(public_record, synthesis);
    match unsafe_markup(&prose, &conversation) {
        None => {}
        Some(error) => return Err(error),
    }
    let mut body = arranged.unwrap_or_else(|| prose.join(SECTION_BREAK));
    if !conversation.is_empty() {
        body.push_str(SECTION_BREAK);
        body.push_str(&conversation_markdown(public_record, synthesis));
    }
    let public =
        published_moment::published(public_record, moments).ok_or(AssemblyError::Invalid)?;
    if !public.is_empty() {
        let observations: Vec<&str> = public
            .iter()
            .filter_map(|moment| moment.observation.as_deref())
            .collect();
        let conversation_texts: Vec<&str> =
            conversation.iter().map(|(text, _)| text.as_str()).collect();
        if !observations_isolated(&prose, &conversation_texts, &observations) {
            return Err(AssemblyError::UnsafeMoment);
        }
        let before = body.len();
        body.push_str(SECTION_BREAK);
        body.push_str(&published_moment::block_markdown(&public));
        // Every public form reads the moments back from the body; refuse rather than publish a
        // block one of them would not recognise.
        if MomentsBlock::parse(&body)
            != Some(MomentsBlock {
                before,
                moments: public,
            })
        {
            return Err(AssemblyError::UnsafeMoment);
        }
    }

    let mut fields: BTreeMap<String, Value> = BTreeMap::new();
    let scalar = |value: &str| Value::Scalar(value.to_string());
    let slug = slug::limit(&slug::slugify(title), 80);
    fields.insert("title".into(), scalar(title));
    fields.insert(
        "slug".into(),
        scalar(if slug.is_empty() {
            &record.publication_id
        } else {
            &slug
        }),
    );
    fields.insert("date".into(), scalar(date));
    // The automatic summary draws on the sections only, so a short piece's description never
    // runs into the generated conversation (attribution headings, unfinished item prose).
    // Written explicitly because the renderer's own fallback would use the whole body.
    let lead = crate::markdown::render(&prose.join(SECTION_BREAK), Default::default());
    let description = crate::markdown::excerpt(lead.text.trim_end(), 180);
    if !description.is_empty() {
        fields.insert("description".into(), scalar(&description));
    }
    if let Some(attribution) = SharedAttribution::from_record(record) {
        if let Some(question) = &attribution.question {
            fields.insert(QUESTION_KEY.into(), scalar(question));
        }
        if let Some(source) = &attribution.source {
            fields.insert(SOURCE_TITLE_KEY.into(), scalar(&source.title));
            if let Some(url) = &source.url {
                fields.insert(SOURCE_URL_KEY.into(), scalar(url));
            }
            fields.insert(SOURCE_KIND_KEY.into(), scalar(source.kind.label()));
        }
    }
    // The ordinary series front matter: the site's own series definition supplies the title,
    // description, theme and navigation (ADR 0038). Approved with the rest (`public_metadata`).
    if let Some(placement) = &record.series {
        placement.validate().map_err(|_| AssemblyError::Invalid)?;
        fields.insert(SERIES_KEY.into(), scalar(&placement.series));
        if let Some(order) = placement.order {
            fields.insert(SERIES_ORDER_KEY.into(), scalar(&order.to_string()));
        }
    }
    let path = post_path(record);
    let credits_path = crate::contributor::sidecar_path(&path).ok_or(AssemblyError::Invalid)?;
    let credits = match choices {
        Some(choices) => {
            let credit_order =
                publication_credit_order(record, structure, drafts, synthesis, moments, active)?;
            let ids = credit_order.iter().map(String::as_str).collect::<Vec<_>>();
            choices
                .project(&ids)
                .map_err(|_| AssemblyError::Invalid)?
                .sidecar()
                .to_string()
        }
        None => {
            let text = serde_json::to_string_pretty(&serde_json::json!({
                "version": 1, "credits": credits,
            }))
            .map_err(|_| AssemblyError::Invalid)?;
            format!("{text}\n")
        }
    };
    Ok(Assembly {
        path,
        source: frontmatter::compose(&fields, &body),
        credits_path,
        credits,
    })
}

/// Whether the joined body would publish anything but each author's own approved prose: raw
/// HTML, an active link or image address, heading attributes beyond an id and classes, or
/// Markdown in one section that changes how another renders (an open fence, a reference
/// definition, a footnote). Checked on the exact parse the site renders with, both with and
/// without smart punctuation because the site setting is not known here.
///
/// `conversation` is the generated synthesis block, each chunk with the item it carries when it
/// is item prose. Its own headings are trusted. Each prose chunk is held to the same rules as a
/// section, may not carry a heading of level one to four (it would break the page outline under
/// the generated headings), and must parse the same inside the block as alone.
///
/// `None` is safe, otherwise the refusal to return: a section's, or an item's. A section
/// heading (by its id or its text) may not claim an anchor the generated block owns.
fn unsafe_markup(
    sections: &[String],
    conversation: &[(String, Option<ItemRef>)],
) -> Option<AssemblyError> {
    if sections
        .iter()
        .any(|text| synthesis::claims_reserved_anchor(text))
    {
        return Some(AssemblyError::ReservedSectionAnchor);
    }
    for (text, item) in conversation {
        if let Some(item) = item {
            if let Err(rule) = synthesis::check_item_markdown(text) {
                return Some(AssemblyError::UnsafeConversationItem(rule, *item));
            }
        }
    }
    has_unsafe_markup(sections, conversation)
}

const TAIL_SENTINEL: &str = "tail";

/// Parsing `parts` joined by `joiner` equals parsing each alone (with a rule between them when
/// `rule`), so no part can reach into its neighbour.
fn isolated_parts(
    parts: &[&str],
    joiner: &str,
    rule: bool,
    options: pulldown_cmark::Options,
) -> bool {
    use pulldown_cmark::{Event, Parser};
    let joined = parts.join(joiner);
    // Each part ends in the newline the join gives it, so a trailing indented code block parses
    // the same alone as in place.
    let terminated: Vec<String> = parts.iter().map(|part| format!("{part}\n")).collect();
    let mut separate: Vec<Event<'_>> = Vec::new();
    for (index, part) in terminated.iter().enumerate() {
        if index > 0 && rule {
            separate.push(Event::Rule);
        }
        separate.extend(Parser::new_ext(part, options));
    }
    Parser::new_ext(&joined, options).collect::<Vec<_>>() == separate
}

/// Whether each approved observation stays inside its moment: it parses the same in the Post as
/// alone, with the sections and the conversation before it and the frame lines (stood for by
/// sentinels) around it, and its links are ones the site build publishes. Observations already
/// refuse raw HTML, headings, images and footnotes (ADR 0062); this catches what only shows in
/// context, such as a reference definition another part would use or a fence left open.
fn observations_isolated(
    sections: &[String],
    conversation: &[&str],
    observations: &[&str],
) -> bool {
    use pulldown_cmark::{Event, Parser, Tag};
    let conversation = conversation.join("\n\n");
    for smart in [false, true] {
        let options = crate::markdown::parser_options(smart);
        let mut blocks: Vec<&str> = sections.iter().map(String::as_str).collect();
        blocks.push(TAIL_SENTINEL);
        if !conversation.is_empty() {
            blocks.push(&conversation);
        }
        for observation in observations {
            blocks.push(observation);
            blocks.push(TAIL_SENTINEL);
        }
        if !isolated_parts(&blocks, SECTION_BREAK, true, options) {
            return false;
        }
        for observation in observations {
            let unsafe_link = Parser::new_ext(observation, options).any(|event| match event {
                Event::Start(Tag::Link { dest_url, .. }) => {
                    !crate::portability::link_is_publishable(&dest_url)
                }
                Event::Html(_) | Event::InlineHtml(_) | Event::Start(Tag::Image { .. }) => true,
                _ => false,
            });
            if unsafe_link {
                return false;
            }
        }
    }
    // A paragraph that is only a video link would render as a player in the Post (ADR 0066:
    // no embed is ever written), so the page would not match the preview.
    !observations
        .iter()
        .any(|observation| crate::markdown::has_standalone_embed(observation))
}

fn has_unsafe_markup(
    sections: &[String],
    conversation: &[(String, Option<ItemRef>)],
) -> Option<AssemblyError> {
    use pulldown_cmark::{Event, HeadingLevel, Parser, Tag};
    let unsafe_address = |address: &str| {
        let compact: String = address
            .chars()
            .filter(|c| !c.is_control() && !c.is_whitespace())
            .collect::<String>()
            .to_ascii_lowercase();
        match compact.find([':', '/', '?', '#']) {
            Some(at) if compact.as_bytes()[at] == b':' => {
                !matches!(&compact[..at], "http" | "https" | "mailto" | "tel")
            }
            _ => false,
        }
    };
    let scan = |events: &[Event<'_>], outline: bool| {
        events.iter().any(|event| match event {
            Event::Html(_) | Event::InlineHtml(_) => true,
            Event::Start(Tag::Heading { attrs, level, .. }) => {
                !attrs.is_empty()
                    || (outline
                        && matches!(
                            level,
                            HeadingLevel::H1
                                | HeadingLevel::H2
                                | HeadingLevel::H3
                                | HeadingLevel::H4
                        ))
            }
            // Whatever the site build's link resolution refuses (a credential-bearing address, a
            // control character) would fail the whole build, so it is refused here instead.
            Event::Start(Tag::Link { dest_url, .. } | Tag::Image { dest_url, .. }) => {
                unsafe_address(dest_url) || !crate::portability::link_is_publishable(dest_url)
            }
            _ => false,
        })
    };
    let isolated = isolated_parts;
    let texts: Vec<&str> = conversation.iter().map(|(text, _)| text.as_str()).collect();
    // The item a failure is about, given the first chunk count at which a check fails: the last
    // item at or before that chunk. Falls back to the first item.
    let item_at = |chunks: usize| {
        conversation[..chunks.min(conversation.len())]
            .iter()
            .rev()
            .find_map(|(_, item)| *item)
            .or_else(|| conversation.iter().find_map(|(_, item)| *item))
    };
    let item_fault = |chunks: usize| {
        item_at(chunks).map_or(AssemblyError::UnsafeMarkup, |item| {
            AssemblyError::UnsafeConversationItem(ItemRule::Markup, item)
        })
    };
    for smart in [false, true] {
        let options = crate::markdown::parser_options(smart);
        // A sentinel section after the last one stands for the markup that follows the prose in
        // the published Post (the arrangement's closing tags): an open fence in the last section
        // would swallow it, so it must stay a separate section like every other boundary.
        let mut section_blocks: Vec<&str> = sections.iter().map(String::as_str).collect();
        section_blocks.push(TAIL_SENTINEL);
        let with_block = |chunks: usize| {
            let block = texts[..chunks].join("\n\n");
            let mut blocks = section_blocks.clone();
            if chunks > 0 {
                blocks.push(&block);
            }
            isolated(&blocks, SECTION_BREAK, true, options)
        };
        if !with_block(texts.len()) {
            // The sections may be fine alone and only break because of the generated block (an
            // item's reference definition reaching a section), which is the item's fault.
            if !isolated(&section_blocks, SECTION_BREAK, true, options) {
                return Some(AssemblyError::UnsafeMarkup);
            }
            let first = (1..=texts.len()).find(|n| !with_block(*n)).unwrap_or(1);
            return Some(item_fault(first));
        }
        if !isolated(&texts, "\n\n", false, options) {
            let first = (1..=texts.len())
                .find(|n| !isolated(&texts[..*n], "\n\n", false, options))
                .unwrap_or(1);
            return Some(item_fault(first));
        }
        if sections
            .iter()
            .any(|text| scan(&Parser::new_ext(text, options).collect::<Vec<_>>(), false))
        {
            return Some(AssemblyError::UnsafeMarkup);
        }
        for (text, item) in conversation {
            if let Some(item) = item {
                if scan(&Parser::new_ext(text, options).collect::<Vec<_>>(), true) {
                    return Some(AssemblyError::UnsafeConversationItem(
                        ItemRule::Markup,
                        *item,
                    ));
                }
            }
        }
    }
    None
}

/// The identity of one draft revision included in the approval subject.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PublishedSectionRevision {
    pub contribution_id: String,
    pub participant_id: String,
    pub revision: u64,
    pub digest: String,
}

/// Private receipt for the approved section revisions and the canonical files that were published.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PublishedRevision {
    pub policy_revision: u64,
    pub sections: Vec<PublishedSectionRevision>,
    pub source_digest: String,
    pub credits_digest: String,
}

fn receipt_digest(bytes: &[u8]) -> String {
    Blake2s256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn valid_receipt_digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

impl PublishedRevision {
    #[allow(clippy::too_many_arguments)]
    pub fn capture(
        record: &SharedPublication,
        structure: Option<&ReflectionStructure>,
        drafts: &DraftSet,
        synthesis: &SynthesisSet,
        moments: &MomentSet,
        approvals: &ApprovalSet,
        active: &[&str],
        assembly: &Assembly,
    ) -> Self {
        let sections = with_subject(
            record,
            structure,
            drafts,
            synthesis,
            moments,
            active,
            |subject| {
                subject
                    .sections
                    .iter()
                    .map(|section| PublishedSectionRevision {
                        contribution_id: section.contribution_id.to_string(),
                        participant_id: section.owner.to_string(),
                        revision: section.revision,
                        digest: section.digest.to_string(),
                    })
                    .collect()
            },
        );
        Self {
            policy_revision: approvals.policy_revision(),
            sections,
            source_digest: receipt_digest(assembly.source.as_bytes()),
            credits_digest: receipt_digest(assembly.credits.as_bytes()),
        }
    }

    fn is_valid(&self) -> bool {
        let mut ids = std::collections::HashSet::new();
        !self.sections.is_empty()
            && self.sections.len() <= crate::collaboration::MAX_CONTRIBUTIONS
            && self.sections.iter().all(|section| {
                crate::collaboration::valid_id(&section.contribution_id)
                    && crate::collaboration::valid_id(&section.participant_id)
                    && section.revision > 0
                    && valid_receipt_digest(&section.digest)
                    && ids.insert(section.contribution_id.to_ascii_lowercase())
            })
            && valid_receipt_digest(&self.source_digest)
            && valid_receipt_digest(&self.credits_digest)
    }

    pub fn matches_files(&self, source: &str, credits: &str) -> bool {
        self.source_digest == receipt_digest(source.as_bytes())
            && self.credits_digest == receipt_digest(credits.as_bytes())
    }
}

/// What happened to a publication after approval. Absent means neither scheduled nor published.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(
    tag = "state",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum Outcome {
    /// Held privately until `publish_at`, then published only if the approvals still hold.
    /// `requested_by` is the Admin account whose grant is checked again when it fires.
    Scheduled {
        version: u8,
        publish_at: i64,
        requested_by: String,
    },
    /// The Post and its credits were written. A retry changes nothing.
    Published {
        version: u8,
        published_at: i64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        revision: Option<PublishedRevision>,
    },
}

impl Outcome {
    pub fn scheduled(publish_at: i64, requested_by: &str) -> Self {
        Self::Scheduled {
            version: OUTCOME_VERSION,
            publish_at,
            requested_by: requested_by.to_string(),
        }
    }

    pub fn published(published_at: i64) -> Self {
        Self::Published {
            version: OUTCOME_VERSION,
            published_at,
            revision: None,
        }
    }

    pub fn published_with_revision(published_at: i64, revision: PublishedRevision) -> Self {
        Self::Published {
            version: OUTCOME_VERSION,
            published_at,
            revision: Some(revision),
        }
    }

    pub fn from_json(source: &str) -> Option<Self> {
        if source.len() > MAX_OUTCOME_BYTES {
            return None;
        }
        let outcome: Self = serde_json::from_str(source).ok()?;
        let valid = match &outcome {
            Self::Scheduled {
                version,
                publish_at,
                requested_by,
            } => {
                *version == OUTCOME_VERSION
                    && *publish_at >= 0
                    && valid_admin_username(requested_by)
            }
            Self::Published {
                version,
                published_at,
                revision,
            } => {
                *version == OUTCOME_VERSION
                    && *published_at >= 0
                    && revision.as_ref().is_none_or(PublishedRevision::is_valid)
            }
        };
        valid.then_some(outcome)
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string(self).expect("an outcome always serializes")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_observation_that_is_only_a_video_link_is_refused_at_the_gate() {
        let sections = vec!["Ann words.".to_string()];
        assert!(observations_isolated(
            &sections,
            &[],
            &["The talk at https://www.youtube.com/watch?v=abcdefghijk moved me."]
        ));
        for observation in [
            "https://www.youtube.com/watch?v=abcdefghijk",
            "<https://www.youtube.com/watch?v=abcdefghijk>",
            "Mine.\n\n[https://youtu.be/abcdefghijk](https://youtu.be/abcdefghijk)",
        ] {
            assert!(
                !observations_isolated(&sections, &[], &["Fine.", observation]),
                "{observation:?}"
            );
        }
    }
}
