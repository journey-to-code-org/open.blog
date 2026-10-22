//! A cookie-free page view counter.
//!
//! What is stored, in `.openblog/analytics.json`: per day, views and unique
//! visitors per page and a count per referring host; plus an all-time total
//! per page. What is never stored: addresses, user agents, or anything that
//! identifies a visitor. Uniques are counted with a hash of (daily random
//! salt, address, user agent) that lives in memory only and is thrown away at
//! midnight, so two visits on one day collapse into one visitor and nothing
//! can be linked across days.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::path::Path;

use openblog_core::DateTime;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value as Json};

use crate::http::{Request, Response};

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
struct DayStats {
    #[serde(default)]
    views: BTreeMap<String, u64>,
    #[serde(default)]
    uniques: BTreeMap<String, u64>,
    #[serde(default)]
    referrers: BTreeMap<String, u64>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
struct Data {
    #[serde(default)]
    version: u32,
    #[serde(default)]
    days: BTreeMap<String, DayStats>,
    #[serde(default)]
    totals: BTreeMap<String, u64>,
}

pub struct Store {
    data: Data,
    dirty: bool,
    /// The day the in-memory unique set belongs to.
    day: String,
    salt: u64,
    seen: HashSet<u64>,
    /// Per-address hit counts for the current minute, to stop a script from
    /// inflating counts (the data is not valuable enough to lock anyone out).
    minute: i64,
    rate: HashMap<String, u32>,
    retention_days: u32,
}

/// Hits one address may record per minute.
const MAX_HITS_PER_MINUTE: u32 = 30;
const MAX_PATH_LEN: usize = 200;
const MAX_TRACKED_PATHS: usize = 5000;

impl Store {
    pub fn load(path: &Path, retention_days: u32) -> Store {
        let data = fs::read_to_string(path)
            .ok()
            .and_then(|t| serde_json::from_str::<Data>(&t).ok())
            .unwrap_or_default();
        Store { data, dirty: false, day: String::new(), salt: 0, seen: HashSet::new(), minute: 0, rate: HashMap::new(), retention_days }
    }

    /// Persist if anything changed. Called from a background thread.
    pub fn save(&mut self, path: &Path) -> Result<(), String> {
        if !self.dirty {
            return Ok(());
        }
        self.prune();
        self.data.version = 1;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("cannot create {}: {e}", parent.display()))?;
        }
        let text = serde_json::to_string(&self.data).map_err(|e| e.to_string())?;
        let tmp = path.with_extension("json.tmp");
        fs::write(&tmp, text).map_err(|e| format!("cannot write {}: {e}", tmp.display()))?;
        fs::rename(&tmp, path).map_err(|e| format!("cannot replace {}: {e}", path.display()))?;
        self.dirty = false;
        Ok(())
    }

    fn prune(&mut self) {
        let keep = self.retention_days.max(1) as usize;
        while self.data.days.len() > keep {
            let oldest = self.data.days.keys().next().cloned();
            if let Some(k) = oldest {
                self.data.days.remove(&k);
            }
        }
    }

    fn roll_day(&mut self, now: DateTime) -> Result<(), String> {
        let today = now.ymd();
        if self.day != today {
            self.day = today;
            self.seen.clear();
            let bytes: [u8; 8] = crate::auth::random_bytes()?;
            self.salt = u64::from_le_bytes(bytes);
        }
        Ok(())
    }

    /// Record one view. `visitor` is the address and user agent joined; it is
    /// hashed with the daily salt and never stored. Returns the page's total.
    pub fn record(&mut self, now: DateTime, path: &str, referrer_host: Option<&str>, visitor: &str) -> Result<u64, String> {
        self.roll_day(now)?;
        let day = self.data.days.entry(self.day.clone()).or_default();
        if !day.views.contains_key(path) && day.views.len() >= MAX_TRACKED_PATHS {
            return Ok(self.data.totals.get(path).copied().unwrap_or(0));
        }
        *day.views.entry(path.to_string()).or_insert(0) += 1;
        let fingerprint = fnv64(self.salt, visitor.as_bytes()) ^ fnv64(self.salt.rotate_left(17), path.as_bytes());
        if self.seen.insert(fingerprint) {
            *day.uniques.entry(path.to_string()).or_insert(0) += 1;
        }
        if let Some(host) = referrer_host {
            if day.referrers.len() < 500 || day.referrers.contains_key(host) {
                *day.referrers.entry(host.to_string()).or_insert(0) += 1;
            }
        }
        let total = self.data.totals.entry(path.to_string()).or_insert(0);
        *total += 1;
        self.dirty = true;
        Ok(*total)
    }

    pub fn views(&self, path: &str) -> u64 {
        self.data.totals.get(path).copied().unwrap_or(0)
    }

    /// `true` when this address may record another hit this minute.
    pub fn allow_hit(&mut self, now: DateTime, address: &str) -> bool {
        let minute = now.unix() / 60;
        if minute != self.minute {
            self.minute = minute;
            self.rate.clear();
        }
        let count = self.rate.entry(address.to_string()).or_insert(0);
        *count += 1;
        *count <= MAX_HITS_PER_MINUTE
    }

    /// The admin dashboard's numbers for the last `days` days.
    pub fn summary(&self, now: DateTime, days: u32) -> Json {
        let days = days.clamp(1, 366);
        let start = DateTime::from_unix(now.unix() - i64::from(days - 1) * 86_400).ymd();
        let mut series = Vec::new();
        let mut views_total = 0u64;
        let mut uniques_total = 0u64;
        let mut per_path: BTreeMap<&str, (u64, u64)> = BTreeMap::new();
        let mut referrers: BTreeMap<&str, u64> = BTreeMap::new();
        for offset in 0..days {
            let day = DateTime::from_unix(now.unix() - i64::from(days - 1 - offset) * 86_400).ymd();
            let (v, u) = match self.data.days.get(&day) {
                Some(stats) => (stats.views.values().sum::<u64>(), stats.uniques.values().sum::<u64>()),
                None => (0, 0),
            };
            views_total += v;
            uniques_total += u;
            series.push(json!({ "day": day, "views": v, "uniques": u }));
        }
        for (day, stats) in self.data.days.range(start.clone()..) {
            let _ = day;
            for (path, v) in &stats.views {
                let entry = per_path.entry(path.as_str()).or_insert((0, 0));
                entry.0 += v;
                entry.1 += stats.uniques.get(path).copied().unwrap_or(0);
            }
            for (host, n) in &stats.referrers {
                *referrers.entry(host.as_str()).or_insert(0) += n;
            }
        }
        let mut top: Vec<(&str, (u64, u64))> = per_path.into_iter().collect();
        top.sort_by(|a, b| b.1 .0.cmp(&a.1 .0).then_with(|| a.0.cmp(b.0)));
        let mut refs: Vec<(&str, u64)> = referrers.into_iter().collect();
        refs.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(b.0)));
        let all_time: u64 = self.data.totals.values().sum();
        json!({
            "days": days,
            "from": start,
            "to": now.ymd(),
            "views": views_total,
            "uniques": uniques_total,
            "allTimeViews": all_time,
            "firstDay": self.data.days.keys().next(),
            "series": series,
            "topPosts": top.iter().take(25).map(|(p, (v, u))| json!({ "path": p, "views": v, "uniques": u, "allTime": self.views(p) })).collect::<Vec<_>>(),
            "referrers": refs.iter().take(25).map(|(h, n)| json!({ "host": h, "views": n })).collect::<Vec<_>>(),
        })
    }
}

fn fnv64(seed: u64, bytes: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325 ^ seed;
    for b in bytes {
        h ^= u64::from(*b);
        h = h.wrapping_mul(0x0100_0000_01b3);
    }
    h
}

/// The host part of a referrer URL, lower-cased and cleaned, or `None` for
/// empty, same-site, or malformed values. Nothing else from the referrer is kept.
pub fn referrer_host(referrer: &str, own_host: &str) -> Option<String> {
    let rest = referrer.trim().strip_prefix("https://").or_else(|| referrer.trim().strip_prefix("http://"))?;
    let host = rest.split(['/', '?', '#']).next()?.trim_start_matches("www.").to_ascii_lowercase();
    let clean: String = host.chars().filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | ':')).take(100).collect();
    if clean.is_empty() || clean == own_host.trim_start_matches("www.").to_ascii_lowercase() {
        return None;
    }
    Some(clean)
}

/// Normalise a client-supplied page path and make sure it is a page this site
/// actually serves, so junk paths cannot bloat the data.
pub fn public_path(out_dir: &Path, raw: &str) -> Option<String> {
    if raw.len() > MAX_PATH_LEN || !raw.starts_with('/') || raw.contains(['?', '#', '\\', '\0']) || raw.contains("..") {
        return None;
    }
    let mut path = raw.to_string();
    if !path.ends_with('/') {
        path.push('/');
    }
    let file = crate::serve::resolve(out_dir, &path)?;
    file.file_name().is_some_and(|n| n == "index.html").then_some(path)
}

/// `POST /api/hit` with `{ "path": "/posts/x/", "referrer": "https://..." }`.
pub fn hit(state: &crate::admin::AppState, req: &Request, out_dir: &Path) -> Response {
    if req.method != "POST" {
        return Response::error(405, "Use POST");
    }
    if req.header("dnt") == Some("1") || req.header("sec-gpc") == Some("1") {
        return Response::json(204, &json!({}));
    }
    let body: Json = match serde_json::from_slice(&req.body) {
        Ok(b) => b,
        Err(_) => return Response::error(400, "Invalid JSON"),
    };
    let Some(path) = body["path"].as_str().and_then(|p| public_path(out_dir, p)) else {
        return Response::error(404, "Not a page on this site");
    };
    let config = crate::site::load_config(&state.root).unwrap_or_default();
    let own_host = config.url.trim_start_matches("https://").trim_start_matches("http://").split('/').next().unwrap_or("").to_string();
    let referrer = body["referrer"].as_str().and_then(|r| referrer_host(r, &own_host));
    let visitor = format!("{}|{}", req.peer, req.header("user-agent").unwrap_or(""));
    let now = crate::clock::now();
    let mut store = state.analytics.lock().unwrap_or_else(|e| e.into_inner());
    if !store.allow_hit(now, &req.peer) {
        return Response::error(429, "Too many hits").with_header("Retry-After", "60");
    }
    match store.record(now, &path, referrer.as_deref(), &visitor) {
        Ok(views) => Response::json(200, &json!({ "views": views })),
        Err(e) => Response::error(500, &e),
    }
}

/// `GET /api/views?path=/posts/x/`
pub fn views(state: &crate::admin::AppState, req: &Request, out_dir: &Path) -> Response {
    let Some(path) = req.query.get("path").and_then(|p| public_path(out_dir, p)) else {
        return Response::error(404, "Not a page on this site");
    };
    let store = state.analytics.lock().unwrap_or_else(|e| e.into_inner());
    Response::json(200, &json!({ "views": store.views(&path) })).with_header("Cache-Control", "no-store")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(s: &str) -> DateTime {
        DateTime::parse(s).unwrap()
    }

    #[test]
    fn counts_views_uniques_and_referrers_per_day() {
        let mut s = Store::load(Path::new("/nonexistent/analytics.json"), 400);
        let d1 = at("2026-10-22T10:00:00Z");
        assert_eq!(s.record(d1, "/a/", Some("news.ycombinator.com"), "1.1.1.1|ua").unwrap(), 1);
        assert_eq!(s.record(d1, "/a/", None, "1.1.1.1|ua").unwrap(), 2);
        assert_eq!(s.record(d1, "/a/", Some("news.ycombinator.com"), "2.2.2.2|ua").unwrap(), 3);
        assert_eq!(s.record(d1, "/b/", None, "1.1.1.1|ua").unwrap(), 1);
        let sum = s.summary(d1, 7);
        assert_eq!(sum["views"], 4);
        assert_eq!(sum["uniques"], 3, "same visitor on the same page counts once per day");
        assert_eq!(sum["topPosts"][0]["path"], "/a/");
        assert_eq!(sum["topPosts"][0]["uniques"], 2);
        assert_eq!(sum["referrers"][0]["host"], "news.ycombinator.com");
        assert_eq!(sum["referrers"][0]["views"], 2);
        assert_eq!(sum["series"].as_array().unwrap().len(), 7);
        // Next day the same visitor is unique again, and yesterday is untouched.
        let d2 = at("2026-10-23T00:00:01Z");
        s.record(d2, "/a/", None, "1.1.1.1|ua").unwrap();
        let sum = s.summary(d2, 2);
        assert_eq!(sum["series"][0]["views"], 4);
        assert_eq!(sum["series"][1]["uniques"], 1);
        assert_eq!(s.views("/a/"), 4);
        assert_eq!(s.summary(d2, 1)["views"], 1);
    }

    #[test]
    fn saves_and_reloads_without_visitor_data() {
        let dir = std::env::temp_dir().join(format!("ob-analytics-{}", std::process::id()));
        let path = dir.join("analytics.json");
        let mut s = Store::load(&path, 400);
        s.record(at("2026-10-22"), "/a/", Some("example.org"), "9.9.9.9|Mozilla").unwrap();
        s.save(&path).unwrap();
        let text = fs::read_to_string(&path).unwrap();
        assert!(!text.contains("9.9.9.9") && !text.contains("Mozilla"), "no visitor data on disk: {text}");
        let again = Store::load(&path, 400);
        assert_eq!(again.views("/a/"), 1);
        assert_eq!(again.summary(at("2026-10-22"), 1)["referrers"][0]["host"], "example.org");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn prunes_old_days_and_limits_hit_rate() {
        let mut s = Store::load(Path::new("/nonexistent"), 2);
        for day in ["2026-01-01", "2026-01-02", "2026-01-03"] {
            s.record(at(day), "/a/", None, "x").unwrap();
        }
        s.prune();
        assert_eq!(s.data.days.len(), 2);
        assert!(!s.data.days.contains_key("2026-01-01"));
        assert_eq!(s.views("/a/"), 3, "totals survive pruning");
        let now = at("2026-10-22T10:00:00Z");
        for _ in 0..MAX_HITS_PER_MINUTE {
            assert!(s.allow_hit(now, "1.2.3.4"));
        }
        assert!(!s.allow_hit(now, "1.2.3.4"));
        assert!(s.allow_hit(now, "5.6.7.8"));
        assert!(s.allow_hit(DateTime::from_unix(now.unix() + 60), "1.2.3.4"), "a new minute resets");
    }

    #[test]
    fn referrer_hosts_are_reduced_to_a_clean_host() {
        assert_eq!(referrer_host("https://www.Example.org/some/page?q=1", "t.dev"), Some("example.org".into()));
        assert_eq!(referrer_host("https://t.dev/other/", "t.dev"), None, "internal navigation is not a referrer");
        assert_eq!(referrer_host("", "t.dev"), None);
        assert_eq!(referrer_host("javascript:alert(1)", "t.dev"), None);
        assert_eq!(referrer_host("http://evil.com/<script>", "t.dev"), Some("evil.com".into()));
    }

    #[test]
    fn only_real_pages_can_be_counted() {
        let dir = std::env::temp_dir().join(format!("ob-paths-{}", std::process::id()));
        fs::create_dir_all(dir.join("posts/x")).unwrap();
        fs::write(dir.join("posts/x/index.html"), "x").unwrap();
        fs::write(dir.join("rss.xml"), "x").unwrap();
        assert_eq!(public_path(&dir, "/posts/x/"), Some("/posts/x/".into()));
        assert_eq!(public_path(&dir, "/posts/x"), Some("/posts/x/".into()));
        assert_eq!(public_path(&dir, "/posts/x/?utm=1"), None);
        assert_eq!(public_path(&dir, "/rss.xml"), None, "only HTML pages");
        assert_eq!(public_path(&dir, "/nope/"), None);
        assert_eq!(public_path(&dir, "posts/x/"), None);
        assert_eq!(public_path(&dir, "/../x/"), None);
        assert_eq!(public_path(&dir, &format!("/{}/", "a".repeat(300))), None);
        let _ = fs::remove_dir_all(&dir);
    }
}
