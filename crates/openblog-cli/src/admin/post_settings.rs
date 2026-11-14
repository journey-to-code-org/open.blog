//! Studio R5, "About this post": what Write needs from the server to tell the truth about a post.
//!
//! - G36: a save that fails says why with a short `code` (and, for the build's problems, which
//!   field), so Studio can put her words beside the right field.
//! - G37: whether a scheduled post goes up by itself (`meta.schedule`, `publish.mode`).
//! - G38: whether a post was ever on the site (`wasPublished`), so its address is only editable
//!   while no saved link can point at it. Unknown counts as "it was".
//! - G40: which profile fields are web addresses, file paths or one of a few choices.
//! - G41: why a change to the contributor registry was refused, by `code`.

use super::*;

/// How a scheduled post reaches readers (G37). `"self"`: this server's own build is what readers
/// see (nothing sends it elsewhere), or it sends the built pages out by itself after the scheduled
/// rebuild. `"next-send"`: the live site is built somewhere else from what is sent there, so the
/// post appears the next time that build runs after its time.
pub(crate) fn schedule_mode(root: &Path, config: &SiteConfig) -> &'static str {
    // Asked on every `meta`, so read from the repository's files where it can, without running Git.
    let (repo, remote) = git_facts(root, &config.publish.remote);
    if !repo || !remote {
        return "self";
    }
    if config.publish.auto && publishes_output(config) {
        return "self";
    }
    "next-send"
}

/// Whether the site is in Git and has the named remote: from `.git/config` when the folder (or one
/// above it) holds a `.git` folder, else from Git itself (a worktree or submodule's `.git` file).
fn git_facts(root: &Path, remote: &str) -> (bool, bool) {
    let mut dir = Some(root);
    while let Some(here) = dir {
        let dot = here.join(".git");
        if dot.is_dir() {
            let config = fs::read_to_string(dot.join("config")).unwrap_or_default();
            let wanted = format!("[remote \"{remote}\"]");
            return (true, config.lines().any(|line| line.trim() == wanted));
        }
        if dot.exists() {
            let git = crate::git::Git::new(root);
            return (git.is_repo(), git.has_remote(remote));
        }
        dir = here.parent();
    }
    (false, false)
}

/// Whether publishing commits the built pages themselves (the output folder is one of the
/// publish paths), so a rebuild here changes what is sent out.
fn publishes_output(config: &SiteConfig) -> bool {
    let output = config.paths.output.trim_matches('/');
    !output.is_empty()
        && config.publish.paths.iter().any(|path| {
            let path = path.trim_matches('/');
            path == output || output.starts_with(&format!("{path}/"))
        })
}

/// How the live site is sent out, for Details: `none` (not a Git repository: this server is the
/// site), `local` (committed here, nowhere to send it), `auto` (sent after every save) or
/// `by-hand` (sent when someone presses Publish).
pub(crate) fn publish_mode(root: &Path, config: &SiteConfig) -> &'static str {
    let (repo, remote) = git_facts(root, &config.publish.remote);
    if !repo {
        "none"
    } else if !remote {
        "local"
    } else if config.publish.auto {
        "auto"
    } else {
        "by-hand"
    }
}

/// The scheduled posts due now, as the commit summary that sends them out (G37).
pub(crate) fn scheduled_summary(due: &[String]) -> Option<String> {
    match due {
        [] => None,
        [one] => Some(format!("Publish scheduled post {one}")),
        many => Some(format!("Publish scheduled posts {}", many.join(", "))),
    }
}

/// The most commits looked at for one post before giving up and saying "it may have been seen".
const HISTORY_LIMIT: usize = 50;

/// Whether a post may ever have been on the site (G38): it is live now, or a version of it in the
/// site's history was published (not a draft, its date reached when it was committed). Without
/// history to ask, or when it can't be read, the answer is yes: an address that might be in
/// someone's bookmarks is never offered for change.
pub(crate) fn was_published(root: &Path, config: &SiteConfig, rel: &str, live_now: bool) -> bool {
    if live_now {
        return true;
    }
    let git = crate::git::Git::new(root);
    if !git.is_repo() {
        return true;
    }
    let file = format!("./{}/{rel}", config.paths.content.trim_matches('/'));
    let limit = format!("-n{}", HISTORY_LIMIT + 1);
    let Ok(log) = git.run(&["log", "--format=%H %ct", &limit, "--", &file]) else {
        return true;
    };
    let commits: Vec<(&str, i64)> = log
        .lines()
        .filter_map(|line| {
            let (hash, time) = line.split_once(' ')?;
            Some((hash, time.trim().parse().ok()?))
        })
        .collect();
    if commits.len() > HISTORY_LIMIT {
        return true;
    }
    commits.iter().any(|(hash, time)| {
        let Ok(text) = git.run(&["show", &format!("{hash}:{file}")]) else {
            return true;
        };
        let Ok(document) = frontmatter::parse(&text) else {
            return true;
        };
        let front = &document.front_matter;
        let draft = front.get_bool("draft").unwrap_or(false)
            || front
                .get("status")
                .is_some_and(|status| status.eq_ignore_ascii_case("draft"));
        if draft {
            return false;
        }
        ["date", "published", "publishedAt", "pubDate"]
            .iter()
            .find_map(|key| front.get(key))
            .and_then(DateTime::parse)
            .is_none_or(|date| date.unix() <= *time)
    })
}

/// What a post's file says about it now (G38): its status, address, resolved slug, and the
/// excerpt the engine would use with no summary (G43).
pub(crate) struct PostFacts {
    pub status: &'static str,
    pub url: Option<String>,
    pub slug: Option<String>,
    pub excerpt: Option<String>,
}

pub(crate) fn post_facts(rel: &str, text: &str, config: &SiteConfig, now: DateTime) -> PostFacts {
    let file = SourceFile {
        path: rel.to_string(),
        contents: text.to_string(),
    };
    let loaded = openblog_core::model::load_post(&file, config, RenderOptions::default());
    let (status, url, slug) = match &loaded {
        Ok(post) if post.draft => ("draft", Some(post.url.clone()), Some(post.slug.clone())),
        Ok(post) if post.date > now => {
            ("scheduled", Some(post.url.clone()), Some(post.slug.clone()))
        }
        Ok(post) => ("published", Some(post.url.clone()), Some(post.slug.clone())),
        Err(_) => ("error", None, None),
    };
    // The excerpt: the same post with no summary of its own, so the engine makes one.
    let excerpt = frontmatter::parse(text).ok().and_then(|mut document| {
        for key in ["description", "summary", "brief", "excerpt"] {
            document.front_matter.fields.remove(key);
        }
        let bare = SourceFile {
            path: rel.to_string(),
            contents: frontmatter::compose(&document.front_matter.fields, &document.body),
        };
        openblog_core::model::load_post(&bare, config, RenderOptions::default())
            .ok()
            .map(|post| post.description)
    });
    PostFacts {
        status,
        url,
        slug,
        excerpt,
    }
}

/// One of the build's problems with a save, with the field it is about and a short code (G36).
/// The sentence stays as `message`.
pub(crate) fn document_issue(problem: &str) -> Json {
    // The build names the file first ("posts/x.md: ..."); the rest is about the post.
    let rest = match problem.split_once(": ") {
        Some((path, rest)) if path.contains('/') && !path.contains(' ') => rest,
        _ => problem,
    };
    let lower = rest.to_ascii_lowercase();
    let (field, code): (String, String) = if lower.starts_with("duplicate post slug")
        || lower.starts_with("duplicate page slug")
        || lower.starts_with("duplicate series slug")
        || (lower.contains("slug") && lower.contains("reserved"))
    {
        ("slug".into(), "slug-taken".into())
    } else if lower.starts_with("unrecognised updated date") {
        ("updated".into(), "date".into())
    } else if lower.starts_with("unrecognised date") || lower.contains("needs a `date`") {
        ("date".into(), "date".into())
    } else if lower.starts_with("comments must be") {
        ("comments".into(), "comments".into())
    } else if rest.starts_with("job") && rest.split_once(':').is_some_and(|(f, _)| !f.contains(' '))
    {
        let (field, code) = openblog_core::job::problem_code(rest);
        (field, code.into())
    } else if lower.starts_with("unknown contributor") {
        ("credits".into(), "credit-unknown-person".into())
    } else if lower.starts_with("unknown crossref role") || lower.starts_with("unknown credit role")
    {
        ("credits".into(), "credit-unknown-role".into())
    } else if lower.contains("must have at least one role") {
        ("credits".into(), "credit-no-role".into())
    } else if lower.starts_with("duplicate contributor") || lower.starts_with("duplicate role") {
        ("credits".into(), "credit-duplicate".into())
    } else if lower.contains("alias") {
        ("aliases".into(), "alias".into())
    } else if let Some(key) = profile_key_in(rest) {
        (key.into(), "profile-field".into())
    } else {
        (String::new(), "build".into())
    };
    json!({ "field": field, "code": code, "message": problem })
}

/// The profile field a sentence names in backticks, if any (`videoUrl`, `locationPrivacy`, ...).
fn profile_key_in(text: &str) -> Option<&'static str> {
    openblog_core::profile::catalog()
        .iter()
        .flat_map(|profile| profile.fields.iter())
        .map(|field| field.key)
        .find(|key| text.contains(&format!("`{key}`")))
}

/// The build's refusal of a save: the sentences as before (`problems`, read by the old Admin and
/// the record screens), and the same with fields and codes (`issues`, G36).
pub(crate) fn save_refused(problems: &[String]) -> Response {
    let issues: Vec<Json> = problems.iter().map(|p| document_issue(p)).collect();
    let code = issues
        .first()
        .and_then(|issue| issue["code"].as_str())
        .unwrap_or("build")
        .to_string();
    Response::json(
        422,
        &json!({ "error": "This can't be saved yet.", "code": code, "problems": problems, "issues": issues }),
    )
}

/// How Studio draws a profile field (G40): a web address, a file in the project, one of a few
/// choices, or the field's own kind. The old Admin reads only `kind` and treats new ones as text.
pub(crate) fn field_control(
    key: &str,
    kind: &'static str,
) -> (&'static str, Option<Vec<&'static str>>) {
    match key {
        "videoUrl" | "thumbnail" | "adaptedFrom" | "license" => ("url", None),
        "videoFile" | "captions" => ("path", None),
        // The old Admin draws this one as a select by its own kind, so the kind stays.
        "productionStatus" => (
            kind,
            Some(openblog_core::video::PRODUCTION_STATUSES.to_vec()),
        ),
        "locationPrivacy" => (
            "choice",
            Some(vec!["hidden", "approximate", "trimmed", "exact"]),
        ),
        "videoRights" => ("choice", Some(vec!["owned", "licensed"])),
        "videoPeople" => ("choice", Some(vec!["consented", "none"])),
        "madeForKids" | "syntheticMedia" => ("choice", Some(vec!["yes", "no"])),
        _ => (kind, None),
    }
}

/// The longest a field may be, where the destination limits it (G40).
pub(crate) fn field_max(key: &str) -> Option<u32> {
    match key {
        "videoTitle" => Some(100),
        _ => None,
    }
}

/// The field a registry problem is about (G41): `contributors.ruth.orcid: ...` is `orcid`;
/// a bad key is `id`.
pub(crate) fn contributor_field(message: &str) -> &'static str {
    let Some(rest) = message.split("contributors.").nth(1) else {
        return "";
    };
    if rest.contains(": key must") {
        return "id";
    }
    let after_id = rest
        .split_once(['.', ':', ' '])
        .map(|(_, tail)| tail)
        .unwrap_or("");
    for field in ["name", "url", "sameAs", "orcid"] {
        if after_id.starts_with(field) {
            return field;
        }
    }
    ""
}

/// The posts that name removed people, as `{path, title}` (G41), from their credit files' paths.
pub(crate) fn posts_naming(root: &Path, config: &SiteConfig, sidecars: &[String]) -> Vec<Json> {
    let sources = site::read_sources(root, config).unwrap_or_default();
    sidecars
        .iter()
        .map(|sidecar| {
            let post = sources.posts.iter().find(|post| {
                openblog_core::contributor::sidecar_path(&post.path).as_deref()
                    == Some(sidecar.as_str())
            });
            let path = post.map(|post| post.path.clone()).unwrap_or_else(|| {
                sidecar
                    .strip_suffix(".credits.json")
                    .map(|stem| format!("{stem}.md"))
                    .unwrap_or_else(|| sidecar.clone())
            });
            let title = post
                .and_then(|post| frontmatter::parse(&post.contents).ok())
                .and_then(|document| document.front_matter.get("title").map(str::to_string))
                .unwrap_or_else(|| path.clone());
            json!({ "path": path, "title": title })
        })
        .collect()
}

#[cfg(test)]
mod unit {
    use super::*;

    #[test]
    fn issues_name_their_field_and_code() {
        let issue = |p: &str| document_issue(p);
        assert_eq!(
            issue("posts/a.md: duplicate post slug `hello` (also in posts/b.md)")["code"],
            "slug-taken"
        );
        assert_eq!(
            issue("posts/a.md: duplicate post slug `x`")["field"],
            "slug"
        );
        assert_eq!(
            issue("posts/a.md: unrecognised date `soon` (use YYYY-MM-DD or RFC 3339)")["field"],
            "date"
        );
        assert_eq!(
            issue("posts/a.md: comments must be `open`, `locked`, or `hidden`")["code"],
            "comments"
        );
        assert_eq!(
            issue("posts/a.md: unknown contributor `ruth`; add it to openblog.json `contributors`")
                ["code"],
            "credit-unknown-person"
        );
        assert_eq!(
            issue("posts/a.md: unknown credit role `foo` for contributor `ruth`")["code"],
            "credit-unknown-role"
        );
        assert_eq!(
            issue("posts/a.md: contributor `ruth` must have at least one role")["code"],
            "credit-no-role"
        );
        let video = issue(
            "posts/a.md: video profile `videoUrl` must be a supported YouTube watch, short, or Shorts URL",
        );
        assert_eq!(video["code"], "profile-field");
        assert_eq!(video["field"], "videoUrl");
        assert_eq!(
            issue("posts/a.md: an alias cannot be the site root")["code"],
            "alias"
        );
        assert_eq!(issue("something else entirely")["code"], "build");
        assert_eq!(
            issue("posts/a.md: something else entirely")["message"],
            "posts/a.md: something else entirely"
        );
    }

    #[test]
    fn registry_problems_name_their_field() {
        assert_eq!(
            contributor_field("invalid openblog.json: contributors.ruth.name must not be empty"),
            "name"
        );
        assert_eq!(
            contributor_field("contributors.ruth.orcid: must be an ORCID iD"),
            "orcid"
        );
        assert_eq!(
            contributor_field("contributors.ruth.url must be an absolute HTTP(S) URL"),
            "url"
        );
        assert_eq!(
            contributor_field("contributors.Ruth B: key must be a lowercase ASCII slug"),
            "id"
        );
        assert_eq!(contributor_field("something else"), "");
    }

    #[test]
    fn a_summary_names_the_posts_that_went_up() {
        assert_eq!(scheduled_summary(&[]), None);
        assert_eq!(
            scheduled_summary(&["Pumpkin bread".into()]).as_deref(),
            Some("Publish scheduled post Pumpkin bread")
        );
        assert_eq!(
            scheduled_summary(&["A".into(), "B".into()]).as_deref(),
            Some("Publish scheduled posts A, B")
        );
    }

    #[test]
    fn git_facts_read_the_config_without_running_git() {
        let dir = std::env::temp_dir().join(format!("ob-git-facts-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("site")).unwrap();
        assert_eq!(
            git_facts(&dir.join("site"), "origin").0,
            crate::git::Git::new(&dir.join("site")).is_repo()
        );
        fs::create_dir_all(dir.join(".git")).unwrap();
        fs::write(
            dir.join(".git/config"),
            "[core]\n\tbare = false\n[remote \"origin\"]\n\turl = x\n",
        )
        .unwrap();
        assert_eq!(git_facts(&dir.join("site"), "origin"), (true, true));
        assert_eq!(git_facts(&dir.join("site"), "upstream"), (true, false));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn profile_fields_say_how_they_are_drawn() {
        assert_eq!(field_control("videoUrl", "text").0, "url");
        assert_eq!(field_control("videoFile", "text").0, "path");
        assert_eq!(
            field_control("productionStatus", "production-status").0,
            "production-status"
        );
        assert_eq!(
            field_control("productionStatus", "production-status")
                .1
                .unwrap()[0],
            "idea"
        );
        assert_eq!(
            field_control("locationPrivacy", "text").1.unwrap(),
            vec!["hidden", "approximate", "trimmed", "exact"]
        );
        assert_eq!(field_control("course", "text"), ("text", None));
        assert_eq!(field_max("videoTitle"), Some(100));
    }
}
