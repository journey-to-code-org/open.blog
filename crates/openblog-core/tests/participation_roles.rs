//! Which works a shared publication covers in moderation (ADR 0102): the
//! path of the post loaded from `posts/{publication_id}.md`, resolved from the
//! loaded site at request time.

use openblog_core::collaboration::{
    AuthorizationRole, IdentityBinding, NewParticipant, NewSharedPublication, NewSourceReference,
    Participant, SharedPublication, SourceKind,
};
use openblog_core::config::SiteConfig;
use openblog_core::model::{LoadOptions, Site, SourceFile, Sources};
use openblog_core::moderation::SharedWorks;

const SHARED: &str = "shared-tides";
const UNPUBLISHED: &str = "shared-unpublished";

fn site(posts: &[(&str, &str)]) -> Site {
    let config =
        SiteConfig::from_json(r#"{"title":"T","url":"https://t.dev","postPath":"/posts/{slug}/"}"#)
            .unwrap();
    Site::load(
        config,
        Sources {
            posts: posts
                .iter()
                .map(|(path, front_matter)| SourceFile {
                    path: (*path).into(),
                    contents: format!("---\ntitle: P\ndate: 2026-01-01\n{front_matter}---\nText"),
                })
                .collect(),
            ..Sources::default()
        },
        LoadOptions::default(),
    )
    .unwrap()
}

/// A shared publication created by `owner-admin` (site owner and
/// contributor), with one more participant per `(name, role)`, each bound
/// under `{name}-admin`.
fn record(publication_id: &str, members: &[(&str, AuthorizationRole)]) -> SharedPublication {
    let mut record = SharedPublication::create(&NewSharedPublication {
        publication_id: publication_id.into(),
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
            display_name: "Owner".into(),
        },
    })
    .unwrap();
    for (name, role) in members {
        record.collaboration.participants.push(Participant {
            id: (*name).into(),
            display_name: (*name).into(),
            profile_url: None,
        });
        record.authorization.bindings.push(IdentityBinding {
            admin_user: format!("{name}-admin"),
            contributor_id: (*name).into(),
            participant_id: (*name).into(),
            roles: vec![*role],
        });
    }
    record
}

#[test]
fn a_shared_publications_work_is_the_path_of_its_loaded_post() {
    let site = site(&[(&format!("posts/{SHARED}.md"), ""), ("posts/solo.md", "")]);
    let records = [record(SHARED, &[]), record(UNPUBLISHED, &[])];
    let works = SharedWorks::new(&records, &site);
    assert_eq!(works.works(SHARED), [format!("/posts/{SHARED}/").as_str()]);
    // A publication whose post is not loaded, or an unknown publication, has
    // no work, so nobody holds a publication role on anything through it.
    assert!(works.works(UNPUBLISHED).is_empty());
    assert!(works.works("shared-unknown").is_empty());
}

#[test]
fn a_renamed_slug_moves_the_work_with_the_post() {
    let path = format!("posts/{SHARED}.md");
    let records = [record(SHARED, &[])];
    let before = site(&[(&path, "slug: tides\n"), ("posts/solo.md", "")]);
    assert_eq!(
        SharedWorks::new(&records, &before).works(SHARED),
        ["/posts/tides/"]
    );
    // The file keeps its publication id; only the slug changes, and the work
    // follows it on the next request.
    let after = site(&[(&path, "slug: high-water\n"), ("posts/solo.md", "")]);
    assert_eq!(
        SharedWorks::new(&records, &after).works(SHARED),
        ["/posts/high-water/"]
    );
    // A post that merely has the publication's slug is not its work.
    let impostor = site(&[("posts/other.md", &format!("slug: {SHARED}\n"))]);
    assert!(SharedWorks::new(&records, &impostor)
        .works(SHARED)
        .is_empty());
}
