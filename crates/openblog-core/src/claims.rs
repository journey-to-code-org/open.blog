//! Private claims and evidence links for Evidence Studio.
//!
//! A claim is a statement in a draft post, optionally anchored to a span of
//! its UTF-8 source. An evidence link is the author's own record that one
//! source (and optionally one notebook passage and locators inside it)
//! supports, contradicts or contextualizes that claim.
//!
//! Everything is private author research until a later, explicit projection
//! copies what is approved. Nothing here judges evidence: there is no score,
//! no net result, no verdict, and no link is ever created from a citation or
//! inferred from text. A relation exists only because the author recorded it.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{Map, Value};

use crate::knowledge_atlas::{
    atlas_diagnostic, check_attribution, check_evidence, item_diagnostic, looks_like_atlas, open,
    parse_attribution, parse_evidence, too_large, AtlasDiagnostic, AtlasDiagnosticCode as Code,
    Attribution, Confidence, Evidence, Links, Visibility, MAX_SHORT_CHARS, MAX_UNCERTAINTY_CHARS,
};
use crate::research_notes::bidi_override;

/// The only claims file version this release reads and writes.
pub const CLAIMS_VERSION: u64 = 1;
pub const MAX_CLAIMS_BYTES: usize = 4 * 1024 * 1024;
pub const MAX_CLAIMS: usize = 20_000;
pub const MAX_LINKS: usize = 100_000;
const MAX_STATEMENT_CHARS: usize = 2_000;
const MAX_RATIONALE_CHARS: usize = 4_000;
const CLAIMS_FIELDS: &[&str] = &["version", "claims", "links"];
const CREDIT_FIELDS: &[&str] = &["credit", "credits", "contributor", "contributors"];

/// How a source bears on a claim, as the author reads it. Required on every
/// link and never defaulted: a citation alone asserts none of these.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Relation {
    Supports,
    Contradicts,
    Contextualizes,
}

impl Relation {
    pub const ALL: [Relation; 3] = [Self::Supports, Self::Contradicts, Self::Contextualizes];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Supports => "supports",
            Self::Contradicts => "contradicts",
            Self::Contextualizes => "contextualizes",
        }
    }

    fn parse(value: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|r| r.as_str() == value)
    }
}

/// What a person, never the software, has done to check a link.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ReviewState {
    /// Recorded, nobody has compared it to the source.
    Unreviewed,
    /// The author confirmed the locator points where the source says.
    LocationChecked,
    /// The author read the passage and stands behind the stated relation.
    Reviewed,
}

impl ReviewState {
    fn parse(value: &str) -> Option<Self> {
        match value {
            "unreviewed" => Some(Self::Unreviewed),
            "location-checked" => Some(Self::LocationChecked),
            "reviewed" => Some(Self::Reviewed),
            _ => None,
        }
    }
}

/// Where a record came from. A suggestion (for example from an assistant)
/// is never the author's reading until the author reviews it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Origin {
    Authored,
    Suggested,
}

/// A span of the draft's UTF-8 source, as byte offsets, with the exact text
/// seen there when it was recorded so a later edit can be detected.
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
pub struct Anchor {
    pub start: usize,
    pub end: usize,
    pub text: String,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

/// What the current draft says about an anchor. Nothing is moved or repaired
/// on the author's behalf.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AnchorCheck {
    /// The recorded text is still at the recorded offsets.
    Verified,
    /// The text occurs exactly once, elsewhere: report, do not rewrite.
    Moved { start: usize },
    /// The text no longer occurs.
    Stale,
    /// The text occurs more than once and the offsets no longer match.
    Ambiguous,
}

impl Anchor {
    pub fn check(&self, draft: &str) -> AnchorCheck {
        if draft.get(self.start..self.end) == Some(self.text.as_str()) {
            return AnchorCheck::Verified;
        }
        let mut found = draft.match_indices(self.text.as_str()).map(|(i, _)| i);
        match (found.next(), found.next()) {
            (None, _) => AnchorCheck::Stale,
            (Some(start), None) => AnchorCheck::Moved { start },
            _ => AnchorCheck::Ambiguous,
        }
    }
}

/// A statement made in one draft post.
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
pub struct Claim {
    /// Immutable identity, unique across claims and links.
    pub id: String,
    /// The post whose draft makes the claim (its slug). Whether it exists is
    /// decided where the content is known.
    pub post: String,
    /// The claim in the author's words.
    pub statement: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub anchor: Option<Anchor>,
    /// What is doubtful or unsettled about the claim itself.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uncertainty: Option<String>,
    #[serde(rename = "recordedBy")]
    pub recorded_by: Attribution,
    pub origin: Origin,
    pub visibility: Visibility,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

/// One recorded relation between a claim and one piece of evidence.
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
pub struct EvidenceLink {
    pub id: String,
    pub claim: String,
    pub relation: Relation,
    /// A library source, optional locators and optional private passage, the
    /// same shape and rules as Knowledge Atlas evidence.
    pub evidence: Evidence,
    /// Why the author reads the source this way. Private unless approved.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rationale: Option<String>,
    pub confidence: Confidence,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uncertainty: Option<String>,
    #[serde(rename = "reviewState")]
    pub review_state: ReviewState,
    #[serde(rename = "recordedBy")]
    pub recorded_by: Attribution,
    pub origin: Origin,
    pub visibility: Visibility,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

/// Counts per relation. Deliberately three numbers that are never combined.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, serde::Serialize)]
pub struct RelationCounts {
    pub supports: usize,
    pub contradicts: usize,
    pub contextualizes: usize,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize)]
pub struct ClaimSet {
    pub version: u64,
    pub claims: Vec<Claim>,
    pub links: Vec<EvidenceLink>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

impl Default for ClaimSet {
    fn default() -> Self {
        Self {
            version: CLAIMS_VERSION,
            claims: Vec::new(),
            links: Vec::new(),
            extra: BTreeMap::new(),
        }
    }
}

fn valid_post(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_SHORT_CHARS
        && value != "."
        && !value.contains("..")
        && !value
            .chars()
            .any(|c| c.is_control() || bidi_override(c) || matches!(c, '/' | '\\' | ':'))
}

fn free_text(
    ctx: &mut crate::knowledge_atlas::Ctx<'_>,
    obj: &mut crate::knowledge_atlas::Obj,
    key: &str,
    max: usize,
) -> Option<String> {
    obj.text(ctx, key, false, max, true)
}

fn parse_choice<T>(
    ctx: &mut crate::knowledge_atlas::Ctx<'_>,
    obj: &mut crate::knowledge_atlas::Obj,
    key: &str,
    parse: fn(&str) -> Option<T>,
    default: Option<T>,
    hint: &str,
) -> Option<T> {
    match obj.map.remove(key) {
        None => match default {
            Some(value) => Some(value),
            None => {
                ctx.report(Code::MissingField, key, hint);
                None
            }
        },
        Some(Value::String(text)) => {
            let parsed = parse(&text);
            if parsed.is_none() {
                ctx.report(Code::InvalidField, key, hint);
            }
            parsed
        }
        Some(_) => {
            ctx.report(Code::InvalidField, key, "must be a string");
            None
        }
    }
}

fn parse_origin(value: &str) -> Option<Origin> {
    match value {
        "authored" => Some(Origin::Authored),
        "suggested" => Some(Origin::Suggested),
        _ => None,
    }
}

fn parse_recorded_by(
    ctx: &mut crate::knowledge_atlas::Ctx<'_>,
    obj: &mut crate::knowledge_atlas::Obj,
) -> Option<Attribution> {
    if obj.map.contains_key("recordedBy") {
        obj.object(ctx, "recordedBy", true)
            .and_then(|o| parse_attribution(ctx, o))
    } else {
        Some(Attribution::author())
    }
}

fn parse_anchor(
    ctx: &mut crate::knowledge_atlas::Ctx<'_>,
    obj: &mut crate::knowledge_atlas::Obj,
) -> Option<Anchor> {
    let mut anchor = obj.object(ctx, "anchor", false)?;
    let number = |anchor: &mut crate::knowledge_atlas::Obj,
                  ctx: &mut crate::knowledge_atlas::Ctx<'_>,
                  key: &str| match anchor.map.remove(key) {
        Some(Value::Number(n)) => n
            .as_u64()
            .and_then(|v| usize::try_from(v).ok())
            .or_else(|| {
                ctx.report(
                    Code::InvalidField,
                    &format!("anchor.{key}"),
                    "must be a non-negative integer",
                );
                None
            }),
        Some(_) => {
            ctx.report(
                Code::InvalidField,
                &format!("anchor.{key}"),
                "must be a non-negative integer",
            );
            None
        }
        None => {
            ctx.report(Code::MissingField, &format!("anchor.{key}"), "is required");
            None
        }
    };
    let start = number(&mut anchor, ctx, "start");
    let end = number(&mut anchor, ctx, "end");
    // The recorded span text is the author's own draft prose, not a quotation.
    let text = anchor.text(ctx, "text", true, MAX_STATEMENT_CHARS, true);
    let (start, end, text) = (start?, end?, text?);
    if start >= end || end - start != text.len() {
        ctx.report(
            Code::AnchorMismatch,
            "anchor",
            "`start` and `end` are UTF-8 byte offsets and must span exactly the bytes of `text`",
        );
        return None;
    }
    Some(Anchor {
        start,
        end,
        text,
        extra: anchor.rest(),
    })
}

fn parse_claim(
    index: usize,
    raw: Value,
    diagnostics: &mut Vec<AtlasDiagnostic>,
) -> (Option<String>, Option<Claim>) {
    let Some((mut ctx, mut obj)) = open("claims", index, raw, diagnostics) else {
        return (None, None);
    };
    let known = ctx.id.clone();
    let id = obj.id(&mut ctx, "id", "claim identifier", true);
    obj.reject_credits(&mut ctx);
    let visibility = obj.visibility(&mut ctx);
    let post = obj.text(&mut ctx, "post", true, MAX_SHORT_CHARS, false);
    if post.as_deref().is_some_and(|p| !valid_post(p)) {
        ctx.report(
            Code::InvalidField,
            "post",
            "must be a post slug, not a path",
        );
    }
    let statement = obj.text(&mut ctx, "statement", true, MAX_STATEMENT_CHARS, true);
    let anchor = parse_anchor(&mut ctx, &mut obj);
    let uncertainty = free_text(&mut ctx, &mut obj, "uncertainty", MAX_UNCERTAINTY_CHARS);
    let recorded_by = parse_recorded_by(&mut ctx, &mut obj);
    let origin = parse_choice(
        &mut ctx,
        &mut obj,
        "origin",
        parse_origin,
        Some(Origin::Authored),
        "use authored or suggested",
    );
    if origin == Some(Origin::Suggested) && visibility == Visibility::Approved {
        ctx.report(
            Code::InvalidVisibility,
            "visibility",
            "a suggested claim cannot be approved; edit it as the author's own first",
        );
    }
    let failed = ctx.failed;
    let extra = obj.rest();
    match (id, post, statement, recorded_by, origin, failed) {
        (Some(id), Some(post), Some(statement), Some(recorded_by), Some(origin), false) => (
            Some(id.clone()),
            Some(Claim {
                id,
                post,
                statement,
                anchor,
                uncertainty,
                recorded_by,
                origin,
                visibility,
                extra,
            }),
        ),
        (id, ..) => (id.or(known), None),
    }
}

fn parse_link(
    index: usize,
    raw: Value,
    diagnostics: &mut Vec<AtlasDiagnostic>,
) -> (Option<String>, Option<EvidenceLink>) {
    let Some((mut ctx, mut obj)) = open("links", index, raw, diagnostics) else {
        return (None, None);
    };
    let known = ctx.id.clone();
    let id = obj.id(&mut ctx, "id", "link identifier", true);
    obj.reject_credits(&mut ctx);
    let visibility = obj.visibility(&mut ctx);
    let claim = obj.id(&mut ctx, "claim", "claim identifier", true);
    let relation = parse_choice(
        &mut ctx,
        &mut obj,
        "relation",
        Relation::parse,
        None,
        "use supports, contradicts, or contextualizes; a link states how the source bears on the claim and a citation alone does not",
    );
    // One piece of evidence per link, so each relation is individually
    // reviewable and approvable; opposing links coexist as separate links.
    let evidence = match obj.map.remove("evidence") {
        Some(item @ Value::Object(_)) => parse_evidence(&mut ctx, "evidence", item),
        Some(_) => {
            ctx.report(
                Code::InvalidField,
                "evidence",
                "must be one evidence object",
            );
            None
        }
        None => {
            ctx.report(
                Code::MissingEvidence,
                "evidence",
                "name the source this link rests on",
            );
            None
        }
    };
    let rationale = free_text(&mut ctx, &mut obj, "rationale", MAX_RATIONALE_CHARS);
    let confidence = parse_choice(
        &mut ctx,
        &mut obj,
        "confidence",
        Confidence::parse,
        Some(Confidence::Tentative),
        "use tentative, plausible, or strong",
    );
    let uncertainty = free_text(&mut ctx, &mut obj, "uncertainty", MAX_UNCERTAINTY_CHARS);
    let review_state = parse_choice(
        &mut ctx,
        &mut obj,
        "reviewState",
        ReviewState::parse,
        Some(ReviewState::Unreviewed),
        "use unreviewed, location-checked, or reviewed",
    );
    let recorded_by = parse_recorded_by(&mut ctx, &mut obj);
    let origin = parse_choice(
        &mut ctx,
        &mut obj,
        "origin",
        parse_origin,
        Some(Origin::Authored),
        "use authored or suggested",
    );
    let failed = ctx.failed;
    let extra = obj.rest();
    match (
        id,
        claim,
        relation,
        evidence,
        confidence,
        review_state,
        recorded_by,
        origin,
        failed,
    ) {
        (
            Some(id),
            Some(claim),
            Some(relation),
            Some(evidence),
            Some(confidence),
            Some(review_state),
            Some(recorded_by),
            Some(origin),
            false,
        ) => (
            Some(id.clone()),
            Some(EvidenceLink {
                id,
                claim,
                relation,
                evidence,
                rationale,
                confidence,
                uncertainty,
                review_state,
                recorded_by,
                origin,
                visibility,
                extra,
            }),
        ),
        (id, ..) => (id.or(known), None),
    }
}

impl ClaimSet {
    /// Parse and validate a serialized claims file against the source library
    /// and notebook it points into. Every problem is returned at once, scoped
    /// to the item and field; nothing is partially accepted.
    pub fn parse(text: &str, links: Links<'_>) -> Result<Self, Vec<AtlasDiagnostic>> {
        if text.len() > MAX_CLAIMS_BYTES {
            return Err(vec![too_large()]);
        }
        let text = text.strip_prefix('\u{feff}').unwrap_or(text);
        match serde_json::from_str(text) {
            Ok(value) => Self::from_value(value, links),
            Err(error) => Err(vec![atlas_diagnostic(
                Code::InvalidJson,
                None,
                format!("invalid JSON: {error}"),
            )]),
        }
    }

    fn from_value(value: Value, links: Links<'_>) -> Result<Self, Vec<AtlasDiagnostic>> {
        let fail = |code, field: &str, message: String| {
            Err(vec![atlas_diagnostic(code, Some(field), message)])
        };
        let Value::Object(mut root) = value else {
            return fail(
                Code::InvalidField,
                "",
                "the claims file must be a JSON object".into(),
            );
        };
        match root.remove("version") {
            Some(Value::Number(n)) if n.as_u64() == Some(CLAIMS_VERSION) => {}
            Some(Value::Number(n)) if n.as_u64().is_some_and(|v| v > CLAIMS_VERSION) => {
                return fail(
                    Code::UnsupportedVersion,
                    "version",
                    format!("claims version {n} was written by a newer open.blog; upgrade before editing so newer data is not lost"),
                );
            }
            Some(_) => {
                return fail(
                    Code::UnsupportedVersion,
                    "version",
                    format!("version must be {CLAIMS_VERSION}"),
                )
            }
            None => {
                return fail(
                    Code::MissingField,
                    "version",
                    format!("add `\"version\": {CLAIMS_VERSION}`"),
                )
            }
        }
        let mut take = |key: &str, max: usize| match root.remove(key) {
            Some(Value::Array(items)) if items.len() > max => Err(vec![atlas_diagnostic(
                Code::TooLarge,
                Some(key),
                format!("a claims file may hold at most {max} {key}"),
            )]),
            Some(Value::Array(items)) => Ok(items),
            Some(_) => Err(vec![atlas_diagnostic(
                Code::InvalidField,
                Some(key),
                "must be a JSON array",
            )]),
            None => Ok(Vec::new()),
        };
        let raw_claims = take("claims", MAX_CLAIMS)?;
        let raw_links = take("links", MAX_LINKS)?;

        let mut diagnostics = Vec::new();
        for key in root.keys().filter(|k| CREDIT_FIELDS.contains(&k.as_str())) {
            diagnostics.push(atlas_diagnostic(
                Code::ContributorCredit,
                Some(key),
                "contributor credits stay in `.credits.json` sidecars",
            ));
        }
        let mut claims = Vec::new();
        let mut evidence_links = Vec::new();
        let mut identities: Vec<(&'static str, usize, String)> = Vec::new();
        for (index, raw) in raw_claims.into_iter().enumerate() {
            let (id, claim) = parse_claim(index, raw, &mut diagnostics);
            identities.extend(id.map(|id| ("claims", index, id)));
            claims.extend(claim.map(|c| (index, c)));
        }
        for (index, raw) in raw_links.into_iter().enumerate() {
            let (id, link) = parse_link(index, raw, &mut diagnostics);
            identities.extend(id.map(|id| ("links", index, id)));
            evidence_links.extend(link.map(|l| (index, l)));
        }
        check_set(
            &identities,
            &claims,
            &evidence_links,
            links,
            &mut diagnostics,
        );
        if !diagnostics.is_empty() {
            return Err(diagnostics);
        }
        let set = Self {
            version: CLAIMS_VERSION,
            claims: claims.into_iter().map(|(_, c)| c).collect(),
            links: evidence_links.into_iter().map(|(_, l)| l).collect(),
            extra: root.into_iter().collect(),
        };
        if set.to_json().len() > MAX_CLAIMS_BYTES {
            return Err(vec![too_large()]);
        }
        Ok(set)
    }

    /// Canonical, deterministic text: file order, defaults written, unknown
    /// fields kept, trailing newline.
    pub fn to_json(&self) -> String {
        let mut text = serde_json::to_string_pretty(self).unwrap_or_default();
        text.push('\n');
        text
    }

    pub fn claim(&self, id: &str) -> Option<&Claim> {
        self.claims.iter().find(|c| c.id == id)
    }

    pub fn link(&self, id: &str) -> Option<&EvidenceLink> {
        self.links.iter().find(|l| l.id == id)
    }

    /// Every link on a claim in file order. No relation is sorted ahead of or
    /// behind another, so contradicting links are never pushed out of view.
    pub fn links_of<'a>(&'a self, claim: &'a str) -> impl Iterator<Item = &'a EvidenceLink> {
        self.links.iter().filter(move |l| l.claim == claim)
    }

    /// Links per relation, never combined into one figure.
    pub fn counts(&self, claim: &str) -> RelationCounts {
        let mut counts = RelationCounts::default();
        for link in self.links_of(claim) {
            match link.relation {
                Relation::Supports => counts.supports += 1,
                Relation::Contradicts => counts.contradicts += 1,
                Relation::Contextualizes => counts.contextualizes += 1,
            }
        }
        counts
    }

    /// Claim ids of one post, in file order.
    pub fn claims_of_post<'a>(&'a self, post: &'a str) -> impl Iterator<Item = &'a Claim> {
        self.claims.iter().filter(move |c| c.post == post)
    }

    /// Whether an approved link may reach a public projection: it and its
    /// claim are both approved. Private rationale is a separate decision for
    /// the projection and never follows from this.
    pub fn is_projected(&self, link: &EvidenceLink) -> bool {
        link.visibility == Visibility::Approved
            && self
                .claim(&link.claim)
                .is_some_and(|c| c.visibility == Visibility::Approved)
    }

    /// Sources and passages that claims depend on, so a removal elsewhere can
    /// be refused while they are used.
    pub fn uses_of_source(&self, source: &str) -> Vec<String> {
        self.links
            .iter()
            .filter(|l| l.evidence.source == source)
            .map(|l| l.id.clone())
            .collect()
    }

    pub fn uses_of_passage(&self, passage: &str) -> Vec<String> {
        self.links
            .iter()
            .filter(|l| l.evidence.passage.as_deref() == Some(passage))
            .map(|l| l.id.clone())
            .collect()
    }

    fn validated(candidate: &Self, links: Links<'_>) -> Result<Self, Vec<AtlasDiagnostic>> {
        let value = serde_json::to_value(candidate).map_err(|error| {
            vec![atlas_diagnostic(
                Code::InvalidJson,
                None,
                format!("the claims could not be serialized: {error}"),
            )]
        })?;
        let reread = Self::from_value(value, links)?;
        let message = "an unknown field cannot shadow a defined field";
        let mut shadowed = Vec::new();
        for key in candidate
            .extra
            .keys()
            .filter(|k| CLAIMS_FIELDS.contains(&k.as_str()))
        {
            shadowed.push(atlas_diagnostic(Code::ShadowedField, Some(key), message));
        }
        for (index, (a, b)) in candidate.claims.iter().zip(&reread.claims).enumerate() {
            if a != b {
                shadowed.push(item_diagnostic(
                    Code::ShadowedField,
                    "claims",
                    index,
                    &a.id,
                    "",
                    message,
                ));
            }
        }
        for (index, (a, b)) in candidate.links.iter().zip(&reread.links).enumerate() {
            if a != b {
                shadowed.push(item_diagnostic(
                    Code::ShadowedField,
                    "links",
                    index,
                    &a.id,
                    "",
                    message,
                ));
            }
        }
        if shadowed.is_empty() {
            Ok(reread)
        } else {
            Err(shadowed)
        }
    }

    /// Add a claim or replace the one with the same id in place; the set
    /// changes only when the whole result is valid.
    pub fn upsert_claim(
        &mut self,
        claim: Claim,
        links: Links<'_>,
    ) -> Result<(), Vec<AtlasDiagnostic>> {
        let mut candidate = self.clone();
        match candidate.claims.iter().position(|c| c.id == claim.id) {
            Some(index) => candidate.claims[index] = claim,
            None => candidate.claims.push(claim),
        }
        *self = Self::validated(&candidate, links)?;
        Ok(())
    }

    pub fn upsert_link(
        &mut self,
        link: EvidenceLink,
        links: Links<'_>,
    ) -> Result<(), Vec<AtlasDiagnostic>> {
        let mut candidate = self.clone();
        match candidate.links.iter().position(|l| l.id == link.id) {
            Some(index) => candidate.links[index] = link,
            None => candidate.links.push(link),
        }
        *self = Self::validated(&candidate, links)?;
        Ok(())
    }

    /// Remove a link. Always allowed: removing evidence never edits a claim.
    pub fn remove_link(&mut self, id: &str, links: Links<'_>) -> Result<(), Vec<AtlasDiagnostic>> {
        let Some(index) = self.links.iter().position(|l| l.id == id) else {
            return Err(vec![unknown("links", id)]);
        };
        let mut candidate = self.clone();
        candidate.links.remove(index);
        *self = Self::validated(&candidate, links)?;
        Ok(())
    }

    /// Remove a claim, refused while any link rests on it so no link is
    /// orphaned and no contradicting link is dropped silently with it.
    pub fn remove_claim(&mut self, id: &str, links: Links<'_>) -> Result<(), Vec<AtlasDiagnostic>> {
        let Some(index) = self.claims.iter().position(|c| c.id == id) else {
            return Err(vec![unknown("claims", id)]);
        };
        let linked: Vec<_> = self
            .links
            .iter()
            .enumerate()
            .filter(|(_, l)| l.claim == id)
            .map(|(i, l)| {
                item_diagnostic(
                    Code::StillLinked,
                    "links",
                    i,
                    &l.id,
                    "claim",
                    "remove or reassign this evidence link before removing its claim",
                )
            })
            .collect();
        if !linked.is_empty() {
            return Err(linked);
        }
        let mut candidate = self.clone();
        candidate.claims.remove(index);
        *self = Self::validated(&candidate, links)?;
        Ok(())
    }
}

fn unknown(collection: &'static str, id: &str) -> AtlasDiagnostic {
    AtlasDiagnostic {
        code: Code::UnknownClaim,
        collection: Some(collection),
        index: None,
        id: Some(id.into()),
        field: None,
        message: format!("nothing in {collection} has the id `{id}`"),
    }
}

fn check_set(
    identities: &[(&'static str, usize, String)],
    claims: &[(usize, Claim)],
    links_in: &[(usize, EvidenceLink)],
    links: Links<'_>,
    diagnostics: &mut Vec<AtlasDiagnostic>,
) {
    let mut seen = BTreeSet::new();
    for (collection, index, id) in identities {
        if !seen.insert(id.as_str()) {
            diagnostics.push(item_diagnostic(
                Code::DuplicateId,
                collection,
                *index,
                id,
                "id",
                "ids are unique across claims and links",
            ));
        }
    }
    let claim_ids: BTreeSet<&str> = identities
        .iter()
        .filter(|(collection, ..)| *collection == "claims")
        .map(|(_, _, id)| id.as_str())
        .collect();
    let by_id: BTreeMap<&str, &Claim> = claims.iter().map(|(_, c)| (c.id.as_str(), c)).collect();
    for (index, claim) in claims {
        let report = |code, field: &str, message: String| {
            item_diagnostic(code, "claims", *index, &claim.id, field, message)
        };
        check_attribution(
            &claim.recorded_by,
            "recordedBy",
            links,
            &report,
            diagnostics,
        );
    }
    let mut keys: BTreeSet<String> = BTreeSet::new();
    for (index, link) in links_in {
        let report = |code, field: &str, message: String| {
            item_diagnostic(code, "links", *index, &link.id, field, message)
        };
        check_attribution(&link.recorded_by, "recordedBy", links, &report, diagnostics);
        check_evidence(&link.evidence, "evidence", links, &report, diagnostics);
        let Some(claim) = by_id.get(link.claim.as_str()) else {
            // A claim that failed to read already has its own diagnostics.
            if claim_ids.contains(link.claim.as_str()) {
                continue;
            }
            diagnostics.push(report(
                Code::UnknownClaim,
                "claim",
                format!("no claim has the id `{}`", link.claim),
            ));
            continue;
        };
        let locators = serde_json::to_string(&link.evidence.locators).unwrap_or_default();
        let key = format!(
            "{}\u{0}{}\u{0}{}\u{0}{locators}\u{0}{}",
            link.claim,
            link.relation.as_str(),
            link.evidence.source,
            link.evidence.passage.as_deref().unwrap_or("")
        );
        if !keys.insert(key) {
            diagnostics.push(report(
                Code::DuplicateLink,
                "evidence",
                "this claim already has a link with the same relation, source, locators and passage".into(),
            ));
        }
        if link.visibility == Visibility::Approved {
            if claim.visibility != Visibility::Approved {
                diagnostics.push(report(
                    Code::PrivateEndpoint,
                    "visibility",
                    "an approved link needs its claim approved too; approval never exposes a private claim".into(),
                ));
            }
            if link.evidence.passage.is_some() {
                diagnostics.push(report(
                    Code::PrivateReference,
                    "evidence.passage",
                    "an approved link may not carry a private notebook passage; cite the source and locators".into(),
                ));
            }
            if link.origin == Origin::Suggested && link.review_state != ReviewState::Reviewed {
                diagnostics.push(report(
                    Code::InvalidVisibility,
                    "visibility",
                    "a suggested link must be reviewed by the author before it is approved".into(),
                ));
            }
        }
    }
    // Support may not be published while contradiction is withheld.
    for (index, link) in links_in {
        if link.relation != Relation::Supports || link.visibility != Visibility::Approved {
            continue;
        }
        let withheld = links_in.iter().any(|(_, other)| {
            other.claim == link.claim
                && other.relation == Relation::Contradicts
                && other.visibility != Visibility::Approved
        });
        if withheld {
            diagnostics.push(item_diagnostic(
                Code::UndisclosedContradiction,
                "links",
                *index,
                &link.id,
                "visibility",
                "this claim has a contradicting link that is still private; approve it too, or withdraw this approval, so support is not published alone",
            ));
        }
    }
}

/// Whether a parsed JSON object has the shape of a claims file, judged by
/// structure only, so a copy saved into a public folder can be refused.
pub fn looks_like_claims(root: &Map<String, Value>) -> bool {
    if looks_like_atlas(root) || root.get("version").and_then(Value::as_u64).is_none() {
        return false;
    }
    let list = |key: &str| root.get(key).and_then(Value::as_array);
    let (claims, links) = (list("claims"), list("links"));
    if claims.is_none() && links.is_none() {
        return false;
    }
    let text = |item: &Value, key: &str| item.get(key).is_some_and(Value::is_string);
    let claim_like =
        |item: &Value| text(item, "id") && text(item, "post") && text(item, "statement");
    let link_like = |item: &Value| {
        text(item, "id")
            && text(item, "claim")
            && item.get("evidence").is_some_and(Value::is_object)
            && item
                .get("relation")
                .and_then(Value::as_str)
                .and_then(Relation::parse)
                .is_some()
    };
    let all = claims.is_none_or(|i| i.iter().all(claim_like))
        && links.is_none_or(|i| i.iter().all(link_like));
    let any = claims.is_some_and(|i| !i.is_empty()) || links.is_some_and(|i| !i.is_empty());
    all && any
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::research_notes::Notebook;
    use crate::source_library::SourceLibrary;
    use serde_json::json;

    fn library() -> SourceLibrary {
        let text = json!({"version": 1, "sources": [
            {"id": "plato-republic", "kind": "work", "title": "Politeia"},
            {"id": "republic-slings", "kind": "edition", "of": "plato-republic", "title": "Edition"},
            {"id": "scholar-book", "kind": "work", "title": "A study"}
        ]})
        .to_string();
        SourceLibrary::parse(&text, &BTreeMap::new()).expect("library")
    }

    fn notebook() -> Notebook {
        let text = json!({"version": 1,
            "passages": [{"id": "p-cave", "source": "republic-slings", "excerpt": {"text": "the cave"}}],
            "notes": []})
        .to_string();
        Notebook::parse(&text, &library()).expect("notebook")
    }

    fn parse(value: Value) -> Result<ClaimSet, Vec<AtlasDiagnostic>> {
        let (library, notebook) = (library(), notebook());
        ClaimSet::parse(
            &value.to_string(),
            Links {
                library: &library,
                notebook: &notebook,
            },
        )
    }

    fn sample() -> Value {
        json!({"version": 1,
            "claims": [{"id": "c1", "post": "on-caves", "statement": "The cave is an allegory of education.",
                "anchor": {"start": 4, "end": 10, "text": "caves!"}},
              {"id": "c2", "post": "on-caves", "statement": "Plato wrote it late."}],
            "links": [
              {"id": "l1", "claim": "c1", "relation": "supports",
               "evidence": {"source": "republic-slings", "passage": "p-cave",
                            "locators": [{"kind": "page", "value": "514"}]},
               "rationale": "Socrates says so directly."},
              {"id": "l2", "claim": "c1", "relation": "contradicts",
               "evidence": {"source": "scholar-book"}},
              {"id": "l3", "claim": "c1", "relation": "contextualizes",
               "evidence": {"source": "scholar-book"}}]})
    }

    fn codes(result: Result<ClaimSet, Vec<AtlasDiagnostic>>) -> Vec<Code> {
        result
            .expect_err("expected failure")
            .into_iter()
            .map(|d| d.code)
            .collect()
    }

    fn with(mut base: Value, path: &str, index: usize, key: &str, value: Value) -> Value {
        base[path][index][key] = value;
        base
    }

    fn with_id(mut v: Value, id: &str) -> Value {
        v["id"] = json!(id);
        v
    }

    #[test]
    fn relations_round_trip_and_defaults_are_written() {
        let set = parse(sample()).expect("valid");
        assert_eq!(
            set.counts("c1"),
            RelationCounts {
                supports: 1,
                contradicts: 1,
                contextualizes: 1
            }
        );
        assert_eq!(set.claims[0].visibility, Visibility::Private);
        assert_eq!(set.links[0].review_state, ReviewState::Unreviewed);
        assert_eq!(set.links[0].origin, Origin::Authored);
        let text = set.to_json();
        assert!(
            text.contains("\"visibility\": \"private\"")
                && text.contains("\"reviewState\": \"unreviewed\"")
        );
        let (l, n) = (library(), notebook());
        let again = ClaimSet::parse(
            &text,
            Links {
                library: &l,
                notebook: &n,
            },
        )
        .unwrap();
        assert_eq!(again.to_json(), text);
        assert!(!text.contains("verdict") && !text.contains("score"));
    }

    #[test]
    fn a_citation_alone_asserts_nothing() {
        let mut v = sample();
        v["links"][0].as_object_mut().unwrap().remove("relation");
        assert_eq!(codes(parse(v)), [Code::MissingField]);
        let v = with(sample(), "links", 0, "relation", json!("proves"));
        assert_eq!(codes(parse(v)), [Code::InvalidField]);
        let mut v = sample();
        v["links"][0].as_object_mut().unwrap().remove("evidence");
        assert_eq!(codes(parse(v)), [Code::MissingEvidence]);
        let set =
            parse(json!({"version": 1, "claims": [{"id": "c", "post": "p", "statement": "S"}]}))
                .unwrap();
        assert_eq!(set.counts("c"), RelationCounts::default());
    }

    #[test]
    fn opposing_links_coexist_and_are_never_netted_or_hidden() {
        let set = parse(sample()).unwrap();
        let order: Vec<_> = set.links_of("c1").map(|l| l.relation).collect();
        assert_eq!(
            order,
            [
                Relation::Supports,
                Relation::Contradicts,
                Relation::Contextualizes
            ]
        );
        let mut v = sample();
        v["links"]
            .as_array_mut()
            .unwrap()
            .push(json!({"id": "l4", "claim": "c1",
            "relation": "contradicts",
            "evidence": {"source": "republic-slings", "passage": "p-cave",
                         "locators": [{"kind": "page", "value": "514"}]}}));
        assert!(parse(v).is_ok());
        let mut v = sample();
        let dup = v["links"][1].clone();
        v["links"].as_array_mut().unwrap().push(with_id(dup, "l9"));
        assert_eq!(codes(parse(v)), [Code::DuplicateLink]);
    }

    #[test]
    fn support_cannot_be_published_while_contradiction_is_withheld() {
        let mut v = sample();
        v["claims"][0]["visibility"] = json!("approved");
        v["links"][0]["visibility"] = json!("approved");
        v["links"][0]["evidence"]
            .as_object_mut()
            .unwrap()
            .remove("passage");
        assert_eq!(codes(parse(v.clone())), [Code::UndisclosedContradiction]);
        v["links"][1]["visibility"] = json!("approved");
        let set = parse(v).unwrap();
        assert!(set.is_projected(&set.links[0]) && set.is_projected(&set.links[1]));
        assert!(!set.is_projected(&set.links[2]));
    }

    #[test]
    fn claims_and_links_are_private_until_approved_and_approval_never_exposes_more() {
        let set = parse(sample()).unwrap();
        assert!(set.links.iter().all(|l| !set.is_projected(l)));
        let v = with(sample(), "links", 1, "visibility", json!("approved"));
        assert_eq!(codes(parse(v)), [Code::PrivateEndpoint]);
        let mut v = sample();
        v["claims"][0]["visibility"] = json!("approved");
        v["links"][0]["visibility"] = json!("approved");
        v["links"][1]["visibility"] = json!("approved");
        assert_eq!(codes(parse(v)), [Code::PrivateReference]);
        let v = with(sample(), "claims", 0, "visibility", json!("public"));
        assert_eq!(codes(parse(v)), [Code::InvalidVisibility]);
    }

    #[test]
    fn suggestions_are_not_the_authors_reading_until_reviewed() {
        let mut v = sample();
        v["claims"][0]["visibility"] = json!("approved");
        v["claims"][0]["origin"] = json!("suggested");
        assert_eq!(codes(parse(v)), [Code::InvalidVisibility]);
        let mut v = sample();
        v["claims"][0]["visibility"] = json!("approved");
        v["links"][1]["visibility"] = json!("approved");
        v["links"][1]["origin"] = json!("suggested");
        assert_eq!(codes(parse(v.clone())), [Code::InvalidVisibility]);
        v["links"][1]["reviewState"] = json!("reviewed");
        assert!(parse(v).is_ok());
    }

    #[test]
    fn orphans_unknown_sources_and_ambiguous_locators_are_scoped() {
        let v = with(sample(), "links", 0, "claim", json!("gone"));
        let errors = parse(v).unwrap_err();
        assert_eq!(errors[0].code, Code::UnknownClaim);
        assert_eq!(
            (errors[0].collection, errors[0].id.as_deref()),
            (Some("links"), Some("l1"))
        );
        assert_eq!(errors[0].field.as_deref(), Some("claim"));
        let mut v = sample();
        v["links"][1]["evidence"]["source"] = json!("nowhere");
        assert_eq!(codes(parse(v)), [Code::UnknownSource]);
        let mut v = sample();
        v["links"][0]["evidence"]["passage"] = json!("p-missing");
        assert_eq!(codes(parse(v)), [Code::UnknownPassage]);
        let mut v = sample();
        v["links"][0]["evidence"]["source"] = json!("scholar-book");
        v["links"][0]["evidence"]
            .as_object_mut()
            .unwrap()
            .remove("locators");
        assert_eq!(codes(parse(v)), [Code::UnknownPassage]);
        let mut v = sample();
        v["links"][1]["evidence"]["locators"] = json!([{"kind": "page", "value": "3"}]);
        assert_eq!(codes(parse(v)), [Code::AmbiguousLocator]);
        let v = with(sample(), "claims", 1, "id", json!("c1"));
        assert_eq!(codes(parse(v)), [Code::DuplicateId]);
    }

    #[test]
    fn anchors_are_checked_against_the_utf8_draft_without_repair() {
        let anchor = Anchor {
            start: 4,
            end: 10,
            text: "caves!".into(),
            extra: BTreeMap::new(),
        };
        assert_eq!(anchor.check("The caves! are"), AnchorCheck::Verified);
        assert_eq!(
            anchor.check("Oh, the caves! ok"),
            AnchorCheck::Moved { start: 8 }
        );
        assert_eq!(anchor.check("The cave"), AnchorCheck::Stale);
        assert_eq!(anchor.check("caves! and caves!"), AnchorCheck::Ambiguous);
        let inside = Anchor {
            start: 1,
            end: 3,
            text: "ab".into(),
            extra: BTreeMap::new(),
        };
        assert_eq!(inside.check("\u{e9} ab"), AnchorCheck::Moved { start: 3 });
        let mut v = sample();
        v["claims"][0]["anchor"] = json!({"start": 0, "end": 2, "text": "\u{e9}"});
        assert!(parse(v.clone()).is_ok());
        v["claims"][0]["anchor"] = json!({"start": 0, "end": 1, "text": "\u{e9}"});
        assert_eq!(codes(parse(v)), [Code::AnchorMismatch]);
        let v = with(
            sample(),
            "claims",
            0,
            "anchor",
            json!({"start": 5, "end": 5, "text": ""}),
        );
        assert!(parse(v).is_err());
    }

    #[test]
    fn uncertainty_and_provenance_are_recorded_not_judged() {
        let mut v = sample();
        v["links"][0]["confidence"] = json!("strong");
        v["links"][0]["uncertainty"] = json!("Translation disputed.");
        v["links"][0]["reviewState"] = json!("location-checked");
        v["links"][0]["recordedBy"] = json!({"kind": "named", "name": "A. Reviewer"});
        let set = parse(v).unwrap();
        assert_eq!(set.links[0].confidence, Confidence::Strong);
        assert_eq!(
            set.links[0].recorded_by.name.as_deref(),
            Some("A. Reviewer")
        );
        let v = with(sample(), "links", 0, "reviewState", json!("verified"));
        assert_eq!(codes(parse(v)), [Code::InvalidField]);
        let v = with(
            sample(),
            "links",
            0,
            "recordedBy",
            json!({"kind": "source", "source": "nowhere"}),
        );
        assert_eq!(codes(parse(v)), [Code::UnknownSource]);
    }

    #[test]
    fn credits_stay_out_and_unknown_fields_survive() {
        let v = with(sample(), "claims", 0, "credits", json!([]));
        assert_eq!(codes(parse(v)), [Code::ContributorCredit]);
        let mut v = sample();
        v["future"] = json!({"a": 1});
        v["claims"][0]["x-note"] = json!("keep");
        v["links"][0]["evidence"]["x-extra"] = json!(true);
        let text = parse(v).unwrap().to_json();
        assert!(text.contains("x-note") && text.contains("x-extra") && text.contains("future"));
        assert_eq!(
            codes(parse(json!({"version": 2, "claims": []}))),
            [Code::UnsupportedVersion]
        );
    }

    #[test]
    fn edits_are_all_or_nothing_and_removal_never_orphans() {
        let (library, notebook) = (library(), notebook());
        let links = Links {
            library: &library,
            notebook: &notebook,
        };
        let mut set = parse(sample()).unwrap();
        let before = set.to_json();
        let mut bad = set.links[0].clone();
        bad.claim = "gone".into();
        assert!(set.upsert_link(bad, links).is_err());
        assert!(set.remove_claim("c1", links).is_err());
        assert!(set.remove_claim("nope", links).is_err());
        let mut shadow = set.claims[1].clone();
        shadow.extra.insert("statement".into(), json!("x"));
        assert_eq!(
            set.upsert_claim(shadow, links).unwrap_err()[0].code,
            Code::ShadowedField
        );
        assert_eq!(set.to_json(), before);
        set.remove_link("l2", links).unwrap();
        assert_eq!(set.counts("c1").contradicts, 0);
        set.remove_claim("c2", links).unwrap();
        assert_eq!(set.uses_of_source("scholar-book"), ["l3"]);
        assert_eq!(set.uses_of_passage("p-cave"), ["l1"]);
    }

    #[test]
    fn hostile_and_oversized_input_is_refused_without_echo() {
        let secret = "ob-claims-secret";
        let v = with(
            sample(),
            "claims",
            0,
            "statement",
            json!(format!("{secret}\u{202e}")),
        );
        let errors = parse(v).unwrap_err();
        assert!(errors.iter().all(|d| !d.to_string().contains(secret)));
        let v = with(sample(), "claims", 0, "post", json!("../etc/passwd"));
        assert_eq!(codes(parse(v)), [Code::InvalidField]);
        let v = with(sample(), "links", 0, "rationale", json!("x".repeat(5000)));
        assert_eq!(codes(parse(v)), [Code::TooLarge]);
        assert_eq!(
            codes(parse(json!({"version": 1, "claims": 3}))),
            [Code::InvalidField]
        );
        assert_eq!(codes(parse(json!([1]))), [Code::InvalidField]);
        let (l, n) = (library(), notebook());
        let links = Links {
            library: &l,
            notebook: &n,
        };
        let big = format!(
            "{{\"version\":1,\"pad\":\"{}\"}}",
            "x".repeat(MAX_CLAIMS_BYTES)
        );
        assert_eq!(
            ClaimSet::parse(&big, links).unwrap_err()[0].code,
            Code::TooLarge
        );
        assert_eq!(
            ClaimSet::parse("{", links).unwrap_err()[0].code,
            Code::InvalidJson
        );
    }

    #[test]
    fn claims_files_are_recognised_by_structure_for_the_leak_guard() {
        let root = |v: Value| v.as_object().unwrap().clone();
        assert!(looks_like_claims(&root(sample())));
        assert!(!looks_like_claims(&root(
            json!({"version": 1, "claims": []})
        )));
        assert!(!looks_like_claims(&root(
            json!({"version": 1, "claims": [{"id": "x"}]})
        )));
        assert!(!looks_like_claims(&root(json!({"claims": [1]}))));
        let text = sample().to_string();
        assert!(crate::research_bundle::looks_like_private_research(
            text.as_bytes()
        ));
    }
}
