//! `openblog pinterest`: list the boards a Pinterest token can pin to, and send one post's Pin
//! card to one of them after the author confirms exactly what goes (story #394, ADRs 0371 to
//! 0373).
//!
//! Off unless `syndication.pinterest.enabled` is true. The dry run reads the post and the image
//! file the site serves and nothing else. Sending reads `PINTEREST_ACCESS_TOKEN`, which is never
//! printed, stored or put in an error. Every request goes through the syndication [`Transport`],
//! so tests script the provider and never reach Pinterest.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use blake2::{Blake2b512, Digest};
use openblog_core::image_facts::MediaType;
use openblog_core::provider_manifest::{
    builtin_manifest, Capability, DistributionRequest, ProviderId,
};
use openblog_core::visual_card::{CardFormat, CardStatus, VisualCard};
use openblog_core::DateTime;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value as Json};

use crate::syndication::{NetworkTransport, Request, Response, Transport};
use crate::{card, fsutil, site, syndication};

/// The environment variable holding the author's Pinterest OAuth access token.
pub const TOKEN_VARIABLE: &str = "PINTEREST_ACCESS_TOKEN";
/// The version of the Pin plan printed by `--json`.
pub const PIN_PLAN_VERSION: u32 = 1;
const NOTHING_SENT: &str = "No request was sent to Pinterest.";
/// Board pages read when checking a board or looking for a Pin: enough for any real account,
/// and a bound on what a misbehaving reply can make open.blog do.
const MAX_PAGES: usize = 20;
const BOARD_PAGE_SIZE: u32 = 100;
/// A Pin found by `--reconcile` must have been created no earlier than this before the attempt.
const RECONCILE_SLACK_SECONDS: i64 = 300;

/// Where Pins go: Pinterest's sandbox (Pins only their creator sees) or production.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Environment {
    Sandbox,
    Production,
}

impl Environment {
    fn parse(value: &str) -> Result<Self, String> {
        match value.trim() {
            "" | "sandbox" => Ok(Self::Sandbox),
            "production" => Ok(Self::Production),
            _ => Err(format!(
                "syndication.pinterest.environment must be `sandbox` or `production`. {NOTHING_SENT}"
            )),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Sandbox => "sandbox",
            Self::Production => "production",
        }
    }

    pub fn api_base(self) -> &'static str {
        match self {
            Self::Sandbox => "https://api-sandbox.pinterest.com/v5",
            Self::Production => "https://api.pinterest.com/v5",
        }
    }

    fn visibility(self) -> &'static str {
        match self {
            Self::Sandbox => "only-you",
            Self::Production => "board-audience",
        }
    }
}

#[derive(Clone, Debug, Default)]
pub struct Options {
    pub board: Option<String>,
    pub section: Option<String>,
    pub json: bool,
    pub write: bool,
    /// The Pin digest the author was shown by the dry run.
    pub confirm: Option<String>,
    pub reconcile: bool,
    pub forget_attempt: bool,
}

struct Settings {
    environment: Environment,
    board: Option<String>,
    section: Option<String>,
    state_path: PathBuf,
}

fn digits(value: &str) -> bool {
    !value.is_empty() && value.len() <= 32 && value.bytes().all(|b| b.is_ascii_digit())
}

fn settings(root: &Path, options: &Options) -> Result<Settings, String> {
    let config = site::load_config(root)?;
    let pinterest = config
        .syndication
        .pinterest
        .as_ref()
        .filter(|pinterest| pinterest.enabled)
        .ok_or_else(|| {
            format!("Pinterest is off. Set syndication.pinterest.enabled to true in openblog.json to use it. {NOTHING_SENT}")
        })?;
    let environment = Environment::parse(&pinterest.environment)?;
    let pick = |option: &Option<String>, configured: &str| {
        option
            .clone()
            .or_else(|| Some(configured.trim().to_string()))
            .filter(|value| !value.is_empty())
    };
    let board = pick(&options.board, &pinterest.board);
    let section = pick(&options.section, &pinterest.board_section);
    if board.as_deref().is_some_and(|b| !digits(b)) {
        return Err(format!(
            "A Pinterest board id is digits only; run `openblog pinterest boards` to list yours. {NOTHING_SENT}"
        ));
    }
    if section.as_deref().is_some_and(|s| !digits(s)) {
        return Err(format!(
            "A Pinterest board section id is digits only. {NOTHING_SENT}"
        ));
    }
    let state_path = syndication::private_state_path(root, &pinterest.state_file)
        .map_err(|_| format!("syndication.pinterest.stateFile must be a project-relative path without `..`. {NOTHING_SENT}"))?;
    Ok(Settings {
        environment,
        board,
        section,
        state_path,
    })
}

/// What a run reaches outside the project: the provider, the clock and the token. Tests script
/// all three.
pub(crate) struct Context<'a> {
    pub transport: &'a dyn Transport,
    pub now: &'a dyn Fn() -> DateTime,
    pub token: &'a dyn Fn() -> Option<String>,
}

fn token(context: &Context<'_>) -> Result<String, String> {
    (context.token)()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            format!("Sending to Pinterest needs your OAuth access token in {TOKEN_VARIABLE}. {NOTHING_SENT}")
        })
}

fn bearer(token: &str) -> Vec<(String, String)> {
    vec![
        ("Authorization".into(), format!("Bearer {token}")),
        ("Accept".into(), "application/json".into()),
    ]
}

// ---------------------------------------------------------------------------------------------
// The Pin plan: exactly what a confirmed `--write` sends, built without any request.

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PinProblem {
    pub code: &'static str,
    pub message: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PinImage {
    pub site_path: String,
    pub media_type: &'static str,
    pub width: u32,
    pub height: u32,
    pub bytes: u64,
    /// BLAKE2b (128 bits) of the exact file sent, so a changed file changes the Pin digest.
    pub content_digest: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PinPlan {
    pub version: u32,
    pub environment: Environment,
    pub api_base: &'static str,
    /// `only-you` in the sandbox; `board-audience` in production.
    pub visibility: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub board_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub board_section_id: Option<String>,
    pub source_path: String,
    /// The canonical address of the post, sent unchanged as the Pin's link.
    pub link: String,
    pub title: String,
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alt_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image: Option<PinImage>,
    pub card_digest: String,
    pub policy_version: String,
    pub ready: bool,
    pub problems: Vec<PinProblem>,
    /// Binds every field above that the request carries; `--confirm` must repeat it.
    pub digest: String,
    pub remote_request_sent: bool,
}

/// The plan and the image bytes it would send.
struct Built {
    plan: PinPlan,
    image: Option<(MediaType, Vec<u8>)>,
}

fn field(hasher: &mut Blake2b512, value: &str) {
    hasher.update((value.len() as u64).to_be_bytes());
    hasher.update(value.as_bytes());
}

fn hex(hasher: Blake2b512) -> String {
    hasher
        .finalize()
        .iter()
        .take(16)
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// The Pin's description: the card's own, then the image credit the author recorded, so a
/// photograph by someone else keeps its credit on Pinterest.
pub fn pin_description(card: &VisualCard) -> String {
    let credit = card
        .image
        .as_ref()
        .and_then(|image| image.candidate.credit.line());
    match credit {
        Some(credit) if card.description.trim().is_empty() => credit,
        Some(credit) => format!("{}\n\n{credit}", card.description),
        None => card.description.clone(),
    }
}

/// Whether a link is a public web address Pinterest can send readers to.
fn public_link(link: &str) -> bool {
    let Ok(url) = url::Url::parse(link) else {
        return false;
    };
    let host = url.host_str().unwrap_or("").to_ascii_lowercase();
    matches!(url.scheme(), "http" | "https")
        && host.contains('.')
        && !host.ends_with(".localhost")
        && !host.ends_with(".local")
        && host.parse::<std::net::IpAddr>().is_err()
}

fn build_plan(
    card: &VisualCard,
    source_path: &str,
    image_file: Option<&Path>,
    settings: &Settings,
) -> Result<Built, String> {
    let mut problems = Vec::new();
    let mut problem = |code: &'static str, message: String| {
        problems.push(PinProblem { code, message });
    };
    if card.status != CardStatus::Ready {
        let codes: Vec<&str> = card
            .problems
            .iter()
            .filter(|p| p.severity != openblog_core::visual_card::Severity::Notice)
            .map(|p| p.code)
            .collect();
        problem(
            "card-not-ready",
            format!(
                "The Pin card is not ready ({}); run `openblog card <slug> --format pinterest-pin` to see why.",
                if codes.is_empty() { "no image".to_string() } else { codes.join(", ") }
            ),
        );
    }
    let mut image = None;
    let mut pin_image = None;
    match (&card.image, image_file) {
        (Some(chosen), Some(file))
            if chosen.facts.is_some() && chosen.candidate.site_path.is_some() =>
        {
            let facts = chosen.facts.expect("checked");
            let bytes = fs::read(file)
                .map_err(|error| format!("cannot read the Pin image: {error}. {NOTHING_SENT}"))?;
            if bytes.len() as u64 != facts.bytes {
                problem(
                    "image-changed",
                    "The image file changed while the Pin was being built; run the command again."
                        .into(),
                );
            }
            let mut hasher = Blake2b512::new();
            hasher.update(&bytes);
            pin_image = Some(PinImage {
                site_path: chosen.candidate.site_path.clone().unwrap_or_default(),
                media_type: facts.media_type.mime(),
                width: facts.width,
                height: facts.height,
                bytes: bytes.len() as u64,
                content_digest: hex(hasher),
            });
            image = Some((facts.media_type, bytes));
        }
        _ => problem(
            "image-not-served",
            "A Pin is sent only with an image file your own site serves; this card has none."
                .into(),
        ),
    }
    if card.alt.as_deref().is_none_or(|alt| alt.trim().is_empty()) {
        problem(
            "alt-missing",
            "A Pin needs the image's own alternative text.".into(),
        );
    }
    let description = pin_description(card);
    let manifest = builtin_manifest(ProviderId::Pinterest);
    let mut request =
        DistributionRequest::new([Capability::Link, Capability::Text, Capability::Image]);
    request.text_chars = Some(description.chars().count());
    for ineligibility in manifest.check(&request) {
        problem(ineligibility.code(), ineligibility.message(&manifest.label));
    }
    if !public_link(&card.link) {
        problem(
            "link-not-public",
            "The post's canonical address is not a public web address, so a Pin could not lead readers to it; set `url` in openblog.json.".into(),
        );
    }
    if settings.board.is_none() {
        problem(
            "board-not-chosen",
            "Choose a board with --board <id> or syndication.pinterest.board; `openblog pinterest boards` lists yours.".into(),
        );
    }
    let mut hasher = Blake2b512::new();
    for value in [
        "openblog-pinterest-pin-v1",
        settings.environment.as_str(),
        settings.board.as_deref().unwrap_or(""),
        settings.section.as_deref().unwrap_or(""),
        source_path,
        &card.link,
        &card.title,
        &description,
        card.alt.as_deref().unwrap_or(""),
        pin_image.as_ref().map(|i| i.media_type).unwrap_or(""),
        pin_image
            .as_ref()
            .map(|i| i.content_digest.as_str())
            .unwrap_or(""),
        &card.digest,
    ] {
        field(&mut hasher, value);
    }
    let plan = PinPlan {
        version: PIN_PLAN_VERSION,
        environment: settings.environment,
        api_base: settings.environment.api_base(),
        visibility: settings.environment.visibility(),
        board_id: settings.board.clone(),
        board_section_id: settings.section.clone(),
        source_path: source_path.to_string(),
        link: card.link.clone(),
        title: card.title.clone(),
        description,
        alt_text: card.alt.clone(),
        image: pin_image,
        card_digest: card.digest.clone(),
        policy_version: manifest.policy_version.clone(),
        ready: problems.is_empty(),
        problems,
        digest: hex(hasher),
        remote_request_sent: false,
    };
    Ok(Built { plan, image })
}

fn load(root: &Path, slug: &str, settings: &Settings) -> Result<Built, String> {
    let (cards, measured) = card::build(root, slug, &[CardFormat::PinterestPin])?;
    let card = cards
        .cards
        .first()
        .ok_or_else(|| format!("no Pin card could be built. {NOTHING_SENT}"))?;
    let file = card
        .image
        .as_ref()
        .and_then(|image| image.candidate.site_path.as_ref())
        .and_then(|path| measured.iter().find(|(known, _)| known == path))
        .map(|(_, file)| file.as_path());
    build_plan(card, &cards.source_path, file, settings)
}

/// The `POST /v5/pins` body: the plan's fields under Pinterest's names, and the image's bytes.
fn pin_request(plan: &PinPlan, image: &(MediaType, Vec<u8>), token: &str) -> Request {
    let mut body = json!({
        "board_id": plan.board_id,
        "title": plan.title,
        "description": plan.description,
        "link": plan.link,
        "alt_text": plan.alt_text,
        "media_source": {
            "source_type": "image_base64",
            "content_type": image.0.mime(),
            "data": STANDARD.encode(&image.1),
        },
    });
    if let Some(section) = &plan.board_section_id {
        body["board_section_id"] = Json::String(section.clone());
    }
    let mut headers = bearer(token);
    headers.push(("Content-Type".into(), "application/json".into()));
    Request {
        method: "POST",
        url: format!("{}/pins", plan.api_base),
        headers,
        body,
    }
}

// ---------------------------------------------------------------------------------------------
// The private record of Pins sent and attempted.

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RecordStatus {
    /// Pinterest answered with the Pin's id.
    Posted,
    /// A request was made and may have created a Pin: a person settles it.
    Unknown,
    /// Pinterest certainly did not create it; sending again is allowed.
    NotPosted,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PinRecord {
    pub status: RecordStatus,
    pub environment: String,
    pub board_id: String,
    pub source_path: String,
    pub link: String,
    pub digest: String,
    pub attempted_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pin_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pin_url: Option<String>,
    /// Whether Pinterest's reply carried the link exactly as sent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub link_preserved: Option<bool>,
    /// A fixed failure code, never provider text.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub failure: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PinState {
    pub version: u32,
    /// By `<environment>/<board id>/<source path>`.
    pub pins: BTreeMap<String, PinRecord>,
}

impl PinState {
    fn load(path: &Path) -> Result<Self, String> {
        match fs::read_to_string(path) {
            Ok(text) => {
                let state: Self = serde_json::from_str(&text).map_err(|_| {
                    format!(
                        "The Pinterest record file cannot be read; fix or move it. {NOTHING_SENT}"
                    )
                })?;
                if state.version != 1 {
                    return Err(format!(
                        "The Pinterest record file is of an unknown version. {NOTHING_SENT}"
                    ));
                }
                Ok(state)
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Self {
                version: 1,
                pins: BTreeMap::new(),
            }),
            Err(error) => Err(format!("cannot read the Pinterest record file: {error}")),
        }
    }

    fn save(&self, path: &Path) -> Result<(), String> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("cannot create the Pinterest record folder: {error}"))?;
        }
        let text = serde_json::to_string_pretty(self)
            .map_err(|error| format!("could not serialize the Pinterest record: {error}"))?;
        fsutil::write_file(path, format!("{text}\n").as_bytes())
    }
}

fn record_key(environment: Environment, board: &str, source_path: &str) -> String {
    format!("{}/{board}/{source_path}", environment.as_str())
}

/// The public address of a Pin.
pub fn pin_url(id: &str) -> String {
    format!("https://www.pinterest.com/pin/{id}/")
}

// ---------------------------------------------------------------------------------------------
// What Pinterest answered.

/// A send's outcome. Only `Posted` carries a Pin; `NotPosted` certainly created nothing; `Unknown`
/// may have, and is never retried automatically.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Outcome {
    Posted { id: String, link: Option<String> },
    NotPosted { code: &'static str },
    Unknown { code: &'static str },
}

/// Reads Pinterest's reply to `POST /v5/pins`. Provider text is never copied.
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
        200 | 201 => {
            let body: Json = serde_json::from_slice(&response.body).unwrap_or(Json::Null);
            match body["id"].as_str().filter(|id| digits(id)) {
                Some(id) => Outcome::Posted {
                    id: id.to_string(),
                    link: body["link"].as_str().map(str::to_string),
                },
                None => Outcome::Unknown { code: "no-pin-id" },
            }
        }
        400 | 404 | 409 | 413 | 415 | 422 => Outcome::NotPosted { code: "rejected" },
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

/// What the author is told for a failure code: what happened and what to do next.
pub fn failure_words(code: &str) -> &'static str {
    match code {
        "rejected" => "Pinterest refused the Pin as sent (the board, section, image or a field). No Pin was created; check them and send again.",
        "token-refused" => "Pinterest refused the access token: it has expired (a sandbox token lasts 30 days) or was revoked. No Pin was created; reconnect by generating a new token.",
        "not-permitted" => "Pinterest refused the action: the token lacks boards:read, boards:write, pins:read or pins:write, the board is not yours to pin to, or an app with Trial access tried production. No Pin was created.",
        "rate-limited" => "Pinterest's rate limit was reached. No Pin was created; send again later.",
        "no-response" => "The request failed or timed out before Pinterest answered, so a Pin may have been created.",
        "no-pin-id" => "Pinterest answered without a Pin id, so a Pin may have been created.",
        "provider-error" => "Pinterest answered with a server error, so a Pin may have been created.",
        _ => "Pinterest did not confirm the Pin.",
    }
}

// ---------------------------------------------------------------------------------------------
// Boards.

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Board {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub privacy: Option<String>,
}

fn read_failure(status: u16) -> String {
    match status {
        401 => failure_words("token-refused").into(),
        403 => "Pinterest refused to list boards: the token lacks boards:read.".into(),
        429 => failure_words("rate-limited").into(),
        _ => format!("Pinterest answered HTTP {status} when listing boards."),
    }
}

/// Every board the token can pin to, read page by page (at most [`MAX_PAGES`]).
fn list_boards(
    transport: &dyn Transport,
    environment: Environment,
    token: &str,
) -> Result<Vec<Board>, String> {
    let mut boards = Vec::new();
    let mut bookmark: Option<String> = None;
    for _ in 0..MAX_PAGES {
        let mut url = url::Url::parse(&format!("{}/boards", environment.api_base()))
            .map_err(|_| "invalid Pinterest address".to_string())?;
        url.query_pairs_mut()
            .append_pair("page_size", &BOARD_PAGE_SIZE.to_string());
        if let Some(mark) = &bookmark {
            url.query_pairs_mut().append_pair("bookmark", mark);
        }
        let response = transport
            .send(&Request {
                method: "GET",
                url: url.to_string(),
                headers: bearer(token),
                body: Json::Null,
            })
            .map_err(|_| {
                "The request to list Pinterest boards failed before Pinterest answered.".to_string()
            })?;
        if response.status != 200 {
            return Err(read_failure(response.status));
        }
        let page: Json = serde_json::from_slice(&response.body)
            .map_err(|_| "Pinterest's list of boards could not be read.".to_string())?;
        let items = page["items"]
            .as_array()
            .ok_or_else(|| "Pinterest's list of boards could not be read.".to_string())?;
        for item in items {
            if let (Some(id), Some(name)) = (item["id"].as_str(), item["name"].as_str()) {
                if digits(id) {
                    boards.push(Board {
                        id: id.to_string(),
                        name: openblog_core::visual_card::one_line(name),
                        privacy: item["privacy"].as_str().map(str::to_string),
                    });
                }
            }
        }
        bookmark = page["bookmark"]
            .as_str()
            .filter(|mark| !mark.is_empty())
            .map(str::to_string);
        if bookmark.is_none() {
            return Ok(boards);
        }
    }
    Ok(boards)
}

fn network<T>(run: impl FnOnce(&Context<'_>) -> T) -> T {
    let transport = NetworkTransport::default();
    let now = crate::clock::now;
    let token = || std::env::var(TOKEN_VARIABLE).ok();
    run(&Context {
        transport: &transport,
        now: &now,
        token: &token,
    })
}

/// What to do when a token can pin to no board. The sandbox holds only sandbox entities: boards
/// made on pinterest.com are filtered out of its board list, and a sandbox board can only be made
/// through the API (ADR 0371), so the sandbox message gives that one request for the author to
/// run. It names the token's variable, never the token, and open.blog sends nothing for it.
fn no_boards(environment: Environment) -> String {
    match environment {
        Environment::Sandbox => format!(
            "This token can pin to no board in Pinterest's sandbox. Boards you made on pinterest.com are not \
             visible there: the sandbox has its own boards, made only through the API. Make one with your \
             sandbox token (open.blog does not send this for you):\n\n  \
             curl -X POST {}/boards -H \"Authorization: Bearer ${TOKEN_VARIABLE}\" \
             -H \"Content-Type: application/json\" -d '{{\"name\": \"My Pins\"}}'\n\n\
             Then run `openblog pinterest boards` again. See docs/pinterest.md.\n",
            environment.api_base()
        ),
        Environment::Production => {
            "This token can pin to no board in Pinterest's production. Create a board on pinterest.com first.\n"
                .to_string()
        }
    }
}

pub fn run_boards(root: &Path, json: bool) -> Result<(), String> {
    network(|context| run_boards_with(root, json, context, &mut std::io::stdout()))
}

fn run_boards_with(
    root: &Path,
    json: bool,
    context: &Context<'_>,
    out: &mut dyn std::io::Write,
) -> Result<(), String> {
    let settings = settings(root, &Options::default())?;
    let token = token(context)?;
    let boards = list_boards(context.transport, settings.environment, &token)?;
    let text = if json {
        serde_json::to_string_pretty(&json!({
            "environment": settings.environment,
            "boards": boards,
        }))
        .map_err(|error| format!("could not serialize the boards: {error}"))?
            + "\n"
    } else if boards.is_empty() {
        no_boards(settings.environment)
    } else {
        let mut text = format!(
            "Boards this token can pin to ({}). Choose one with --board <id> or syndication.pinterest.board:\n",
            settings.environment.as_str()
        );
        for board in &boards {
            text.push_str(&format!("  {}  {}\n", board.id, board.name));
        }
        text
    };
    out.write_all(text.as_bytes())
        .map_err(|error| format!("cannot print the boards: {error}"))
}

// ---------------------------------------------------------------------------------------------
// Pins.

pub fn run_pin(root: &Path, slug: &str, options: Options) -> Result<(), String> {
    network(|context| run_pin_with(root, slug, &options, context, &mut std::io::stdout()))
}

fn run_pin_with(
    root: &Path,
    slug: &str,
    options: &Options,
    context: &Context<'_>,
    out: &mut dyn std::io::Write,
) -> Result<(), String> {
    let modes = [
        options.write,
        options.reconcile,
        options.forget_attempt,
        options.json,
    ]
    .iter()
    .filter(|on| **on)
    .count();
    if modes > 1 {
        return Err(format!(
            "--write, --reconcile, --forget-attempt and --json each run alone. {NOTHING_SENT}"
        ));
    }
    if options.confirm.is_some() && !options.write {
        return Err(format!("--confirm goes with --write. {NOTHING_SENT}"));
    }
    let settings = settings(root, options)?;
    let built = load(root, slug, &settings)?;
    let mut say = |text: String| {
        out.write_all(text.as_bytes())
            .map_err(|error| format!("cannot print: {error}"))
    };
    if options.reconcile || options.forget_attempt {
        return settle(
            &settings,
            slug,
            &built.plan,
            options.reconcile,
            context,
            &mut say,
        );
    }
    if options.json {
        let text = serde_json::to_string_pretty(&built.plan)
            .map_err(|error| format!("could not serialize the Pin plan: {error}"))?;
        return say(format!("{text}\n"));
    }
    if !options.write {
        return say(text_report(slug, &built.plan));
    }
    write(&settings, slug, built, options, context, &mut say)
}

/// The exact `openblog pinterest pin` command for this post, board and section, ending in `tail`.
/// Every command open.blog suggests names the board (and section) the run used, so following it
/// rebuilds the same Pin and looks up the same record even when they came from the command line.
fn pin_command(slug: &str, board: Option<&str>, section: Option<&str>, tail: &str) -> String {
    let mut command = format!("openblog pinterest pin {slug}");
    if let Some(board) = board {
        command.push_str(&format!(" --board {board}"));
    }
    if let Some(section) = section {
        command.push_str(&format!(" --section {section}"));
    }
    command.push(' ');
    command.push_str(tail);
    command
}

fn text_report(slug: &str, plan: &PinPlan) -> String {
    let mut out = format!(
        "Pinterest Pin for `{slug}` ({}{}). Nothing was sent.\n",
        plan.environment.as_str(),
        if plan.environment == Environment::Sandbox {
            ": only you will see it"
        } else {
            ""
        }
    );
    out.push_str(&format!(
        "  board: {}\n",
        plan.board_id.as_deref().unwrap_or("(none chosen)")
    ));
    if let Some(section) = &plan.board_section_id {
        out.push_str(&format!("  section: {section}\n"));
    }
    out.push_str(&format!("  title: {}\n", plan.title));
    out.push_str(&format!(
        "  description: {}\n",
        plan.description.replace('\n', "\n    ")
    ));
    if let Some(alt) = &plan.alt_text {
        out.push_str(&format!("  alt text: {alt}\n"));
    }
    out.push_str(&format!("  link: {}\n", plan.link));
    if let Some(image) = &plan.image {
        out.push_str(&format!(
            "  image: {} ({} {}x{}, {} bytes)\n",
            image.site_path, image.media_type, image.width, image.height, image.bytes
        ));
    }
    if plan.ready {
        out.push_str(&format!(
            "\nPin digest: {}\nTo send exactly this Pin, run:\n  {}\n",
            plan.digest,
            pin_command(
                slug,
                plan.board_id.as_deref(),
                plan.board_section_id.as_deref(),
                &format!("--write --confirm {}", plan.digest)
            )
        ));
    } else {
        out.push_str("\nThis Pin cannot be sent yet:\n");
        for problem in &plan.problems {
            out.push_str(&format!("  - {}: {}\n", problem.code, problem.message));
        }
    }
    out
}

fn write(
    settings: &Settings,
    slug: &str,
    built: Built,
    options: &Options,
    context: &Context<'_>,
    say: &mut dyn FnMut(String) -> Result<(), String>,
) -> Result<(), String> {
    let plan = built.plan;
    if !plan.ready {
        let codes: Vec<&str> = plan.problems.iter().map(|p| p.code).collect();
        return Err(format!(
            "This Pin cannot be sent ({}); run without --write to see why. {NOTHING_SENT}",
            codes.join(", ")
        ));
    }
    match options.confirm.as_deref() {
        None => {
            return Err(format!(
                "--write sends only a Pin you confirmed: run without --write, check it, then add --confirm <digest>. {NOTHING_SENT}"
            ))
        }
        Some(confirmed) if confirmed.trim() != plan.digest => {
            return Err(format!(
                "The Pin changed since you previewed it (its post, image, board or words). Run without --write and confirm the new digest. {NOTHING_SENT}"
            ))
        }
        Some(_) => {}
    }
    let (Some(board), Some(image)) = (plan.board_id.clone(), built.image) else {
        return Err(format!("This Pin has no board or image. {NOTHING_SENT}"));
    };
    let key = record_key(plan.environment, &board, &plan.source_path);
    let reconcile_command = pin_command(slug, Some(&board), None, "--reconcile");
    let mut state = PinState::load(&settings.state_path)?;
    match state.pins.get(&key) {
        Some(record) if record.status == RecordStatus::Posted => {
            return Err(format!(
                "This post is already pinned to that board as {}. {NOTHING_SENT}",
                record.pin_url.as_deref().unwrap_or("a Pin")
            ))
        }
        Some(record) if record.status == RecordStatus::Unknown => {
            return Err(format!(
                "An earlier attempt to pin this post to board {board} may have created a Pin. Run `{reconcile_command}` to look for it before sending again. {NOTHING_SENT}"
            ))
        }
        _ => {}
    }
    let token = token(context)?;
    // The board must be one this token can pin to, checked before the Pin is sent.
    let boards = list_boards(context.transport, plan.environment, &token)
        .map_err(|error| format!("{error} {NOTHING_SENT_PIN}"))?;
    if !boards.iter().any(|b| b.id == board) {
        return Err(format!(
            "Board {board} is not one this token can pin to; run `openblog pinterest boards`. {NOTHING_SENT_PIN}"
        ));
    }
    // Recorded before the request, so a crash mid-request can never lead to a second Pin.
    let attempted_at = (context.now)().rfc3339();
    let mut record = PinRecord {
        status: RecordStatus::Unknown,
        environment: plan.environment.as_str().into(),
        board_id: board.clone(),
        source_path: plan.source_path.clone(),
        link: plan.link.clone(),
        digest: plan.digest.clone(),
        attempted_at,
        pin_id: None,
        pin_url: None,
        link_preserved: None,
        failure: None,
    };
    state.pins.insert(key.clone(), record.clone());
    state
        .save(&settings.state_path)
        .map_err(|error| format!("{error} {NOTHING_SENT_PIN}"))?;
    let result = context.transport.send(&pin_request(&plan, &image, &token));
    let outcome = classify(&result);
    let message = match &outcome {
        Outcome::Posted { id, link } => {
            let preserved = link.as_deref() == Some(plan.link.as_str());
            record.status = RecordStatus::Posted;
            record.pin_url = Some(pin_url(id));
            record.pin_id = Some(id.clone());
            record.link_preserved = Some(preserved);
            let mut text = format!(
                "Pinned `{}` to board {board} as {}{}.\n",
                plan.title,
                pin_url(id),
                if plan.environment == Environment::Sandbox {
                    " (sandbox: only you can see it)"
                } else {
                    ""
                }
            );
            if !preserved {
                text.push_str("Warning: Pinterest's reply did not carry your post's address as the Pin's link; open the Pin and check where it leads.\n");
            }
            Ok(text)
        }
        Outcome::NotPosted { code } => {
            record.status = RecordStatus::NotPosted;
            record.failure = Some((*code).into());
            Err(format!("Not pinned: {}", failure_words(code)))
        }
        Outcome::Unknown { code } => {
            record.failure = Some((*code).into());
            Err(format!(
                "Pin status unknown: {} Check board {board} in Pinterest, then run `{reconcile_command}`; it will not be sent again until then.",
                failure_words(code)
            ))
        }
    };
    state.pins.insert(key, record);
    state.save(&settings.state_path)?;
    match message {
        Ok(text) => say(text),
        Err(error) => Err(error),
    }
}

const NOTHING_SENT_PIN: &str = "No Pin was sent.";

/// `--reconcile` looks for the Pin an unknown attempt may have made; `--forget-attempt` lets the
/// author, having checked the board, allow it to be sent again.
fn settle(
    settings: &Settings,
    slug: &str,
    plan: &PinPlan,
    reconcile: bool,
    context: &Context<'_>,
    say: &mut dyn FnMut(String) -> Result<(), String>,
) -> Result<(), String> {
    let board = plan.board_id.clone().ok_or_else(|| {
        format!("Choose the board the attempt went to with --board <id>. {NOTHING_SENT}")
    })?;
    let key = record_key(plan.environment, &board, &plan.source_path);
    let mut state = PinState::load(&settings.state_path)?;
    let forget_command = pin_command(slug, Some(&board), None, "--forget-attempt");
    let Some(record) = state.pins.get(&key).cloned() else {
        // The attempt may have taken its board from `--board` and this run from the config:
        // name every unsettled attempt for this post, with the exact command that settles it.
        let mut text = format!(
            "No attempt to pin this post to board {board} ({}) is recorded.\n",
            plan.environment.as_str()
        );
        let tail = if reconcile {
            "--reconcile"
        } else {
            "--forget-attempt"
        };
        let others: Vec<&PinRecord> = state
            .pins
            .values()
            .filter(|r| {
                r.source_path == plan.source_path
                    && r.environment == plan.environment.as_str()
                    && r.status == RecordStatus::Unknown
            })
            .collect();
        if !others.is_empty() {
            text.push_str("This post has an unsettled attempt elsewhere:\n");
            for other in others {
                text.push_str(&format!(
                    "  board {}: run `{}`\n",
                    other.board_id,
                    pin_command(slug, Some(&other.board_id), None, tail)
                ));
            }
        }
        return say(text);
    };
    if record.status != RecordStatus::Unknown {
        return say(match record.status {
            RecordStatus::Posted => format!(
                "Already pinned as {}.\n",
                record.pin_url.as_deref().unwrap_or("a Pin")
            ),
            _ => "The last attempt certainly created no Pin; you may send it again.\n".into(),
        });
    }
    if !reconcile {
        state.pins.remove(&key);
        state.save(&settings.state_path)?;
        return say("Forgot the unsettled attempt. If it did create a Pin, sending again makes a second one.\n".into());
    }
    let token = token(context)?;
    let since = DateTime::parse(&record.attempted_at)
        .map(|t| t.unix() - RECONCILE_SLACK_SECONDS)
        .unwrap_or(i64::MIN);
    let found = find_pins(
        context.transport,
        plan.environment,
        &board,
        &token,
        &record.link,
        since,
    )?;
    match found.as_slice() {
        [id] => {
            let mut settled = record;
            settled.status = RecordStatus::Posted;
            settled.pin_url = Some(pin_url(id));
            settled.pin_id = Some(id.clone());
            settled.link_preserved = Some(true);
            settled.failure = None;
            let url = pin_url(id);
            state.pins.insert(key, settled);
            state.save(&settings.state_path)?;
            say(format!("Found the Pin: {url}. It is recorded as posted.\n"))
        }
        [] => Err(format!(
            "No Pin linking this post was found on board {board} since the attempt. The attempt stays unsettled: check the board yourself, and if the Pin is not there run `{forget_command}` to allow sending it again."
        )),
        _ => Err(format!(
            "{} Pins linking this post were made on board {board} since the attempt; the attempt stays unsettled. Remove any duplicate in Pinterest, then run `{forget_command}` or keep it.",
            found.len()
        )),
    }
}

/// The ids of Pins on `board` that link exactly `link` and were created at or after `since`.
fn find_pins(
    transport: &dyn Transport,
    environment: Environment,
    board: &str,
    token: &str,
    link: &str,
    since: i64,
) -> Result<Vec<String>, String> {
    let mut found = Vec::new();
    let mut bookmark: Option<String> = None;
    for _ in 0..MAX_PAGES {
        let mut url = url::Url::parse(&format!("{}/boards/{board}/pins", environment.api_base()))
            .map_err(|_| "invalid Pinterest address".to_string())?;
        url.query_pairs_mut()
            .append_pair("page_size", &BOARD_PAGE_SIZE.to_string());
        if let Some(mark) = &bookmark {
            url.query_pairs_mut().append_pair("bookmark", mark);
        }
        let response = transport
            .send(&Request {
                method: "GET",
                url: url.to_string(),
                headers: bearer(token),
                body: Json::Null,
            })
            .map_err(|_| "The request to read the board failed before Pinterest answered; the attempt stays unsettled.".to_string())?;
        if response.status != 200 {
            return Err(format!(
                "{} The attempt stays unsettled.",
                read_failure(response.status)
            ));
        }
        let page: Json = serde_json::from_slice(&response.body).map_err(|_| {
            "Pinterest's list of Pins could not be read; the attempt stays unsettled.".to_string()
        })?;
        let items = page["items"].as_array().ok_or_else(|| {
            "Pinterest's list of Pins could not be read; the attempt stays unsettled.".to_string()
        })?;
        for item in items {
            let created = item["created_at"]
                .as_str()
                .and_then(DateTime::parse)
                .map(DateTime::unix);
            if let Some(id) = item["id"].as_str().filter(|id| digits(id)) {
                if item["link"].as_str() == Some(link) && created.is_none_or(|at| at >= since) {
                    found.push(id.to_string());
                }
            }
        }
        bookmark = page["bookmark"]
            .as_str()
            .filter(|mark| !mark.is_empty())
            .map(str::to_string);
        if bookmark.is_none() {
            break;
        }
    }
    Ok(found)
}

#[cfg(test)]
mod tests {
    use super::*;
    use openblog_core::image_facts::samples;
    use std::cell::RefCell;
    use std::collections::VecDeque;

    pub(super) const TOKEN: &str = "pina_test_token_never_printed_0123456789";

    type Check = Box<dyn Fn(&Request)>;

    pub(super) struct Scripted {
        pub calls: RefCell<Vec<Request>>,
        pub replies: RefCell<VecDeque<Result<Response, String>>>,
        pub during_send: Option<Check>,
    }

    impl Scripted {
        pub fn new(replies: Vec<Result<Response, String>>) -> Self {
            Self {
                calls: RefCell::new(Vec::new()),
                replies: RefCell::new(replies.into()),
                during_send: None,
            }
        }
    }

    impl Transport for Scripted {
        fn send(&self, request: &Request) -> Result<Response, String> {
            if let Some(check) = &self.during_send {
                check(request);
            }
            self.calls.borrow_mut().push(request.clone());
            self.replies
                .borrow_mut()
                .pop_front()
                .expect("the test scripted no reply for this request")
        }
    }

    pub(super) fn reply(status: u16, body: Json) -> Result<Response, String> {
        Ok(Response {
            status,
            body: body.to_string().into_bytes(),
        })
    }

    pub(super) fn boards(ids: &[&str]) -> Result<Response, String> {
        let items: Vec<Json> = ids
            .iter()
            .map(|id| json!({"id": id, "name": format!("Board {id}"), "privacy": "PUBLIC"}))
            .collect();
        reply(200, json!({"items": items, "bookmark": null}))
    }

    pub(super) const RECIPE: &str = "---\ntitle: Lemon tart\nslug: tart\ndate: 2026-01-01\nprofile: recipe\ndescription: Sharp and short.\ncardTitle: Lemon tart with a crisp crust\n---\nIntro.\n\n![A slice of tart on a plate](/img/pin.png)\n\n## Ingredients\n\n- lemons\n\n## Method\n\n1. Bake.\n";

    pub(super) fn site(pinterest: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "openblog-pinterest-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(root.join("content/posts")).unwrap();
        fs::create_dir_all(root.join("static/img")).unwrap();
        fs::write(
            root.join("openblog.json"),
            format!(
                r#"{{"title":"Kitchen","url":"https://cook.example.org","syndication":{{"pinterest":{pinterest}}}}}"#
            ),
        )
        .unwrap();
        fs::write(root.join("content/posts/tart.md"), RECIPE).unwrap();
        fs::write(
            root.join("static/img/pin.png"),
            samples::png(1000, 1500, false),
        )
        .unwrap();
        root
    }

    pub(super) const ON: &str = r#"{"enabled":true,"board":"111"}"#;

    pub(super) fn run(
        root: &Path,
        options: &Options,
        transport: &Scripted,
    ) -> (Result<(), String>, String) {
        let now = || DateTime::parse("2026-10-29T12:00:00Z").unwrap();
        let token = || Some(TOKEN.to_string());
        let context = Context {
            transport,
            now: &now,
            token: &token,
        };
        let mut out = Vec::new();
        let result = run_pin_with(root, "tart", options, &context, &mut out);
        let printed = String::from_utf8(out).unwrap();
        assert!(!printed.contains(TOKEN));
        if let Err(error) = &result {
            assert!(!error.contains(TOKEN));
        }
        (result, printed)
    }

    pub(super) fn plan(root: &Path) -> PinPlan {
        let transport = Scripted::new(vec![]);
        let options = Options {
            json: true,
            ..Options::default()
        };
        let (result, printed) = run(root, &options, &transport);
        result.unwrap();
        assert!(transport.calls.borrow().is_empty());
        let value: Json = serde_json::from_str(&printed).unwrap();
        let built = load(root, "tart", &settings(root, &Options::default()).unwrap()).unwrap();
        assert_eq!(value["digest"], built.plan.digest);
        built.plan
    }

    pub(super) fn confirmed(digest: &str) -> Options {
        Options {
            write: true,
            confirm: Some(digest.to_string()),
            ..Options::default()
        }
    }

    pub(super) fn state(root: &Path) -> PinState {
        PinState::load(&root.join(".openblog/pinterest.json")).unwrap()
    }

    pub(super) fn key(plan: &PinPlan) -> String {
        format!("sandbox/111/{}", plan.source_path)
    }

    #[test]
    fn the_dry_run_shows_the_exact_pin_and_sends_nothing() {
        let root = site(ON);
        let transport = Scripted::new(vec![]);
        let (result, printed) = run(&root, &Options::default(), &transport);
        result.unwrap();
        assert!(transport.calls.borrow().is_empty());
        assert!(printed.contains("Nothing was sent"));
        assert!(printed.contains("only you will see it"));
        let plan = plan(&root);
        assert!(plan.ready, "{:?}", plan.problems);
        assert!(!plan.remote_request_sent);
        assert_eq!(plan.environment, Environment::Sandbox);
        assert_eq!(plan.api_base, "https://api-sandbox.pinterest.com/v5");
        assert_eq!(plan.link, "https://cook.example.org/posts/tart/");
        assert_eq!(plan.title, "Lemon tart with a crisp crust");
        assert_eq!(plan.description, "Sharp and short.");
        assert_eq!(plan.alt_text.as_deref(), Some("A slice of tart on a plate"));
        assert_eq!(plan.board_id.as_deref(), Some("111"));
        let image = plan.image.as_ref().unwrap();
        assert_eq!(
            (image.media_type, image.width, image.height),
            ("image/png", 1000, 1500)
        );
        assert!(printed.contains(&format!("--write --confirm {}", plan.digest)));
        assert!(!root.join(".openblog/pinterest.json").exists());
        assert_eq!(
            Some(800),
            builtin_manifest(ProviderId::Pinterest)
                .constraints
                .max_text_chars
        );
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn the_digest_changes_with_the_board_the_image_and_the_words() {
        let root = site(ON);
        let first = plan(&root).digest;
        assert_eq!(first, plan(&root).digest, "deterministic");
        fs::write(
            root.join("static/img/pin.png"),
            samples::png(1000, 1501, false),
        )
        .unwrap();
        let image = plan(&root).digest;
        assert_ne!(first, image);
        fs::write(
            root.join("content/posts/tart.md"),
            RECIPE.replace("Sharp and short.", "Sharp, short and sweet."),
        )
        .unwrap();
        assert_ne!(image, plan(&root).digest);
        let other_board = site(r#"{"enabled":true,"board":"222"}"#);
        assert_ne!(first, plan(&other_board).digest);
        fs::remove_dir_all(root).ok();
        fs::remove_dir_all(other_board).ok();
    }

    #[test]
    fn it_is_off_unless_enabled_and_needs_a_board_and_a_confirmed_digest() {
        for config in [r#"{"enabled":false,"board":"111"}"#, r#"{"board":"111"}"#] {
            let root = site(config);
            let transport = Scripted::new(vec![]);
            let (result, _) = run(&root, &Options::default(), &transport);
            assert!(result.unwrap_err().contains("Pinterest is off"));
            assert!(transport.calls.borrow().is_empty());
            fs::remove_dir_all(root).ok();
        }
        let root = site(r#"{"enabled":true,"environment":"staging","board":"111"}"#);
        let (result, _) = run(&root, &Options::default(), &Scripted::new(vec![]));
        assert!(result.unwrap_err().contains("`sandbox` or `production`"));
        fs::remove_dir_all(root).ok();

        let root = site(r#"{"enabled":true}"#);
        let transport = Scripted::new(vec![]);
        let (result, _) = run(&root, &confirmed("0"), &transport);
        assert!(result.unwrap_err().contains("board-not-chosen"));
        assert!(transport.calls.borrow().is_empty());
        fs::remove_dir_all(root).ok();

        let root = site(ON);
        let digest = plan(&root).digest;
        for options in [
            Options {
                write: true,
                ..Options::default()
            },
            confirmed("0123"),
            Options {
                confirm: Some(digest.clone()),
                ..Options::default()
            },
        ] {
            let transport = Scripted::new(vec![]);
            let (result, _) = run(&root, &options, &transport);
            assert!(result.unwrap_err().contains(NOTHING_SENT));
            assert!(transport.calls.borrow().is_empty());
        }
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn a_confirmed_pin_goes_to_an_authorized_board_exactly_as_previewed() {
        let root = site(ON);
        let plan = plan(&root);
        let transport = Scripted::new(vec![
            boards(&["111", "333"]),
            reply(
                201,
                json!({"id": "987654321", "link": plan.link, "board_id": "111"}),
            ),
        ]);
        let (result, printed) = run(&root, &confirmed(&plan.digest), &transport);
        result.unwrap();
        assert!(printed.contains("https://www.pinterest.com/pin/987654321/"));
        assert!(printed.contains("sandbox: only you can see it"));
        let calls = transport.calls.borrow();
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[0].method, "GET");
        assert!(calls[0]
            .url
            .starts_with("https://api-sandbox.pinterest.com/v5/boards?"));
        let post = &calls[1];
        assert_eq!(
            (post.method, post.url.as_str()),
            ("POST", "https://api-sandbox.pinterest.com/v5/pins")
        );
        assert!(post
            .headers
            .contains(&("Authorization".into(), format!("Bearer {TOKEN}"))));
        let body = &post.body;
        assert_eq!(body["board_id"], "111");
        assert!(body.get("board_section_id").is_none());
        assert_eq!(body["title"], plan.title);
        assert_eq!(body["description"], plan.description);
        assert_eq!(body["alt_text"], "A slice of tart on a plate");
        assert_eq!(body["link"], "https://cook.example.org/posts/tart/");
        assert_eq!(body["media_source"]["source_type"], "image_base64");
        assert_eq!(body["media_source"]["content_type"], "image/png");
        let sent = STANDARD
            .decode(body["media_source"]["data"].as_str().unwrap())
            .unwrap();
        assert_eq!(sent, fs::read(root.join("static/img/pin.png")).unwrap());
        let keys: Vec<&String> = body.as_object().unwrap().keys().collect();
        assert_eq!(keys.len(), 6, "only the previewed fields: {keys:?}");
        drop(calls);
        let record = &state(&root).pins[&key(&plan)];
        assert_eq!(record.status, RecordStatus::Posted);
        assert_eq!(record.pin_id.as_deref(), Some("987654321"));
        assert_eq!(record.link_preserved, Some(true));
        let saved = fs::read_to_string(root.join(".openblog/pinterest.json")).unwrap();
        assert!(!saved.contains(TOKEN));

        // The same post is never pinned to the same board twice.
        let again = Scripted::new(vec![]);
        let (result, _) = run(&root, &confirmed(&plan.digest), &again);
        assert!(result.unwrap_err().contains("already pinned"));
        assert!(again.calls.borrow().is_empty());
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn a_board_the_token_cannot_use_is_refused_before_any_pin() {
        let root = site(ON);
        let plan = plan(&root);
        let transport = Scripted::new(vec![boards(&["222"])]);
        let (result, _) = run(&root, &confirmed(&plan.digest), &transport);
        let error = result.unwrap_err();
        assert!(error.contains("not one this token can pin to"), "{error}");
        assert_eq!(transport.calls.borrow().len(), 1);
        assert!(!root.join(".openblog/pinterest.json").exists());

        // A token without boards:read cannot list boards: no Pin either.
        let transport = Scripted::new(vec![reply(
            403,
            json!({"code": 3, "message": "secret detail"}),
        )]);
        let (result, _) = run(&root, &confirmed(&plan.digest), &transport);
        let error = result.unwrap_err();
        assert!(error.contains("boards:read") && !error.contains("secret detail"));
        assert_eq!(transport.calls.borrow().len(), 1);
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn a_production_pin_goes_to_the_production_host_with_its_section() {
        let root = site(
            r#"{"enabled":true,"environment":"production","board":"111","boardSection":"55"}"#,
        );
        let plan = plan(&root);
        assert_eq!(plan.visibility, "board-audience");
        let transport = Scripted::new(vec![
            boards(&["111"]),
            reply(201, json!({"id": "5", "link": plan.link})),
        ]);
        let (result, printed) = run(&root, &confirmed(&plan.digest), &transport);
        result.unwrap();
        assert!(!printed.contains("sandbox"));
        let calls = transport.calls.borrow();
        assert_eq!(calls[1].url, "https://api.pinterest.com/v5/pins");
        assert_eq!(calls[1].body["board_section_id"], "55");
        fs::remove_dir_all(root).ok();
    }

    /// The options a printed `openblog pinterest pin ...` command line stands for.
    pub(super) fn parse_command(command: &str) -> Options {
        let words: Vec<&str> = command.split_whitespace().collect();
        assert_eq!(&words[..4], ["openblog", "pinterest", "pin", "tart"]);
        let mut options = Options::default();
        let mut rest = words[4..].iter();
        while let Some(word) = rest.next() {
            let mut value = || Some(rest.next().expect("a value").to_string());
            match *word {
                "--board" => options.board = value(),
                "--section" => options.section = value(),
                "--confirm" => options.confirm = value(),
                "--write" => options.write = true,
                "--reconcile" => options.reconcile = true,
                "--forget-attempt" => options.forget_attempt = true,
                other => panic!("unexpected word {other}"),
            }
        }
        options
    }

    #[test]
    fn the_printed_send_command_rebuilds_the_previewed_pin_with_its_board_and_section() {
        // The config names neither the board nor a section: both come from the command line.
        let root = site(r#"{"enabled":true,"board":"","boardSection":"77"}"#);
        let preview = Options {
            board: Some("111".into()),
            section: Some("55".into()),
            ..Options::default()
        };
        let (result, printed) = run(&root, &preview, &Scripted::new(vec![]));
        result.unwrap();
        let command = printed
            .lines()
            .map(str::trim)
            .find(|line| line.starts_with("openblog pinterest pin"))
            .expect("a send command")
            .to_string();
        assert!(
            command.contains("--board 111 --section 55 --write --confirm"),
            "{command}"
        );
        let transport = Scripted::new(vec![boards(&["111"]), reply(201, json!({"id": "9"}))]);
        let (result, _) = run(&root, &parse_command(&command), &transport);
        result.unwrap();
        assert_eq!(transport.calls.borrow()[1].body["board_section_id"], "55");
        fs::remove_dir_all(root).ok();
    }
}

/// Failure reporting, unsettled attempts and source address preservation (task DIST3.2.3), run
/// against a scripted Pinterest.
#[cfg(test)]
mod failure_tests {
    use super::tests::{
        boards, confirmed, key, parse_command, plan as pin_plan, reply, run, site, state, Scripted,
        ON,
    };
    use super::*;
    use openblog_core::image_facts::samples;

    fn send(root: &Path, answer: Result<Response, String>) -> (Result<(), String>, String) {
        let plan = pin_plan(root);
        let transport = Scripted::new(vec![boards(&["111"]), answer]);
        run(root, &confirmed(&plan.digest), &transport)
    }

    #[test]
    fn every_reply_is_posted_not_posted_or_unknown_and_never_repeats_provider_text() {
        let body = |status| {
            reply(
                status,
                json!({"code": 9, "message": "PROVIDER-SECRET-TEXT"}),
            )
        };
        let cases: Vec<(Result<Response, String>, Outcome)> = vec![
            (
                reply(201, json!({"id": "12", "link": "x"})),
                Outcome::Posted {
                    id: "12".into(),
                    link: Some("x".into()),
                },
            ),
            (
                reply(201, json!({"id": "not-digits"})),
                Outcome::Unknown { code: "no-pin-id" },
            ),
            (
                Ok(Response {
                    status: 200,
                    body: b"<html>".to_vec(),
                }),
                Outcome::Unknown { code: "no-pin-id" },
            ),
            (body(400), Outcome::NotPosted { code: "rejected" }),
            (body(404), Outcome::NotPosted { code: "rejected" }),
            (
                body(401),
                Outcome::NotPosted {
                    code: "token-refused",
                },
            ),
            (
                body(403),
                Outcome::NotPosted {
                    code: "not-permitted",
                },
            ),
            (
                body(429),
                Outcome::NotPosted {
                    code: "rate-limited",
                },
            ),
            (
                body(500),
                Outcome::Unknown {
                    code: "provider-error",
                },
            ),
            (
                body(503),
                Outcome::Unknown {
                    code: "provider-error",
                },
            ),
            (
                Err("request timed out after 30 seconds".into()),
                Outcome::Unknown {
                    code: "no-response",
                },
            ),
        ];
        for (answer, expected) in cases {
            assert_eq!(classify(&answer), expected);
        }
        for status in [400, 401, 403, 429] {
            let root = site(ON);
            let (result, _) = send(&root, body(status));
            let error = result.unwrap_err();
            assert!(error.starts_with("Not pinned:"), "{status}: {error}");
            assert!(!error.contains("PROVIDER-SECRET-TEXT"));
            let record = &state(&root).pins[&key(&pin_plan(&root))];
            assert_eq!(record.status, RecordStatus::NotPosted);
            assert!(record.pin_id.is_none());
            let saved = fs::read_to_string(root.join(".openblog/pinterest.json")).unwrap();
            assert!(!saved.contains("PROVIDER-SECRET-TEXT"));
            // Certainly not posted: sending again is allowed and works.
            let (result, _) = send(
                &root,
                reply(201, json!({"id": "77", "link": pin_plan(&root).link})),
            );
            result.unwrap();
            assert_eq!(
                state(&root).pins[&key(&pin_plan(&root))].status,
                RecordStatus::Posted
            );
            fs::remove_dir_all(root).ok();
        }
        let root = site(ON);
        let (result, _) = send(&root, body(401));
        assert!(result.unwrap_err().contains("reconnect"));
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn the_attempt_is_recorded_before_the_request_so_a_crash_cannot_repeat_a_pin() {
        let root = site(ON);
        let plan = pin_plan(&root);
        let record_file = root.join(".openblog/pinterest.json");
        let mut transport = Scripted::new(vec![boards(&["111"]), Err("connection reset".into())]);
        let seen = record_file.clone();
        let wanted = key(&plan);
        transport.during_send = Some(Box::new(move |request: &Request| {
            if request.method == "POST" {
                let state = PinState::load(&seen).unwrap();
                assert_eq!(state.pins[&wanted].status, RecordStatus::Unknown);
            }
        }));
        let (result, _) = run(&root, &confirmed(&plan.digest), &transport);
        let error = result.unwrap_err();
        assert!(error.starts_with("Pin status unknown:"), "{error}");
        assert!(error.contains("--reconcile"));
        let record = &state(&root).pins[&key(&plan)];
        assert_eq!(record.status, RecordStatus::Unknown);
        assert_eq!(record.failure.as_deref(), Some("no-response"));
        assert_eq!(record.attempted_at, "2026-10-29T12:00:00Z");

        // An unsettled attempt is never sent again on its own.
        let again = Scripted::new(vec![]);
        let (result, _) = run(&root, &confirmed(&plan.digest), &again);
        assert!(result.unwrap_err().contains("may have created a Pin"));
        assert!(again.calls.borrow().is_empty());
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn an_unknown_attempt_names_the_exact_command_that_settles_it_on_its_board() {
        // The config names board 111; the attempt goes to 222 from the command line.
        let root = site(ON);
        let preview = Options {
            board: Some("222".into()),
            ..Options::default()
        };
        let (result, printed) = run(&root, &preview, &Scripted::new(vec![]));
        result.unwrap();
        let command = printed
            .lines()
            .map(str::trim)
            .find(|line| line.starts_with("openblog pinterest pin"))
            .unwrap()
            .to_string();
        let transport = Scripted::new(vec![boards(&["222"]), reply(502, json!({}))]);
        let (result, _) = run(&root, &parse_command(&command), &transport);
        let error = result.unwrap_err();
        let wanted = "`openblog pinterest pin tart --board 222 --reconcile`";
        assert!(error.contains(wanted), "{error}");

        // Sending again names the same command.
        let (result, _) = run(&root, &parse_command(&command), &Scripted::new(vec![]));
        assert!(result.unwrap_err().contains(wanted));

        // Reconciling against the configured board points at the real attempt.
        let (result, printed) = run(
            &root,
            &parse_command("openblog pinterest pin tart --reconcile"),
            &Scripted::new(vec![]),
        );
        result.unwrap();
        assert!(printed.contains("No attempt to pin this post to board 111"));
        assert!(
            printed.contains(&format!("board 222: run {wanted}")),
            "{printed}"
        );

        // Following the printed command reconciles the real attempt.
        let plan = pin_plan(&root);
        let found = Scripted::new(vec![reply(
            200,
            json!({"items": [{"id": "8", "link": plan.link, "created_at": "2026-10-29T12:00:01"}], "bookmark": null}),
        )]);
        let (result, _) = run(&root, &parse_command(wanted.trim_matches('`')), &found);
        result.unwrap();
        assert!(found.calls.borrow()[0].url.contains("/boards/222/pins?"));
        let record = &state(&root).pins[&format!("sandbox/222/{}", plan.source_path)];
        assert_eq!(record.status, RecordStatus::Posted);
        fs::remove_dir_all(root).ok();
    }

    fn unsettled(root: &Path) -> PinPlan {
        let (result, _) = send(root, reply(502, json!({})));
        assert!(result.unwrap_err().starts_with("Pin status unknown:"));
        pin_plan(root)
    }

    fn reconcile() -> Options {
        Options {
            reconcile: true,
            ..Options::default()
        }
    }

    #[test]
    fn reconcile_records_the_one_pin_that_links_the_post_since_the_attempt() {
        let root = site(ON);
        let plan = unsettled(&root);
        let transport = Scripted::new(vec![reply(
            200,
            json!({"items": [
                {"id": "1", "link": "https://cook.example.org/posts/other/", "created_at": "2026-10-29T12:00:05"},
                {"id": "2", "link": plan.link, "created_at": "2026-01-01T00:00:00"},
                {"id": "3", "link": plan.link, "created_at": "2026-10-29T12:00:04"}
            ], "bookmark": null}),
        )]);
        let (result, printed) = run(&root, &reconcile(), &transport);
        result.unwrap();
        assert!(printed.contains("https://www.pinterest.com/pin/3/"));
        let calls = transport.calls.borrow();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].method, "GET");
        assert!(calls[0]
            .url
            .starts_with("https://api-sandbox.pinterest.com/v5/boards/111/pins?"));
        let record = &state(&root).pins[&key(&plan)];
        assert_eq!(record.status, RecordStatus::Posted);
        assert_eq!(record.pin_id.as_deref(), Some("3"));
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn reconcile_never_decides_alone_that_nothing_was_posted() {
        let root = site(ON);
        let plan = unsettled(&root);
        // Nothing found: the attempt stays unsettled until the author says otherwise.
        let empty = Scripted::new(vec![reply(200, json!({"items": [], "bookmark": null}))]);
        let (result, _) = run(&root, &reconcile(), &empty);
        assert!(result.unwrap_err().contains("--forget-attempt"));
        assert_eq!(state(&root).pins[&key(&plan)].status, RecordStatus::Unknown);
        // Two candidates: still unsettled.
        let two = Scripted::new(vec![reply(
            200,
            json!({"items": [
                {"id": "4", "link": plan.link, "created_at": "2026-10-29T12:00:01"},
                {"id": "5", "link": plan.link, "created_at": "2026-10-29T12:00:02"}
            ], "bookmark": null}),
        )]);
        let (result, _) = run(&root, &reconcile(), &two);
        assert!(result.unwrap_err().contains("2 Pins"));
        // A failed read leaves it as it was.
        let failed = Scripted::new(vec![reply(500, json!({}))]);
        let (result, _) = run(&root, &reconcile(), &failed);
        assert!(result.unwrap_err().contains("stays unsettled"));
        assert_eq!(state(&root).pins[&key(&plan)].status, RecordStatus::Unknown);
        // The author checked the board: forgetting the attempt allows sending again.
        let forget = Options {
            forget_attempt: true,
            ..Options::default()
        };
        let none = Scripted::new(vec![]);
        let (result, printed) = run(&root, &forget, &none);
        result.unwrap();
        assert!(printed.contains("second one"));
        assert!(none.calls.borrow().is_empty());
        assert!(!state(&root).pins.contains_key(&key(&plan)));
        let (result, _) = send(&root, reply(201, json!({"id": "6", "link": plan.link})));
        result.unwrap();
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn the_pin_links_the_canonical_address_and_a_changed_link_is_reported() {
        let root = site(ON);
        let plan = pin_plan(&root);
        assert_eq!(plan.link, "https://cook.example.org/posts/tart/");
        let (result, printed) = send(
            &root,
            reply(
                201,
                json!({"id": "8", "link": "https://cook.example.org/posts/tart/?utm_source=pinterest"}),
            ),
        );
        result.unwrap();
        assert!(printed.contains("did not carry your post's address"));
        assert_eq!(state(&root).pins[&key(&plan)].link_preserved, Some(false));
        fs::remove_dir_all(root).ok();

        // The link is the canonical address cross-posting sends (ADR 0004): the post's page on
        // this site, whatever else the front matter says.
        let root = site(ON);
        fs::write(
            root.join("content/posts/tart.md"),
            super::tests::RECIPE.replace(
                "profile: recipe\n",
                "profile: recipe\ncanonicalUrl: https://kitchen.example.com/tart\n",
            ),
        )
        .unwrap();
        let canonical = pin_plan(&root).link;
        assert_eq!(canonical, "https://cook.example.org/posts/tart/");
        let transport = Scripted::new(vec![
            boards(&["111"]),
            reply(201, json!({"id": "9", "link": canonical})),
        ]);
        let (result, _) = run(&root, &confirmed(&pin_plan(&root).digest), &transport);
        result.unwrap();
        assert_eq!(transport.calls.borrow()[1].body["link"], canonical);
        fs::remove_dir_all(root).ok();

        // A site without a public address cannot be pinned.
        let root = site(ON);
        let config = fs::read_to_string(root.join("openblog.json"))
            .unwrap()
            .replace("https://cook.example.org", "http://localhost:3000");
        fs::write(root.join("openblog.json"), config).unwrap();
        let plan = pin_plan(&root);
        assert!(plan.problems.iter().any(|p| p.code == "link-not-public"));
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn a_credit_travels_in_the_description_and_unsafe_images_are_never_sent() {
        let root = site(ON);
        fs::write(
            root.join("content/posts/tart.md"),
            super::tests::RECIPE.replace(
                "cardTitle:",
                "cardImage: /img/pin.png\ncardImageAlt: A slice of tart\ncardImageCredit: Ana Ruiz\ncardTitle:",
            ),
        )
        .unwrap();
        let plan = pin_plan(&root);
        assert!(plan.ready, "{:?}", plan.problems);
        assert_eq!(plan.description, "Sharp and short.\n\nImage: Ana Ruiz");
        fs::remove_dir_all(root).ok();

        // A description that no longer fits with its credit is refused by the manifest.
        let root = site(ON);
        let long = "a".repeat(795);
        fs::write(
            root.join("content/posts/tart.md"),
            super::tests::RECIPE.replace(
                "cardTitle:",
                &format!("cardDescription: {long}\ncardImage: /img/pin.png\ncardImageAlt: A slice\ncardImageCredit: Ana Ruiz\ncardTitle:"),
            ),
        )
        .unwrap();
        let plan = pin_plan(&root);
        assert!(
            plan.problems.iter().any(|p| p.code == "text-too-long"),
            "{:?}",
            plan.problems
        );
        fs::remove_dir_all(root).ok();

        // A photograph that records where it was taken, or an image on another site, is not sent.
        for (file, post) in [
            (
                Some(samples::png(1000, 1500, true)),
                super::tests::RECIPE.to_string(),
            ),
            (
                None,
                super::tests::RECIPE.replace("/img/pin.png", "https://images.example.net/pin.png"),
            ),
        ] {
            let root = site(ON);
            if let Some(bytes) = file {
                fs::write(root.join("static/img/pin.png"), bytes).unwrap();
            }
            fs::write(root.join("content/posts/tart.md"), post).unwrap();
            let plan = pin_plan(&root);
            assert!(!plan.ready);
            let transport = Scripted::new(vec![]);
            let (result, _) = run(&root, &confirmed(&plan.digest), &transport);
            assert!(result.unwrap_err().contains(NOTHING_SENT));
            assert!(transport.calls.borrow().is_empty());
            fs::remove_dir_all(root).ok();
        }
    }

    #[test]
    fn an_empty_sandbox_says_how_to_make_a_sandbox_board_without_printing_the_token() {
        let now = || DateTime::from_unix(0);
        let token = || Some(super::tests::TOKEN.to_string());
        for (config, expect, absent) in [
            (
                ON,
                "curl -X POST https://api-sandbox.pinterest.com/v5/boards -H \"Authorization: Bearer $PINTEREST_ACCESS_TOKEN\"",
                "on pinterest.com first",
            ),
            (
                r#"{"enabled":true,"environment":"production","board":"111"}"#,
                "Create a board on pinterest.com first.",
                "curl",
            ),
        ] {
            let root = site(config);
            let transport = Scripted::new(vec![boards(&[])]);
            let context = Context {
                transport: &transport,
                now: &now,
                token: &token,
            };
            let mut out = Vec::new();
            run_boards_with(&root, false, &context, &mut out).unwrap();
            let printed = String::from_utf8(out).unwrap();
            assert!(printed.contains(expect), "{printed}");
            assert!(!printed.contains(absent), "{printed}");
            assert!(!printed.contains(super::tests::TOKEN));
            let calls = transport.calls.borrow();
            assert_eq!(calls.len(), 1, "only the board listing is sent");
            assert_eq!(calls[0].method, "GET");
            drop(calls);
            fs::remove_dir_all(root).ok();
        }
    }

    #[test]
    fn listing_boards_follows_pages_and_reports_a_refused_token() {
        let root = site(ON);
        let transport = Scripted::new(vec![
            reply(
                200,
                json!({"items": [{"id": "1", "name": "Bakes"}], "bookmark": "next-page"}),
            ),
            reply(
                200,
                json!({"items": [{"id": "2", "name": "Trips\nand more"}, {"id": "x", "name": "bad"}], "bookmark": null}),
            ),
        ]);
        let now = || DateTime::from_unix(0);
        let token = || Some(super::tests::TOKEN.to_string());
        let context = Context {
            transport: &transport,
            now: &now,
            token: &token,
        };
        let mut out = Vec::new();
        run_boards_with(&root, false, &context, &mut out).unwrap();
        let printed = String::from_utf8(out).unwrap();
        assert!(printed.contains("1  Bakes") && printed.contains("2  Trips and more"));
        assert!(!printed.contains("bad"));
        assert!(transport.calls.borrow()[1]
            .url
            .contains("bookmark=next-page"));

        let refused = Scripted::new(vec![reply(401, json!({"code": 2, "message": "x"}))]);
        let context = Context {
            transport: &refused,
            now: &now,
            token: &token,
        };
        let error = run_boards_with(&root, true, &context, &mut Vec::new()).unwrap_err();
        assert!(error.contains("reconnect"));

        let no_token = || None;
        let nothing = Scripted::new(vec![]);
        let context = Context {
            transport: &nothing,
            now: &now,
            token: &no_token,
        };
        let error = run_boards_with(&root, false, &context, &mut Vec::new()).unwrap_err();
        assert!(error.contains(TOKEN_VARIABLE));
        assert!(nothing.calls.borrow().is_empty());
        fs::remove_dir_all(root).ok();
    }
}
