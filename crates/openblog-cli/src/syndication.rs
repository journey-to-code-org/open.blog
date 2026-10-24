//! Safe, provider-neutral cross-posting from an open.blog source post.

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use base64::Engine;
use blake2::{Blake2b512, Digest};
use hmac::{Hmac, Mac};
use html5ever::tendril::TendrilSink;
use markup5ever_rcdom::{Handle, NodeData, RcDom};
use openblog_core::config::{SyndicationProvider, SyndicationTargetConfig};
use openblog_core::{project_post, Post, ProjectionFormat, SiteConfig};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value as Json};
use sha2::Sha256;
use ureq::config::Config;
use url::Url;

use crate::{fsutil, safe_http, site, url_context};

const MAX_RESPONSE_BYTES: u64 = 1_048_576;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const HASHNODE_ENDPOINT: &str = "https://gql-beta.hashnode.com";

#[derive(Clone, Debug)]
pub struct Options {
    pub target_names: Vec<String>,
    pub write: bool,
    pub publish: bool,
}

#[derive(Clone, Debug, PartialEq)]
struct SyndicationPost {
    source_id: String,
    source_path: String,
    slug: String,
    title: String,
    description: String,
    markdown: String,
    html: String,
    tags: Vec<String>,
    canonical_url: String,
    revision: String,
}

#[derive(Clone, Debug, PartialEq)]
struct Request {
    method: &'static str,
    url: String,
    headers: Vec<(String, String)>,
    body: Json,
}

#[derive(Clone, Debug)]
struct Response {
    status: u16,
    body: Vec<u8>,
}

trait Transport {
    fn send(&self, request: &Request) -> Result<Response, String>;
}

#[derive(Default)]
struct NetworkTransport {
    resolver: safe_http::PublicResolver,
}

impl Transport for NetworkTransport {
    fn send(&self, request: &Request) -> Result<Response, String> {
        let config = network_config();
        let agent = safe_http::public_agent(config, self.resolver.clone());
        let result = match request.method {
            "GET" => {
                let mut builder = agent.get(&request.url);
                for (name, value) in &request.headers {
                    builder = builder.header(name, value);
                }
                builder.call()
            }
            "POST" | "PUT" => {
                let mut builder = if request.method == "POST" {
                    agent.post(&request.url)
                } else {
                    agent.put(&request.url)
                };
                for (name, value) in &request.headers {
                    builder = builder.header(name, value);
                }
                builder.send(request.body.to_string())
            }
            _ => return Err("unsupported syndication HTTP method".into()),
        };
        let mut response = match result {
            Ok(response) => response,
            Err(ureq::Error::Timeout(_)) => return Err("request timed out after 30 seconds".into()),
            Err(_) => return Err("request failed before the provider returned a response".into()),
        };
        let status = response.status().as_u16();
        let body = response
            .body_mut()
            .with_config()
            .limit(MAX_RESPONSE_BYTES)
            .read_to_vec()
            .map_err(|_| "provider response exceeded 1 MiB or could not be read".to_string())?;
        Ok(Response { status, body })
    }
}

fn network_config() -> Config {
    Config::builder()
        .timeout_global(Some(REQUEST_TIMEOUT))
        .http_status_as_error(false)
        .max_redirects(0)
        .proxy(None)
        .user_agent(concat!("open.blog-syndication/", env!("CARGO_PKG_VERSION")))
        .build()
}

fn status_error(status: u16) -> String {
    match status {
        401 => "authentication failed; check the target's environment credential".into(),
        402 => "the provider requires billing or an eligible plan".into(),
        403 => {
            "the credential lacks permission or the provider plan does not allow publishing".into()
        }
        404 => "the configured publication, site, or stored remote item was not found".into(),
        409 => "the provider rejected the write because the remote item changed".into(),
        422 => "the provider rejected the post or target configuration".into(),
        429 => "the provider rate limit was reached; retry later".into(),
        500..=599 => "the provider is temporarily unavailable; retry later".into(),
        _ => format!("provider returned HTTP {status}"),
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct State {
    schema_version: u32,
    records: BTreeMap<String, BTreeMap<String, StateRecord>>,
}

impl Default for State {
    fn default() -> Self {
        Self {
            schema_version: 2,
            records: BTreeMap::new(),
        }
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct StateRecord {
    source_path: String,
    remote_id: String,
    remote_url: String,
    remote_revision: String,
    revision: String,
    publication_state: String,
    updated_at_unix: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyState {
    schema_version: u32,
    records: BTreeMap<String, LegacyStateRecord>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyStateRecord {
    source_id: String,
    source_path: String,
    target: String,
    remote_id: String,
    remote_url: String,
    #[serde(default)]
    remote_revision: String,
    revision: String,
    publication_state: String,
    updated_at_unix: u64,
}

impl State {
    fn load(path: &Path) -> Result<Self, String> {
        match fs::read_to_string(path) {
            Ok(json) => Self::from_json(&json)
                .map_err(|e| format!("invalid private syndication state {}: {e}", path.display())),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Self {
                schema_version: 2,
                records: BTreeMap::new(),
            }),
            Err(error) => Err(format!("cannot read {}: {error}", path.display())),
        }
    }

    fn save(&self, path: &Path) -> Result<(), String> {
        let bytes = serde_json::to_vec_pretty(self).map_err(|e| e.to_string())?;
        fsutil::write_file(path, &bytes)
    }

    fn from_json(json: &str) -> Result<Self, String> {
        let value: Json = serde_json::from_str(json).map_err(|error| error.to_string())?;
        match value["schemaVersion"].as_u64() {
            Some(2) => serde_json::from_value(value).map_err(|error| error.to_string()),
            Some(1) => {
                let legacy: LegacyState =
                    serde_json::from_value(value).map_err(|error| error.to_string())?;
                if legacy.schema_version != 1 {
                    return Err("unsupported syndication state schema".into());
                }
                let mut state = Self {
                    schema_version: 2,
                    records: BTreeMap::new(),
                };
                for record in legacy.records.into_values() {
                    state.insert(
                        &record.source_id,
                        &record.target,
                        StateRecord {
                            source_path: record.source_path,
                            remote_id: record.remote_id,
                            remote_url: record.remote_url,
                            remote_revision: record.remote_revision,
                            revision: record.revision,
                            publication_state: record.publication_state,
                            updated_at_unix: record.updated_at_unix,
                        },
                    );
                }
                Ok(state)
            }
            _ => Err("unsupported syndication state schema".into()),
        }
    }

    fn record(&self, source_id: &str, target: &str) -> Option<&StateRecord> {
        self.records.get(source_id)?.get(target)
    }

    fn insert(&mut self, source_id: &str, target: &str, record: StateRecord) {
        self.records
            .entry(source_id.to_string())
            .or_default()
            .insert(target.to_string(), record);
    }
}

pub fn run(root: &Path, slug: &str, options: Options) -> Result<(), String> {
    run_with_transport(root, slug, options, &NetworkTransport::default())
}

fn run_with_transport(
    root: &Path,
    slug: &str,
    options: Options,
    transport: &dyn Transport,
) -> Result<(), String> {
    let config = site::load_config(root)?;
    let (loaded, _) = site::load_site(root, false, Some(crate::clock::now()))?;
    let post = match loaded.posts.iter().find(|post| post.slug == slug) {
        Some(post) => post,
        None => return Err(unavailable_post_error(root, slug)?),
    };
    let syndication_post = syndication_post(post, &config)?;

    let selected = select_targets(&config, &options.target_names)?;
    let state_path = private_state_path(root, &config.syndication.state_file)?;
    let mut state = State::load(&state_path)?;
    validate_source_identity(&state, &syndication_post)?;
    validate_plan(&selected, options.publish)?;
    println!(
        "Syndication {} for `{}` ({})",
        if options.write { "write" } else { "dry run" },
        syndication_post.title,
        syndication_post.canonical_url
    );
    let mut canonical_verified = false;
    for (name, target) in selected {
        let adapter = match provider_adapter(target) {
            DestinationAdapter::Manual(adapter) => {
                println!("- {name}: {}", adapter.instruction(&syndication_post));
                continue;
            }
            DestinationAdapter::Remote(adapter) => adapter,
        };
        let existing = state.record(&syndication_post.source_id, name);
        let public = options.publish && target.allow_publish;
        let action = if existing.is_some() {
            "update"
        } else {
            "create"
        };
        println!(
            "- {name}: {action} {} via {}{}",
            if public { "public copy" } else { "draft" },
            adapter.name(),
            if options.write {
                ""
            } else {
                " (no request sent)"
            }
        );
        if let Some(warning) = adapter.warning() {
            println!("  warning: {warning}");
        }
        if !options.write {
            continue;
        }
        if !canonical_verified {
            verify_live_canonical(transport, &syndication_post.canonical_url)?;
            canonical_verified = true;
        }
        let credential = adapter.credential()?;
        let request = adapter.request(&syndication_post, existing, public, &credential)?;
        let outcome = execute(adapter.as_ref(), transport, &request)?;
        state.insert(
            &syndication_post.source_id,
            name,
            StateRecord {
                source_path: syndication_post.source_path.clone(),
                remote_id: outcome.id,
                remote_url: outcome.url,
                remote_revision: outcome.remote_revision,
                revision: syndication_post.revision.clone(),
                publication_state: if public { "published" } else { "draft" }.into(),
                updated_at_unix: SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs(),
            },
        );
        state.save(&state_path)?;
    }
    if !options.write {
        println!("No remote content or private state was changed. Re-run with --write after reviewing this plan.");
    }
    Ok(())
}

fn validate_plan(
    selected: &[(&String, &SyndicationTargetConfig)],
    publish: bool,
) -> Result<(), String> {
    for (name, target) in selected {
        let adapter = provider_adapter(target);
        adapter.validate()?;
        if publish && !target.allow_publish {
            return Err(format!(
                "target `{name}` does not permit publishing; set allowPublish to true as a second explicit opt-in"
            ));
        }
        if publish && !adapter.supports_public_write() {
            return Err(format!(
                "target `{name}` uses {}, whose adapter is draft-only; omit --publish and publish the saved draft in {}",
                adapter.name(), adapter.name()
            ));
        }
    }
    Ok(())
}

fn unavailable_post_error(root: &Path, slug: &str) -> Result<String, String> {
    let (preview, _) = site::load_site(root, true, None)?;
    if preview.posts.iter().any(|post| post.slug == slug) {
        Ok(format!(
            "post `{slug}` is not production-visible; publish the draft or wait for its scheduled date and deploy open.blog before syndicating"
        ))
    } else {
        Ok(format!("no post has slug `{slug}`"))
    }
}

fn validate_source_identity(state: &State, post: &SyndicationPost) -> Result<(), String> {
    if let Some(targets) = state.records.get(&post.source_id) {
        if let Some((target, record)) = targets
            .iter()
            .find(|(_, record)| record.source_path != post.source_path)
        {
            return Err(format!(
                "syndicationId `{}` is already used by `{}` for target `{target}`",
                post.source_id, record.source_path
            ));
        }
    }
    Ok(())
}

fn verify_live_canonical(transport: &dyn Transport, canonical_url: &str) -> Result<(), String> {
    let request = Request {
        method: "GET",
        url: canonical_url.to_string(),
        headers: vec![("Accept".into(), "text/html".into())],
        body: Json::Null,
    };
    let response = transport
        .send(&request)
        .map_err(|error| format!("canonical preflight failed: {error}"))?;
    if !(200..300).contains(&response.status) {
        return Err(format!(
            "canonical preflight failed: {} returned HTTP {}",
            canonical_url, response.status
        ));
    }
    let html = String::from_utf8_lossy(&response.body);
    let expected = Url::parse(canonical_url)
        .map_err(|_| "canonical preflight received an invalid source URL".to_string())?;
    let head = head_link_metadata(&html);
    let document_base = head
        .base_href
        .as_deref()
        .map(|href| expected.join(href))
        .transpose()
        .ok()
        .flatten()
        .unwrap_or_else(|| expected.clone());
    let matches = head.canonical_hrefs.into_iter().any(|href| {
        document_base
            .join(&href)
            .map(|mut actual| {
                actual.set_fragment(None);
                let mut expected = expected.clone();
                expected.set_fragment(None);
                actual == expected
            })
            .unwrap_or(false)
    });
    if !matches {
        return Err(format!(
            "canonical preflight failed: {canonical_url} is reachable but does not declare itself in a <link rel=\"canonical\">"
        ));
    }
    Ok(())
}

#[derive(Default)]
struct HeadLinkMetadata {
    base_href: Option<String>,
    canonical_hrefs: Vec<String>,
}

fn head_link_metadata(html: &str) -> HeadLinkMetadata {
    let dom = html5ever::parse_document(RcDom::default(), Default::default()).one(html);
    let mut metadata = HeadLinkMetadata::default();
    collect_head_link_metadata(&dom.document, false, &mut metadata);
    metadata
}

fn collect_head_link_metadata(node: &Handle, inside_head: bool, metadata: &mut HeadLinkMetadata) {
    let mut inside_head = inside_head;
    if let NodeData::Element { name, attrs, .. } = &node.data {
        inside_head = inside_head || name.local.as_ref().eq_ignore_ascii_case("head");
        if inside_head && name.local.as_ref().eq_ignore_ascii_case("base") {
            if metadata.base_href.is_none() {
                metadata.base_href = attrs
                    .borrow()
                    .iter()
                    .find(|attr| attr.name.local.as_ref().eq_ignore_ascii_case("href"))
                    .map(|attr| attr.value.to_string());
            }
        } else if inside_head && name.local.as_ref().eq_ignore_ascii_case("link") {
            let attrs = attrs.borrow();
            let rel = attrs
                .iter()
                .find(|attr| attr.name.local.as_ref().eq_ignore_ascii_case("rel"))
                .map(|attr| attr.value.as_ref());
            if rel.is_some_and(|value| {
                value
                    .split_ascii_whitespace()
                    .any(|token| token.eq_ignore_ascii_case("canonical"))
            }) {
                if let Some(href) = attrs
                    .iter()
                    .find(|attr| attr.name.local.as_ref().eq_ignore_ascii_case("href"))
                {
                    metadata.canonical_hrefs.push(href.value.to_string());
                }
            }
        }
    }
    for child in node.children.borrow().iter() {
        collect_head_link_metadata(child, inside_head, metadata);
    }
}

fn select_targets<'a>(
    config: &'a SiteConfig,
    names: &[String],
) -> Result<Vec<(&'a String, &'a SyndicationTargetConfig)>, String> {
    if config.syndication.targets.is_empty() {
        return Err("no syndication targets are configured in openblog.json".into());
    }
    let mut selected = Vec::new();
    for (name, target) in &config.syndication.targets {
        if (!names.is_empty() && !names.iter().any(|wanted| wanted == name)) || !target.enabled {
            continue;
        }
        selected.push((name, target));
    }
    for name in names {
        if !config.syndication.targets.contains_key(name) {
            return Err(format!("unknown syndication target `{name}`"));
        }
    }
    if selected.is_empty() {
        return Err("no enabled syndication targets were selected".into());
    }
    Ok(selected)
}

fn private_state_path(root: &Path, configured: &str) -> Result<std::path::PathBuf, String> {
    let relative = Path::new(configured);
    if relative.is_absolute()
        || relative
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err("syndication.stateFile must be a project-relative path without `..`".into());
    }
    Ok(root.join(relative))
}

fn syndication_post(post: &Post, config: &SiteConfig) -> Result<SyndicationPost, String> {
    let source_id = post
        .syndication_id
        .clone()
        .unwrap_or_else(|| format!("source:{}", post.source.replace('\\', "/")));
    let projection = project_post(post, config)?;
    let canonical_url = projection.publication_url.clone();
    let canonical = url_context::validate_public_url(&canonical_url)
        .map_err(|error| format!("canonical URL is not public: {error}"))?;
    if canonical.scheme() != "https" {
        return Err("canonical URL must use HTTPS before syndication".into());
    }
    if canonical
        .host_str()
        .is_some_and(|host| host == "example.com" || host.ends_with(".example.com"))
    {
        return Err("set the site's real public URL before syndication".into());
    }
    let markdown = projection
        .representation(ProjectionFormat::Markdown)
        .body
        .clone();
    let mut hasher = Blake2b512::new();
    hasher.update(post.title.as_bytes());
    hasher.update(markdown.as_bytes());
    hasher.update(canonical_url.as_bytes());
    let revision = hasher
        .finalize()
        .iter()
        .take(20)
        .map(|byte| format!("{byte:02x}"))
        .collect();
    Ok(SyndicationPost {
        source_id,
        source_path: post.source.clone(),
        slug: post.slug.clone(),
        title: post.title.clone(),
        description: post.description.clone(),
        markdown,
        html: projection
            .representation(ProjectionFormat::Html)
            .body
            .clone(),
        tags: post.tags.iter().map(|tag| tag.name.clone()).collect(),
        canonical_url,
        revision,
    })
}

trait ProviderAdapter {
    fn name(&self) -> &'static str;
    fn validate(&self) -> Result<(), String>;
    fn credential(&self) -> Result<String, String>;
    fn request(
        &self,
        post: &SyndicationPost,
        existing: Option<&StateRecord>,
        publish: bool,
        credential: &str,
    ) -> Result<Request, String>;
    fn outcome(&self, body: &Json) -> Result<Outcome, String>;
    fn supports_public_write(&self) -> bool {
        true
    }
    fn warning(&self) -> Option<&'static str> {
        None
    }
}

struct DevAdapter;
struct HashnodeAdapter<'a> {
    publication_id: &'a str,
}
struct GhostAdapter<'a> {
    endpoint: &'a str,
}
struct WordpressAdapter<'a> {
    endpoint: &'a str,
    publication_id: &'a str,
}
struct MediumAdapter;

enum DestinationAdapter<'a> {
    Remote(Box<dyn ProviderAdapter + 'a>),
    Manual(MediumAdapter),
}

impl DestinationAdapter<'_> {
    fn name(&self) -> &'static str {
        match self {
            Self::Remote(adapter) => adapter.name(),
            Self::Manual(_) => "Medium",
        }
    }

    fn validate(&self) -> Result<(), String> {
        match self {
            Self::Remote(adapter) => adapter.validate(),
            Self::Manual(_) => Ok(()),
        }
    }

    fn supports_public_write(&self) -> bool {
        match self {
            Self::Remote(adapter) => adapter.supports_public_write(),
            Self::Manual(_) => true,
        }
    }
}

fn provider_adapter(target: &SyndicationTargetConfig) -> DestinationAdapter<'_> {
    match target.provider {
        SyndicationProvider::Dev => DestinationAdapter::Remote(Box::new(DevAdapter)),
        SyndicationProvider::Hashnode => DestinationAdapter::Remote(Box::new(HashnodeAdapter {
            publication_id: &target.publication_id,
        })),
        SyndicationProvider::Ghost => DestinationAdapter::Remote(Box::new(GhostAdapter {
            endpoint: &target.endpoint,
        })),
        SyndicationProvider::Wordpress => DestinationAdapter::Remote(Box::new(WordpressAdapter {
            endpoint: &target.endpoint,
            publication_id: &target.publication_id,
        })),
        SyndicationProvider::Medium => DestinationAdapter::Manual(MediumAdapter),
    }
}

fn environment_credential(variable: &str, provider: &str) -> Result<String, String> {
    std::env::var(variable)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| format!("{provider} requires {variable} in the server environment"))
}

impl ProviderAdapter for DevAdapter {
    fn name(&self) -> &'static str {
        "DEV"
    }
    fn validate(&self) -> Result<(), String> {
        Ok(())
    }
    fn credential(&self) -> Result<String, String> {
        environment_credential("DEVTO_API_KEY", self.name())
    }
    fn request(
        &self,
        post: &SyndicationPost,
        existing: Option<&StateRecord>,
        publish: bool,
        credential: &str,
    ) -> Result<Request, String> {
        dev_request(post, existing, publish, credential)
    }
    fn outcome(&self, body: &Json) -> Result<Outcome, String> {
        outcome_from_fields(self.name(), &body["id"], &body["url"], "")
    }
}

impl ProviderAdapter for HashnodeAdapter<'_> {
    fn name(&self) -> &'static str {
        "Hashnode"
    }
    fn validate(&self) -> Result<(), String> {
        if self.publication_id.trim().is_empty() {
            Err("Hashnode target requires publicationId (and an eligible Pro publication)".into())
        } else {
            Ok(())
        }
    }
    fn credential(&self) -> Result<String, String> {
        environment_credential("HASHNODE_PAT", self.name())
    }
    fn request(
        &self,
        post: &SyndicationPost,
        existing: Option<&StateRecord>,
        publish: bool,
        credential: &str,
    ) -> Result<Request, String> {
        hashnode_request(self.publication_id, post, existing, publish, credential)
    }
    fn outcome(&self, body: &Json) -> Result<Outcome, String> {
        if let Some(message) = body["errors"][0]["message"].as_str() {
            return Err(format!("Hashnode rejected the request: {message}"));
        }
        let draft = if body["data"]["createDraft"]["draft"].is_object() {
            &body["data"]["createDraft"]["draft"]
        } else {
            &body["data"]["updateDraft"]["draft"]
        };
        outcome_from_fields(self.name(), &draft["id"], &draft["slug"], "")
    }
    fn supports_public_write(&self) -> bool {
        false
    }
}

impl ProviderAdapter for GhostAdapter<'_> {
    fn name(&self) -> &'static str {
        "Ghost"
    }
    fn validate(&self) -> Result<(), String> {
        validated_endpoint(self.endpoint, "Ghost endpoint").map(|_| ())
    }
    fn credential(&self) -> Result<String, String> {
        environment_credential("GHOST_ADMIN_API_KEY", self.name())
    }
    fn request(
        &self,
        post: &SyndicationPost,
        existing: Option<&StateRecord>,
        publish: bool,
        credential: &str,
    ) -> Result<Request, String> {
        ghost_request(self.endpoint, post, existing, publish, credential)
    }
    fn outcome(&self, body: &Json) -> Result<Outcome, String> {
        outcome_from_fields(
            self.name(),
            &body["posts"][0]["id"],
            &body["posts"][0]["url"],
            body["posts"][0]["updated_at"].as_str().unwrap_or_default(),
        )
    }
}

impl ProviderAdapter for WordpressAdapter<'_> {
    fn name(&self) -> &'static str {
        "WordPress"
    }
    fn validate(&self) -> Result<(), String> {
        if self.publication_id.trim().is_empty() {
            validated_endpoint(self.endpoint, "WordPress endpoint").map(|_| ())
        } else {
            Ok(())
        }
    }
    fn credential(&self) -> Result<String, String> {
        if self.publication_id.trim().is_empty() {
            let username = std::env::var("WORDPRESS_USERNAME").unwrap_or_default();
            let password = std::env::var("WORDPRESS_APPLICATION_PASSWORD").unwrap_or_default();
            if username.trim().is_empty() || password.trim().is_empty() {
                return Err("self-hosted WordPress requires WORDPRESS_USERNAME and WORDPRESS_APPLICATION_PASSWORD".into());
            }
            Ok(format!(
                "Basic {}",
                STANDARD.encode(format!("{username}:{password}"))
            ))
        } else {
            environment_credential("WORDPRESS_ACCESS_TOKEN", self.name())
        }
    }
    fn request(
        &self,
        post: &SyndicationPost,
        existing: Option<&StateRecord>,
        publish: bool,
        credential: &str,
    ) -> Result<Request, String> {
        wordpress_request(
            self.endpoint,
            self.publication_id,
            post,
            existing,
            publish,
            credential,
        )
    }
    fn outcome(&self, body: &Json) -> Result<Outcome, String> {
        outcome_from_fields(self.name(), &body["id"], &body["link"], "")
    }
    fn warning(&self) -> Option<&'static str> {
        Some("core WordPress cannot set an external canonical URL; verify your SEO plugin or use WordPress as the original publisher")
    }
}

impl MediumAdapter {
    fn instruction(&self, post: &SyndicationPost) -> String {
        format!(
            "manual import only — open Medium's Import a story and paste {}",
            post.canonical_url
        )
    }
}

fn common_headers(authorization: (&str, String)) -> Vec<(String, String)> {
    vec![
        ("Content-Type".into(), "application/json".into()),
        (authorization.0.into(), authorization.1),
    ]
}

fn dev_request(
    post: &SyndicationPost,
    existing: Option<&StateRecord>,
    publish: bool,
    credential: &str,
) -> Result<Request, String> {
    let (method, url) = match existing {
        Some(record) if !record.remote_id.is_empty() => (
            "PUT",
            format!("https://dev.to/api/articles/{}", record.remote_id),
        ),
        _ => ("POST", "https://dev.to/api/articles".into()),
    };
    let mut headers = common_headers(("api-key", credential.into()));
    headers.push(("Accept".into(), "application/vnd.forem.api-v1+json".into()));
    Ok(Request {
        method,
        url,
        headers,
        body: json!({"article": {
            "title": post.title,
            "body_markdown": post.markdown,
            "published": publish,
            "canonical_url": post.canonical_url,
            "description": post.description,
            "tags": post.tags.iter().take(4).cloned().collect::<Vec<_>>().join(",")
        }}),
    })
}

fn hashnode_request(
    publication_id: &str,
    post: &SyndicationPost,
    existing: Option<&StateRecord>,
    publish: bool,
    credential: &str,
) -> Result<Request, String> {
    if publication_id.trim().is_empty() {
        return Err(
            "Hashnode target requires publicationId (and an eligible Pro publication)".into(),
        );
    }
    let tags: Vec<Json> = post
        .tags
        .iter()
        .take(15)
        .map(|name| json!({"name": name, "slug": slug(name)}))
        .collect();
    let input = json!({
        "title": post.title, "subtitle": post.description, "slug": post.slug,
        "contentMarkdown": post.markdown, "canonicalUrl": post.canonical_url, "tags": tags
    });
    let (query, variables) = if let Some(record) = existing {
        ("mutation Update($input: UpdateDraftInput!) { updateDraft(input: $input) { draft { id slug } } }",
         json!({"input": merge_object(input, json!({"draftId": record.remote_id}))}))
    } else {
        ("mutation Create($input: CreateDraftInput!) { createDraft(input: $input) { draft { id slug } } }",
         json!({"input": merge_object(input, json!({"publicationId": publication_id}))}))
    };
    // Hashnode requires a separate publishDraft mutation. A first stable iteration
    // deliberately keeps this adapter draft-only rather than risking a second write.
    if publish {
        return Err("Hashnode public publishing is not yet automated; create/update a draft and publish it in Hashnode".into());
    }
    Ok(Request {
        method: "POST",
        url: HASHNODE_ENDPOINT.into(),
        headers: common_headers(("Authorization", format!("Bearer {credential}"))),
        body: json!({"query": query, "variables": variables}),
    })
}

fn merge_object(mut left: Json, right: Json) -> Json {
    if let (Some(left), Some(right)) = (left.as_object_mut(), right.as_object()) {
        left.extend(right.clone());
    }
    left
}

fn ghost_request(
    endpoint: &str,
    post: &SyndicationPost,
    existing: Option<&StateRecord>,
    publish: bool,
    credential: &str,
) -> Result<Request, String> {
    let base = validated_endpoint(endpoint, "Ghost endpoint")?;
    let token = ghost_token(credential)?;
    let url = match existing {
        Some(record) if !record.remote_id.is_empty() => format!(
            "{}/ghost/api/admin/posts/{}/?source=html",
            base.trim_end_matches('/'),
            record.remote_id
        ),
        _ => format!(
            "{}/ghost/api/admin/posts/?source=html",
            base.trim_end_matches('/')
        ),
    };
    let mut payload = json!({"title": post.title, "slug": post.slug, "html": post.html, "custom_excerpt": post.description, "canonical_url": post.canonical_url, "status": if publish {"published"} else {"draft"}});
    if let Some(record) = existing {
        if record.remote_revision.is_empty() {
            return Err("saved Ghost state has no updated_at revision; create a fresh draft state before updating".into());
        }
        payload["updated_at"] = Json::String(record.remote_revision.clone());
    }
    Ok(Request {
        method: if existing.is_some() { "PUT" } else { "POST" },
        url,
        headers: common_headers(("Authorization", format!("Ghost {token}"))),
        body: json!({"posts": [payload]}),
    })
}

fn ghost_token(key: &str) -> Result<String, String> {
    let (id, secret) = key
        .split_once(':')
        .ok_or("GHOST_ADMIN_API_KEY must have id:hex-secret form")?;
    let secret = decode_hex(secret).ok_or("GHOST_ADMIN_API_KEY has an invalid hex secret")?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let header = URL_SAFE_NO_PAD.encode(json!({"alg":"HS256","typ":"JWT","kid":id}).to_string());
    let claims =
        URL_SAFE_NO_PAD.encode(json!({"iat":now,"exp":now + 300,"aud":"/admin/"}).to_string());
    let unsigned = format!("{header}.{claims}");
    let mut mac = Hmac::<Sha256>::new_from_slice(&secret).map_err(|_| "invalid Ghost key")?;
    mac.update(unsigned.as_bytes());
    Ok(format!(
        "{unsigned}.{}",
        URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes())
    ))
}

fn decode_hex(value: &str) -> Option<Vec<u8>> {
    if !value.len().is_multiple_of(2) {
        return None;
    }
    (0..value.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&value[i..i + 2], 16).ok())
        .collect()
}

fn wordpress_request(
    endpoint: &str,
    publication_id: &str,
    post: &SyndicationPost,
    existing: Option<&StateRecord>,
    publish: bool,
    credential: &str,
) -> Result<Request, String> {
    let base = if publication_id.trim().is_empty() {
        validated_endpoint(endpoint, "WordPress endpoint")?
    } else {
        format!(
            "https://public-api.wordpress.com/wp/v2/sites/{}",
            publication_id.trim()
        )
    };
    let suffix = existing
        .filter(|record| !record.remote_id.is_empty())
        .map(|record| format!("/posts/{}", record.remote_id))
        .unwrap_or_else(|| "/posts".into());
    Ok(Request {
        method: "POST",
        url: format!("{}{suffix}", base.trim_end_matches('/')),
        headers: common_headers((
            "Authorization",
            if credential.starts_with("Basic ") {
                credential.to_string()
            } else {
                format!("Bearer {credential}")
            },
        )),
        body: json!({"title": post.title, "content": post.html, "excerpt": post.description, "slug": post.slug, "status": if publish {"publish"} else {"draft"}}),
    })
}

fn validated_endpoint(value: &str, label: &str) -> Result<String, String> {
    let url = Url::parse(value).map_err(|_| format!("{label} must be a complete HTTPS URL"))?;
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(format!(
            "{label} must be HTTPS without credentials, query, or fragment"
        ));
    }
    Ok(value.trim_end_matches('/').to_string())
}

fn slug(value: &str) -> String {
    openblog_core::slug::slugify(value)
}

struct Outcome {
    id: String,
    url: String,
    remote_revision: String,
}

fn execute(
    adapter: &dyn ProviderAdapter,
    transport: &dyn Transport,
    request: &Request,
) -> Result<Outcome, String> {
    let response = transport.send(request)?;
    if !(200..300).contains(&response.status) {
        return Err(status_error(response.status));
    }
    let body: Json = serde_json::from_slice(&response.body)
        .map_err(|_| format!("{} returned invalid JSON", adapter.name()))?;
    adapter.outcome(&body)
}

fn outcome_from_fields(
    provider: &str,
    id: &Json,
    url: &Json,
    remote_revision: &str,
) -> Result<Outcome, String> {
    let id = id
        .as_str()
        .map(str::to_string)
        .or_else(|| id.as_u64().map(|id| id.to_string()))
        .ok_or_else(|| format!("{provider} response did not contain a remote ID"))?;
    Ok(Outcome {
        id,
        url: url.as_str().unwrap_or_default().to_string(),
        remote_revision: remote_revision.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn post_fixture() -> SyndicationPost {
        SyndicationPost {
            source_id: "post-1".into(),
            source_path: "posts/a.md".into(),
            slug: "a".into(),
            title: "A".into(),
            description: "D".into(),
            markdown: "Body".into(),
            html: "<p>Body</p>".into(),
            tags: vec!["Rust".into()],
            canonical_url: "https://blog.example/posts/a/".into(),
            revision: "abc".into(),
        }
    }

    #[test]
    fn dev_create_is_a_draft_with_canonical_and_update_uses_remote_id() {
        let post = post_fixture();
        let create = dev_request(&post, None, false, "secret").unwrap();
        assert_eq!(create.method, "POST");
        assert_eq!(create.body["article"]["published"], false);
        assert_eq!(create.body["article"]["canonical_url"], post.canonical_url);
        let state = StateRecord {
            remote_id: "42".into(),
            ..Default::default()
        };
        let update = dev_request(&post, Some(&state), false, "secret").unwrap();
        assert_eq!(update.method, "PUT");
        assert!(update.url.ends_with("/42"));
    }

    #[test]
    fn wordpress_and_ghost_default_to_drafts() {
        let post = post_fixture();
        assert_eq!(
            wordpress_request(
                "https://wp.example/wp-json/wp/v2",
                "",
                &post,
                None,
                false,
                "x",
            )
            .unwrap()
            .body["status"],
            "draft"
        );
        let request = ghost_request(
            "https://ghost.example",
            &post,
            None,
            false,
            "abc:00112233445566778899aabbccddeeff",
        )
        .unwrap();
        assert_eq!(request.body["posts"][0]["status"], "draft");
        assert_eq!(
            request.body["posts"][0]["canonical_url"],
            post.canonical_url
        );
        let state = StateRecord {
            remote_id: "post-id".into(),
            remote_revision: "2026-10-24T12:00:00.000Z".into(),
            ..Default::default()
        };
        let update = ghost_request(
            "https://ghost.example",
            &post,
            Some(&state),
            false,
            "abc:00112233445566778899aabbccddeeff",
        )
        .unwrap();
        assert_eq!(update.method, "PUT");
        assert_eq!(update.body["posts"][0]["updated_at"], state.remote_revision);
    }

    #[test]
    fn hashnode_request_is_draft_only_and_updates_by_saved_id() {
        let post = post_fixture();
        let create = hashnode_request("pub-id", &post, None, false, "pat").unwrap();
        assert!(create.body["query"]
            .as_str()
            .unwrap()
            .contains("createDraft"));
        assert_eq!(create.body["variables"]["input"]["publicationId"], "pub-id");
        let state = StateRecord {
            remote_id: "draft-id".into(),
            ..Default::default()
        };
        let update = hashnode_request("pub-id", &post, Some(&state), false, "pat").unwrap();
        assert!(update.body["query"]
            .as_str()
            .unwrap()
            .contains("updateDraft"));
        assert_eq!(update.body["variables"]["input"]["draftId"], "draft-id");
        assert!(hashnode_request("pub-id", &post, None, true, "pat").is_err());
    }

    #[test]
    fn state_uses_nested_source_and_target_identities_without_delimiter_collisions() {
        let mut state = State::default();
        state.insert("a\nb", "c", StateRecord::default());
        state.insert("a", "b\nc", StateRecord::default());
        assert!(state.record("a\nb", "c").is_some());
        assert!(state.record("a", "b\nc").is_some());
        assert_eq!(state.records.len(), 2);
    }

    #[test]
    fn version_one_state_migrates_to_nested_version_two_records() {
        let state = State::from_json(
            r#"{"schemaVersion":1,"records":{"opaque legacy key":{"sourceId":"post-1","sourcePath":"posts/a.md","target":"dev","remoteId":"42","remoteUrl":"https://dev.to/a","revision":"abc","publicationState":"draft","updatedAtUnix":1}}}"#,
        )
        .unwrap();
        assert_eq!(state.schema_version, 2);
        assert_eq!(state.record("post-1", "dev").unwrap().remote_id, "42");
    }

    #[test]
    fn source_identity_collision_is_rejected_across_different_targets() {
        let post = post_fixture();
        let mut state = State::default();
        state.insert(
            &post.source_id,
            "old-target",
            StateRecord {
                source_path: "posts/a-renamed.md".into(),
                ..Default::default()
            },
        );
        let error = validate_source_identity(&state, &post).unwrap_err();
        assert!(error.contains("old-target"));
        assert!(error.contains("posts/a-renamed.md"));
    }

    #[test]
    fn hashnode_public_intent_fails_during_planning() {
        let name = "hashnode".to_string();
        let target = SyndicationTargetConfig {
            provider: SyndicationProvider::Hashnode,
            allow_publish: true,
            publication_id: "pub-id".into(),
            ..Default::default()
        };
        let error = validate_plan(&[(&name, &target)], true).unwrap_err();
        assert!(error.contains("draft-only"));
    }

    #[test]
    fn endpoints_reject_insecure_or_credentialed_urls() {
        assert!(validated_endpoint("http://ghost.example", "endpoint").is_err());
        assert!(validated_endpoint("https://a:b@ghost.example", "endpoint").is_err());
        assert!(validated_endpoint("https://ghost.example", "endpoint").is_ok());
    }

    struct FakeTransport(Response);
    impl Transport for FakeTransport {
        fn send(&self, _: &Request) -> Result<Response, String> {
            Ok(self.0.clone())
        }
    }

    #[test]
    fn response_parsing_uses_provider_remote_id() {
        let response = Response {
            status: 201,
            body: br#"{"id":42,"url":"https://dev.to/me/a"}"#.to_vec(),
        };
        let request = dev_request(&post_fixture(), None, false, "x").unwrap();
        let outcome = execute(&DevAdapter, &FakeTransport(response), &request).unwrap();
        assert_eq!(outcome.id, "42");
    }

    #[test]
    fn canonical_preflight_requires_a_matching_page_canonical() {
        let valid = Response {
            status: 200,
            body: br#"<html><head>
              <!-- <link rel="canonical" href="https://wrong.example/"> -->
              <script>"<link rel='canonical' href='https://wrong.example/'>"</script>
              <link href="/posts/a/" rel="alternate canonical">
              </head><body><link rel="canonical" href="https://wrong.example/"></body></html>"#
                .to_vec(),
        };
        verify_live_canonical(&FakeTransport(valid), "https://blog.example/posts/a/").unwrap();

        let wrong = Response {
            status: 200,
            body: br#"<link rel='canonical' href='https://other.example/a'>"#.to_vec(),
        };
        let error = verify_live_canonical(&FakeTransport(wrong), "https://blog.example/posts/a/")
            .unwrap_err();
        assert!(error.contains("does not declare itself"));

        let decoys = Response {
            status: 200,
            body: br#"<html><head><!-- <link rel='canonical' href='/posts/a/'> --><script>const fake = '<link rel="canonical" href="/posts/a/">';</script></head><body><link rel='canonical' href='/posts/a/'></body></html>"#.to_vec(),
        };
        assert!(
            verify_live_canonical(&FakeTransport(decoys), "https://blog.example/posts/a/").is_err()
        );

        let foreign_base = Response {
            status: 200,
            body: br#"<head><base href="https://other.example/"><link rel="canonical" href="/posts/a/"></head>"#.to_vec(),
        };
        assert!(verify_live_canonical(
            &FakeTransport(foreign_base),
            "https://blog.example/posts/a/"
        )
        .is_err());
    }

    #[test]
    fn canonical_transport_rejects_dns_that_resolves_to_non_public_addresses() {
        assert!(network_config().proxy().is_none());
        for address in ["127.0.0.1:443", "203.0.113.10:443"] {
            let transport = NetworkTransport {
                resolver: safe_http::PublicResolver::mapped_for_policy_test(
                    "canonical-policy.test",
                    address.parse().unwrap(),
                ),
            };
            let error = verify_live_canonical(&transport, "https://canonical-policy.test/posts/a/")
                .unwrap_err();
            assert!(error.contains("could not be retrieved") || error.contains("request failed"));
        }
    }

    #[test]
    fn draft_and_scheduled_sources_are_rejected_before_syndication() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("openblog-syndication-draft-{unique}"));
        fs::create_dir_all(root.join("content/posts")).unwrap();
        fs::write(
            root.join("openblog.json"),
            r#"{
              "url":"https://blog.openblog.dev",
              "syndication":{"targets":{"medium":{"provider":"medium"}}}
            }"#,
        )
        .unwrap();
        fs::write(
            root.join("content/posts/post.md"),
            "---\ntitle: Post\nslug: post\ndate: 2020-01-01\ndraft: true\n---\n\nBody\n",
        )
        .unwrap();
        fs::write(
            root.join("content/posts/scheduled.md"),
            "---\ntitle: Scheduled\nslug: scheduled\ndate: 2999-01-01\n---\n\nBody\n",
        )
        .unwrap();
        for slug in ["post", "scheduled"] {
            let error = run(
                &root,
                slug,
                Options {
                    target_names: Vec::new(),
                    write: false,
                    publish: false,
                },
            )
            .unwrap_err();
            assert!(error.contains("not production-visible"));
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn dry_run_is_secretless_and_does_not_create_private_state() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("openblog-syndication-{unique}"));
        fs::create_dir_all(root.join("content/posts")).unwrap();
        fs::write(
            root.join("openblog.json"),
            r#"{
              "url":"https://blog.openblog.dev",
              "syndication":{"targets":{"medium":{"provider":"medium"}}}
            }"#,
        )
        .unwrap();
        fs::write(
            root.join("content/posts/post.md"),
            "---\ntitle: Post\nslug: post\ndate: 2020-01-01\nsyndicationId: durable-post\n---\n\nBody\n",
        )
        .unwrap();
        run(
            &root,
            "post",
            Options {
                target_names: Vec::new(),
                write: false,
                publish: false,
            },
        )
        .unwrap();
        assert!(!root.join(".openblog/syndication.json").exists());
        fs::remove_dir_all(root).unwrap();
    }
}
