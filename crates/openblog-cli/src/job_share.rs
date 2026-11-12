//! `openblog job-share`: one finished job for Google Business Profile, a Facebook Page and
//! Nextdoor (story #488, ADRs 0393 to 0395).
//!
//! Without options it previews each destination and sends nothing. `--kit <new folder>` writes
//! the by-hand kit (the words, the photo and where to post them) that works today with no
//! account. `--send google-business-profile --confirm <digest>` posts to Google Business Profile,
//! and only when `syndication.googleBusinessProfile.enabled` is true: Google gives its API only
//! to a project it approved. The access token is read from [`TOKEN_VARIABLE`] and is never
//! printed, stored or put in an error. Every request goes through the syndication [`Transport`],
//! so tests script Google and never reach it. `--status` shows what happened at each destination.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use openblog_core::job_destination::{
    self, JobDestination, JobProjection, JobSource, Photo, Route,
};
use openblog_core::DateTime;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value as Json};

use crate::syndication::{NetworkTransport, Request, Response, Transport};
use crate::{card, fsutil, site, syndication};

pub const USAGE: &str = "usage: openblog job-share <slug> [--to google-business-profile,facebook,nextdoor] [--json] [--kit <new folder>] [--status]
       openblog job-share <slug> --send google-business-profile --confirm <digest> [--forget-attempt]";
/// The environment variable holding the owner's Google OAuth access token (scope
/// `https://www.googleapis.com/auth/business.manage`).
pub const TOKEN_VARIABLE: &str = "GOOGLE_BUSINESS_ACCESS_TOKEN";
/// The private record of each job's destinations, relative to the project root.
pub const STATE_FILE: &str = ".openblog/job-shares.json";
const API_BASE: &str = "https://mybusiness.googleapis.com/v4";
const NOTHING_SENT: &str = "Nothing was sent to Google.";

#[derive(Clone, Debug, Default)]
pub struct Options {
    pub to: Option<String>,
    pub json: bool,
    pub kit: Option<String>,
    pub status: bool,
    pub send: Option<String>,
    pub confirm: Option<String>,
    pub forget_attempt: bool,
}

/// What a run reaches outside the project: Google, the clock and the token. Tests script all
/// three.
pub(crate) struct Context<'a> {
    pub transport: &'a dyn Transport,
    pub now: &'a dyn Fn() -> DateTime,
    pub token: &'a dyn Fn() -> Option<String>,
}

// ---------------------------------------------------------------------------------------------
// The private record.

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Status {
    /// The by-hand kit was written; whether the owner posted it is theirs to know.
    KitMade,
    /// Google answered with the post's name.
    Posted,
    /// A request was made and may have created a post: the owner checks and settles it.
    Unknown,
    /// Google certainly did not create it; sending again is allowed.
    NotPosted,
    /// The owner said in Admin that they posted it by hand.
    PostedByHand,
}

impl Status {
    fn words(self) -> &'static str {
        match self {
            Self::KitMade => "kit made, for you to post by hand",
            Self::Posted => "posted",
            Self::Unknown => "may have been posted: check, then settle it",
            Self::NotPosted => "not posted",
            Self::PostedByHand => "you posted it by hand",
        }
    }

    /// The job is at the place, or may be: a post open.blog made or may have made, or one the
    /// owner made by hand. Neither a send nor a kit replaces it (ADR 0397).
    fn holds(self) -> bool {
        matches!(self, Self::Posted | Self::Unknown | Self::PostedByHand)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Record {
    pub status: Status,
    pub at: String,
    pub digest: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub post_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub post_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub failure: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct State {
    pub version: u32,
    /// By the job's source path, then by destination.
    pub jobs: BTreeMap<String, BTreeMap<String, Record>>,
}

impl State {
    pub(crate) fn load(path: &Path) -> Result<Self, String> {
        match fs::read_to_string(path) {
            Ok(text) => {
                let state: Self = serde_json::from_str(&text).map_err(|_| {
                    format!("The job share record ({STATE_FILE}) cannot be read; fix or move it.")
                })?;
                if state.version != 1 {
                    return Err(format!(
                        "The job share record ({STATE_FILE}) is of an unknown version."
                    ));
                }
                Ok(state)
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Self {
                version: 1,
                jobs: BTreeMap::new(),
            }),
            Err(error) => Err(format!("cannot read the job share record: {error}")),
        }
    }

    pub(crate) fn save(&self, path: &Path) -> Result<(), String> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("cannot create the job share record folder: {error}"))?;
        }
        let text = serde_json::to_string_pretty(self)
            .map_err(|error| format!("could not serialize the job share record: {error}"))?;
        fsutil::write_file(path, format!("{text}\n").as_bytes())
    }

    pub(crate) fn record(&self, source: &str, destination: JobDestination) -> Option<&Record> {
        self.jobs.get(source)?.get(destination.as_str())
    }

    pub(crate) fn set(&mut self, source: &str, destination: JobDestination, record: Record) {
        self.jobs
            .entry(source.to_string())
            .or_default()
            .insert(destination.as_str().to_string(), record);
    }
}

// ---------------------------------------------------------------------------------------------
// Loading a job.

pub(crate) struct Job {
    pub title: String,
    /// The job's page, relative to the site (`/posts/new-oak-floor/`), as the announcements name it.
    pub work: String,
    pub source_path: String,
    pub projections: Vec<JobProjection>,
    /// The first after-photo's file, when it is one of the site's.
    photo_file: Option<PathBuf>,
    language: String,
}

/// Which published post to share: by slug (the command) or by source path (Admin).
pub(crate) enum Which<'a> {
    Slug(&'a str),
    Source(&'a str),
}

fn destinations(to: Option<&str>) -> Result<Vec<JobDestination>, String> {
    let Some(to) = to else {
        return Ok(JobDestination::ALL.to_vec());
    };
    let mut chosen = Vec::new();
    for name in to.split(',').filter(|name| !name.trim().is_empty()) {
        let destination = JobDestination::parse(name).ok_or_else(|| {
            format!("`{}` is not a place a job can go: use google-business-profile, facebook or nextdoor", name.trim())
        })?;
        if !chosen.contains(&destination) {
            chosen.push(destination);
        }
    }
    if chosen.is_empty() {
        return Err(USAGE.into());
    }
    chosen.sort();
    Ok(chosen)
}

fn load(root: &Path, slug: &str, chosen: &[JobDestination]) -> Result<Job, String> {
    load_job(root, Which::Slug(slug), chosen)
}

pub(crate) fn load_job(
    root: &Path,
    which: Which<'_>,
    chosen: &[JobDestination],
) -> Result<Job, String> {
    let config = site::load_config(root)?;
    // Only a published job: a draft or a scheduled job has no page anyone could follow.
    let (loaded, _) = site::load_site(root, false, Some(crate::clock::now()))?;
    let found = loaded.posts.iter().find(|post| match which {
        Which::Slug(slug) => post.slug == slug,
        Which::Source(source) => post.source.replace('\\', "/") == source,
    });
    let post = match (found, &which) {
        (Some(post), _) => post,
        (None, Which::Slug(slug)) => return Err(syndication::unavailable_post_error(root, slug)?),
        (None, Which::Source(_)) => {
            return Err(
                "This job is not published yet, so there is no page to share. Publish it first."
                    .into(),
            )
        }
    };
    let slug = post.slug.as_str();
    let job = post.job.as_ref().ok_or_else(|| {
        format!("`{slug}` is not a job; only a post with `profile: job` can be shared this way")
    })?;
    let service = loaded
        .services
        .iter()
        .find(|service| service.id == job.service)
        .map(|service| service.name.clone())
        .unwrap_or_else(|| job_destination::service_words(&job.service));
    let static_dir = root.join(&config.paths.static_dir);
    let private = fsutil::PrivateState::of(root).withhold(&site::comparison_files(root, &config));
    let first = job.after.first().map(String::as_str);
    let lower = first.map(str::to_ascii_lowercase).unwrap_or_default();
    let mut photo_file = None;
    let photo_url;
    let photo = match first {
        None => Photo::None,
        Some(reference) if lower.starts_with("http://") || lower.starts_with("https://") => {
            Photo::Elsewhere(reference)
        }
        Some(reference) => {
            let relative = reference.trim_start_matches('/');
            match card::static_file(&static_dir, relative, &private) {
                None => Photo::Missing(reference),
                Some(file) => match card::facts(&file) {
                    None => Photo::Unreadable(reference),
                    Some(facts) => {
                        photo_file = Some(file);
                        photo_url = config.absolute(reference);
                        Photo::Measured {
                            site_path: reference,
                            url: &photo_url,
                            facts,
                        }
                    }
                },
            }
        }
    };
    let canonical_url = config.absolute(&post.url);
    let source = JobSource {
        title: &post.title,
        description: &post.description,
        service: &service,
        town: &job.town,
        region: &job.region,
        canonical_url: &canonical_url,
        photo,
        campaigns: config.analytics.campaigns,
    };
    let projections = chosen
        .iter()
        .map(|destination| job_destination::project(&source, *destination))
        .collect();
    Ok(Job {
        title: post.title.clone(),
        work: post.url.clone(),
        source_path: post.source.replace('\\', "/"),
        projections,
        photo_file,
        language: config.language.clone(),
    })
}

// ---------------------------------------------------------------------------------------------
// The command.

pub fn run(root: &Path, slug: &str, options: Options) -> Result<(), String> {
    let transport = NetworkTransport::default();
    let now = crate::clock::now;
    let token = || std::env::var(TOKEN_VARIABLE).ok();
    let context = Context {
        transport: &transport,
        now: &now,
        token: &token,
    };
    run_with(root, slug, &options, &context, &mut std::io::stdout())
}

pub(crate) fn run_with(
    root: &Path,
    slug: &str,
    options: &Options,
    context: &Context<'_>,
    out: &mut dyn std::io::Write,
) -> Result<(), String> {
    let modes = [
        options.json,
        options.kit.is_some(),
        options.status,
        options.send.is_some(),
    ]
    .iter()
    .filter(|on| **on)
    .count();
    if modes > 1 {
        return Err(format!(
            "--json, --kit, --status and --send each run alone.\n{USAGE}"
        ));
    }
    if (options.confirm.is_some() || options.forget_attempt) && options.send.is_none() {
        return Err(format!(
            "--confirm and --forget-attempt go with --send.\n{USAGE}"
        ));
    }
    let mut say = |text: String| {
        out.write_all(text.as_bytes())
            .map_err(|error| format!("cannot print: {error}"))
    };
    let state_path = root.join(STATE_FILE);
    if let Some(send) = &options.send {
        if options.to.is_some() {
            return Err(format!(
                "--send names its one destination; leave out --to.\n{USAGE}"
            ));
        }
        match JobDestination::parse(send) {
            Some(JobDestination::GoogleBusinessProfile) => {}
            Some(JobDestination::Facebook) => {
                return Err(format!(
                    "A job goes to your Facebook Page from Admin: open the job and choose Share this job, which schedules it through your connected Page. Or run with --kit <new folder> to post it by hand. {NOTHING_SENT}"
                ))
            }
            _ => {
                return Err(format!(
                    "Nextdoor is posted by hand: run with --kit <new folder>. {NOTHING_SENT}"
                ))
            }
        }
        let job = load(root, slug, &[JobDestination::GoogleBusinessProfile])?;
        return send_google(root, slug, &state_path, job, options, context, &mut say);
    }
    let chosen = destinations(options.to.as_deref())?;
    let job = load(root, slug, &chosen)?;
    if options.json {
        let text = job_destination::kit_json(&job.title, &job.projections);
        return say(text);
    }
    if options.status {
        let state = State::load(&state_path)?;
        let mut text = format!("Where `{}` has gone:\n", job.title);
        for projection in &job.projections {
            let line = match state.record(&job.source_path, projection.destination) {
                None => "not shared yet".to_string(),
                Some(record) => {
                    let mut line = format!("{} ({})", record.status.words(), record.at);
                    if let Some(url) = &record.post_url {
                        line.push_str(&format!(": {url}"));
                    }
                    if record.status == Status::Posted && record.digest != projection.digest {
                        line.push_str("; the job changed since");
                    }
                    line
                }
            };
            text.push_str(&format!("  {}: {line}\n", projection.label));
        }
        return say(text);
    }
    if let Some(directory) = options.kit.as_deref() {
        return write_kit(root, &state_path, directory, job, context, &mut say);
    }
    let state = State::load(&state_path)?;
    say(preview(root, slug, &job, &state))
}

fn sending_on(root: &Path) -> bool {
    site::load_config(root)
        .ok()
        .and_then(|config| config.syndication.google_business_profile)
        .is_some_and(|google| google.enabled)
}

fn preview(root: &Path, slug: &str, job: &Job, state: &State) -> String {
    let mut out = format!("Sharing `{}`. Nothing was sent.\n", job.title);
    for p in &job.projections {
        out.push_str(&format!("\n{}\n", p.label));
        out.push_str(&format!(
            "  words: {}\n",
            p.text
                .split('\n')
                .map(|line| if line.is_empty() {
                    String::new()
                } else {
                    format!("         {line}")
                })
                .collect::<Vec<_>>()
                .join("\n")
                .trim_start()
        ));
        out.push_str(&format!("  link: {}\n", p.link));
        match &p.photo {
            Some(photo) => out.push_str(&format!(
                "  photo: {} ({} {}x{}, {} bytes)\n",
                photo.site_path,
                photo.media_type.label(),
                photo.width,
                photo.height,
                photo.bytes
            )),
            None => out.push_str("  photo: none\n"),
        }
        for problem in &p.problems {
            out.push_str(&format!(
                "  - {}{}\n",
                if problem.blocking { "fix first: " } else { "" },
                problem.message
            ));
        }
        let record = state.record(&job.source_path, p.destination);
        if let Some(record) = record {
            out.push_str(&format!(
                "  shared: {} ({})
",
                record.status.words(),
                record.at
            ));
        }
        if !p.ready {
            continue;
        }
        let by_hand =
            format!("  To post it by hand: openblog job-share {slug} --kit <new folder>\n");
        match p.route {
            Route::Adapter if p.destination == JobDestination::Facebook => {
                out.push_str("  To post it to your Facebook Page: in Admin, open the job and choose Share this job.
");
                out.push_str(&by_hand);
            }
            Route::Adapter if record.is_some_and(|r| r.status.holds()) => out.push_str(&format!(
                "  It is not offered for sending again; see openblog job-share {slug} --status.
"
            )),
            Route::Adapter if sending_on(root) => out.push_str(&format!(
                "  digest: {}\n  To send exactly this: openblog job-share {slug} --send {} --confirm {}\n",
                p.digest,
                p.destination.as_str(),
                p.digest
            )),
            Route::Adapter => {
                out.push_str("  Sending is off (syndication.googleBusinessProfile.enabled). See docs/job-sharing.md.\n");
                out.push_str(&by_hand);
            }
            Route::ByHand => out.push_str(&by_hand),
        }
    }
    out
}

fn write_kit(
    root: &Path,
    state_path: &Path,
    directory: &str,
    job: Job,
    context: &Context<'_>,
    say: &mut dyn FnMut(String) -> Result<(), String>,
) -> Result<(), String> {
    let mut state = State::load(state_path)?;
    let folder = syndication::new_artifact_folder(root, directory, "job kit")?;
    let write = |name: &str, bytes: &[u8]| {
        fsutil::create_new_file(&folder.join(name), bytes)
            .map_err(|cause| format!("cannot write {name} in {}: {cause}", folder.display()))
    };
    let photo = job
        .projections
        .iter()
        .find_map(|p| p.photo.as_ref())
        .zip(job.photo_file.as_ref());
    if let Some((photo, file)) = photo {
        fs::create_dir(folder.join("images"))
            .map_err(|error| format!("cannot create images in {}: {error}", folder.display()))?;
        let bytes =
            fs::read(file).map_err(|error| format!("cannot read {}: {error}", file.display()))?;
        write(&format!("images/{}", photo.file_name), &bytes)?;
    }
    write(
        "kit.json",
        job_destination::kit_json(&job.title, &job.projections).as_bytes(),
    )?;
    write(
        "index.html",
        job_destination::kit_page(&job.title, &job.projections).as_bytes(),
    )?;
    let at = (context.now)().rfc3339();
    let mut text = format!(
        "Kit for `{}` written to {}. Nothing was posted; open index.html and post each one yourself.\n",
        job.title,
        folder.display()
    );
    for p in &job.projections {
        text.push_str(&format!(
            "- {}: {}\n",
            p.label,
            if p.ready {
                "ready to post by hand"
            } else {
                "fix the problems in the kit first"
            }
        ));
        // A kit never replaces a post open.blog made or may have made, or one she made by hand.
        let keep = state
            .record(&job.source_path, p.destination)
            .is_some_and(|r| r.status.holds());
        if p.ready && !keep {
            state.set(
                &job.source_path,
                p.destination,
                Record {
                    status: Status::KitMade,
                    at: at.clone(),
                    digest: p.digest.clone(),
                    post_name: None,
                    post_url: None,
                    failure: None,
                },
            );
        }
    }
    state.save(state_path)?;
    say(text)
}

// ---------------------------------------------------------------------------------------------
// Google Business Profile.

fn digits(value: &str) -> bool {
    !value.is_empty() && value.len() <= 32 && value.bytes().all(|b| b.is_ascii_digit())
}

/// The `accounts.locations.localPosts.create` request: a standard post, its words, a Learn more
/// button to the job's page and the first after-photo by its public address.
fn local_post_request(
    projection: &JobProjection,
    account: &str,
    location: &str,
    language: &str,
    token: &str,
) -> Request {
    let mut body = json!({
        "languageCode": if language.trim().is_empty() { "en" } else { language.trim() },
        "summary": projection.text,
        "topicType": "STANDARD",
        "callToAction": { "actionType": "LEARN_MORE", "url": projection.link },
    });
    if let Some(photo) = &projection.photo {
        body["media"] = json!([{ "mediaFormat": "PHOTO", "sourceUrl": photo.url }]);
    }
    Request {
        method: "POST",
        url: format!("{API_BASE}/accounts/{account}/locations/{location}/localPosts"),
        headers: vec![
            ("Authorization".into(), format!("Bearer {token}")),
            ("Accept".into(), "application/json".into()),
            ("Content-Type".into(), "application/json".into()),
        ],
        body,
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Outcome {
    Posted { name: String, url: Option<String> },
    NotPosted { code: &'static str },
    Unknown { code: &'static str },
}

/// Reads Google's reply. Google's own text is never copied.
pub fn classify(result: &Result<Response, String>) -> Outcome {
    let response = match result {
        Ok(response) => response,
        Err(_) => {
            return Outcome::Unknown {
                code: "no-response",
            }
        }
    };
    match response.status {
        200 => {
            let body: Json = serde_json::from_slice(&response.body).unwrap_or(Json::Null);
            let name = body["name"].as_str().filter(|name| {
                name.starts_with("accounts/")
                    && name.len() <= 300
                    && !name.contains(char::is_whitespace)
            });
            match name {
                Some(name) => Outcome::Posted {
                    name: name.to_string(),
                    url: body["searchUrl"]
                        .as_str()
                        .filter(|url| url.starts_with("https://"))
                        .map(str::to_string),
                },
                None => Outcome::Unknown {
                    code: "no-post-name",
                },
            }
        }
        400 | 404 | 409 | 413 | 422 => Outcome::NotPosted { code: "rejected" },
        401 => Outcome::NotPosted {
            code: "token-refused",
        },
        403 => Outcome::NotPosted {
            code: "not-permitted",
        },
        429 => Outcome::NotPosted {
            code: "rate-limited",
        },
        _ => Outcome::Unknown {
            code: "provider-error",
        },
    }
}

/// What the owner is told for a failure: what happened and what to do next.
pub fn failure_words(code: &str) -> &'static str {
    match code {
        "rejected" => "Google refused the post as sent (the business, the words, the photo or the link). No post was made; check them and send again, or use the kit.",
        "token-refused" => "Google refused the access token: it has expired (they last an hour) or was revoked. No post was made; get a new token and send again.",
        "not-permitted" => "Google refused: this Google project is not yet approved for the Business Profile API, or the account cannot manage this business. No post was made; use the kit meanwhile.",
        "rate-limited" => "Google's limit on requests was reached. No post was made; send again later.",
        "no-response" => "The request failed or timed out before Google answered, so a post may have been made.",
        "no-post-name" => "Google answered without naming the post, so a post may have been made.",
        "provider-error" => "Google answered with a server error, so a post may have been made.",
        _ => "Google did not confirm the post.",
    }
}

fn send_google(
    root: &Path,
    slug: &str,
    state_path: &Path,
    job: Job,
    options: &Options,
    context: &Context<'_>,
    say: &mut dyn FnMut(String) -> Result<(), String>,
) -> Result<(), String> {
    let config = site::load_config(root)?;
    let google = config
        .syndication
        .google_business_profile
        .as_ref()
        .filter(|google| google.enabled)
        .ok_or_else(|| {
            format!("Sending to Google Business Profile is off. It needs a Google project approved for the Business Profile API; see docs/job-sharing.md. Meanwhile run `openblog job-share {slug} --kit <new folder>`. {NOTHING_SENT}")
        })?;
    let (account, location) = (google.account.trim(), google.location.trim());
    if !digits(account) || !digits(location) {
        return Err(format!(
            "syndication.googleBusinessProfile.account and .location must be the numbers from accounts/<account>/locations/<location>. {NOTHING_SENT}"
        ));
    }
    let projection = job
        .projections
        .first()
        .ok_or_else(|| format!("no projection was built. {NOTHING_SENT}"))?;
    let destination = JobDestination::GoogleBusinessProfile;
    let mut state = State::load(state_path)?;
    let unknown_command = format!(
        "openblog job-share {slug} --send google-business-profile --confirm <digest> --forget-attempt"
    );
    if options.forget_attempt {
        return match state.record(&job.source_path, destination) {
            Some(record) if record.status == Status::Unknown => {
                let mut record = record.clone();
                record.status = Status::NotPosted;
                state.set(&job.source_path, destination, record);
                state.save(state_path)?;
                say(
                    "The earlier attempt is forgotten; you can send again. Nothing was sent.\n"
                        .into(),
                )
            }
            _ => Err(format!(
                "There is no unsettled attempt to forget. {NOTHING_SENT}"
            )),
        };
    }
    if projection.route != Route::Adapter || !projection.ready {
        let codes: Vec<&str> = projection
            .problems
            .iter()
            .filter(|p| p.blocking)
            .map(|p| p.code)
            .collect();
        return Err(format!(
            "This job cannot be sent to Google Business Profile ({}); run `openblog job-share {slug}` to see why. {NOTHING_SENT}",
            codes.join(", ")
        ));
    }
    match options.confirm.as_deref() {
        None => {
            return Err(format!(
                "--send sends only what you confirmed: run `openblog job-share {slug}`, check it, then add --confirm <digest>. {NOTHING_SENT}"
            ))
        }
        Some(confirmed) if confirmed.trim() != projection.digest => {
            return Err(format!(
                "The post changed since you previewed it (its words, link or photo). Run `openblog job-share {slug}` and confirm the new digest. {NOTHING_SENT}"
            ))
        }
        Some(_) => {}
    }
    match state.record(&job.source_path, destination) {
        Some(record) if record.status == Status::Posted => {
            return Err(format!(
                "This job is already on Google Business Profile{}. {NOTHING_SENT}",
                record
                    .post_url
                    .as_deref()
                    .map(|url| format!(" at {url}"))
                    .unwrap_or_default()
            ))
        }
        Some(record) if record.status == Status::PostedByHand => {
            return Err(format!(
                "You said in Admin that you posted this job to Google Business Profile by hand ({}), so sending it would post it twice. {NOTHING_SENT}",
                record.at
            ))
        }
        Some(record) if record.status == Status::Unknown => {
            return Err(format!(
                "An earlier attempt may have posted this job. Look on your Business Profile; if it is not there, run `{unknown_command}`. {NOTHING_SENT}"
            ))
        }
        _ => {}
    }
    let token = (context.token)()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            format!("Sending to Google Business Profile needs your access token in {TOKEN_VARIABLE}. {NOTHING_SENT}")
        })?;
    // Recorded before the request, so a crash mid-request never leads to a second post.
    let mut record = Record {
        status: Status::Unknown,
        at: (context.now)().rfc3339(),
        digest: projection.digest.clone(),
        post_name: None,
        post_url: None,
        failure: None,
    };
    state.set(&job.source_path, destination, record.clone());
    state.save(state_path)?;
    let request = local_post_request(projection, account, location, &job.language, &token);
    let outcome = classify(&context.transport.send(&request));
    let message = match &outcome {
        Outcome::Posted { name, url } => {
            record.status = Status::Posted;
            record.post_name = Some(name.clone());
            record.post_url = url.clone();
            Ok(format!(
                "Posted `{}` to Google Business Profile{}.\n",
                job.title,
                url.as_deref()
                    .map(|url| format!(": {url}"))
                    .unwrap_or_default()
            ))
        }
        Outcome::NotPosted { code } => {
            record.status = Status::NotPosted;
            record.failure = Some((*code).into());
            Err(format!("Not posted: {}", failure_words(code)))
        }
        Outcome::Unknown { code } => {
            record.failure = Some((*code).into());
            Err(format!(
                "Not sure it was posted: {} Look on your Business Profile; if it is not there, run `{unknown_command}`. It will not be sent again until then.",
                failure_words(code)
            ))
        }
    };
    state.set(&job.source_path, destination, record);
    state.save(state_path)?;
    message.and_then(say)
}

#[cfg(test)]
mod tests {
    use super::*;
    use openblog_core::image_facts::samples;
    use std::cell::RefCell;
    use std::collections::VecDeque;

    const TOKEN: &str = "ya29.test_token_never_printed_0123456789";

    struct Scripted {
        calls: RefCell<Vec<Request>>,
        replies: RefCell<VecDeque<Result<Response, String>>>,
    }

    impl Transport for Scripted {
        fn send(&self, request: &Request) -> Result<Response, String> {
            self.calls.borrow_mut().push(request.clone());
            self.replies
                .borrow_mut()
                .pop_front()
                .expect("the test scripted no reply for this request")
        }
    }

    fn scripted(replies: Vec<Result<Response, String>>) -> Scripted {
        Scripted {
            calls: RefCell::new(Vec::new()),
            replies: RefCell::new(replies.into()),
        }
    }

    fn reply(status: u16, body: Json) -> Result<Response, String> {
        Ok(Response {
            status,
            body: body.to_string().into_bytes(),
        })
    }

    const JOB: &str = "---\ntitle: New oak floor in Maple Falls\ndate: 2026-10-21\ndescription: Sanded, stained and sealed a worn oak floor.\nprofile: job\njob:\n  trade: flooring\n  service: hardwood-install\n  place:\n    town: Maple Falls\n    region: WA\n  started: 2026-10-14\n  finished: 2026-10-16\n  media:\n    after:\n      - /images/floor-after.png\n---\nDone.\n";

    fn site(google: &str) -> tempfile_dir::Dir {
        let dir = tempfile_dir::Dir::new();
        let root = dir.path();
        fs::create_dir_all(root.join("content/posts")).unwrap();
        fs::create_dir_all(root.join("static/images")).unwrap();
        fs::write(
            root.join("openblog.json"),
            format!(
                r#"{{"title":"Floors","url":"https://floors.example.org","syndication":{{"googleBusinessProfile":{google}}}}}"#
            ),
        )
        .unwrap();
        fs::write(root.join("content/posts/floor.md"), JOB).unwrap();
        let mut png = samples::png(1200, 900, false);
        png.resize(20_000, 0);
        fs::write(root.join("static/images/floor-after.png"), png).unwrap();
        dir
    }

    const ON: &str = r#"{"enabled":true,"account":"111","location":"222"}"#;
    const OFF: &str = r#"{"enabled":false}"#;

    fn run(
        root: &Path,
        options: Options,
        transport: &Scripted,
        token: Option<&str>,
    ) -> (Result<(), String>, String) {
        let now = || DateTime::parse("2026-11-08T12:00:00Z").unwrap();
        let token = token.map(str::to_string);
        let token = move || token.clone();
        let context = Context {
            transport,
            now: &now,
            token: &token,
        };
        let mut out = Vec::new();
        let result = run_with(root, "floor", &options, &context, &mut out);
        (result, String::from_utf8(out).unwrap())
    }

    fn digest(root: &Path) -> String {
        let (result, out) = run(
            root,
            Options {
                json: true,
                to: Some("google-business-profile".into()),
                ..Options::default()
            },
            &scripted(vec![]),
            None,
        );
        result.unwrap();
        let value: Json = serde_json::from_str(&out).unwrap();
        value["destinations"][0]["digest"]
            .as_str()
            .unwrap()
            .to_string()
    }

    fn send(digest: &str) -> Options {
        Options {
            send: Some("google-business-profile".into()),
            confirm: Some(digest.into()),
            ..Options::default()
        }
    }

    #[test]
    fn the_preview_sends_nothing_and_says_sending_is_off() {
        let dir = site(OFF);
        let transport = scripted(vec![]);
        let (result, out) = run(dir.path(), Options::default(), &transport, Some(TOKEN));
        result.unwrap();
        assert!(transport.calls.borrow().is_empty());
        assert!(out.contains("Sharing `New oak floor in Maple Falls`. Nothing was sent."));
        assert!(out.contains("Hardwood install in Maple Falls, WA."));
        assert!(out.contains("Sending is off"));
        assert!(out.contains("--kit <new folder>"));
        assert!(out.contains("Nextdoor"));
        assert!(!dir.path().join(STATE_FILE).exists());
    }

    #[test]
    fn sending_is_off_by_default_and_refused_without_a_request() {
        for google in [OFF, "null"] {
            let dir = site(google);
            let transport = scripted(vec![]);
            let digest = digest(dir.path());
            let (result, _) = run(dir.path(), send(&digest), &transport, Some(TOKEN));
            let error = result.unwrap_err();
            assert!(error.contains("is off"), "{error}");
            assert!(error.contains("--kit"), "{error}");
            assert!(transport.calls.borrow().is_empty());
        }
    }

    #[test]
    fn a_confirmed_job_is_posted_once_as_previewed() {
        let dir = site(ON);
        let digest = digest(dir.path());
        let transport = scripted(vec![reply(
            200,
            json!({"name": "accounts/111/locations/222/localPosts/9", "searchUrl": "https://local.google.com/place?id=1"}),
        )]);
        let (result, out) = run(dir.path(), send(&digest), &transport, Some(TOKEN));
        result.unwrap();
        assert!(out.contains("Posted `New oak floor in Maple Falls` to Google Business Profile"));
        let calls = transport.calls.borrow();
        assert_eq!(calls.len(), 1);
        let request = &calls[0];
        assert_eq!(
            request.url,
            "https://mybusiness.googleapis.com/v4/accounts/111/locations/222/localPosts"
        );
        assert_eq!(request.body["topicType"], "STANDARD");
        assert_eq!(
            request.body["summary"],
            "Sanded, stained and sealed a worn oak floor.\n\nHardwood install in Maple Falls, WA."
        );
        assert_eq!(request.body["callToAction"]["actionType"], "LEARN_MORE");
        assert_eq!(
            request.body["callToAction"]["url"],
            "https://floors.example.org/posts/floor/"
        );
        assert_eq!(
            request.body["media"][0]["sourceUrl"],
            "https://floors.example.org/images/floor-after.png"
        );
        assert!(!out.contains(TOKEN));
        let state = fs::read_to_string(dir.path().join(STATE_FILE)).unwrap();
        assert!(state.contains("\"posted\""));
        assert!(!state.contains(TOKEN));
        drop(calls);
        // A second send is refused without a request.
        let again = scripted(vec![]);
        let (result, _) = run(dir.path(), send(&digest), &again, Some(TOKEN));
        assert!(result
            .unwrap_err()
            .contains("already on Google Business Profile"));
        assert!(again.calls.borrow().is_empty());
        let (result, out) = run(
            dir.path(),
            Options {
                status: true,
                ..Options::default()
            },
            &again,
            None,
        );
        result.unwrap();
        assert!(out.contains("Google Business Profile: posted (2026-11-08T12:00:00Z): https://local.google.com/place?id=1"), "{out}");
        assert!(out.contains("Nextdoor: not shared yet"));
    }

    #[test]
    fn a_wrong_or_missing_digest_or_token_sends_nothing() {
        let dir = site(ON);
        let transport = scripted(vec![]);
        let (result, _) = run(dir.path(), send("0000"), &transport, Some(TOKEN));
        assert!(result.unwrap_err().contains("changed since you previewed"));
        let digest = digest(dir.path());
        let (result, _) = run(dir.path(), send(&digest), &transport, None);
        assert!(result.unwrap_err().contains(TOKEN_VARIABLE));
        let (result, _) = run(
            dir.path(),
            Options {
                send: Some("nextdoor".into()),
                confirm: Some(digest.clone()),
                ..Options::default()
            },
            &transport,
            Some(TOKEN),
        );
        assert!(result.unwrap_err().contains("posted by hand"));
        assert!(transport.calls.borrow().is_empty());
        assert!(!dir.path().join(STATE_FILE).exists());
    }

    #[test]
    fn an_unapproved_project_is_told_plainly_and_may_send_again() {
        let dir = site(ON);
        let digest = digest(dir.path());
        let transport = scripted(vec![reply(
            403,
            json!({"error": {"message": "secret provider text"}}),
        )]);
        let (result, _) = run(dir.path(), send(&digest), &transport, Some(TOKEN));
        let error = result.unwrap_err();
        assert!(error.contains("not yet approved"), "{error}");
        assert!(!error.contains("secret provider text"));
        let retry = scripted(vec![reply(
            200,
            json!({"name": "accounts/111/locations/222/localPosts/9"}),
        )]);
        let (result, _) = run(dir.path(), send(&digest), &retry, Some(TOKEN));
        result.unwrap();
    }

    #[test]
    fn an_answer_that_may_have_posted_holds_until_the_owner_settles_it() {
        let dir = site(ON);
        let digest = digest(dir.path());
        let transport = scripted(vec![Err("timed out".into())]);
        let (result, _) = run(dir.path(), send(&digest), &transport, Some(TOKEN));
        assert!(result.unwrap_err().contains("may have been made"));
        let held = scripted(vec![]);
        let (result, _) = run(dir.path(), send(&digest), &held, Some(TOKEN));
        assert!(result.unwrap_err().contains("may have posted"));
        assert!(held.calls.borrow().is_empty());
        let mut forget = send(&digest);
        forget.forget_attempt = true;
        let (result, _) = run(dir.path(), forget, &held, Some(TOKEN));
        result.unwrap();
        assert!(held.calls.borrow().is_empty());
        let retry = scripted(vec![reply(
            200,
            json!({"name": "accounts/111/locations/222/localPosts/9"}),
        )]);
        let (result, _) = run(dir.path(), send(&digest), &retry, Some(TOKEN));
        result.unwrap();
    }

    #[test]
    fn a_job_she_posted_by_hand_is_never_sent_again_and_a_kit_keeps_her_mark() {
        let dir = site(ON);
        let digest = digest(dir.path());
        // What Admin's "I posted it" writes.
        let state_path = dir.path().join(STATE_FILE);
        let mut state = State::load(&state_path).unwrap();
        for destination in [
            JobDestination::GoogleBusinessProfile,
            JobDestination::Nextdoor,
        ] {
            state.set(
                "posts/floor.md",
                destination,
                Record {
                    status: Status::PostedByHand,
                    at: "2026-11-07T09:00:00Z".into(),
                    digest: digest.clone(),
                    post_name: None,
                    post_url: None,
                    failure: None,
                },
            );
        }
        state.save(&state_path).unwrap();
        let transport = scripted(vec![]);
        let (result, out) = run(dir.path(), Options::default(), &transport, Some(TOKEN));
        result.unwrap();
        assert!(
            out.contains("shared: you posted it by hand (2026-11-07T09:00:00Z)"),
            "{out}"
        );
        assert!(!out.contains("--send google-business-profile"), "{out}");
        let (result, _) = run(dir.path(), send(&digest), &transport, Some(TOKEN));
        let error = result.unwrap_err();
        assert!(error.contains("by hand"), "{error}");
        assert!(error.contains("Nothing was sent"), "{error}");
        assert!(transport.calls.borrow().is_empty());
        let (result, _) = run(
            dir.path(),
            Options {
                kit: Some("kit".into()),
                ..Options::default()
            },
            &transport,
            None,
        );
        result.unwrap();
        let state = State::load(&state_path).unwrap();
        for destination in [
            JobDestination::GoogleBusinessProfile,
            JobDestination::Nextdoor,
        ] {
            let record = state.record("posts/floor.md", destination).unwrap();
            assert_eq!(record.status, Status::PostedByHand, "{destination:?}");
            assert_eq!(record.at, "2026-11-07T09:00:00Z");
        }
        assert_eq!(
            state
                .record("posts/floor.md", JobDestination::Facebook)
                .unwrap()
                .status,
            Status::KitMade
        );
    }

    #[test]
    fn the_kit_works_with_no_account_and_is_recorded() {
        let dir = site(OFF);
        let transport = scripted(vec![]);
        let (result, out) = run(
            dir.path(),
            Options {
                kit: Some("kit".into()),
                ..Options::default()
            },
            &transport,
            None,
        );
        result.unwrap();
        assert!(transport.calls.borrow().is_empty());
        assert!(out.contains("Nothing was posted"));
        let kit = dir.path().join("kit");
        let page = fs::read_to_string(kit.join("index.html")).unwrap();
        assert!(page.contains("Open Nextdoor"));
        assert!(page.contains("https://nextdoor.com/sharekit/?source=openblog&amp;body="));
        assert!(kit.join("images/floor-after.png").is_file());
        let json: Json =
            serde_json::from_str(&fs::read_to_string(kit.join("kit.json")).unwrap()).unwrap();
        assert_eq!(json["destinations"].as_array().unwrap().len(), 3);
        let state = fs::read_to_string(dir.path().join(STATE_FILE)).unwrap();
        assert_eq!(state.matches("kit-made").count(), 3);
        // A kit is written only into a new folder.
        let (result, _) = run(
            dir.path(),
            Options {
                kit: Some("kit".into()),
                ..Options::default()
            },
            &transport,
            None,
        );
        assert!(result.unwrap_err().contains("choose a new folder"));
    }

    #[test]
    fn a_photo_that_may_hold_where_it_was_taken_is_left_out_of_the_kit() {
        let dir = site(OFF);
        let mut png = samples::png(1200, 900, true);
        png.resize(20_000, 0);
        fs::write(dir.path().join("static/images/floor-after.png"), png).unwrap();
        let transport = scripted(vec![]);
        let (result, out) = run(dir.path(), Options::default(), &transport, None);
        result.unwrap();
        assert!(out.contains("fix first: The first after photo may hold the place"));
        let (result, _) = run(
            dir.path(),
            Options {
                kit: Some("kit".into()),
                ..Options::default()
            },
            &transport,
            None,
        );
        result.unwrap();
        let kit = dir.path().join("kit");
        assert!(!kit.join("images").exists(), "the photo was copied");
        let page = fs::read_to_string(kit.join("index.html")).unwrap();
        assert!(!page.contains("floor-after.png"), "{page}");
        assert!(page.contains("The photo is left out"));
        assert!(!fs::read_to_string(kit.join("kit.json"))
            .unwrap()
            .contains("floor-after.png"));
    }

    #[test]
    fn a_job_reaches_a_facebook_page_through_the_announcements_when_it_has_no_photo() {
        let dir = site(OFF);
        fs::write(
            dir.path().join("content/posts/floor.md"),
            JOB.replace(
                "  media:\n    after:\n      - /images/floor-after.png\n",
                "",
            ),
        )
        .unwrap();
        let transport = scripted(vec![]);
        let (result, out) = run(
            dir.path(),
            Options {
                json: true,
                to: Some("facebook".into()),
                ..Options::default()
            },
            &transport,
            None,
        );
        result.unwrap();
        let value: Json = serde_json::from_str(&out).unwrap();
        assert_eq!(value["destinations"][0]["route"], "adapter");
        let (result, out) = run(dir.path(), Options::default(), &transport, None);
        result.unwrap();
        assert!(out.contains("in Admin, open the job and choose Share this job"));
        let (result, _) = run(
            dir.path(),
            Options {
                send: Some("facebook".into()),
                ..Options::default()
            },
            &transport,
            None,
        );
        assert!(result.unwrap_err().contains("from Admin"));
        assert!(transport.calls.borrow().is_empty());
        // With a photo, which the Page adapter cannot carry, Facebook is by hand.
        let with_photo = site(OFF);
        let (result, out) = run(
            with_photo.path(),
            Options {
                json: true,
                to: Some("facebook".into()),
                ..Options::default()
            },
            &transport,
            None,
        );
        result.unwrap();
        let value: Json = serde_json::from_str(&out).unwrap();
        assert_eq!(value["destinations"][0]["route"], "by-hand");
    }

    #[test]
    fn a_post_that_is_not_a_job_or_an_unknown_destination_is_refused() {
        let dir = site(OFF);
        fs::write(
            dir.path().join("content/posts/note.md"),
            "---\ntitle: Note\ndate: 2026-10-01\n---\nHi.\n",
        )
        .unwrap();
        let transport = scripted(vec![]);
        let context_now = || DateTime::parse("2026-11-08T12:00:00Z").unwrap();
        let token = || None;
        let context = Context {
            transport: &transport,
            now: &context_now,
            token: &token,
        };
        let error = run_with(
            dir.path(),
            "note",
            &Options::default(),
            &context,
            &mut Vec::new(),
        )
        .unwrap_err();
        assert!(error.contains("is not a job"));
        let (result, _) = run(
            dir.path(),
            Options {
                to: Some("twitter".into()),
                ..Options::default()
            },
            &transport,
            None,
        );
        assert!(result.unwrap_err().contains("not a place a job can go"));
    }

    #[test]
    fn google_replies_are_read_without_copying_them() {
        assert_eq!(
            classify(&reply(200, json!({"name": "nope"}))),
            Outcome::Unknown {
                code: "no-post-name"
            }
        );
        assert_eq!(
            classify(&reply(401, json!({}))),
            Outcome::NotPosted {
                code: "token-refused"
            }
        );
        assert_eq!(
            classify(&reply(503, json!({}))),
            Outcome::Unknown {
                code: "provider-error"
            }
        );
    }

    /// A temporary folder removed when dropped.
    mod tempfile_dir {
        pub struct Dir(std::path::PathBuf);

        impl Dir {
            pub fn new() -> Self {
                let path = std::env::temp_dir().join(format!(
                    "openblog-job-share-{}-{}",
                    std::process::id(),
                    std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap()
                        .as_nanos()
                ));
                std::fs::create_dir_all(&path).unwrap();
                Self(path)
            }

            pub fn path(&self) -> &std::path::Path {
                &self.0
            }
        }

        impl Drop for Dir {
            fn drop(&mut self) {
                std::fs::remove_dir_all(&self.0).ok();
            }
        }
    }
}
