//! Studio (the new Admin at /admin/studio/, docs/specs/studio/architecture.md): its files are
//! served from the binary with the right types and Admin's strict security headers, an unknown
//! path is a 404, and the embedded list matches web/studio on disk.

use super::*;

fn header<'a>(response: &'a Response, name: &str) -> Option<&'a str> {
    response
        .headers
        .iter()
        .find(|(key, _)| key.eq_ignore_ascii_case(name))
        .map(|(_, value)| value.as_str())
}

#[test]
fn studio_page_is_served_with_admins_security_policy() {
    let f = fixture("studio-index");
    for path in [
        "/admin/studio",
        "/admin/studio/",
        "/admin/studio/index.html",
    ] {
        let response = handle(&f.state, &req("GET", path));
        assert_eq!(response.status, 200, "{path}");
        assert!(header(&response, "Content-Type")
            .unwrap()
            .starts_with("text/html"));
        let csp = header(&response, "Content-Security-Policy").expect("CSP on Studio");
        assert!(csp.contains("script-src 'self'"), "{csp}");
        assert!(!csp.contains("unsafe-inline"), "{csp}");
        let body = String::from_utf8_lossy(&response.body);
        assert!(body.contains("/admin/studio/studio.js"));
    }
}

#[test]
fn studio_files_have_their_content_types() {
    let f = fixture("studio-types");
    for (path, kind) in [
        ("/admin/studio/studio.js", "text/javascript"),
        ("/admin/studio/studio.css", "text/css"),
        ("/admin/studio/zubra/theme.css", "text/css"),
        (
            "/admin/studio/zubra/cdn/action-button.js",
            "text/javascript",
        ),
        (
            "/admin/studio/fonts/literata-latin-wght-normal.woff2",
            "font/woff2",
        ),
    ] {
        let response = handle(&f.state, &req("GET", path));
        assert_eq!(response.status, 200, "{path}");
        assert!(
            header(&response, "Content-Type").unwrap().starts_with(kind),
            "{path}"
        );
    }
}

#[test]
fn unknown_studio_paths_are_not_found() {
    let f = fixture("studio-404");
    for path in [
        "/admin/studio/nope.js",
        "/admin/studio/../admin.rs",
        "/admin/studio/zubra/LICENSE",
        "/admin/studio/README.md",
    ] {
        assert_eq!(handle(&f.state, &req("GET", path)).status, 404, "{path}");
    }
}

#[test]
fn embedded_list_matches_web_studio_on_disk() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../web/studio");
    let mut on_disk = Vec::new();
    let mut stack = vec![root.clone()];
    while let Some(dir) = stack.pop() {
        for entry in fs::read_dir(&dir).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                stack.push(path);
                continue;
            }
            let rel = path
                .strip_prefix(&root)
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/");
            if rel.ends_with(".md") || rel == "zubra/LICENSE" {
                continue;
            }
            on_disk.push(rel);
        }
    }
    on_disk.sort();
    let mut embedded: Vec<String> = crate::studio_files::STUDIO_FILES
        .iter()
        .map(|(name, _)| name.to_string())
        .collect();
    embedded.sort();
    assert_eq!(
        embedded, on_disk,
        "run `node scripts/studio-files.mjs` after changing web/studio"
    );
}
