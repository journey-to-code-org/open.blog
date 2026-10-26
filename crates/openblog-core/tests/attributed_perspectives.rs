//! Stable attributed-perspective targets and author-response permissions
//! (RD11.1, ADRs 0160 to 0164): targets that survive a re-layout, reorder
//! and edit without ever pointing at other words, and a response only the
//! section's own bound contributor can write.

use openblog_core::attributed_perspective::{
    admit_response, anchor, authorize_author, response_shown, AttributedResponse,
    AttributedSections, AttributedTarget, ResponseError, ResponseRequest, StaleReason, Standing,
    ANCHOR_PREFIX,
};
use openblog_core::collaboration::{
    AuthorizationAction, AuthorizationRole, AuthorizationTarget, IdentityBinding, NewParticipant,
    NewSharedPublication, NewSourceReference, Participant, SharedPublication, SourceKind,
};
use openblog_core::config::SiteConfig;
use openblog_core::invitation::Identities;
use openblog_core::model::{LoadOptions, Site, SourceFile, Sources};
use openblog_core::moderation::{
    ItemFacts, ModerationAction, ModerationPolicy, ModerationState, PolicyError, Principal,
    Request, SharedWorks, MODERATION_TOKEN_ACTOR,
};
use openblog_core::participation::{ParticipationKind, ParticipationMode};
use openblog_core::passage_target::{PassageSelector, PassageTarget};
use openblog_core::reflection::{compose, ComposedTurn, Placement, ReflectionLayout};
use openblog_core::third_perspective::{PerspectiveTarget, TargetStatus};
use openblog_core::DateTime;

const PUBLICATION: &str = "shared-tides";
const WORK: &str = "/posts/shared-tides/";

const USERS: [&str; 7] = [
    "owner-admin",
    "coord-admin",
    "mina-admin",
    "joe-admin",
    "ed-admin",
    "rea-admin",
    "ghost-admin",
];
// `ghost` is in the registry and bound to nothing here.
const KEYS: [&str; 7] = ["owner", "coord", "mina", "joe", "ed", "rea", "ghost"];

fn identities() -> Identities<'static> {
    Identities {
        active_admin_users: &USERS,
        contributor_ids: &KEYS,
    }
}

fn member(record: &mut SharedPublication, name: &str, role: AuthorizationRole) {
    record.collaboration.participants.push(Participant {
        id: format!("p-{name}"),
        display_name: name.to_uppercase(),
        profile_url: None,
    });
    record.authorization.bindings.push(IdentityBinding {
        admin_user: format!("{name}-admin"),
        contributor_id: name.into(),
        participant_id: format!("p-{name}"),
        roles: vec![role],
    });
}

/// MINA and JOE write; a coordinator, an editor and a reader are bound too.
fn record() -> SharedPublication {
    let mut record = SharedPublication::create(&NewSharedPublication {
        publication_id: PUBLICATION.into(),
        title: "Tides, together".into(),
        guiding_question: String::new(),
        sources: vec![NewSourceReference {
            kind: SourceKind::Article,
            title: "Tide tables".into(),
            ..NewSourceReference::default()
        }],
        creator: NewParticipant {
            admin_user: "owner-admin".into(),
            contributor_id: "owner".into(),
            display_name: "OWNER".into(),
        },
    })
    .unwrap();
    member(&mut record, "coord", AuthorizationRole::Coordinator);
    member(&mut record, "mina", AuthorizationRole::Contributor);
    member(&mut record, "joe", AuthorizationRole::Contributor);
    member(&mut record, "ed", AuthorizationRole::Editor);
    member(&mut record, "rea", AuthorizationRole::Reader);
    record
}

fn site() -> Site {
    let config =
        SiteConfig::from_json(r#"{"title":"T","url":"https://t.dev","postPath":"/posts/{slug}/"}"#)
            .unwrap();
    Site::load(
        config,
        Sources {
            posts: vec![SourceFile {
                path: format!("posts/{PUBLICATION}.md"),
                contents: "---\ntitle: P\ndate: 2026-01-01\n---\nText".into(),
            }],
            ..Sources::default()
        },
        LoadOptions::default(),
    )
    .unwrap()
}

/// `(display name, text)` turns, one per round, composed as a published
/// reflection under `layout`.
fn body(layout: ReflectionLayout, turns: &[(&str, &str)]) -> String {
    let mut people: Vec<&str> = Vec::new();
    for (name, _) in turns {
        if !people.contains(name) {
            people.push(name);
        }
    }
    let composed: Vec<ComposedTurn<'_>> = turns
        .iter()
        .enumerate()
        .map(|(round, (name, text))| ComposedTurn {
            round,
            round_prompt: None,
            display_name: name,
            label: None,
            placement: match layout {
                ReflectionLayout::Sequential => Placement { lane: 0, lanes: 1 },
                _ => Placement {
                    lane: people.iter().position(|person| person == name).unwrap(),
                    lanes: people.len(),
                },
            },
            body: (*text).to_string(),
        })
        .collect();
    compose(layout, &composed)
}

const TURNS: [(&str, &str); 3] = [
    ("MINA", "The moon pulls the water."),
    ("JOE", "It is also the sun."),
    ("MINA", "Neither explains the harbour."),
];

fn sections(
    record: &SharedPublication,
    layout: ReflectionLayout,
    turns: &[(&str, &str)],
) -> AttributedSections {
    AttributedSections::from_published(record, &body(layout, turns))
}

fn target_of(sections: &AttributedSections, contribution: &str, nth: usize) -> AttributedTarget {
    sections
        .sections()
        .iter()
        .find(|section| section.contribution == contribution && section.nth == nth)
        .expect("section")
        .target()
}

// ---------------------------------------------------------------------------
// Targets

#[test]
fn a_target_is_an_ordinary_section_target_and_never_visual() {
    let record = record();
    let published = sections(&record, ReflectionLayout::SideBySide, &TURNS);
    let section = &published.sections()[2];
    assert_eq!(section.anchor(), "ob-by-p-mina-1");
    let target = section.target().perspective_target();
    // The stored form is B5's section target: no new shape to read.
    let json = target.to_json();
    assert!(json.contains("\"kind\":\"section\""));
    assert!(json.contains("ob-by-p-mina-1"));
    for visual in ["left", "right", "lane", "column", "side", "position"] {
        assert!(!json.contains(visual), "{visual}");
    }
    let back = PerspectiveTarget::from_value(&target.to_value()).unwrap();
    assert_eq!(
        AttributedTarget::from_perspective(&back).unwrap(),
        Some(section.target())
    );
    assert_eq!(section.digest.len(), 32);
}

#[test]
fn work_and_ordinary_section_targets_are_not_attributed() {
    assert_eq!(
        AttributedTarget::from_perspective(&PerspectiveTarget::work()),
        Ok(None)
    );
    let heading = PerspectiveTarget::section(Some("methods".into()), None);
    assert_eq!(AttributedTarget::from_perspective(&heading), Ok(None));
}

#[test]
fn a_reserved_anchor_must_be_canonical_and_carry_a_digest() {
    let digest = Some("0123456789abcdef0123456789abcdef".to_string());
    for bad in [
        "ob-by-",
        "ob-by-p-mina",
        "ob-by-p-mina-",
        "ob-by-p-mina-01",
        "ob-by-p-mina-1000",
        "ob-by--1",
        "ob-by-p..mina-1",
    ] {
        let target = PerspectiveTarget::section(Some(bad.into()), digest.clone());
        assert!(
            AttributedTarget::from_perspective(&target).is_err(),
            "{bad}"
        );
    }
    // Without the digest the author and place could point at other words.
    let bare = PerspectiveTarget::section(Some(anchor("p-mina", 0)), None);
    assert_eq!(
        AttributedTarget::from_perspective(&bare)
            .unwrap_err()
            .code(),
        "digest-required"
    );
    assert!(ANCHOR_PREFIX.starts_with("ob-"));
}

#[test]
fn a_quotation_or_a_sectionless_anchor_is_never_attributed() {
    // RD10 refuses a quotation as a Third Perspective target, so an attributed
    // section can only ever be a whole-section target.
    let quote = PassageTarget {
        section: Some(anchor("p-mina", 0)),
        selector: PassageSelector::Quote(openblog_core::passage_target::TextQuote {
            exact: "moon".into(),
            prefix: String::new(),
            suffix: String::new(),
            start: 0,
        }),
    };
    assert!(PerspectiveTarget::try_from(quote).is_err());
}

// ---------------------------------------------------------------------------
// Resolution

#[test]
fn reordering_or_relayout_keeps_every_target_on_its_own_words() {
    let record = record();
    let original = sections(&record, ReflectionLayout::Sequential, &TURNS);
    let joe = target_of(&original, "p-joe", 0);
    let mina_second = target_of(&original, "p-mina", 1);

    // Every layout, left and right swapped: same sections, same standing.
    for layout in ReflectionLayout::ALL {
        let relaid = sections(&record, layout, &TURNS);
        assert_eq!(relaid.sections(), original.sections(), "{layout:?}");
    }
    // Reordered: JOE first, MINA's two sections after.
    let reordered = sections(
        &record,
        ReflectionLayout::SideBySide,
        &[TURNS[1], TURNS[0], TURNS[2]],
    );
    assert_eq!(
        reordered.resolve(&joe),
        Standing::Current {
            nth: 0,
            moved: false,
            author: "JOE".into()
        }
    );
    // MINA's sections swap places: each target follows its text and says
    // that it moved, and none lands on the other's words.
    let swapped = sections(
        &record,
        ReflectionLayout::Sequential,
        &[TURNS[1], TURNS[2], TURNS[0]],
    );
    assert_eq!(
        swapped.resolve(&mina_second),
        Standing::Current {
            nth: 0,
            moved: true,
            author: "MINA".into()
        }
    );
}

#[test]
fn an_edited_section_is_stale_and_never_retargeted() {
    let record = record();
    let original = sections(&record, ReflectionLayout::Sequential, &TURNS);
    let first = target_of(&original, "p-mina", 0);
    let edited = sections(
        &record,
        ReflectionLayout::Sequential,
        &[("MINA", "The moon and the sun."), TURNS[1], TURNS[2]],
    );
    // MINA's other section is untouched but is not what was read.
    assert_eq!(
        edited.resolve(&first),
        Standing::Stale {
            reason: StaleReason::SectionChanged,
            author: Some("MINA".into())
        }
    );
    assert_eq!(
        edited.resolve(&first).target_status("p-mina"),
        TargetStatus::Stale {
            section_present: true
        }
    );
}

#[test]
fn a_deleted_section_or_author_keeps_honest_context() {
    let record = record();
    let original = sections(&record, ReflectionLayout::Sequential, &TURNS);
    let second = target_of(&original, "p-mina", 1);
    let joe = target_of(&original, "p-joe", 0);

    let without_second = sections(&record, ReflectionLayout::Sequential, &TURNS[..2]);
    assert_eq!(
        without_second.resolve(&second),
        Standing::Stale {
            reason: StaleReason::SectionRemoved,
            author: Some("MINA".into())
        }
    );
    // JOE left the work: nothing stands in, and no author is named.
    let without_joe = sections(&record, ReflectionLayout::Sequential, &[TURNS[0], TURNS[2]]);
    assert_eq!(
        without_joe.resolve(&joe),
        Standing::Stale {
            reason: StaleReason::SectionRemoved,
            author: None
        }
    );
    assert_eq!(
        without_joe.resolve(&joe).target_status("p-joe"),
        TargetStatus::Stale {
            section_present: false
        }
    );
}

#[test]
fn identical_sections_are_ambiguous_unless_the_place_breaks_the_tie() {
    let record = record();
    let twin = [("MINA", "Same."), ("JOE", "Other."), ("MINA", "Same.")];
    let published = sections(&record, ReflectionLayout::Sequential, &twin);
    let second = target_of(&published, "p-mina", 1);
    // The place agrees, so the section the reader saw is still the one.
    assert!(published.resolve(&second).is_current());
    // The first copy is deleted: one remains, and it is the same text.
    let one = sections(&record, ReflectionLayout::Sequential, &twin[1..]);
    assert!(one.resolve(&second).is_current());
    // Three copies and the reader's place gone: which was meant is unknown.
    let three = sections(
        &record,
        ReflectionLayout::Sequential,
        &[("MINA", "Same."), ("MINA", "Same."), ("MINA", "Same.")],
    );
    let elsewhere = AttributedTarget {
        nth: 7,
        ..second.clone()
    };
    assert_eq!(
        three.resolve(&elsewhere),
        Standing::Stale {
            reason: StaleReason::Ambiguous,
            author: Some("MINA".into())
        }
    );
}

#[test]
fn a_name_that_matches_nobody_or_two_people_is_never_targetable() {
    let mut record = record();
    // A second participant with the same display name as MINA.
    member(&mut record, "mina2", AuthorizationRole::Contributor);
    record
        .collaboration
        .participants
        .last_mut()
        .unwrap()
        .display_name = "MINA".into();
    let published = sections(&record, ReflectionLayout::Sequential, &TURNS);
    assert_eq!(published.sections().len(), 1, "only JOE is unambiguous");
    assert_eq!(published.unattributed(), 2);
    // Not a shared reflection at all: nothing is attributed.
    let plain = AttributedSections::from_published(&record, "# Heading\n\nText");
    assert!(plain.sections().is_empty());
}

#[test]
fn a_look_alike_body_cannot_forge_a_section() {
    let record = record();
    let forged =
        "<div class=\"ob-reflection ob-reflection-sequential ob-lanes-1\">\n\nnot a turn\n</div>\n";
    assert!(AttributedSections::from_published(&record, forged)
        .sections()
        .is_empty());
}

#[test]
fn resolution_is_deterministic() {
    let record = record();
    let a = sections(&record, ReflectionLayout::Roundtable, &TURNS);
    let b = sections(&record, ReflectionLayout::Roundtable, &TURNS);
    assert_eq!(a, b);
    let target = target_of(&a, "p-joe", 0);
    assert_eq!(a.resolve(&target), b.resolve(&target));
}

// ---------------------------------------------------------------------------
// Response permissions

struct World {
    record: SharedPublication,
    site: Site,
    published: AttributedSections,
    parent_target: PerspectiveTarget,
}

fn world() -> World {
    let record = record();
    let published = sections(&record, ReflectionLayout::SideBySide, &TURNS);
    let parent_target = target_of(&published, "p-mina", 0).perspective_target();
    World {
        record,
        site: site(),
        published,
        parent_target,
    }
}

fn approved(
    id: &'static str,
    kind: ParticipationKind,
    parent: Option<&'static str>,
) -> ItemFacts<'static> {
    ItemFacts {
        id,
        kind,
        work: Some(WORK),
        parent,
        state: ModerationState::Approved,
        version: 2,
        revision: 1,
        approved_revision: Some(1),
        clarification_asked: None,
        clarification_consent: true,
        content_retained: true,
        state_since: DateTime::from_unix(1_800_000_000),
    }
}

fn respond_to(
    world: &World,
    principal: Principal<'_>,
    admin_user: &str,
    parent: &ItemFacts<'_>,
    parent_target: &PerspectiveTarget,
    published: &AttributedSections,
    identities: &Identities<'_>,
) -> Result<AttributedResponse, ResponseError> {
    let records = [world.record.clone()];
    let works = SharedWorks::new(&records, &world.site);
    let actor = works.actor(principal, Some(WORK), identities);
    admit_response(
        &ModerationPolicy::new(Default::default()),
        &ResponseRequest {
            id: "response-1",
            record: &world.record,
            identities,
            admin_user,
            actor,
            work: WORK,
            mode: ParticipationMode::Open,
            parent,
            parent_mode: ParticipationMode::Open,
            parent_target,
            sections: published,
            at: DateTime::from_unix(1_800_000_100),
        },
    )
}

fn respond(
    world: &World,
    principal: Principal<'_>,
    admin_user: &str,
    parent: &ItemFacts<'_>,
    identities: &Identities<'_>,
) -> Result<AttributedResponse, ResponseError> {
    respond_to(
        world,
        principal,
        admin_user,
        parent,
        &world.parent_target,
        &world.published,
        identities,
    )
}

fn session(admin_user: &str) -> Principal<'_> {
    Principal::AdminSession { admin_user }
}

fn perspective() -> ItemFacts<'static> {
    approved("perspective-1", ParticipationKind::ThirdPerspective, None)
}

#[test]
fn the_sections_own_contributor_answers_and_the_answer_starts_pending() {
    let world = world();
    let answer = respond(
        &world,
        session("mina-admin"),
        "mina-admin",
        &perspective(),
        &identities(),
    )
    .expect("mina wrote the section");
    assert_eq!(answer.admission.state, ModerationState::Pending);
    assert_eq!(
        answer.admission.audit.actor_id.as_deref(),
        Some("mina-admin")
    );
    assert_eq!(
        answer.admission.audit.related.as_deref(),
        Some("perspective-1")
    );
    assert_eq!(answer.responder.participant, "p-mina");
    assert_eq!(answer.responder.author, "MINA");
    assert!(answer.responder.standing.is_current());
}

#[test]
fn nobody_else_can_answer_as_that_author() {
    let world = world();
    let identities = identities();
    // Another contributor, the coordinator, the site owner, an editor, a
    // reader, an account in the registry bound to nothing, an unknown
    // account and the moderation token: the same refusal, whoever asks.
    for admin_user in [
        "joe-admin",
        "coord-admin",
        "owner-admin",
        "ed-admin",
        "rea-admin",
        "ghost-admin",
        "nobody",
    ] {
        assert_eq!(
            respond(
                &world,
                session(admin_user),
                admin_user,
                &perspective(),
                &identities
            )
            .unwrap_err(),
            ResponseError::Denied,
            "{admin_user}"
        );
    }
    assert_eq!(
        respond(
            &world,
            Principal::ModerationToken,
            MODERATION_TOKEN_ACTOR,
            &perspective(),
            &identities
        )
        .unwrap_err(),
        ResponseError::Denied
    );
}

#[test]
fn impersonation_and_a_registry_key_alone_are_refused() {
    let world = world();
    // Joe's session claiming to be mina-admin: the request's account and the
    // resolved actor must agree.
    assert_eq!(
        respond(
            &world,
            session("joe-admin"),
            "mina-admin",
            &perspective(),
            &identities()
        )
        .unwrap_err(),
        ResponseError::Denied
    );
    // The key `mina` is no longer in the registry.
    let without_key = Identities {
        active_admin_users: &USERS,
        contributor_ids: &["owner", "coord", "joe", "ed", "rea"],
    };
    assert_eq!(
        respond(
            &world,
            session("mina-admin"),
            "mina-admin",
            &perspective(),
            &without_key
        )
        .unwrap_err(),
        ResponseError::Denied
    );
    // A deactivated account.
    let inactive = Identities {
        active_admin_users: &["owner-admin", "joe-admin"],
        contributor_ids: &KEYS,
    };
    assert_eq!(
        respond(
            &world,
            session("mina-admin"),
            "mina-admin",
            &perspective(),
            &inactive
        )
        .unwrap_err(),
        ResponseError::Denied
    );
}

#[test]
fn registry_identity_without_the_contributor_role_grants_nothing() {
    let mut world = world();
    let index = world
        .record
        .authorization
        .bindings
        .iter()
        .position(|binding| binding.participant_id == "p-mina")
        .unwrap();
    // Mina is demoted to editor: still in the registry, still bound.
    world.record.authorization.bindings[index].roles = vec![AuthorizationRole::Editor];
    assert_eq!(
        respond(
            &world,
            session("mina-admin"),
            "mina-admin",
            &perspective(),
            &identities()
        )
        .unwrap_err(),
        ResponseError::Denied
    );
    // The contributor role on that participant is the grant, whatever else
    // the binding holds.
    world.record.authorization.bindings[index].roles = vec![
        AuthorizationRole::Coordinator,
        AuthorizationRole::Contributor,
    ];
    assert!(respond(
        &world,
        session("mina-admin"),
        "mina-admin",
        &perspective(),
        &identities()
    )
    .is_ok());
}

#[test]
fn the_grant_is_the_contributors_own_participant_only() {
    let world = world();
    let identities = identities();
    let grant = |admin_user: &str, participant: &str| {
        world
            .record
            .authorize(
                admin_user,
                &identities,
                AuthorizationAction::RespondAsAuthor,
                AuthorizationTarget::Participant(participant),
            )
            .is_ok()
    };
    assert!(grant("mina-admin", "p-mina"));
    assert!(grant("joe-admin", "p-joe"));
    assert!(!grant("mina-admin", "p-joe"));
    assert!(!grant("coord-admin", "p-mina"));
    assert!(!grant("coord-admin", "p-coord"));
    assert!(!grant("owner-admin", "p-mina"));
    assert!(!grant("ed-admin", "p-ed"));
    assert!(!grant("rea-admin", "p-rea"));
    assert_eq!(
        authorize_author(&world.record, &identities, "mina-admin", "p-mina"),
        Ok(())
    );
    assert_eq!(
        authorize_author(&world.record, &identities, "mina-admin", "p-joe"),
        Err(ResponseError::Denied)
    );
}

#[test]
fn in_a_group_work_each_author_answers_only_their_own_sections() {
    let world = world();
    let identities = identities();
    let joe_target = target_of(&world.published, "p-joe", 0).perspective_target();
    assert!(respond_to(
        &world,
        session("joe-admin"),
        "joe-admin",
        &perspective(),
        &joe_target,
        &world.published,
        &identities
    )
    .is_ok());
    assert_eq!(
        respond_to(
            &world,
            session("mina-admin"),
            "mina-admin",
            &perspective(),
            &joe_target,
            &world.published,
            &identities
        )
        .unwrap_err(),
        ResponseError::Denied
    );
    // A perspective on the whole work is not attributed: this module grants
    // nothing and RD12's generic author response applies.
    assert_eq!(
        respond_to(
            &world,
            session("joe-admin"),
            "joe-admin",
            &perspective(),
            &PerspectiveTarget::work(),
            &world.published,
            &identities
        )
        .unwrap_err(),
        ResponseError::NotAttributed
    );
}

#[test]
fn a_changed_section_can_still_be_answered_but_a_gone_or_renamed_author_cannot() {
    let world = world();
    let identities = identities();
    let edited = sections(
        &world.record,
        ReflectionLayout::Sequential,
        &[("MINA", "Rewritten."), TURNS[1], TURNS[2]],
    );
    let answer = respond_to(
        &world,
        session("mina-admin"),
        "mina-admin",
        &perspective(),
        &world.parent_target,
        &edited,
        &identities,
    )
    .expect("the author may answer a reader of the earlier text");
    assert!(matches!(
        answer.responder.standing,
        Standing::Stale {
            reason: StaleReason::SectionChanged,
            ..
        }
    ));
    // The section is gone: the author cannot be confirmed.
    let gone = sections(&world.record, ReflectionLayout::Sequential, &[TURNS[1]]);
    assert_eq!(
        respond_to(
            &world,
            session("mina-admin"),
            "mina-admin",
            &perspective(),
            &world.parent_target,
            &gone,
            &identities
        )
        .unwrap_err(),
        ResponseError::AuthorUnconfirmed
    );
    // The participant id now belongs to someone else: the name the section
    // is published under is no longer theirs.
    let mut renamed = world.record.clone();
    for participant in &mut renamed.collaboration.participants {
        if participant.id == "p-mina" {
            participant.display_name = "SOMEONE ELSE".into();
        }
    }
    let renamed_world = World {
        record: renamed,
        site: site(),
        published: world.published.clone(),
        parent_target: world.parent_target.clone(),
    };
    assert_eq!(
        respond(
            &renamed_world,
            session("mina-admin"),
            "mina-admin",
            &perspective(),
            &identities
        )
        .unwrap_err(),
        ResponseError::AuthorUnconfirmed
    );
}

#[test]
fn a_removed_participant_leaves_nobody_who_can_answer() {
    let mut world = world();
    let identities = identities();
    world
        .record
        .authorization
        .bindings
        .retain(|binding| binding.participant_id != "p-mina");
    assert_eq!(
        respond(
            &world,
            session("mina-admin"),
            "mina-admin",
            &perspective(),
            &identities
        )
        .unwrap_err(),
        ResponseError::Denied
    );
    world
        .record
        .collaboration
        .participants
        .retain(|participant| participant.id != "p-mina");
    assert_eq!(
        respond(
            &world,
            session("mina-admin"),
            "mina-admin",
            &perspective(),
            &identities
        )
        .unwrap_err(),
        ResponseError::Denied
    );
}

#[test]
fn the_parent_must_be_a_public_third_perspective_of_this_work() {
    let world = world();
    let identities = identities();
    let mut pending = perspective();
    pending.state = ModerationState::Pending;
    pending.approved_revision = None;
    let comment = approved("c", ParticipationKind::Comment, None);
    let mut elsewhere = perspective();
    elsewhere.work = Some("/posts/other/");
    let mut purged = perspective();
    purged.content_retained = false;
    for parent in [pending, comment, elsewhere, purged] {
        assert_eq!(
            respond(
                &world,
                session("mina-admin"),
                "mina-admin",
                &parent,
                &identities
            )
            .unwrap_err(),
            ResponseError::Unavailable
        );
    }
}

#[test]
fn modes_and_the_one_policy_still_decide() {
    let world = world();
    let identities = identities();
    let records = [world.record.clone()];
    let works = SharedWorks::new(&records, &world.site);
    let actor = works.actor(session("mina-admin"), Some(WORK), &identities);
    let parent = perspective();
    for (mode, expected) in [
        (ParticipationMode::Locked, PolicyError::Closed),
        (ParticipationMode::Hidden, PolicyError::Unavailable),
    ] {
        let error = admit_response(
            &ModerationPolicy::new(Default::default()),
            &ResponseRequest {
                id: "r",
                record: &world.record,
                identities: &identities,
                admin_user: "mina-admin",
                actor,
                work: WORK,
                mode,
                parent: &parent,
                parent_mode: ParticipationMode::Open,
                parent_target: &world.parent_target,
                sections: &world.published,
                at: DateTime::from_unix(1_800_000_100),
            },
        )
        .unwrap_err();
        assert_eq!(error, ResponseError::Policy(expected));
    }
}

#[test]
fn a_response_is_shown_only_while_it_and_its_parent_are_public() {
    let parent = perspective();
    let response = approved(
        "response-1",
        ParticipationKind::AuthorResponse,
        Some("perspective-1"),
    );
    let open = ParticipationMode::Open;
    assert!(response_shown(&response, open, &parent, open));
    // Taking the parent down hides the response without touching it.
    let mut removed = perspective();
    removed.state = ModerationState::Removed;
    assert!(!response_shown(&response, open, &removed, open));
    // A hidden kind, a pending response, another parent.
    assert!(!response_shown(
        &response,
        ParticipationMode::Hidden,
        &perspective(),
        open
    ));
    assert!(!response_shown(
        &response,
        open,
        &perspective(),
        ParticipationMode::Hidden
    ));
    let mut pending = response;
    pending.state = ModerationState::Pending;
    pending.approved_revision = None;
    assert!(!response_shown(&pending, open, &perspective(), open));
    let other = approved(
        "response-2",
        ParticipationKind::AuthorResponse,
        Some("perspective-9"),
    );
    assert!(!response_shown(&other, open, &perspective(), open));
    // Locked still shows what was approved.
    assert!(response_shown(
        &response,
        ParticipationMode::Locked,
        &perspective(),
        ParticipationMode::Locked
    ));
}

#[test]
fn a_coordinator_moderates_the_response_but_a_contributor_never_does() {
    let world = world();
    let identities = identities();
    let records = [world.record.clone()];
    let works = SharedWorks::new(&records, &world.site);
    let policy = ModerationPolicy::new(Default::default());
    let mut response = approved(
        "response-1",
        ParticipationKind::AuthorResponse,
        Some("perspective-1"),
    );
    response.state = ModerationState::Pending;
    response.approved_revision = None;
    response.version = 1;
    let decide = |admin_user: &str, action: ModerationAction| {
        let actor = works.actor(session(admin_user), Some(WORK), &identities);
        policy.decide(
            &response,
            &Request {
                actor,
                action,
                expected_version: 1,
                reason: None,
                at: DateTime::from_unix(1_800_000_200),
                reported_item: None,
            },
        )
    };
    assert!(decide("coord-admin", ModerationAction::Approve).is_ok());
    // The author does not approve their own answer.
    assert_eq!(
        decide("mina-admin", ModerationAction::Approve).unwrap_err(),
        PolicyError::Denied
    );
}
