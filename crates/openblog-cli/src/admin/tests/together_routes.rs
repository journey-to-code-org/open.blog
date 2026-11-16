//! Writing together (Studio R14a): what a co-writer sign-in can and cannot reach (G110), `meta` by
//! account (G111), inviting someone new and joining by link (G112), the sharing choice at the
//! start (G113), the list with state (G115), put away (G116), codes (G117) and the gate's
//! answers (G118). Security first: the route table is read from the router itself, so a route
//! added without a decision fails here.

use super::*;
use crate::admin::together::{
    CODES, CO_WRITER_ROUTES, JOIN, NO_SESSION_ROUTES, OWNER_ROUTES, TOKEN_HEADER,
};

const ADMIN_SOURCE: &str = include_str!("../../admin.rs");
const TOGETHER_SOURCE: &str = include_str!("../together.rs");

/// Every route the router dispatches, read from `authenticated_api` itself: `("METHOD", "name")`
/// arms, `name.strip_prefix("x/")` hand-offs (as `x/*` for any method), and the two dispatchers
/// that read a name's tail themselves.
fn router_routes() -> Routes {
    let start = ADMIN_SOURCE
        .find("fn authenticated_api(")
        .expect("the router");
    let end = start + ADMIN_SOURCE[start..].find("// Authentication").unwrap();
    let body = &ADMIN_SOURCE[start..end];
    let mut routes = BTreeSet::new();
    for line in body.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix("(\"") {
            let Some((method, rest)) = rest.split_once("\", \"") else {
                continue;
            };
            let Some((name, rest)) = rest.split_once("\")") else {
                continue;
            };
            if rest.trim_start().starts_with("=>")
                && ["GET", "POST", "PUT", "DELETE", "PATCH"].contains(&method)
            {
                routes.insert((method.to_string(), name.to_string()));
            }
        }
        let mut search = line;
        while let Some(at) = search.find("name.strip_prefix(\"") {
            let rest = &search[at + "name.strip_prefix(\"".len()..];
            let prefix = &rest[..rest.find('"').unwrap()];
            let method = if prefix == "preview/" { "GET" } else { "*" };
            routes.insert((method.to_string(), format!("{prefix}*")));
            search = rest;
        }
    }
    // Dispatchers that read the rest of the name themselves.
    let dispatchers = [
        ("theme_draft::undo_route(name)", ("DELETE", "theme-draft/*")),
        ("voice::sample_route(name)", ("*", "voice/samples/*")),
    ];
    for (call, route) in dispatchers {
        assert!(body.contains(call), "{call} moved: update this test");
        routes.insert((route.0.to_string(), route.1.to_string()));
    }
    let calls = body.matches("_route(name)").count();
    assert_eq!(
        calls,
        dispatchers.len(),
        "a new dispatcher reads routes itself: classify its routes for co-writer sign-ins"
    );
    routes
}

type Routes = BTreeSet<(String, String)>;

fn classified() -> (Routes, Routes) {
    let as_set = |list: &[(&str, &str)]| {
        list.iter()
            .map(|(m, n)| (m.to_string(), n.to_string()))
            .collect::<BTreeSet<_>>()
    };
    (as_set(CO_WRITER_ROUTES), as_set(OWNER_ROUTES))
}

#[test]
fn every_route_in_the_router_has_a_decision_for_co_writer_sign_ins() {
    let routes = router_routes();
    assert!(routes.len() > 200, "the router was read: {}", routes.len());
    let (co_writer, owner) = classified();
    let both = co_writer.intersection(&owner).collect::<Vec<_>>();
    assert!(both.is_empty(), "routes in both lists: {both:?}");
    let undecided = routes
        .iter()
        .filter(|route| !co_writer.contains(*route) && !owner.contains(*route))
        .collect::<Vec<_>>();
    assert!(
        undecided.is_empty(),
        "routes with no decision for co-writer sign-ins (add each to CO_WRITER_ROUTES or together_owner_routes.in): {undecided:?}"
    );
    let stale = co_writer
        .iter()
        .chain(&owner)
        .filter(|route| !routes.contains(*route))
        .collect::<Vec<_>>();
    assert!(
        stale.is_empty(),
        "listed routes the router no longer has: {stale:?}"
    );
    // Nothing outside Writing together is on the allowlist, and the four things only an owner
    // account does are not on it.
    for (method, name) in &co_writer {
        assert!(
            name.starts_with("collaboration/")
                || ["logout", "session", "meta", "preview/*"].contains(&name.as_str()),
            "{method} {name}"
        );
    }
    for owner_only in [
        ("POST", "collaboration/publications"),
        ("POST", "collaboration/publish"),
        ("POST", "collaboration/schedule"),
        ("POST", "collaboration/series/create"),
        ("POST", "collaboration/publications/archive"),
        ("POST", "collaboration/publications/source-metadata"),
    ] {
        assert!(
            owner.contains(&(owner_only.0.to_string(), owner_only.1.to_string())),
            "{owner_only:?}"
        );
    }
    // The only routes with no session are signing in and joining by link.
    assert_eq!(
        NO_SESSION_ROUTES,
        &[("POST", "login"), ("GET", JOIN), ("POST", JOIN)]
    );
}

/// An owner (mikey, in charge of one reflection), a co-writer who has signed in (lee), and the
/// reflection's id.
fn together_fixture(tag: &str) -> (Fixture, (String, String), (String, String), String) {
    let f = fixture(tag);
    register_contributors(
        &f,
        json!({
            "mikey-writer": { "name": "Mikey" },
            "lee": { "name": "Lee Park" },
            "sam": { "name": "Sam" },
            "ruth": { "name": "Ruth" }
        }),
    );
    let path = f.dir.join(".openblog/users.json");
    let mut users = Users::load(&path).unwrap();
    users
        .add_co_writer("lee", Some("lee correct horse battery"))
        .unwrap();
    users.save(&path).unwrap();
    let mikey = login_ok(&f);
    let lee = login_as(&f, "lee", "lee correct horse battery");
    let created = create_shared(&f, &mikey, reflection_request());
    assert_eq!(created.status, 201);
    let id = body_json(&created)["publication"]["publicationId"]
        .as_str()
        .unwrap()
        .to_string();
    (f, mikey, lee, id)
}

/// A concrete address for a classified route.
fn sample_path(name: &str) -> String {
    match name {
        "preview/*" => format!("preview/{}", "a".repeat(64)),
        "theme-draft/*" => "theme-draft/a-theme".into(),
        "voice/samples/*" => "voice/samples/one-sample".into(),
        prefixed if prefixed.ends_with("/*") => {
            format!("{}anything", &prefixed[..prefixed.len() - 1])
        }
        plain => plain.into(),
    }
}

#[test]
fn a_co_writer_sign_in_gets_403_on_every_other_admin_route_and_nothing_changes() {
    let (f, mikey, lee, id) = together_fixture("together-guard");
    let before = tree_snapshot(&f.dir);
    let mut checked = 0;
    for (method, name) in OWNER_ROUTES {
        let methods: &[&str] = if *method == "*" {
            &["GET", "POST", "PUT", "DELETE", "PATCH"]
        } else {
            std::slice::from_ref(method)
        };
        for method in methods {
            let path = format!(
                "/admin/api/{}?publicationId={id}&path=posts/a.md",
                sample_path(name)
            );
            let request = authed(
                json_req(method, &path, json!({ "publicationId": id })),
                &lee,
                true,
            );
            // Refused before any body is read...
            let early = preflight(&f.state, &request).unwrap_err();
            assert_eq!(early.status, 403, "preflight {method} {name}");
            // ...and by the router, with the same answer for every route.
            let response = handle(&f.state, &request);
            assert_eq!(response.status, 403, "{method} {name}");
            assert_eq!(
                body_json(&response)["code"],
                "owner-only",
                "{method} {name}"
            );
            // Without the CSRF header too: the guard comes first.
            let bare = handle(
                &f.state,
                &authed(json_req(method, &path, json!({})), &lee, false),
            );
            assert_eq!(bare.status, 403, "{method} {name} without CSRF");
            checked += 1;
        }
    }
    assert!(checked > 200);
    assert_eq!(
        tree_snapshot(&f.dir),
        before,
        "a refused request changed a file"
    );
    // The owner reaches the same routes as before: a sample answers as it always did.
    for path in [
        "/admin/api/documents",
        "/admin/api/contributors",
        "/admin/api/assistant/settings",
    ] {
        let response = handle(&f.state, &authed(req("GET", path), &mikey, false));
        assert_eq!(response.status, 200, "{path}");
    }
    // A co-writer still reaches what is theirs.
    for path in [
        "/admin/api/session".to_string(),
        "/admin/api/meta".to_string(),
        "/admin/api/collaboration/publications".to_string(),
    ] {
        let response = handle(&f.state, &authed(req("GET", &path), &lee, false));
        assert_eq!(response.status, 200, "{path}");
    }
}

#[test]
fn a_co_writer_cannot_read_settings_accounts_keys_people_or_the_sites_files() {
    let (f, _mikey, lee, _id) = together_fixture("together-private");
    // A provider key and a social account in place, to prove neither leaves.
    let path = f.dir.join("openblog.json");
    let mut config: Json = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
    config["assistant"] = json!({ "provider": "anthropic", "model": "secret-model-7f3c" });
    fs::write(&path, config.to_string()).unwrap();
    for (method, path) in [
        ("GET", "assistant/settings"),
        ("GET", "assistant/status"),
        ("PUT", "assistant/settings"),
        ("GET", "social/status"),
        ("GET", "social/accounts"),
        ("GET", "appearance"),
        ("GET", "preferences"),
        ("GET", "engagement/settings"),
        ("GET", "contributors"),
        ("PUT", "contributors"),
        ("GET", "documents"),
        ("GET", "document?path=posts/hello.md"),
        ("POST", "document"),
        ("DELETE", "document?path=posts/hello.md"),
        ("GET", "images"),
        ("POST", "upload"),
        ("GET", "capture-audio"),
        ("GET", "status"),
        ("GET", "publish"),
        ("POST", "publish"),
        ("POST", "rebuild"),
        ("POST", "preview"),
        ("GET", "sources"),
        ("GET", "research/notebook"),
        ("GET", "push/subscriptions"),
        ("GET", "voice/samples"),
        ("POST", "collaboration/publications"),
        ("POST", "collaboration/publish"),
        ("POST", "collaboration/schedule"),
        ("POST", "collaboration/series/create"),
        ("POST", "collaboration/publications/archive"),
    ] {
        let response = handle(
            &f.state,
            &authed(
                json_req(method, &format!("/admin/api/{path}"), json!({})),
                &lee,
                true,
            ),
        );
        assert_eq!(response.status, 403, "{method} {path}");
        assert!(
            !String::from_utf8_lossy(&response.body).contains("7f3c"),
            "{method} {path}"
        );
    }
    // `meta` for a co-writer holds only what Writing together needs.
    let meta = body_json(&handle(
        &f.state,
        &authed(req("GET", "/admin/api/meta"), &lee, false),
    ));
    let keys = meta
        .as_object()
        .unwrap()
        .keys()
        .cloned()
        .collect::<BTreeSet<_>>();
    assert_eq!(
        keys,
        [
            "account",
            "now",
            "siteTitle",
            "siteUrl",
            "studioWords",
            "together"
        ]
        .into_iter()
        .map(String::from)
        .collect()
    );
    assert_eq!(meta["account"], "co-writer");
    assert_eq!(meta["together"]["canStart"], false);
    assert!(!meta.to_string().contains("7f3c"));
}

#[test]
fn an_owners_meta_says_so_and_counts_what_is_waiting() {
    let (f, mikey, _lee, _id) = together_fixture("together-meta");
    let meta = body_json(&handle(
        &f.state,
        &authed(req("GET", "/admin/api/meta"), &mikey, false),
    ));
    assert_eq!(meta["account"], "owner");
    assert_eq!(meta["together"]["takingPart"], 1);
    assert_eq!(
        meta["together"]["waitingOnYou"], 1,
        "her part is waiting on her"
    );
    assert_eq!(meta["together"]["canStart"], true);
    assert!(meta["siteTitle"].is_string() && meta.get("series").is_some());
}

fn invite_new(
    f: &Fixture,
    session: &(String, String),
    id: &str,
    sign_in: &str,
    key: &str,
) -> Response {
    post_api(
        f,
        session,
        "invitations",
        json!({ "publicationId": id, "contributorId": key, "roles": ["contributor"], "newAccount": { "signInName": sign_in } }),
    )
}

fn join_get(f: &Fixture, token: &str, peer: &str) -> Response {
    let mut request = req("GET", &format!("/admin/api/{JOIN}"));
    request.headers.insert(TOKEN_HEADER.into(), token.into());
    request.peer = peer.into();
    handle(&f.state, &request)
}

fn join_post(f: &Fixture, body: Json, peer: &str) -> Response {
    let mut request = json_req("POST", &format!("/admin/api/{JOIN}"), body);
    request.peer = peer.into();
    handle(&f.state, &request)
}

fn token_of(response: &Response) -> String {
    body_json(response)["token"].as_str().unwrap().to_string()
}

fn users_of(f: &Fixture) -> Users {
    Users::load(&f.dir.join(".openblog/users.json")).unwrap()
}

#[test]
fn an_invitation_link_lets_a_new_person_choose_a_password_once_and_never_again() {
    let (f, mikey, _lee, id) = together_fixture("together-join");
    let issued = invite_new(&f, &mikey, &id, "sam", "sam");
    assert_eq!(
        issued.status,
        201,
        "{}",
        String::from_utf8_lossy(&issued.body)
    );
    let token = token_of(&issued);
    // The link opens Studio's join page, with the token only in the fragment.
    assert_eq!(
        body_json(&issued)["link"],
        json!(format!("/admin/studio/#/together/join/{token}"))
    );
    // A reserved account: it exists, cannot sign in, and is a co-writer.
    let sam = users_of(&f).find("sam").cloned().unwrap();
    assert!(sam.is_reserved());
    let login = handle(
        &f.state,
        &json_req(
            "POST",
            "/admin/api/login",
            json!({ "username": "sam", "password": "" }),
        ),
    );
    assert_eq!(login.status, 401);
    // The token is stored nowhere: only its hash is in the record.
    assert!(tree_contains(&f.dir, &token).is_empty());
    // What the join page shows, from the header alone.
    let view = join_get(&f, &token, "10.0.0.5");
    assert_eq!(view.status, 200, "{}", String::from_utf8_lossy(&view.body));
    let shown = body_json(&view);
    assert_eq!(shown["newAccount"], true);
    assert_eq!(shown["signInName"], "sam");
    assert_eq!(shown["forName"], "Sam");
    assert_eq!(shown["invitedBy"], "Mikey");
    assert!(view
        .headers
        .iter()
        .any(|(k, v)| k == "Cache-Control" && v == "no-store"));
    // A token in the query is never read.
    let mut in_query = req("GET", &format!("/admin/api/{JOIN}?token={token}"));
    in_query.peer = "10.0.0.6".into();
    assert_eq!(handle(&f.state, &in_query).status, 404);
    // Too short a password changes nothing.
    let short = join_post(
        &f,
        json!({ "token": token, "password": "short" }),
        "10.0.0.5",
    );
    assert_eq!(short.status, 422);
    assert_eq!(body_json(&short)["code"], "password");
    assert!(users_of(&f).find("sam").unwrap().is_reserved());
    // Say yes: password set, invitation accepted, signed in, in one step.
    let joined = join_post(
        &f,
        json!({ "token": token, "password": "sam correct horse battery" }),
        "10.0.0.5",
    );
    assert_eq!(
        joined.status,
        200,
        "{}",
        String::from_utf8_lossy(&joined.body)
    );
    assert_eq!(body_json(&joined)["publicationId"], json!(id));
    let cookie = joined
        .headers
        .iter()
        .find(|(k, _)| k == "Set-Cookie")
        .unwrap()
        .1
        .split(';')
        .next()
        .unwrap()
        .to_string();
    let sam_session = (
        cookie,
        body_json(&joined)["csrf"].as_str().unwrap().to_string(),
    );
    let listed = list_shared(&f, &sam_session);
    assert_eq!(listed["publications"].as_array().unwrap().len(), 1);
    // A co-writer from the start.
    let documents = handle(
        &f.state,
        &authed(req("GET", "/admin/api/documents"), &sam_session, false),
    );
    assert_eq!(documents.status, 403);
    // Single use: the same link again, to look or to join, is refused the same way.
    assert_eq!(join_get(&f, &token, "10.0.0.7").status, 404);
    let again = join_post(
        &f,
        json!({ "token": token, "password": "a different correct horse" }),
        "10.0.0.8",
    );
    assert_eq!(again.status, 404);
    assert_eq!(body_json(&again)["code"], "invalid-invitation");
    assert!(auth::verify_password(
        &users_of(&f).find("sam").unwrap().hash,
        "sam correct horse battery"
    ));
}

#[test]
fn a_link_cannot_set_the_password_of_an_account_that_already_signs_in() {
    let (f, mikey, _lee, id) = together_fixture("together-join-existing");
    let issued = post_api(
        &f,
        &mikey,
        "invitations",
        invite_body(&id, "lee", "lee", json!(["contributor"])),
    );
    assert_eq!(issued.status, 201);
    let token = token_of(&issued);
    let view = body_json(&join_get(&f, &token, "10.0.1.1"));
    assert_eq!(view["newAccount"], false);
    assert_eq!(view["signInName"], "lee");
    let taken = join_post(
        &f,
        json!({ "token": token, "password": "an attacker's correct horse" }),
        "10.0.1.1",
    );
    assert_eq!(taken.status, 404);
    assert!(auth::verify_password(
        &users_of(&f).find("lee").unwrap().hash,
        "lee correct horse battery"
    ));
}

#[test]
fn a_link_that_expired_or_was_withdrawn_stops_working_and_frees_its_name() {
    let (f, mikey, _lee, id) = together_fixture("together-join-ended");
    // Withdrawn.
    let issued = invite_new(&f, &mikey, &id, "sam", "sam");
    let token = token_of(&issued);
    let invitation = body_json(&issued)["invitation"]["id"]
        .as_str()
        .unwrap()
        .to_string();
    let revoked = post_api(
        &f,
        &mikey,
        "invitations/revoke",
        json!({ "publicationId": id, "invitationId": invitation }),
    );
    assert_eq!(revoked.status, 200);
    assert_eq!(join_get(&f, &token, "10.0.2.1").status, 404);
    assert!(
        users_of(&f).find("sam").is_none(),
        "the reserved name is released"
    );
    // Expired: the stored invitation's time ran out.
    let issued = invite_new(&f, &mikey, &id, "ruth", "ruth");
    let token = token_of(&issued);
    let path = f
        .dir
        .join(crate::shared_publications::DIRECTORY)
        .join(format!("{id}.json"));
    let mut stored: Json = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
    for invitation in stored["invitations"].as_array_mut().unwrap() {
        if invitation["adminUser"] == "ruth" {
            invitation["createdAt"] = json!(1_000_000);
            invitation["expiresAt"] = json!(1_000_100);
        }
    }
    fs::write(&path, serde_json::to_string_pretty(&stored).unwrap()).unwrap();
    assert_eq!(join_get(&f, &token, "10.0.2.2").status, 404);
    let late = join_post(
        &f,
        json!({ "token": token, "password": "ruth correct horse battery" }),
        "10.0.2.2",
    );
    assert_eq!(late.status, 404);
    assert!(
        users_of(&f).find("ruth").is_none(),
        "an expired reservation is released"
    );
    // Declined from the link: nothing joins, and the name is free again.
    let issued = invite_new(&f, &mikey, &id, "sam", "sam");
    let token = token_of(&issued);
    let declined = join_post(&f, json!({ "token": token, "decline": true }), "10.0.2.3");
    assert_eq!(declined.status, 200);
    assert!(users_of(&f).find("sam").is_none());
    assert_eq!(join_get(&f, &token, "10.0.2.4").status, 404);
}

#[test]
fn joining_is_throttled_by_address_and_a_good_link_gives_the_tries_back() {
    let (f, mikey, _lee, id) = together_fixture("together-join-throttle");
    let token = token_of(&invite_new(&f, &mikey, &id, "sam", "sam"));
    let wrong = format!("{id}.{}", "0".repeat(64));
    for _ in 0..4 {
        assert_eq!(join_get(&f, &wrong, "10.0.3.1").status, 404);
    }
    // The fifth wrong try locks this address for a while; the right token is refused too.
    assert_eq!(join_get(&f, &wrong, "10.0.3.1").status, 404);
    let locked = join_get(&f, &token, "10.0.3.1");
    assert_eq!(locked.status, 429);
    assert_eq!(body_json(&locked)["code"], "too-many-tries");
}

#[test]
fn only_an_owner_account_invites_someone_new_and_a_co_writer_invites_only_co_writers() {
    let (f, mikey, lee, id) = together_fixture("together-invite-rules");
    // Lee joins as a co-writer who helps run it.
    let issued = post_api(
        &f,
        &mikey,
        "invitations",
        invite_body(&id, "lee", "lee", json!(["contributor", "coordinator"])),
    );
    let accepted = post_api(
        &f,
        &lee,
        "invitations/accept",
        json!({ "token": token_of(&issued), "contributorId": "lee" }),
    );
    assert_eq!(accepted.status, 200);
    // Not someone new...
    let new = invite_new(&f, &lee, &id, "sam", "sam");
    assert_eq!(new.status, 403);
    assert!(users_of(&f).find("sam").is_none());
    // ...and not an owner account.
    add_admin_user(&f, "ruth", "ruth correct horse battery");
    let owner = post_api(
        &f,
        &lee,
        "invitations",
        invite_body(&id, "ruth", "ruth", json!(["contributor"])),
    );
    assert_eq!(owner.status, 403);
    assert_eq!(body_json(&owner)["code"], "owner-only");
    // Another co-writer, yes.
    let path = f.dir.join(".openblog/users.json");
    let mut users = Users::load(&path).unwrap();
    users
        .add_co_writer("sam", Some("sam correct horse battery"))
        .unwrap();
    users.save(&path).unwrap();
    let co_writer = post_api(
        &f,
        &lee,
        "invitations",
        invite_body(&id, "sam", "sam", json!(["contributor"])),
    );
    assert_eq!(
        co_writer.status,
        201,
        "{}",
        String::from_utf8_lossy(&co_writer.body)
    );
    // A name already used is refused with its own code, and nothing is reserved twice.
    let taken = invite_new(&f, &mikey, &id, "lee", "ruth");
    assert_eq!(taken.status, 422);
    assert_eq!(body_json(&taken)["code"], "name-taken");
    let bad = invite_new(&f, &mikey, &id, "Not A Name", "ruth");
    assert_eq!(body_json(&bad)["field"], "signInName");
}

fn save_part(
    f: &Fixture,
    session: &(String, String),
    id: &str,
    expected: u64,
    words: &str,
) -> Response {
    handle(
        &f.state,
        &authed(
            json_req(
                "PUT",
                "/admin/api/collaboration/draft",
                json!({ "publicationId": id, "expectedRevision": expected, "markdown": words }),
            ),
            session,
            true,
        ),
    )
}

fn get_collab(f: &Fixture, session: &(String, String), path: &str, id: &str) -> Response {
    handle(
        &f.state,
        &authed(
            req(
                "GET",
                &format!("/admin/api/collaboration/{path}?publicationId={id}"),
            ),
            session,
            false,
        ),
    )
}

/// Mikey's reflection with "when everyone's ready" sharing (a new reflection's default since
/// #650), and Sam joined by link as a co-writer who writes a part. Returns Sam's session.
fn with_sam(f: &Fixture, mikey: &(String, String), id: &str) -> (String, String) {
    assert_eq!(
        body_json(&get_collab(f, mikey, "reveal", id))["policy"],
        "allReady"
    );
    let token = token_of(&invite_new(f, mikey, id, "sam", "sam"));
    let joined = join_post(
        f,
        json!({ "token": token, "password": "sam correct horse battery" }),
        "10.0.4.1",
    );
    assert_eq!(joined.status, 200);
    login_as(f, "sam", "sam correct horse battery")
}

#[test]
fn nobody_reads_another_persons_part_before_it_is_shared() {
    let (f, mikey, _lee, id) = together_fixture("together-unshared");
    let sam = with_sam(&f, &mikey, &id);
    assert_eq!(
        save_part(&f, &mikey, &id, 0, "Mikey's private words 9e1d").status,
        200
    );
    assert_eq!(
        save_part(&f, &sam, &id, 0, "Sam's private words 4b2a").status,
        200
    );
    for (session, others) in [(&sam, "9e1d"), (&mikey, "4b2a")] {
        let reveal = get_collab(&f, session, "reveal", &id);
        assert_eq!(reveal.status, 200);
        assert!(!String::from_utf8_lossy(&reveal.body).contains(others));
        let preview = get_collab(&f, session, "preview", &id);
        assert_eq!(preview.status, 200);
        let url = body_json(&preview)["preview"]["previewUrl"]
            .as_str()
            .unwrap()
            .to_string();
        let document = handle(&f.state, &authed(req("GET", &url), session, false));
        assert!(!String::from_utf8_lossy(&document.body).contains(others));
        let listed = list_shared(&f, session);
        assert!(!listed.to_string().contains(others));
        // Own draft only: there is no address for another person's.
        let draft = get_collab(&f, session, "draft", &id);
        assert!(!String::from_utf8_lossy(&draft.body).contains(others));
    }
    // A co-writer cannot open a preview made for someone else.
    let mikeys = body_json(&get_collab(&f, &mikey, "preview", &id))["preview"]["previewUrl"]
        .as_str()
        .unwrap()
        .to_string();
    assert_eq!(
        handle(&f.state, &authed(req("GET", &mikeys), &sam, false)).status,
        404
    );
    // Where each stands, without saying whether the other has started.
    let sams_view = list_shared(&f, &sam)["publications"][0].clone();
    let people = sams_view["people"].as_array().unwrap();
    assert_eq!(people[0]["where"], "notReady", "{sams_view}");
    assert_eq!(people[1]["where"], "writing");
    assert_eq!(people[1]["you"], true);
}

#[test]
fn two_saves_of_the_same_part_never_lose_either() {
    let (f, mikey, _lee, id) = together_fixture("together-conflict");
    assert_eq!(save_part(&f, &mikey, &id, 0, "From the phone").status, 200);
    // A second tab still thinks nothing is saved: refused, the first kept, the newer copy sent
    // back so the screen can show both.
    let stale = save_part(&f, &mikey, &id, 0, "From the computer");
    assert_eq!(stale.status, 409);
    let body = body_json(&stale);
    assert_eq!(body["code"], "changed");
    assert_eq!(body["current"]["markdown"], "From the phone");
    let draft = body_json(&get_collab(&f, &mikey, "draft", &id));
    assert_eq!(draft["draft"]["markdown"], "From the phone");
    // Keeping mine saves on top of the newer one, which stays as an earlier version.
    assert_eq!(
        save_part(&f, &mikey, &id, 1, "From the computer").status,
        200
    );
    let draft = body_json(&get_collab(&f, &mikey, "draft", &id));
    assert_eq!(draft["draft"]["markdown"], "From the computer");
    assert_eq!(draft["draft"]["stamp"]["number"], 2);
}

#[test]
fn a_reflection_starts_with_the_sharing_choice_it_was_given() {
    let f = fixture("together-start");
    register_contributors(&f, json!({ "mikey-writer": { "name": "Mikey" } }));
    let mikey = login_ok(&f);
    let mut body = reflection_request();
    body["revealPolicy"] = json!("allReady");
    let created = create_shared(&f, &mikey, body);
    assert_eq!(created.status, 201);
    let id = body_json(&created)["publication"]["publicationId"]
        .as_str()
        .unwrap()
        .to_string();
    let reveal = body_json(&get_collab(&f, &mikey, "reveal", &id));
    assert_eq!(reveal["policy"], "allReady");
    // Absent, a new reflection starts with mutual reveal, as every other new one does (#650).
    let created = create_shared(&f, &mikey, reflection_request());
    let other = body_json(&created)["publication"]["publicationId"]
        .as_str()
        .unwrap()
        .to_string();
    assert_eq!(
        body_json(&get_collab(&f, &mikey, "reveal", &other))["policy"],
        "allReady"
    );
    let mut independent = reflection_request();
    independent["revealPolicy"] = json!("independent");
    let created = create_shared(&f, &mikey, independent);
    let chosen = body_json(&created)["publication"]["publicationId"]
        .as_str()
        .unwrap()
        .to_string();
    assert_eq!(
        body_json(&get_collab(&f, &mikey, "reveal", &chosen))["policy"],
        "independent"
    );
    let mut wrong = reflection_request();
    wrong["revealPolicy"] = json!("whenever");
    let refused = create_shared(&f, &mikey, wrong);
    assert_eq!(refused.status, 422);
    assert_eq!(body_json(&refused)["field"], "revealPolicy");
}

fn approve(f: &Fixture, session: &(String, String), id: &str) -> Response {
    let preview = body_json(&get_collab(f, session, "preview", id));
    let seen = preview["preview"]["seen"]
        .as_str()
        .unwrap_or_default()
        .to_string();
    post_api(
        f,
        session,
        "approve",
        json!({ "publicationId": id, "seen": seen, "affirmed": true }),
    )
}

fn ready(f: &Fixture, session: &(String, String), id: &str, revision: u64) -> Response {
    handle(
        &f.state,
        &authed(
            json_req(
                "PUT",
                "/admin/api/collaboration/reveal/ready",
                json!({ "publicationId": id, "revision": revision }),
            ),
            session,
            true,
        ),
    )
}

/// How a writer's name goes on the reflection: `PUT collaboration/credit-choice`.
fn choose_credit(
    f: &Fixture,
    session: &(String, String),
    id: &str,
    revision: u64,
    choice: Json,
) -> Response {
    handle(
        &f.state,
        &authed(
            json_req(
                "PUT",
                "/admin/api/collaboration/credit-choice",
                json!({ "publicationId": id, "expectedRevision": revision, "choice": choice }),
            ),
            session,
            true,
        ),
    )
}

#[test]
fn the_whole_loop_ends_on_the_blog_and_only_an_owner_account_publishes() {
    let (f, mikey, _lee, id) = together_fixture("together-loop");
    let sam = with_sam(&f, &mikey, &id);
    let state_of = |session: &(String, String)| list_shared(&f, session)["publications"][0].clone();
    assert_eq!(state_of(&mikey)["state"], "started");
    save_part(&f, &mikey, &id, 0, "Mikey's part.");
    assert_eq!(state_of(&mikey)["state"], "writing");
    assert_eq!(ready(&f, &mikey, &id, 1).status, 200);
    assert_eq!(state_of(&mikey)["state"], "sharing");
    assert_eq!(state_of(&mikey)["you"]["shared"], true);
    save_part(&f, &sam, &id, 0, "Sam's part.");
    assert_eq!(ready(&f, &sam, &id, 1).status, 200);
    // A new reflection asks each writer how their name goes on it before anyone agrees (#650).
    assert_eq!(state_of(&sam)["state"], "naming");
    assert_eq!(state_of(&sam)["you"]["credit"], "notChosen");
    assert_eq!(state_of(&sam)["you"]["waitingOnYou"], true);
    let chose = choose_credit(
        &f,
        &sam,
        &id,
        0,
        json!({ "kind": "displayName", "name": "Sam" }),
    );
    assert_eq!(
        chose.status,
        200,
        "{}",
        String::from_utf8_lossy(&chose.body)
    );
    assert_eq!(state_of(&sam)["you"]["credit"], "name");
    assert_eq!(state_of(&sam)["you"]["waitingOnYou"], false);
    assert_eq!(state_of(&mikey)["state"], "naming");
    assert_eq!(state_of(&mikey)["you"]["waitingOnYou"], true);
    let chose = choose_credit(&f, &mikey, &id, 1, json!({ "kind": "profile" }));
    assert_eq!(
        chose.status,
        200,
        "{}",
        String::from_utf8_lossy(&chose.body)
    );
    assert_eq!(state_of(&sam)["state"], "agreeing");
    assert_eq!(state_of(&sam)["you"]["waitingOnYou"], true);
    assert_eq!(approve(&f, &sam, &id).status, 200);
    assert_eq!(approve(&f, &mikey, &id).status, 200);
    let seen_by_sam = state_of(&sam);
    assert_eq!(seen_by_sam["state"], "ready");
    assert_eq!(seen_by_sam["you"]["canPublish"], false);
    assert_eq!(seen_by_sam["publisherName"], "Mikey");
    assert_eq!(state_of(&mikey)["you"]["canPublish"], true);
    // A co-writer can't publish or schedule, whatever their roles.
    let body = json!({ "publicationId": id });
    assert_eq!(post_api(&f, &sam, "publish", body.clone()).status, 403);
    assert_eq!(
        post_api(
            &f,
            &sam,
            "schedule",
            json!({ "publicationId": id, "publishAt": "2099-01-01T08:00:00Z" })
        )
        .status,
        403
    );
    // The owner publishes: the answer says where it went (G118).
    let published = post_api(&f, &mikey, "publish", body.clone());
    assert_eq!(
        published.status,
        200,
        "{}",
        String::from_utf8_lossy(&published.body)
    );
    let path = body_json(&published)["path"].as_str().unwrap().to_string();
    assert!(path.starts_with("posts/") && f.dir.join("content").join(&path).is_file());
    let after = state_of(&mikey);
    assert_eq!(after["state"], "published");
    assert_eq!(after["path"], json!(path));
    // Published twice changes nothing; agreeing after is refused with its code.
    assert_eq!(
        body_json(&post_api(&f, &mikey, "publish", body))["alreadyPublished"],
        true
    );
    let late = post_api(&f, &sam, "approve/withdraw", json!({ "publicationId": id }));
    assert_eq!(body_json(&late)["code"], "published");
}

/// `PUT collaboration/approval-policy` as Studio's Rules sheet sends it.
fn suggest_rule(f: &Fixture, session: &(String, String), id: &str, policy: Json) -> Response {
    let current = body_json(&get_collab(f, session, "approval-policy", id));
    handle(
        &f.state,
        &authed(
            json_req(
                "PUT",
                "/admin/api/collaboration/approval-policy",
                json!({
                    "publicationId": id,
                    "expectedRevision": current["revision"],
                    "expectedProposalId": current["proposal"]["id"],
                    "policy": policy,
                    "confirmed": true,
                }),
            ),
            session,
            true,
        ),
    )
}

#[test]
fn a_suggested_rule_is_on_everyones_list_until_everyone_agrees_to_it() {
    let (f, mikey, _lee, id) = together_fixture("together-rule");
    let sam = with_sam(&f, &mikey, &id);
    let state_of = |session: &(String, String)| list_shared(&f, session)["publications"][0].clone();
    assert_eq!(state_of(&sam)["ruleProposal"], Json::Null);
    let policy = json!({ "requirement": "contributingAuthors", "scope": "wholePiece" });
    let suggested = suggest_rule(&f, &mikey, &id, policy.clone());
    assert_eq!(
        suggested.status,
        200,
        "{}",
        String::from_utf8_lossy(&suggested.body)
    );
    assert_eq!(body_json(&suggested)["proposed"], true);
    // Nothing changed yet; both see what was suggested and that it asks them.
    for session in [&mikey, &sam] {
        let proposal = state_of(session)["ruleProposal"].clone();
        assert_eq!(proposal["policy"], policy, "{proposal}");
        assert_eq!(proposal["asksYou"], true);
        assert_eq!(proposal["consentedByYou"], false);
    }
    let proposal_id = state_of(&sam)["ruleProposal"]["id"].clone();
    for (session, done) in [(&sam, false), (&mikey, true)] {
        let agreed = post_api(
            &f,
            session,
            "approval-policy/consent",
            json!({ "publicationId": id, "proposalId": proposal_id, "affirmed": true }),
        );
        assert_eq!(
            agreed.status,
            200,
            "{}",
            String::from_utf8_lossy(&agreed.body)
        );
        assert_eq!(body_json(&agreed)["changed"], done);
    }
    assert_eq!(state_of(&sam)["ruleProposal"], Json::Null);
    let rule = body_json(&get_collab(&f, &sam, "approval-policy", &id));
    assert_eq!(rule["policy"], policy);
}

#[test]
fn put_away_hides_a_reflection_without_throwing_anything_away() {
    let (f, mikey, lee, id) = together_fixture("together-put-away");
    save_part(&f, &mikey, &id, 0, "Kept words");
    let away = post_api(
        &f,
        &mikey,
        "publications/archive",
        json!({ "publicationId": id, "archived": true }),
    );
    assert_eq!(away.status, 200);
    assert!(list_shared(&f, &mikey)["publications"]
        .as_array()
        .unwrap()
        .is_empty());
    let archived = body_json(&handle(
        &f.state,
        &authed(
            req("GET", "/admin/api/collaboration/publications?archived=1"),
            &mikey,
            false,
        ),
    ));
    assert_eq!(archived["publications"][0]["archived"], true);
    assert_eq!(
        body_json(&get_collab(&f, &mikey, "draft", &id))["draft"]["markdown"],
        "Kept words"
    );
    let back = post_api(
        &f,
        &mikey,
        "publications/archive",
        json!({ "publicationId": id, "archived": false }),
    );
    assert_eq!(back.status, 200);
    assert_eq!(
        list_shared(&f, &mikey)["publications"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    // Only an owner account, and only one in charge of it.
    assert_eq!(
        post_api(
            &f,
            &lee,
            "publications/archive",
            json!({ "publicationId": id, "archived": true })
        )
        .status,
        403
    );
}

#[test]
fn collaboration_answers_carry_codes_from_the_one_list() {
    let (f, mikey, lee, id) = together_fixture("together-codes");
    // Not in it: the same not-found as a missing reflection.
    let missing = get_collab(&f, &lee, "draft", &id);
    assert_eq!(body_json(&missing)["code"], "not-found");
    let invalid = post_api(
        &f,
        &mikey,
        "approve",
        json!({ "publicationId": id, "seen": "x", "affirmed": false }),
    );
    assert!(CODES.contains(&body_json(&invalid)["code"].as_str().unwrap()));
    // Every code the server writes is in the list Studio is tested against.
    for source in [ADMIN_SOURCE, TOGETHER_SOURCE] {
        for (at, _) in source.match_indices("together::problem(") {
            let call = &source[at..at + source[at..].find(';').unwrap_or(200).min(400)];
            let code = call.split('"').nth(1).unwrap_or_default();
            assert!(CODES.contains(&code), "{code} in {call}");
        }
    }
    for (at, _) in TOGETHER_SOURCE.match_indices("problem(\n") {
        let call = &TOGETHER_SOURCE[at..at + 200];
        let code = call.split('"').nth(1).unwrap_or_default();
        assert!(CODES.contains(&code), "{code}");
    }
}

#[test]
fn invitation_tokens_are_never_written_to_the_log() {
    // Every log line in the collaboration code names an id, never a token or a secret.
    let start = ADMIN_SOURCE.find("// Shared publications").unwrap();
    let end = ADMIN_SOURCE.find("fn draft_limit_problem").unwrap();
    for source in [&ADMIN_SOURCE[start..end], TOGETHER_SOURCE] {
        for (at, _) in source.match_indices("eprintln!(") {
            let call = &source[at..at + source[at..].find(");").unwrap()];
            // The format string, then what it is given.
            let open = call.find('"').unwrap();
            let close = open + 1 + call[open + 1..].find('"').unwrap();
            let (format, args) = (&call[open..=close], &call[close + 1..]);
            for word in ["token", "secret", "password"] {
                assert!(
                    !format.contains(&format!("{{{word}")) && !args.contains(word),
                    "a log line may print a {word}: {call}"
                );
            }
        }
    }
}

#[test]
fn an_owner_lists_and_removes_co_writer_sign_ins_and_nothing_of_them_stays_bound() {
    let (f, mikey, lee, id) = together_fixture("together-co-writers");
    let issued = post_api(
        &f,
        &mikey,
        "invitations",
        invite_body(&id, "lee", "lee", json!(["contributor"])),
    );
    let accepted = post_api(
        &f,
        &lee,
        "invitations/accept",
        json!({ "token": token_of(&issued), "contributorId": "lee" }),
    );
    assert_eq!(accepted.status, 200);
    let waiting = invite_new(&f, &mikey, &id, "sam", "sam");
    assert_eq!(waiting.status, 201);
    let listed = body_json(&get_collab(&f, &mikey, "co-writers", &id));
    let names = listed["coWriters"]
        .as_array()
        .unwrap()
        .iter()
        .map(|one| {
            (
                one["name"].as_str().unwrap().to_string(),
                one["waiting"] == true,
            )
        })
        .collect::<Vec<_>>();
    assert_eq!(names, vec![("lee".into(), false), ("sam".into(), true)]);
    assert_eq!(
        listed["coWriters"][0]["reflections"][0]["publicationId"],
        json!(id)
    );
    assert!(!listed.to_string().contains("argon2"), "never a hash");
    // A co-writer can neither list nor remove sign-ins.
    assert_eq!(get_collab(&f, &lee, "co-writers", &id).status, 403);
    assert_eq!(
        post_api(&f, &lee, "co-writers/remove", json!({ "name": "sam" })).status,
        403
    );
    // An owner account is never removed here.
    let owner = post_api(&f, &mikey, "co-writers/remove", json!({ "name": "mikey" }));
    assert_eq!(owner.status, 404);
    assert!(users_of(&f).find("mikey").is_some());
    // Removing Lee ends the sign-in at once and every binding with it; the credit stays.
    let removed = post_api(&f, &mikey, "co-writers/remove", json!({ "name": "lee" }));
    assert_eq!(
        removed.status,
        200,
        "{}",
        String::from_utf8_lossy(&removed.body)
    );
    assert!(users_of(&f).find("lee").is_none());
    assert_eq!(
        handle(
            &f.state,
            &authed(req("GET", "/admin/api/session"), &lee, false)
        )
        .status,
        401
    );
    let record = stored_record(&f, &id);
    assert!(record
        .authorization
        .bindings
        .iter()
        .all(|binding| binding.admin_user != "lee"));
    assert!(record
        .collaboration
        .participants
        .iter()
        .any(|participant| participant.display_name == "Lee Park"));
}
