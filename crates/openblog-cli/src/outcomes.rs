//! The distribution report (epic DIST8, #388; ADRs 0402 to 0404): `openblog outcomes` and Admin's
//! **Where it went** screen.
//!
//! Each adapter keeps its own private record. This module only reads them, each through a small
//! reader that turns the record into [`Outcome`] rows, then reconciles the rows, joins them to the
//! site's posts and to the visits the built-in counter attributed to each destination, and redacts
//! everything on the way out. Nothing is written, nothing is sent and no provider is asked: a status
//! is "confirmed" only when the provider's own answer was recorded, a visit count is "estimated"
//! because referrers are often stripped, and a provider's own statistics are always "unavailable".

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use openblog_core::outcome::{self, Counts, Evidence, Outcome, Status};
use openblog_core::{DateTime, SiteConfig};
use serde_json::{json, Value as Json};

/// The most bytes a record is read to; a larger file is reported as unreadable, not loaded.
const MAX_RECORD_BYTES: u64 = 8 * 1024 * 1024;

/// One adapter's record, as the report saw it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Family {
    pub id: &'static str,
    pub label: &'static str,
    /// `absent` (never used), `read`, or `unreadable`.
    pub state: &'static str,
}

fn read_json(root: &Path, rel: &str) -> Result<Option<Json>, ()> {
    let path = root.join(rel);
    match fs::metadata(&path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(()),
        Ok(meta) if meta.len() > MAX_RECORD_BYTES => return Err(()),
        Ok(_) => {}
    }
    let text = fs::read_to_string(&path).map_err(|_| ())?;
    serde_json::from_str(&text).map(Some).map_err(|_| ())
}

fn text(value: &Json, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Json::as_str)
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string)
}

fn unix(seconds: i64) -> Option<String> {
    (seconds > 0).then(|| DateTime::from_unix(seconds).rfc3339())
}

// ---------------------------------------------------------------------------------------------
// The readers. Each knows one record's format and nothing else; an unknown status is left out.

/// Cross-posting (`syndication.json`, schema 2): by source identity, then target name.
fn syndication(record: &Json, config: &SiteConfig) -> Vec<Outcome> {
    let mut rows = Vec::new();
    let Some(records) = record.get("records").and_then(Json::as_object) else {
        return rows;
    };
    for (source_id, targets) in records {
        let Some(targets) = targets.as_object() else {
            continue;
        };
        for (target, entry) in targets {
            // The provider of a target the author renamed or removed is unknown: left out.
            let Some(provider) = config.syndication.targets.get(target).map(|t| {
                serde_json::to_value(t.provider)
                    .ok()
                    .and_then(|v| v.as_str().map(str::to_string))
                    .unwrap_or_default()
            }) else {
                continue;
            };
            let status = match entry.get("publicationState").and_then(Json::as_str) {
                Some("published") => Status::Delivered,
                Some("draft") => Status::Draft,
                _ => continue,
            };
            let source = text(entry, "sourcePath").unwrap_or_else(|| source_id.clone());
            let mut row = Outcome::new(&source, &provider, status, Evidence::Provider);
            row.place = Some(target.clone());
            row.remote_id = text(entry, "remoteId");
            row.permalink = text(entry, "remoteUrl");
            row.last_update_at = entry
                .get("updatedAtUnix")
                .and_then(Json::as_i64)
                .and_then(unix);
            rows.push(row);
        }
    }
    rows
}

/// Pinterest (`pinterest.json`, version 1): by environment, board and source path.
fn pinterest(record: &Json) -> Vec<Outcome> {
    let mut rows = Vec::new();
    let Some(pins) = record.get("pins").and_then(Json::as_object) else {
        return rows;
    };
    for pin in pins.values() {
        // A sandbox Pin is visible only to its creator: it is not a delivery to anyone.
        let sandbox = pin.get("environment").and_then(Json::as_str) != Some("production");
        let status = match pin.get("status").and_then(Json::as_str) {
            Some("posted") if sandbox => Status::Draft,
            Some("posted") => Status::Delivered,
            Some("unknown") => Status::Unknown,
            Some("not-posted") => Status::NotDelivered,
            _ => continue,
        };
        let Some(source) = text(pin, "sourcePath") else {
            continue;
        };
        let evidence = if status == Status::Unknown {
            Evidence::None
        } else {
            Evidence::Provider
        };
        let mut row = Outcome::new(&source, "pinterest", status, evidence);
        row.place = text(pin, "boardId").map(|board| format!("board {board}"));
        row.remote_id = text(pin, "pinId");
        row.permalink = text(pin, "pinUrl");
        row.first_attempt_at = text(pin, "attemptedAt");
        row.last_update_at = text(pin, "attemptedAt");
        row.problem = text(pin, "failure");
        rows.push(row);
    }
    rows
}

/// Community submissions (`community-submissions.json`, version 1): only the author confirms one.
fn community(record: &Json) -> Vec<Outcome> {
    let mut rows = Vec::new();
    let Some(records) = record.get("records").and_then(Json::as_object) else {
        return rows;
    };
    for (source, destinations) in records {
        let Some(destinations) = destinations.as_object() else {
            continue;
        };
        for (key, list) in destinations {
            let (destination, place) = match key.split_once(':') {
                Some(("reddit", community)) => ("reddit", Some(format!("r/{community}"))),
                None if key == "hacker-news" || key == "product-hunt" => (key.as_str(), None),
                _ => continue,
            };
            for submission in list.as_array().into_iter().flatten() {
                let mut row = Outcome::new(source, destination, Status::ByHand, Evidence::Author);
                row.place = place.clone();
                row.permalink = text(submission, "permalink");
                let at = submission
                    .get("confirmedAtUnix")
                    .and_then(Json::as_i64)
                    .and_then(unix);
                row.first_attempt_at = at.clone();
                row.last_update_at = at;
                rows.push(row);
            }
        }
    }
    rows
}

/// Job shares (`job-shares.json`, version 1): by the job's source path, then the place.
fn job_shares(record: &Json) -> Vec<Outcome> {
    let mut rows = Vec::new();
    let Some(jobs) = record.get("jobs").and_then(Json::as_object) else {
        return rows;
    };
    for (source, places) in jobs {
        let Some(places) = places.as_object() else {
            continue;
        };
        for (place, entry) in places {
            let (status, evidence) = match entry.get("status").and_then(Json::as_str) {
                Some("posted") => (Status::Delivered, Evidence::Provider),
                Some("posted-by-hand") => (Status::ByHand, Evidence::Author),
                Some("kit-made") => (Status::Pending, Evidence::None),
                Some("unknown") => (Status::Unknown, Evidence::None),
                Some("not-posted") => (Status::NotDelivered, Evidence::Provider),
                _ => continue,
            };
            let mut row = Outcome::new(source, place, status, evidence);
            row.remote_id = text(entry, "postName");
            row.permalink = text(entry, "postUrl");
            row.last_update_at = text(entry, "at");
            row.first_attempt_at = text(entry, "at");
            rows.push(row);
        }
    }
    rows
}

/// YouTube releases (the protected record): by post slug.
fn youtube(record: &Json, slug_sources: &BTreeMap<String, String>) -> Vec<Outcome> {
    let mut rows = Vec::new();
    let Some(releases) = record.get("releases").and_then(Json::as_object) else {
        return rows;
    };
    for (slug, release) in releases {
        let Some(source) = slug_sources.get(slug) else {
            continue;
        };
        let scheduled = release.get("publishAt").is_some_and(|v| !v.is_null());
        let (status, evidence) = match release.get("state").and_then(Json::as_str) {
            // A video is uploaded private; it is public only when YouTube publishes it at its time.
            Some("uploaded") if scheduled => (Status::Pending, Evidence::Provider),
            Some("uploaded") => (Status::Draft, Evidence::Provider),
            Some("uploading") => (Status::Pending, Evidence::None),
            Some("unknown") => (Status::Unknown, Evidence::None),
            Some("failed") | Some("not-uploaded") => (Status::NotDelivered, Evidence::Provider),
            _ => continue,
        };
        if status == Status::NotDelivered
            && release.get("startedAt").and_then(Json::as_i64) == Some(0)
        {
            // Approved but never sent: nothing happened at YouTube.
            continue;
        }
        let mut row = Outcome::new(source, "youtube", status, evidence);
        row.remote_id = text(release, "videoId");
        row.permalink = text(release, "url");
        row.first_attempt_at = release
            .get("startedAt")
            .and_then(Json::as_i64)
            .and_then(unix);
        row.last_update_at = release
            .get("lastSentAt")
            .and_then(Json::as_i64)
            .and_then(unix);
        row.problem = text(release, "failure");
        row.attempts = release
            .get("history")
            .and_then(Json::as_array)
            .map(|h| h.len().clamp(1, 1000) as u32)
            .unwrap_or(1);
        rows.push(row);
    }
    rows
}

fn read_youtube(root: &Path) -> Result<Option<Json>, ()> {
    let path = root.join(".openblog/private/youtube/releases");
    let bytes = match fs::read(&path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(()),
        Ok(bytes) if bytes.len() as u64 > MAX_RECORD_BYTES => return Err(()),
        Ok(bytes) => bytes,
    };
    let plain = crate::admin::unprotect_private_credential(&bytes).map_err(|_| ())?;
    serde_json::from_slice(&plain).map(Some).map_err(|_| ())
}

/// Every adapter's rows, and how each record was found.
pub(crate) fn gather(
    root: &Path,
    config: &SiteConfig,
    slug_sources: &BTreeMap<String, String>,
) -> (Vec<Outcome>, Vec<Family>) {
    let mut rows = Vec::new();
    let mut families = Vec::new();
    let mut take = |id: &'static str,
                    label: &'static str,
                    found: Result<Option<Json>, ()>,
                    read: &dyn Fn(&Json) -> Vec<Outcome>| {
        let state = match found {
            Ok(None) => "absent",
            Ok(Some(record)) => {
                rows.extend(read(&record));
                "read"
            }
            Err(()) => "unreadable",
        };
        families.push(Family { id, label, state });
    };
    take(
        "cross-posting",
        "Cross-posting",
        read_json(root, &config.syndication.state_file),
        &|r| syndication(r, config),
    );
    let pinterest_file = config
        .syndication
        .pinterest
        .as_ref()
        .map(|p| p.state_file.clone())
        .unwrap_or_else(|| ".openblog/pinterest.json".into());
    take(
        "pinterest",
        "Pinterest",
        read_json(root, &pinterest_file),
        &pinterest,
    );
    take(
        "community",
        "Community submissions",
        read_json(root, &config.community.state_file),
        &community,
    );
    take(
        "job-shares",
        "Shared jobs",
        read_json(root, crate::job_share::STATE_FILE),
        &job_shares,
    );
    take("youtube", "YouTube", read_youtube(root), &|r| {
        youtube(r, slug_sources)
    });
    (rows, families)
}

// ---------------------------------------------------------------------------------------------
// The report.

fn words(status: Status) -> &'static str {
    match status {
        Status::Delivered => "Delivered",
        Status::ByHand => "Posted by hand",
        Status::Draft => "Draft or private",
        Status::Pending => "Waiting",
        Status::Unknown => "Unknown: check, then settle it",
        Status::NotDelivered => "Not delivered",
    }
}

fn kind(status: Status, evidence: Evidence) -> &'static str {
    match (status, evidence) {
        (Status::Unknown, _) | (_, Evidence::None) => "unknown",
        (_, Evidence::Provider) => "confirmed",
        (_, Evidence::Author) => "author",
    }
}

/// The report as JSON: the families read, totals, and one entry per post with its rows. `visits`
/// is `None` when the built-in counter is off, so every visit figure says "unavailable".
pub(crate) fn report(
    root: &Path,
    config: &SiteConfig,
    posts: &[(String, String, String, String)],
    visits: Option<&BTreeMap<String, BTreeMap<String, u64>>>,
    days: u32,
) -> Json {
    let content = config.paths.content.clone();
    let slug_sources: BTreeMap<String, String> = posts
        .iter()
        .map(|(source, slug, _, _)| (slug.clone(), source.clone()))
        .collect();
    let (rows, families) = gather(root, config, &slug_sources);
    let rows = outcome::reconcile(rows, &content);
    let totals = Counts::of(&rows);
    let by_source: BTreeMap<String, &(String, String, String, String)> = posts
        .iter()
        .map(|post| (outcome::source_key(&post.0, &content), post))
        .collect();
    let mut entries: BTreeMap<String, Vec<Json>> = BTreeMap::new();
    for row in &rows {
        // Only posts the site still has: an old record for a deleted post is not reported.
        let Some((_, _, title, url)) = by_source.get(&row.source).map(|p| (*p).clone()) else {
            continue;
        };
        let estimated = visits.map(|v| {
            v.get(&row.destination)
                .and_then(|paths| paths.get(&url))
                .copied()
                .unwrap_or(0)
        });
        entries.entry(row.source.clone()).or_default().push(json!({
            "title": title,
            "url": url,
            "destination": row.destination,
            "place": row.place,
            "status": row.status,
            "statusWords": words(row.status),
            "evidence": kind(row.status, row.evidence),
            "remoteId": row.remote_id,
            "permalink": row.permalink,
            "attempts": row.attempts,
            "firstAttemptAt": row.first_attempt_at,
            "lastUpdateAt": row.last_update_at,
            "problem": row.problem,
            "visits": match estimated {
                Some(n) => json!({ "kind": "estimated", "value": n, "days": days }),
                None => json!({ "kind": "unavailable", "reason": "counter-off" }),
            },
            "providerStats": { "kind": "unavailable", "reason": "not-read" },
        }));
    }
    let posts_out: Vec<Json> = entries
        .into_iter()
        .map(|(source, rows)| {
            json!({
                "source": source,
                "title": rows[0]["title"],
                "url": rows[0]["url"],
                "destinations": rows,
            })
        })
        .collect();
    // Visits by destination for the site's own post pages only, so Admin can show them beside the
    // social announcements it reads from the hosted queue (ADR 0404).
    let pages: std::collections::BTreeSet<&str> = posts.iter().map(|p| p.3.as_str()).collect();
    let arrivals: BTreeMap<&String, BTreeMap<&String, &u64>> = visits
        .into_iter()
        .flatten()
        .map(|(destination, paths)| {
            (
                destination,
                paths
                    .iter()
                    .filter(|(path, _)| pages.contains(path.as_str()))
                    .collect(),
            )
        })
        .collect();
    json!({
        "version": 1,
        "days": days,
        "arrivals": arrivals,
        "families": families.iter().map(|f| json!({ "id": f.id, "label": f.label, "state": f.state })).collect::<Vec<_>>(),
        "totals": totals,
        "reached": totals.reached(),
        "visitsAvailable": visits.is_some(),
        "posts": posts_out,
    })
}

/// The posts the report can name: source, slug, title and page path.
pub(crate) fn site_posts(site: &openblog_core::Site) -> Vec<(String, String, String, String)> {
    site.posts
        .iter()
        .map(|p| {
            (
                p.source.clone(),
                p.slug.clone(),
                p.title.clone(),
                p.url.clone(),
            )
        })
        .collect()
}

/// `openblog outcomes [--json] [--days N]`.
pub(crate) fn run(root: &Path, json_out: bool, days: u32) -> Result<(), String> {
    let (site, _) = crate::site::load_site(root, false, None)?;
    let config = &site.config;
    let store_path = root.join(".openblog/analytics.json");
    let visits = config.analytics.builtin.then(|| {
        crate::analytics::Store::load(&store_path, config.analytics.retention_days)
            .arrivals(crate::clock::now(), days)
    });
    let report = report(root, config, &site_posts(&site), visits.as_ref(), days);
    if json_out {
        println!(
            "{}",
            serde_json::to_string_pretty(&report).map_err(|e| e.to_string())?
        );
        return Ok(());
    }
    print!("{}", plain(&report));
    Ok(())
}

/// `GET /admin/api/distribution?days=N`: the same report for Admin, read-only, from the live
/// counter the server holds.
pub(crate) fn admin_get(
    state: &crate::admin::AppState,
    req: &crate::http::Request,
) -> crate::http::Response {
    let days = match req.query.get("days") {
        None => 30,
        Some(value) => match value.trim().parse::<u32>() {
            Ok(days) if (1..=400).contains(&days) => days,
            _ => {
                return crate::http::Response::error(
                    400,
                    "days must be a whole number from 1 to 400",
                )
            }
        },
    };
    let (site, _) = match crate::site::load_site(&state.root, false, None) {
        Ok(loaded) => loaded,
        Err(error) => return crate::http::Response::error(500, &error),
    };
    let visits = site.config.analytics.builtin.then(|| {
        state
            .analytics
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .arrivals(crate::clock::now(), days)
    });
    crate::http::Response::json(
        200,
        &report(
            &state.root,
            &site.config,
            &site_posts(&site),
            visits.as_ref(),
            days,
        ),
    )
}

/// The report as plain text for a terminal.
pub(crate) fn plain(report: &Json) -> String {
    let mut out = String::new();
    let totals = &report["totals"];
    out.push_str(&format!(
        "Where your posts went (read from your own records; no provider was asked)\n\
         Reached: {} ({} confirmed by the provider, {} posted by hand). Unknown: {}. Waiting: {}. Drafts or private: {}. Not delivered: {}.\n",
        report["reached"],
        totals["delivered"],
        totals["byHand"],
        totals["unknown"],
        totals["pending"],
        totals["draft"],
        totals["notDelivered"],
    ));
    for family in report["families"].as_array().into_iter().flatten() {
        if family["state"] == "unreadable" {
            out.push_str(&format!(
                "Note: the {} record could not be read, so it is not in this report.\n",
                family["label"].as_str().unwrap_or("")
            ));
        }
    }
    let days = report["days"].as_u64().unwrap_or(0);
    for post in report["posts"].as_array().into_iter().flatten() {
        out.push_str(&format!(
            "\n{} ({})\n",
            post["title"].as_str().unwrap_or(""),
            post["url"].as_str().unwrap_or("")
        ));
        for row in post["destinations"].as_array().into_iter().flatten() {
            let place = row["place"]
                .as_str()
                .map(|p| format!(" ({p})"))
                .unwrap_or_default();
            let visits = match row["visits"]["kind"].as_str() {
                Some("estimated") => format!(
                    "about {} visits from there in {days} days",
                    row["visits"]["value"]
                ),
                _ => "visits unavailable".into(),
            };
            let link = row["permalink"]
                .as_str()
                .map(|l| format!(" {l}"))
                .unwrap_or_default();
            out.push_str(&format!(
                "  {}{}: {}, {}{}\n",
                row["destination"].as_str().unwrap_or(""),
                place,
                row["statusWords"].as_str().unwrap_or(""),
                visits,
                link
            ));
        }
    }
    if report["posts"].as_array().is_none_or(|p| p.is_empty()) {
        out.push_str("\nNothing has been sent anywhere yet.\n");
    }
    if report["visitsAvailable"] == false {
        out.push_str(
            "\nVisits are unavailable: the built-in counter is off (analytics.builtin).\n",
        );
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dir(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("ob-outcomes-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join(".openblog")).unwrap();
        dir
    }

    fn config() -> SiteConfig {
        SiteConfig::from_json(
            r#"{"title":"T","url":"https://t.example","syndication":{"targets":{"my-dev":{"provider":"dev","enabled":true}}}}"#,
        )
        .unwrap()
    }

    fn posts() -> Vec<(String, String, String, String)> {
        vec![
            (
                "content/posts/a.md".into(),
                "a".into(),
                "Post A".into(),
                "/a/".into(),
            ),
            (
                "content/posts/b.md".into(),
                "b".into(),
                "Post B".into(),
                "/b/".into(),
            ),
        ]
    }

    fn write(root: &Path, rel: &str, value: Json) {
        let path = root.join(rel);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, value.to_string()).unwrap();
    }

    fn row<'a>(report: &'a Json, url: &str, destination: &str) -> &'a Json {
        report["posts"]
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p["url"] == url)
            .unwrap_or_else(|| panic!("no {url} in {report}"))["destinations"]
            .as_array()
            .unwrap()
            .iter()
            .find(|r| r["destination"] == destination)
            .unwrap_or_else(|| panic!("no {destination} for {url}"))
    }

    #[test]
    fn with_nothing_sent_the_report_is_empty_and_writes_nothing() {
        let root = dir("empty");
        let report = report(&root, &config(), &posts(), None, 30);
        assert_eq!(report["reached"], 0);
        assert!(report["posts"].as_array().unwrap().is_empty());
        assert!(report["families"]
            .as_array()
            .unwrap()
            .iter()
            .all(|f| f["state"] == "absent"));
        assert_eq!(fs::read_dir(root.join(".openblog")).unwrap().count(), 0);
        assert!(plain(&report).contains("Nothing has been sent anywhere yet."));
        assert!(plain(&report).contains("Visits are unavailable"));
    }

    #[test]
    fn every_adapter_record_is_normalized_and_joined_to_its_post() {
        let root = dir("all");
        write(
            &root,
            ".openblog/syndication.json",
            json!({"schemaVersion": 2, "records": {"source:content/posts/a.md": {
                "my-dev": {"sourcePath": "posts/a.md", "remoteId": "991", "remoteUrl": "https://dev.to/t/a-1", "remoteRevision": "", "revision": "r", "publicationState": "published", "updatedAtUnix": 1762000000},
                "gone-target": {"sourcePath": "posts/a.md", "remoteId": "1", "remoteUrl": "", "remoteRevision": "", "revision": "r", "publicationState": "published", "updatedAtUnix": 1762000000}
            }}}),
        );
        write(
            &root,
            ".openblog/pinterest.json",
            json!({"version": 1, "pins": {
                "production/42/posts/a.md": {"status": "posted", "environment": "production", "boardId": "42", "sourcePath": "posts/a.md", "link": "https://t.example/a/", "digest": "d", "attemptedAt": "2026-11-02T10:00:00Z", "pinId": "777", "pinUrl": "https://www.pinterest.com/pin/777/"},
                "sandbox/42/posts/b.md": {"status": "posted", "environment": "sandbox", "boardId": "42", "sourcePath": "posts/b.md", "link": "https://t.example/b/", "digest": "d", "attemptedAt": "2026-11-02T10:00:00Z", "pinId": "8"}
            }}),
        );
        write(
            &root,
            ".openblog/community-submissions.json",
            json!({"recordsVersion": 1, "records": {"source:content/posts/a.md": {
                "hacker-news": [{"status": "author-confirmed", "evidence": "author", "canonicalUrl": "https://t.example/a/", "title": "A", "permalink": "https://news.ycombinator.com/item?id=1", "confirmedAt": "x", "confirmedAtUnix": 1762100000, "policyVersion": "p"}],
                "reddit:rust": [{"status": "author-confirmed", "evidence": "author", "canonicalUrl": "https://t.example/a/", "title": "A", "permalink": null, "confirmedAt": "x", "confirmedAtUnix": 1762100000, "policyVersion": "p"}]
            }}}),
        );
        write(
            &root,
            ".openblog/job-shares.json",
            json!({"version": 1, "jobs": {"posts/b.md": {
                "nextdoor": {"status": "posted-by-hand", "at": "2026-11-03T10:00:00Z", "digest": "x"},
                "google-business-profile": {"status": "unknown", "at": "2026-11-03T11:00:00Z", "digest": "y"}
            }}}),
        );
        let mut visits = BTreeMap::new();
        visits.insert(
            "pinterest".to_string(),
            BTreeMap::from([("/a/".to_string(), 12u64)]),
        );
        let report = report(&root, &config(), &posts(), Some(&visits), 30);

        let dev = row(&report, "/a/", "dev");
        assert_eq!(dev["status"], "delivered");
        assert_eq!(dev["evidence"], "confirmed");
        assert_eq!(dev["place"], "my-dev");
        assert_eq!(dev["permalink"], "https://dev.to/t/a-1");
        assert_eq!(
            dev["lastUpdateAt"],
            DateTime::from_unix(1762000000).rfc3339()
        );
        let pin = row(&report, "/a/", "pinterest");
        assert_eq!(
            pin["visits"],
            json!({"kind": "estimated", "value": 12, "days": 30})
        );
        assert_eq!(pin["providerStats"]["kind"], "unavailable");
        assert_eq!(
            row(&report, "/b/", "pinterest")["status"],
            "draft",
            "a sandbox Pin reaches no one"
        );
        let hn = row(&report, "/a/", "hacker-news");
        assert_eq!(
            (hn["status"].as_str(), hn["evidence"].as_str()),
            (Some("by-hand"), Some("author"))
        );
        assert_eq!(
            hn["permalink"], "https://news.ycombinator.com/item",
            "the query is dropped"
        );
        assert_eq!(row(&report, "/a/", "reddit")["place"], "r/rust");
        assert_eq!(row(&report, "/b/", "nextdoor")["status"], "by-hand");
        assert_eq!(
            row(&report, "/b/", "google-business-profile")["evidence"],
            "unknown"
        );
        // A target no longer in the settings is left out rather than guessed at.
        assert_eq!(
            report["posts"][0]["destinations"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|r| r["destination"] == "dev")
                .count(),
            1
        );
        // dev 1, pinterest prod 1, HN 1, reddit 1, nextdoor 1 reached; GBP unknown; sandbox draft.
        assert_eq!(report["reached"], 5);
        assert_eq!(report["totals"]["unknown"], 1);
        assert_eq!(report["totals"]["draft"], 1);
    }

    #[test]
    fn an_unreadable_record_is_named_and_the_others_still_report() {
        let root = dir("bad");
        fs::write(root.join(".openblog/pinterest.json"), "{ not json").unwrap();
        write(
            &root,
            ".openblog/job-shares.json",
            json!({"version": 1, "jobs": {"posts/a.md": {
            "nextdoor": {"status": "posted-by-hand", "at": "2026-11-03T10:00:00Z", "digest": "x"}}}}),
        );
        let report = report(&root, &config(), &posts(), None, 30);
        let pins = report["families"]
            .as_array()
            .unwrap()
            .iter()
            .find(|f| f["id"] == "pinterest")
            .unwrap();
        assert_eq!(pins["state"], "unreadable");
        assert_eq!(report["reached"], 1);
        assert!(plain(&report).contains("the Pinterest record could not be read"));
    }

    #[test]
    fn a_report_never_carries_provider_text_tokens_or_tracking_values() {
        let root = dir("redact");
        write(
            &root,
            ".openblog/pinterest.json",
            json!({"version": 1, "pins": {
                "production/42/posts/a.md": {"status": "not-posted", "environment": "production", "boardId": "42", "sourcePath": "posts/a.md", "link": "l", "digest": "d", "attemptedAt": "2026-11-02T10:00:00Z", "failure": "HTTP 401 Bearer pina_SECRETTOKEN invalid"}
            }}),
        );
        write(
            &root,
            ".openblog/job-shares.json",
            json!({"version": 1, "jobs": {"posts/a.md": {
            "google-business-profile": {"status": "posted", "at": "2026-11-03T10:00:00Z", "digest": "x", "postName": "accounts/1/locations/2/localPosts/3", "postUrl": "https://local.google.com/p?access_token=SECRETTOKEN"}}}}),
        );
        let report = report(&root, &config(), &posts(), None, 30);
        let text = report.to_string();
        assert!(!text.contains("SECRETTOKEN"), "{text}");
        assert!(!text.contains("Bearer"));
        assert_eq!(row(&report, "/a/", "pinterest")["problem"], "other");
        assert_eq!(
            row(&report, "/a/", "google-business-profile")["permalink"],
            "https://local.google.com/p"
        );
    }
}
