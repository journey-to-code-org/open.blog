//! Safe, provider-neutral cross-posting from an open.blog source post.

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use base64::Engine;
use blake2::{Blake2b512, Digest};
use hmac::{Hmac, Mac};
use openblog_core::config::{SyndicationProvider, SyndicationTargetConfig};
use openblog_core::frontmatter;
use openblog_core::{Post, SiteConfig};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value as Json};
use sha2::Sha256;
use url::Url;

use crate::{fsutil, site, url_context};

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
struct Article {
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

struct NetworkTransport;

impl Transport for NetworkTransport {
    fn send(&self, request: &Request) -> Result<Response, String> {
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .timeout_global(Some(REQUEST_TIMEOUT))
            .user_agent(concat!("open.blog-syndication/", env!("CARGO_PKG_VERSION")))
            .build()
            .into();
        let mut builder = match request.method {
            "POST" => agent.post(&request.url),
            "PUT" => agent.put(&request.url),
            _ => return Err("unsupported syndication HTTP method".into()),
        };
        for (name, value) in &request.headers {
            builder = builder.header(name, value);
        }
        let mut response = match builder.send(request.body.to_string()) {
            Ok(response) => response,
            Err(ureq::Error::StatusCode(status)) => {
                return Err(status_error(status));
            }
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

fn status_error(status: u16) -> String {
    match status {
        401 => "authentication failed; check the target's environment credential".into(),
        402 => "the provider requires billing or an eligible plan".into(),
        403 => {
            "the credential lacks permission or the provider plan does not allow publishing".into()
        }
        404 => "the configured publication, site, or stored remote item was not found".into(),
        409 => "the provider rejected the write because the remote item changed".into(),
        422 => "the provider rejected the article or target configuration".into(),
        429 => "the provider rate limit was reached; retry later".into(),
        500..=599 => "the provider is temporarily unavailable; retry later".into(),
        _ => format!("provider returned HTTP {status}"),
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct State {
    schema_version: u32,
    records: BTreeMap<String, StateRecord>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct StateRecord {
    source_id: String,
    source_path: String,
    target: String,
    remote_id: String,
    remote_url: String,
    remote_revision: String,
    revision: String,
    publication_state: String,
    updated_at_unix: u64,
}

impl State {
    fn load(path: &Path) -> Result<Self, String> {
        match fs::read_to_string(path) {
            Ok(json) => serde_json::from_str(&json)
                .map_err(|e| format!("invalid private syndication state {}: {e}", path.display())),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Self {
                schema_version: 1,
                records: BTreeMap::new(),
            }),
            Err(error) => Err(format!("cannot read {}: {error}", path.display())),
        }
    }

    fn save(&self, path: &Path) -> Result<(), String> {
        let bytes = serde_json::to_vec_pretty(self).map_err(|e| e.to_string())?;
        fsutil::write_file(path, &bytes)
    }
}

fn state_key(source_id: &str, target: &str) -> String {
    format!("{source_id}\n{target}")
}

pub fn run(root: &Path, slug: &str, options: Options) -> Result<(), String> {
    let config = site::load_config(root)?;
    let sources = site::read_sources(root, &config)?;
    let (loaded, _) = site::load_site(root, true, None)?;
    let post = loaded
        .posts
        .iter()
        .find(|post| post.slug == slug)
        .ok_or_else(|| format!("no post has slug `{slug}`"))?;
    let source = sources
        .posts
        .iter()
        .find(|source| source.path == post.source)
        .ok_or_else(|| format!("cannot find source `{}`", post.source))?;
    let article = article(post, &source.contents, &config)?;

    let selected = select_targets(&config, &options.target_names)?;
    let state_path = private_state_path(root, &config.syndication.state_file)?;
    let mut state = State::load(&state_path)?;
    println!(
        "Syndication {} for `{}` ({})",
        if options.write { "write" } else { "dry run" },
        article.title,
        article.canonical_url
    );
    for (name, target) in selected {
        let key = state_key(&article.source_id, name);
        let existing = state.records.get(&key);
        if let Some(record) = existing {
            if record.source_path != article.source_path {
                return Err(format!(
                    "syndicationId `{}` is already used by `{}` for target `{name}`",
                    article.source_id, record.source_path
                ));
            }
        }
        let public = options.publish && target.allow_publish;
        if options.publish && !target.allow_publish {
            return Err(format!(
                "target `{name}` does not permit publishing; set allowPublish to true as a second explicit opt-in"
            ));
        }
        if target.provider == SyndicationProvider::Medium {
            println!(
                "- {name}: manual import only — open Medium's Import a story and paste {}",
                article.canonical_url
            );
            continue;
        }
        validate_target(target)?;
        let action = if existing.is_some() {
            "update"
        } else {
            "create"
        };
        println!(
            "- {name}: {action} {} via {}{}",
            if public { "public copy" } else { "draft" },
            provider_name(target.provider),
            if options.write {
                ""
            } else {
                " (no request sent)"
            }
        );
        if target.provider == SyndicationProvider::Wordpress {
            println!("  warning: core WordPress cannot set an external canonical URL; verify your SEO plugin or use WordPress as the original publisher");
        }
        if !options.write {
            continue;
        }
        let credential = credential(target)?;
        let request = build_request(name, target, &article, existing, public, &credential)?;
        let outcome = execute(target.provider, &NetworkTransport, &request)?;
        state.records.insert(
            key,
            StateRecord {
                source_id: article.source_id.clone(),
                source_path: article.source_path.clone(),
                target: name.clone(),
                remote_id: outcome.id,
                remote_url: outcome.url,
                remote_revision: outcome.remote_revision,
                revision: article.revision.clone(),
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

fn article(post: &Post, source: &str, config: &SiteConfig) -> Result<Article, String> {
    let document = frontmatter::parse(source)?;
    let source_id = document
        .front_matter
        .get("syndicationId")
        .or_else(|| document.front_matter.get("syndication_id"))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| format!("source:{}", post.source.replace('\\', "/")));
    let canonical_url = config.absolute(&post.url);
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
    let markdown = absolutize_markdown(&document.body, config)?;
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
    Ok(Article {
        source_id,
        source_path: post.source.clone(),
        slug: post.slug.clone(),
        title: post.title.clone(),
        description: post.description.clone(),
        markdown,
        html: absolutize_html(&post.html, config),
        tags: post.tags.iter().map(|tag| tag.name.clone()).collect(),
        canonical_url,
        revision,
    })
}

fn absolutize_markdown(markdown: &str, config: &SiteConfig) -> Result<String, String> {
    let base = Url::parse(&format!("{}/", config.url.trim_end_matches('/')))
        .map_err(|_| "site url must be a complete public URL".to_string())?;
    let mut out = markdown.to_string();
    for marker in ["](/", "src=\"/", "href=\"/"] {
        let replacement = format!("{}{}", &marker[..marker.len() - 1], base.as_str());
        out = out.replace(marker, &replacement);
    }
    Ok(out)
}

fn absolutize_html(html: &str, config: &SiteConfig) -> String {
    let base = config.url.trim_end_matches('/');
    html.replace("src=\"/", &format!("src=\"{base}/"))
        .replace("href=\"/", &format!("href=\"{base}/"))
}

fn provider_name(provider: SyndicationProvider) -> &'static str {
    match provider {
        SyndicationProvider::Dev => "DEV",
        SyndicationProvider::Hashnode => "Hashnode",
        SyndicationProvider::Ghost => "Ghost",
        SyndicationProvider::Wordpress => "WordPress",
        SyndicationProvider::Medium => "Medium",
    }
}

fn credential(target: &SyndicationTargetConfig) -> Result<String, String> {
    if target.provider == SyndicationProvider::Wordpress && target.publication_id.trim().is_empty()
    {
        let username = std::env::var("WORDPRESS_USERNAME").unwrap_or_default();
        let password = std::env::var("WORDPRESS_APPLICATION_PASSWORD").unwrap_or_default();
        if username.trim().is_empty() || password.trim().is_empty() {
            return Err("self-hosted WordPress requires WORDPRESS_USERNAME and WORDPRESS_APPLICATION_PASSWORD".into());
        }
        return Ok(format!(
            "Basic {}",
            STANDARD.encode(format!("{username}:{password}"))
        ));
    }
    let variable = match target.provider {
        SyndicationProvider::Dev => "DEVTO_API_KEY",
        SyndicationProvider::Hashnode => "HASHNODE_PAT",
        SyndicationProvider::Ghost => "GHOST_ADMIN_API_KEY",
        SyndicationProvider::Wordpress => "WORDPRESS_ACCESS_TOKEN",
        SyndicationProvider::Medium => return Ok(String::new()),
    };
    std::env::var(variable)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            format!(
                "{provider} requires {variable} in the server environment",
                provider = provider_name(target.provider)
            )
        })
}

fn validate_target(target: &SyndicationTargetConfig) -> Result<(), String> {
    match target.provider {
        SyndicationProvider::Hashnode if target.publication_id.trim().is_empty() => {
            Err("Hashnode target requires publicationId (and an eligible Pro publication)".into())
        }
        SyndicationProvider::Ghost => {
            validated_endpoint(&target.endpoint, "Ghost endpoint").map(|_| ())
        }
        SyndicationProvider::Wordpress if target.publication_id.trim().is_empty() => {
            validated_endpoint(&target.endpoint, "WordPress endpoint").map(|_| ())
        }
        _ => Ok(()),
    }
}

fn build_request(
    target_name: &str,
    target: &SyndicationTargetConfig,
    article: &Article,
    existing: Option<&StateRecord>,
    publish: bool,
    credential: &str,
) -> Result<Request, String> {
    match target.provider {
        SyndicationProvider::Dev => dev_request(article, existing, publish, credential),
        SyndicationProvider::Hashnode => {
            hashnode_request(target, article, existing, publish, credential)
        }
        SyndicationProvider::Ghost => ghost_request(target, article, existing, publish, credential),
        SyndicationProvider::Wordpress => {
            wordpress_request(target, article, existing, publish, credential)
        }
        SyndicationProvider::Medium => Err(format!("target `{target_name}` is manual-only")),
    }
}

fn common_headers(authorization: (&str, String)) -> Vec<(String, String)> {
    vec![
        ("Content-Type".into(), "application/json".into()),
        (authorization.0.into(), authorization.1),
    ]
}

fn dev_request(
    article: &Article,
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
            "title": article.title,
            "body_markdown": article.markdown,
            "published": publish,
            "canonical_url": article.canonical_url,
            "description": article.description,
            "tags": article.tags.iter().take(4).cloned().collect::<Vec<_>>().join(",")
        }}),
    })
}

fn hashnode_request(
    target: &SyndicationTargetConfig,
    article: &Article,
    existing: Option<&StateRecord>,
    publish: bool,
    credential: &str,
) -> Result<Request, String> {
    if target.publication_id.trim().is_empty() {
        return Err(
            "Hashnode target requires publicationId (and an eligible Pro publication)".into(),
        );
    }
    let tags: Vec<Json> = article
        .tags
        .iter()
        .take(15)
        .map(|name| json!({"name": name, "slug": slug(name)}))
        .collect();
    let input = json!({
        "title": article.title, "subtitle": article.description, "slug": article.slug,
        "contentMarkdown": article.markdown, "canonicalUrl": article.canonical_url, "tags": tags
    });
    let (query, variables) = if let Some(record) = existing {
        ("mutation Update($input: UpdateDraftInput!) { updateDraft(input: $input) { draft { id slug } } }",
         json!({"input": merge_object(input, json!({"draftId": record.remote_id}))}))
    } else {
        ("mutation Create($input: CreateDraftInput!) { createDraft(input: $input) { draft { id slug } } }",
         json!({"input": merge_object(input, json!({"publicationId": target.publication_id}))}))
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
    target: &SyndicationTargetConfig,
    article: &Article,
    existing: Option<&StateRecord>,
    publish: bool,
    credential: &str,
) -> Result<Request, String> {
    let base = validated_endpoint(&target.endpoint, "Ghost endpoint")?;
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
    let mut post = json!({"title": article.title, "slug": article.slug, "html": article.html, "custom_excerpt": article.description, "canonical_url": article.canonical_url, "status": if publish {"published"} else {"draft"}});
    if let Some(record) = existing {
        if record.remote_revision.is_empty() {
            return Err("saved Ghost state has no updated_at revision; create a fresh draft state before updating".into());
        }
        post["updated_at"] = Json::String(record.remote_revision.clone());
    }
    Ok(Request {
        method: if existing.is_some() { "PUT" } else { "POST" },
        url,
        headers: common_headers(("Authorization", format!("Ghost {token}"))),
        body: json!({"posts": [post]}),
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
    if value.len() % 2 != 0 {
        return None;
    }
    (0..value.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&value[i..i + 2], 16).ok())
        .collect()
}

fn wordpress_request(
    target: &SyndicationTargetConfig,
    article: &Article,
    existing: Option<&StateRecord>,
    publish: bool,
    credential: &str,
) -> Result<Request, String> {
    let base = if target.publication_id.trim().is_empty() {
        validated_endpoint(&target.endpoint, "WordPress endpoint")?
    } else {
        format!(
            "https://public-api.wordpress.com/wp/v2/sites/{}",
            target.publication_id.trim()
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
        body: json!({"title": article.title, "content": article.html, "excerpt": article.description, "slug": article.slug, "status": if publish {"publish"} else {"draft"}}),
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
    provider: SyndicationProvider,
    transport: &dyn Transport,
    request: &Request,
) -> Result<Outcome, String> {
    let response = transport.send(request)?;
    if !(200..300).contains(&response.status) {
        return Err(status_error(response.status));
    }
    let body: Json = serde_json::from_slice(&response.body)
        .map_err(|_| format!("{} returned invalid JSON", provider_name(provider)))?;
    if let Some(message) = body["errors"][0]["message"].as_str() {
        return Err(format!("Hashnode rejected the request: {message}"));
    }
    let (id, url, remote_revision) = match provider {
        SyndicationProvider::Dev => (&body["id"], &body["url"], ""),
        SyndicationProvider::Hashnode => {
            let draft = if body["data"]["createDraft"]["draft"].is_object() {
                &body["data"]["createDraft"]["draft"]
            } else {
                &body["data"]["updateDraft"]["draft"]
            };
            (&draft["id"], &draft["slug"], "")
        }
        SyndicationProvider::Ghost => (
            &body["posts"][0]["id"],
            &body["posts"][0]["url"],
            body["posts"][0]["updated_at"].as_str().unwrap_or_default(),
        ),
        SyndicationProvider::Wordpress => (&body["id"], &body["link"], ""),
        SyndicationProvider::Medium => return Err("Medium is manual-only".into()),
    };
    let id = id
        .as_str()
        .map(str::to_string)
        .or_else(|| id.as_u64().map(|id| id.to_string()))
        .ok_or_else(|| {
            format!(
                "{} response did not contain a remote ID",
                provider_name(provider)
            )
        })?;
    Ok(Outcome {
        id,
        url: url.as_str().unwrap_or_default().to_string(),
        remote_revision: remote_revision.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn article_fixture() -> Article {
        Article {
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
        let article = article_fixture();
        let create = dev_request(&article, None, false, "secret").unwrap();
        assert_eq!(create.method, "POST");
        assert_eq!(create.body["article"]["published"], false);
        assert_eq!(
            create.body["article"]["canonical_url"],
            article.canonical_url
        );
        let state = StateRecord {
            remote_id: "42".into(),
            ..Default::default()
        };
        let update = dev_request(&article, Some(&state), false, "secret").unwrap();
        assert_eq!(update.method, "PUT");
        assert!(update.url.ends_with("/42"));
    }

    #[test]
    fn wordpress_and_ghost_default_to_drafts() {
        let article = article_fixture();
        let wordpress = SyndicationTargetConfig {
            provider: SyndicationProvider::Wordpress,
            endpoint: "https://wp.example/wp-json/wp/v2".into(),
            ..Default::default()
        };
        assert_eq!(
            wordpress_request(&wordpress, &article, None, false, "x")
                .unwrap()
                .body["status"],
            "draft"
        );
        let ghost = SyndicationTargetConfig {
            provider: SyndicationProvider::Ghost,
            endpoint: "https://ghost.example".into(),
            ..Default::default()
        };
        let request = ghost_request(
            &ghost,
            &article,
            None,
            false,
            "abc:00112233445566778899aabbccddeeff",
        )
        .unwrap();
        assert_eq!(request.body["posts"][0]["status"], "draft");
        assert_eq!(
            request.body["posts"][0]["canonical_url"],
            article.canonical_url
        );
        let state = StateRecord {
            remote_id: "post-id".into(),
            remote_revision: "2026-10-24T12:00:00.000Z".into(),
            ..Default::default()
        };
        let update = ghost_request(
            &ghost,
            &article,
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
        let article = article_fixture();
        let target = SyndicationTargetConfig {
            provider: SyndicationProvider::Hashnode,
            publication_id: "pub-id".into(),
            ..Default::default()
        };
        let create = hashnode_request(&target, &article, None, false, "pat").unwrap();
        assert!(create.body["query"]
            .as_str()
            .unwrap()
            .contains("createDraft"));
        assert_eq!(create.body["variables"]["input"]["publicationId"], "pub-id");
        let state = StateRecord {
            remote_id: "draft-id".into(),
            ..Default::default()
        };
        let update = hashnode_request(&target, &article, Some(&state), false, "pat").unwrap();
        assert!(update.body["query"]
            .as_str()
            .unwrap()
            .contains("updateDraft"));
        assert_eq!(update.body["variables"]["input"]["draftId"], "draft-id");
        assert!(hashnode_request(&target, &article, None, true, "pat").is_err());
    }

    #[test]
    fn state_key_is_source_identity_plus_user_target_name() {
        assert_ne!(state_key("same", "dev"), state_key("same", "dev-work"));
        assert_ne!(state_key("one", "dev"), state_key("two", "dev"));
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
        let request = dev_request(&article_fixture(), None, false, "x").unwrap();
        let outcome =
            execute(SyndicationProvider::Dev, &FakeTransport(response), &request).unwrap();
        assert_eq!(outcome.id, "42");
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
            "---\ntitle: Post\nslug: post\ndate: 2026-10-24\nsyndicationId: durable-post\n---\n\nBody\n",
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
