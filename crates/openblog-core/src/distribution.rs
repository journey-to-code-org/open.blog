//! Source-to-destination preview and approval (epic #381, story #390, ADRs 0723 to 0725).
//!
//! A **distribution plan** shows, for one published post and the destinations the author chose,
//! exactly what each destination would receive: the portable projection the existing destination
//! policy names (ADR 0004), the publication intent, the capabilities that asks of the destination,
//! and every destination-specific reason it cannot take them (the provider manifest's own
//! ineligibilities, ADR 0721, plus the conversion checks the cross-posting adapters already run).
//! Nothing here sends, reads a credential or touches the network.
//!
//! An **approval** is the author's explicit consent to one plan, bound to the source revision,
//! the canonical address, the publication intent, each destination's preview digest and the
//! manifest each destination was previewed under. It covers a later run only while all of those
//! still hold; a breaking provider upgrade voids it (ADR 0722).
//!
//! Errors are fixed text and never repeat the author's content.

use std::collections::BTreeMap;
use std::fmt;

use blake2::{Blake2b512, Digest};
use serde::Serialize;
use serde_json::{json, Value as Json};

use crate::escape;
use crate::provider_manifest::{
    approval_stands, Capability, DistributionRequest, Ineligibility, ProviderId, ProviderManifest,
};

/// The plan format this release writes, and the approvals file format it reads and writes.
pub const PLAN_VERSION: u32 = 1;
pub const APPROVALS_VERSION: u32 = 1;
/// The largest approvals file read, in bytes.
pub const MAX_APPROVALS_BYTES: usize = 1024 * 1024;

/// The representation a destination receives, from its destination policy.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PreviewFormat {
    PortableMarkdown,
    PortableHtml,
    ManualMarkdown,
}

impl PreviewFormat {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::PortableMarkdown => "portable-markdown",
            Self::PortableHtml => "portable-html",
            Self::ManualMarkdown => "manual-markdown",
        }
    }

    /// The extension of the dry-run artifact holding this content.
    pub fn extension(self) -> &'static str {
        match self {
            Self::PortableHtml => "html",
            _ => "md",
        }
    }

    fn describe(self) -> &'static str {
        match self {
            Self::PortableMarkdown => "Portable Markdown",
            Self::PortableHtml => "Portable HTML",
            Self::ManualMarkdown => "Portable Markdown for a manual import",
        }
    }
}

/// What a run would do at a destination.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Intent {
    /// Create or update an unpublished copy for the author to review at the destination.
    Draft,
    /// Create or update a public copy (both `--publish` and the target's `allowPublish`).
    Published,
    /// Nothing is sent; the author imports the copy by hand.
    Manual,
}

impl Intent {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Draft => "draft",
            Self::Published => "published",
            Self::Manual => "manual",
        }
    }

    /// The capabilities this intent asks of a destination that receives the article.
    pub fn capabilities(self, images: bool) -> Vec<Capability> {
        let mut capabilities = vec![Capability::Article];
        if self == Self::Draft {
            capabilities.push(Capability::Draft);
        }
        if images {
            capabilities.push(Capability::Image);
        }
        capabilities
    }
}

/// Whether a destination can take its preview.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Status {
    /// The adapter does everything asked; a run may send it.
    Ready,
    /// Only by hand: open.blog sends nothing and the author follows the guided workflow.
    Manual,
    /// Something keeps this destination from taking the post; nothing is sent to it.
    Blocked,
}

impl Status {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Ready => "ready",
            Self::Manual => "manual",
            Self::Blocked => "blocked",
        }
    }
}

/// One destination-specific reason, as the preview reports it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Problem {
    pub code: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capability: Option<Capability>,
    pub message: String,
}

impl Problem {
    /// A reason found outside the manifest: a misconfigured target or a blocking conversion
    /// finding the adapter would refuse before any request.
    pub fn blocking(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.to_string(),
            capability: None,
            message: message.into(),
        }
    }

    fn from_ineligibility(problem: &Ineligibility, label: &str) -> Self {
        Self {
            code: problem.code().to_string(),
            capability: problem.capability(),
            message: problem.message(label),
        }
    }
}

/// What the caller knows about one destination before it is previewed.
pub struct DestinationInput<'a> {
    /// The author's name for the target (a configuration key).
    pub name: &'a str,
    pub manifest: ProviderManifest,
    pub format: PreviewFormat,
    pub intent: Intent,
    /// Exactly the content the adapter would send, or the author would import.
    pub content: &'a str,
    /// Every other value the destination's request carries besides the content and the canonical
    /// address, in the request's own field names: the title, tags, excerpt, slug and so on.
    pub fields: Vec<RequestField>,
    /// What the run asks of the destination; its capabilities come from the intent.
    pub request: DistributionRequest,
    /// Reasons found outside the manifest, in the caller's order.
    pub blocking: Vec<Problem>,
    /// The step the author takes by hand, for a manual destination.
    pub instruction: Option<String>,
}

/// One value a destination's request carries besides its content, under the request's own field
/// name. A list such as the tags keeps one entry per item, so two different lists never read alike.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct RequestField {
    pub name: String,
    pub values: Vec<String>,
}

impl RequestField {
    pub fn one(name: &str, value: &str) -> Self {
        Self {
            name: name.to_string(),
            values: vec![value.to_string()],
        }
    }

    pub fn list(name: &str, values: &[String]) -> Self {
        Self {
            name: name.to_string(),
            values: values.to_vec(),
        }
    }
}

/// One destination's preview: what it would receive and whether it can.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DestinationPreview {
    pub name: String,
    pub provider: ProviderId,
    pub label: String,
    pub policy_version: String,
    pub format: PreviewFormat,
    pub intent: Intent,
    pub capabilities: Vec<Capability>,
    pub status: Status,
    pub problems: Vec<Problem>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instruction: Option<String>,
    pub bytes: usize,
    /// Binds the name, provider, format, intent, canonical address, capabilities, content and
    /// every other request field, so an approval covers everything a write sends. The policy version is left out on purpose: whether a newer manifest keeps an approval is the
    /// compatibility policy's question (ADR 0722), not a byte comparison.
    pub digest: String,
    pub content: String,
    pub fields: Vec<RequestField>,
    pub manifest: ProviderManifest,
}

/// Previews one destination against its manifest. The status is `blocked` when any reason is
/// not a manual capability, `manual` when every reason is, and `ready` otherwise.
pub fn preview_destination(input: DestinationInput<'_>, canonical_url: &str) -> DestinationPreview {
    let manifest = input.manifest;
    let mut problems: Vec<Problem> = manifest
        .check(&input.request)
        .iter()
        .map(|problem| Problem::from_ineligibility(problem, &manifest.label))
        .collect();
    problems.extend(input.blocking);
    let status = if problems.is_empty() {
        Status::Ready
    } else if problems.iter().all(|p| p.code == "capability-manual") {
        Status::Manual
    } else {
        Status::Blocked
    };
    let capabilities: Vec<Capability> = input.request.capabilities.iter().copied().collect();
    let mut hasher = Blake2b512::new();
    for part in [
        "openblog-distribution-preview/2",
        input.name,
        manifest.provider.as_str(),
        input.format.as_str(),
        input.intent.as_str(),
        canonical_url,
    ] {
        field(&mut hasher, part);
    }
    for capability in &capabilities {
        field(&mut hasher, capability.as_str());
    }
    field(&mut hasher, input.content);
    field(&mut hasher, &input.fields.len().to_string());
    for request_field in &input.fields {
        field(&mut hasher, &request_field.name);
        field(&mut hasher, &request_field.values.len().to_string());
        for value in &request_field.values {
            field(&mut hasher, value);
        }
    }
    DestinationPreview {
        name: input.name.to_string(),
        provider: manifest.provider,
        label: manifest.label.clone(),
        policy_version: manifest.policy_version.clone(),
        format: input.format,
        intent: input.intent,
        capabilities,
        status,
        problems,
        instruction: input.instruction,
        bytes: input.content.len(),
        digest: hex(hasher),
        content: input.content.to_string(),
        fields: input.fields,
        manifest,
    }
}

/// What the author has when no destination is configured or enabled: the canonical post stays on
/// their site, and the portable copy can be imported anywhere by hand.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Fallback {
    pub reason: &'static str,
    pub format: PreviewFormat,
    pub content: String,
}

/// The post a plan distributes.
pub struct PlanSource<'a> {
    pub source_id: &'a str,
    pub source_path: &'a str,
    pub slug: &'a str,
    pub title: &'a str,
    pub canonical_url: &'a str,
    pub revision: &'a str,
}

/// One post's previews for the chosen destinations, and the digest an approval names.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DistributionPlan {
    pub version: u32,
    pub source_id: String,
    pub source_path: String,
    pub slug: String,
    pub title: String,
    pub canonical_url: String,
    pub revision: String,
    pub publish: bool,
    pub remote_request_sent: bool,
    pub digest: String,
    pub destinations: Vec<DestinationPreview>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fallback: Option<Fallback>,
}

impl DistributionPlan {
    /// A plan over `destinations`. With none, the plan carries the portable Markdown `fallback`.
    pub fn new(
        source: PlanSource<'_>,
        publish: bool,
        destinations: Vec<DestinationPreview>,
        portable_markdown: &str,
    ) -> Self {
        let mut hasher = Blake2b512::new();
        for part in [
            "openblog-distribution-plan/1",
            source.source_id,
            source.revision,
            source.canonical_url,
            if publish { "publish" } else { "draft" },
        ] {
            field(&mut hasher, part);
        }
        for destination in &destinations {
            field(&mut hasher, &destination.name);
            field(&mut hasher, &destination.digest);
            field(&mut hasher, destination.status.as_str());
        }
        let fallback = destinations.is_empty().then(|| Fallback {
            reason: "no-destination",
            format: PreviewFormat::PortableMarkdown,
            content: portable_markdown.to_string(),
        });
        Self {
            version: PLAN_VERSION,
            source_id: source.source_id.to_string(),
            source_path: source.source_path.to_string(),
            slug: source.slug.to_string(),
            title: source.title.to_string(),
            canonical_url: source.canonical_url.to_string(),
            revision: source.revision.to_string(),
            publish,
            remote_request_sent: false,
            digest: hex(hasher),
            destinations,
            fallback,
        }
    }

    pub fn destination(&self, name: &str) -> Option<&DestinationPreview> {
        self.destinations.iter().find(|d| d.name == name)
    }

    pub fn to_json_value(&self) -> Json {
        serde_json::to_value(self).unwrap_or(Json::Null)
    }
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

/// Why an approval was refused, or does not cover a run. Every message is fixed text.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ApprovalError {
    /// The digest the author approved is not the digest of the plan as it is now.
    PlanChanged,
    NothingToApprove,
    /// A destination in the plan is blocked; fix it or leave it out with `--target`.
    DestinationBlocked,
    NotApproved,
    SourceChanged,
    IntentChanged,
    DestinationNotApproved,
    PreviewChanged,
    /// The destination's provider manifest changed in a breaking way since the approval.
    PolicyChanged,
    /// The approvals file is not one this release reads.
    InvalidApprovals,
}

impl ApprovalError {
    pub fn code(self) -> &'static str {
        match self {
            Self::PlanChanged => "plan-changed",
            Self::NothingToApprove => "nothing-to-approve",
            Self::DestinationBlocked => "destination-blocked",
            Self::NotApproved => "not-approved",
            Self::SourceChanged => "source-changed",
            Self::IntentChanged => "intent-changed",
            Self::DestinationNotApproved => "destination-not-approved",
            Self::PreviewChanged => "preview-changed",
            Self::PolicyChanged => "policy-changed",
            Self::InvalidApprovals => "invalid-approvals",
        }
    }

    fn sentence(self) -> &'static str {
        match self {
            Self::PlanChanged => "The plan changed after it was previewed; preview it again and approve the new digest.",
            Self::NothingToApprove => "There is no destination to approve.",
            Self::DestinationBlocked => "A destination in this plan is blocked; fix it, or leave it out with --target, and preview again.",
            Self::NotApproved => "This post has no approved distribution plan.",
            Self::SourceChanged => "The post or its canonical address changed after the approval.",
            Self::IntentChanged => "The approval was for a different draft or publish choice.",
            Self::DestinationNotApproved => "This destination was not part of the approved plan.",
            Self::PreviewChanged => "What this destination would receive changed after the approval.",
            Self::PolicyChanged => "The destination's provider policy changed in a way that needs a new approval.",
            Self::InvalidApprovals => "The approvals file is not one this release can read.",
        }
    }
}

impl fmt::Display for ApprovalError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.sentence())
    }
}

impl std::error::Error for ApprovalError {}

/// One destination as it was approved.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovedDestination {
    pub name: String,
    pub provider: ProviderId,
    pub preview_digest: String,
    /// The manifest the destination was previewed under, so a later manifest can be classified.
    pub manifest: ProviderManifest,
}

/// The author's consent to one plan.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Approval {
    pub source_id: String,
    pub revision: String,
    pub canonical_url: String,
    pub publish: bool,
    pub plan_digest: String,
    pub approved_at: String,
    pub destinations: Vec<ApprovedDestination>,
}

/// Records the author's approval of `plan`, given the digest they were shown. A digest that is
/// not the plan's own, an empty plan or a blocked destination refuses it.
pub fn approve(
    plan: &DistributionPlan,
    presented_digest: &str,
    approved_at: &str,
) -> Result<Approval, ApprovalError> {
    if presented_digest.trim() != plan.digest {
        return Err(ApprovalError::PlanChanged);
    }
    if plan.destinations.is_empty() {
        return Err(ApprovalError::NothingToApprove);
    }
    if plan
        .destinations
        .iter()
        .any(|d| d.status == Status::Blocked)
    {
        return Err(ApprovalError::DestinationBlocked);
    }
    Ok(Approval {
        source_id: plan.source_id.clone(),
        revision: plan.revision.clone(),
        canonical_url: plan.canonical_url.clone(),
        publish: plan.publish,
        plan_digest: plan.digest.clone(),
        approved_at: approved_at.to_string(),
        destinations: plan
            .destinations
            .iter()
            .map(|d| ApprovedDestination {
                name: d.name.clone(),
                provider: d.provider,
                preview_digest: d.digest.clone(),
                manifest: d.manifest.clone(),
            })
            .collect(),
    })
}

impl Approval {
    /// Whether this approval covers sending `name` from `plan` now. The plan may be a subset of the
    /// approved one (a run limited with `--target`), but every destination it sends must have been
    /// approved with the same preview, under a manifest the current one does not break.
    pub fn covers(&self, plan: &DistributionPlan, name: &str) -> Result<(), ApprovalError> {
        if self.source_id != plan.source_id {
            return Err(ApprovalError::NotApproved);
        }
        if self.revision != plan.revision || self.canonical_url != plan.canonical_url {
            return Err(ApprovalError::SourceChanged);
        }
        if self.publish != plan.publish {
            return Err(ApprovalError::IntentChanged);
        }
        let current = plan
            .destination(name)
            .ok_or(ApprovalError::DestinationNotApproved)?;
        let approved = self
            .destinations
            .iter()
            .find(|d| d.name == name)
            .ok_or(ApprovalError::DestinationNotApproved)?;
        if approved.provider != current.provider || approved.preview_digest != current.digest {
            return Err(ApprovalError::PreviewChanged);
        }
        if !approval_stands(&approved.manifest, &current.manifest) {
            return Err(ApprovalError::PolicyChanged);
        }
        Ok(())
    }
}

/// The private approvals file: the latest approval of each source.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Approvals {
    pub approvals: BTreeMap<String, Approval>,
}

impl Approvals {
    /// Reads the file, refusing anything this release does not know (a version, a field, a
    /// manifest) as a whole.
    pub fn from_json(text: &str) -> Result<Self, ApprovalError> {
        if text.len() > MAX_APPROVALS_BYTES {
            return Err(ApprovalError::InvalidApprovals);
        }
        let value: Json =
            serde_json::from_str(text).map_err(|_| ApprovalError::InvalidApprovals)?;
        let object = value.as_object().ok_or(ApprovalError::InvalidApprovals)?;
        if object.len() != 2 || object.get("version") != Some(&json!(APPROVALS_VERSION)) {
            return Err(ApprovalError::InvalidApprovals);
        }
        let mut approvals = BTreeMap::new();
        for (source_id, approval) in object
            .get("approvals")
            .and_then(Json::as_object)
            .ok_or(ApprovalError::InvalidApprovals)?
        {
            let approval = read_approval(approval).ok_or(ApprovalError::InvalidApprovals)?;
            if &approval.source_id != source_id {
                return Err(ApprovalError::InvalidApprovals);
            }
            approvals.insert(source_id.clone(), approval);
        }
        Ok(Self { approvals })
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(&json!({
            "version": APPROVALS_VERSION,
            "approvals": self.approvals,
        }))
        .unwrap_or_default()
    }

    pub fn get(&self, source_id: &str) -> Option<&Approval> {
        self.approvals.get(source_id)
    }

    /// Records `approval`, replacing the source's earlier one.
    pub fn record(&mut self, approval: Approval) {
        self.approvals.insert(approval.source_id.clone(), approval);
    }
}

fn read_approval(value: &Json) -> Option<Approval> {
    let object = value.as_object()?;
    const FIELDS: [&str; 7] = [
        "sourceId",
        "revision",
        "canonicalUrl",
        "publish",
        "planDigest",
        "approvedAt",
        "destinations",
    ];
    if object.len() != FIELDS.len() || !FIELDS.iter().all(|f| object.contains_key(*f)) {
        return None;
    }
    let text = |name: &str| object.get(name)?.as_str().map(str::to_string);
    let mut destinations = Vec::new();
    for destination in object.get("destinations")?.as_array()? {
        let d = destination.as_object()?;
        if d.len() != 4 {
            return None;
        }
        let manifest = ProviderManifest::from_value(d.get("manifest")?.clone()).ok()?;
        let provider = ProviderId::parse(d.get("provider")?.as_str()?).ok()?;
        if provider != manifest.provider {
            return None;
        }
        destinations.push(ApprovedDestination {
            name: d.get("name")?.as_str()?.to_string(),
            provider,
            preview_digest: d.get("previewDigest")?.as_str()?.to_string(),
            manifest,
        });
    }
    Some(Approval {
        source_id: text("sourceId")?,
        revision: text("revision")?,
        canonical_url: text("canonicalUrl")?,
        publish: object.get("publish")?.as_bool()?,
        plan_digest: text("planDigest")?,
        approved_at: text("approvedAt")?,
        destinations,
    })
}

/// The dry-run preview page: a static, script-free HTML document a person can read in any
/// browser, offline, with a keyboard or a screen reader. `files` names each destination's
/// artifact, in the plan's order; `approve_command` is the exact command that approves this plan.
pub fn preview_page(plan: &DistributionPlan, files: &[String], approve_command: &str) -> String {
    let mut out = String::new();
    let t = escape::text;
    out.push_str("<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n");
    out.push_str(&format!(
        "<title>Distribution preview: {}</title>\n",
        t(&plan.title)
    ));
    out.push_str(PAGE_STYLE);
    out.push_str("</head>\n<body>\n<main>\n");
    out.push_str(&format!(
        "<h1>Distribution preview: {}</h1>\n",
        t(&plan.title)
    ));
    out.push_str("<p class=\"notice\"><strong>Preview, not sent.</strong> Nothing in this folder was sent to any destination, and no credential was read.</p>\n");
    out.push_str("<dl>\n");
    out.push_str(&format!(
        "<dt>Canonical address</dt><dd><a href=\"{}\">{}</a></dd>\n",
        escape::attr(&plan.canonical_url),
        t(&plan.canonical_url)
    ));
    out.push_str(&format!(
        "<dt>Source</dt><dd>{}</dd>\n<dt>Revision</dt><dd><code>{}</code></dd>\n<dt>Plan digest</dt><dd><code>{}</code></dd>\n",
        t(&plan.source_path),
        t(&plan.revision),
        t(&plan.digest)
    ));
    out.push_str("</dl>\n");
    if let Some(fallback) = &plan.fallback {
        out.push_str("<section aria-labelledby=\"fallback-title\">\n<h2 id=\"fallback-title\">No destination is configured</h2>\n");
        out.push_str("<p>Your post stays on your own site, and nothing is sent anywhere. To publish a copy elsewhere, import this portable Markdown by hand, or configure a destination under <code>syndication.targets</code> in <code>openblog.json</code>.</p>\n");
        out.push_str(&format!(
            "<pre tabindex=\"0\" aria-label=\"Portable Markdown of the post\">{}</pre>\n</section>\n",
            t(&fallback.content)
        ));
        out.push_str("</main>\n</body>\n</html>\n");
        return out;
    }
    out.push_str("<section aria-labelledby=\"summary-title\">\n<h2 id=\"summary-title\">Destinations</h2>\n<table>\n<caption>What each chosen destination would receive, and whether it can</caption>\n<thead><tr><th scope=\"col\">Destination</th><th scope=\"col\">Action</th><th scope=\"col\">Status</th></tr></thead>\n<tbody>\n");
    for (index, d) in plan.destinations.iter().enumerate() {
        out.push_str(&format!(
            "<tr><th scope=\"row\"><a href=\"#destination-{}\">{}</a> ({})</th><td>{}</td><td>{}</td></tr>\n",
            index + 1,
            t(&d.name),
            t(&d.label),
            intent_words(d.intent),
            status_words(d.status)
        ));
    }
    out.push_str("</tbody>\n</table>\n</section>\n");
    for (index, d) in plan.destinations.iter().enumerate() {
        let id = format!("destination-{}", index + 1);
        out.push_str(&format!(
            "<section aria-labelledby=\"{id}\">\n<h2 id=\"{id}\">{} ({})</h2>\n",
            t(&d.name),
            t(&d.label)
        ));
        out.push_str(&format!(
            "<p><strong>Status:</strong> {}. <strong>Action:</strong> {}.</p>\n",
            status_words(d.status),
            intent_words(d.intent)
        ));
        if !d.problems.is_empty() {
            out.push_str(&format!(
                "<h3 id=\"{id}-problems\">Why this destination cannot take it through open.blog</h3>\n<ul aria-labelledby=\"{id}-problems\">\n"
            ));
            for problem in &d.problems {
                out.push_str(&format!(
                    "<li>{} <span class=\"code\">({})</span></li>\n",
                    t(&problem.message),
                    t(&problem.code)
                ));
            }
            out.push_str("</ul>\n");
        }
        if let Some(instruction) = &d.instruction {
            out.push_str(&format!(
                "<p><strong>By hand:</strong> {}</p>\n",
                t(instruction)
            ));
        }
        if !d.fields.is_empty() {
            out.push_str(&format!(
                "<table>
<caption>Everything else the request to {} carries</caption>
<thead><tr><th scope=\"col\">Field</th><th scope=\"col\">Value</th></tr></thead>
<tbody>
",
                t(&d.name)
            ));
            for request_field in &d.fields {
                let value = if request_field.values.iter().all(|v| v.is_empty()) {
                    "<em>none</em>".to_string()
                } else {
                    request_field
                        .values
                        .iter()
                        .map(|v| format!("<code>{}</code>", t(v)))
                        .collect::<Vec<_>>()
                        .join(", ")
                };
                out.push_str(&format!(
                    "<tr><th scope=\"row\"><code>{}</code></th><td>{value}</td></tr>
",
                    t(&request_field.name)
                ));
            }
            out.push_str(
                "</tbody>
</table>
",
            );
        }
        out.push_str(&format!(
            "<p>{} ({} bytes), checked under the {} provider policy of {}. Saved as <a href=\"{}\">{}</a>.</p>\n",
            d.format.describe(),
            d.bytes,
            t(&d.label),
            t(&d.policy_version),
            escape::attr(files.get(index).map(String::as_str).unwrap_or("")),
            t(files.get(index).map(String::as_str).unwrap_or(""))
        ));
        out.push_str(&format!(
            "<pre tabindex=\"0\" aria-label=\"{} for {}\">{}</pre>\n</section>\n",
            d.format.describe(),
            escape::attr(&d.name),
            t(&d.content)
        ));
    }
    out.push_str("<section aria-labelledby=\"approve-title\">\n<h2 id=\"approve-title\">Approve this plan</h2>\n");
    if plan
        .destinations
        .iter()
        .any(|d| d.status == Status::Blocked)
    {
        out.push_str("<p>This plan cannot be approved while a destination is blocked. Fix it, or leave it out with <code>--target</code>, and preview again.</p>\n");
    } else {
        out.push_str("<p>Approving records your consent to exactly this plan; it still sends nothing. Any change to the post, a destination's preview, or a breaking provider policy change needs a new approval.</p>\n");
        out.push_str(&format!(
            "<pre tabindex=\"0\" aria-label=\"Command that approves this plan\"><code>{}</code></pre>\n",
            t(approve_command)
        ));
    }
    out.push_str("</section>\n</main>\n</body>\n</html>\n");
    out
}

fn status_words(status: Status) -> &'static str {
    match status {
        Status::Ready => "Ready: open.blog can send this",
        Status::Manual => "By hand: open.blog sends nothing here",
        Status::Blocked => "Blocked: nothing will be sent here",
    }
}

fn intent_words(intent: Intent) -> &'static str {
    match intent {
        Intent::Draft => "save an unpublished draft",
        Intent::Published => "publish a public copy",
        Intent::Manual => "you import the copy yourself",
    }
}

const PAGE_STYLE: &str = "<style>
:root{color-scheme:light dark;--bg:#ffffff;--fg:#1b1b1f;--muted:#4a4a55;--line:#8a8a96;--panel:#f3f3f6;--link:#0b57c2}
@media (prefers-color-scheme:dark){:root{--bg:#141418;--fg:#ececf1;--muted:#c3c3cc;--line:#77778a;--panel:#212128;--link:#8ab4ff}}
body{margin:0;background:var(--bg);color:var(--fg);font:1rem/1.5 system-ui,sans-serif}
main{max-width:52rem;margin:0 auto;padding:1rem}
a{color:var(--link)}
a:focus-visible,pre:focus-visible{outline:3px solid var(--link);outline-offset:2px}
.notice{border:2px solid var(--line);padding:.75rem;background:var(--panel)}
dt{font-weight:600}dd{margin:0 0 .5rem;overflow-wrap:anywhere}
table{border-collapse:collapse;width:100%}
caption{text-align:left;color:var(--muted);padding-bottom:.25rem}
th,td{border:1px solid var(--line);padding:.4rem;text-align:left;vertical-align:top;overflow-wrap:anywhere}
pre{white-space:pre-wrap;overflow-wrap:anywhere;background:var(--panel);border:1px solid var(--line);padding:.75rem;max-height:32rem;overflow:auto}
.code{color:var(--muted)}
</style>
";

#[cfg(test)]
mod tests {
    use super::*;
    use crate::provider_manifest::builtin_manifest;

    fn input<'a>(name: &'a str, provider: ProviderId, intent: Intent) -> DestinationInput<'a> {
        DestinationInput {
            name,
            manifest: builtin_manifest(provider),
            format: PreviewFormat::PortableMarkdown,
            intent,
            content: "Body <b>",
            fields: vec![
                RequestField::one("description", "About <i>"),
                RequestField::list("tags", &["rust".into(), "web".into()]),
            ],
            request: DistributionRequest::new(intent.capabilities(false)),
            blocking: Vec::new(),
            instruction: None,
        }
    }

    fn plan(destinations: Vec<DestinationPreview>) -> DistributionPlan {
        DistributionPlan::new(
            PlanSource {
                source_id: "post-1",
                source_path: "posts/a.md",
                slug: "a",
                title: "A <title>",
                canonical_url: "https://blog.example.org/a/",
                revision: "r1",
            },
            false,
            destinations,
            "# A",
        )
    }

    #[test]
    fn statuses_follow_the_manifest_and_the_blocking_reasons() {
        let url = "https://blog.example.org/a/";
        let dev = preview_destination(input("dev", ProviderId::Dev, Intent::Draft), url);
        assert_eq!(dev.status, Status::Ready);
        let medium = preview_destination(input("m", ProviderId::Medium, Intent::Manual), url);
        assert_eq!(medium.status, Status::Manual);
        assert!(medium
            .problems
            .iter()
            .all(|p| p.code == "capability-manual"));
        let mut blocked = input("dev", ProviderId::Dev, Intent::Draft);
        blocked
            .blocking
            .push(Problem::blocking("conversion-blocked", "Fix the tags."));
        assert_eq!(preview_destination(blocked, url).status, Status::Blocked);
    }

    #[test]
    fn digests_bind_content_but_not_the_policy_version() {
        let url = "https://blog.example.org/a/";
        let a = preview_destination(input("dev", ProviderId::Dev, Intent::Draft), url);
        let mut newer = input("dev", ProviderId::Dev, Intent::Draft);
        newer.manifest.policy_version = "2027-01-01".into();
        assert_eq!(preview_destination(newer, url).digest, a.digest);
        let mut changed = input("dev", ProviderId::Dev, Intent::Draft);
        changed.content = "Other";
        assert_ne!(preview_destination(changed, url).digest, a.digest);
        let published = preview_destination(input("dev", ProviderId::Dev, Intent::Published), url);
        assert_ne!(published.digest, a.digest);
        // Every request field is bound, and a list is bound item by item.
        let mut described = input("dev", ProviderId::Dev, Intent::Draft);
        described.fields[0] = RequestField::one("description", "Other");
        assert_ne!(preview_destination(described, url).digest, a.digest);
        let mut retagged = input("dev", ProviderId::Dev, Intent::Draft);
        retagged.fields[1] = RequestField::list("tags", &["rust, web".into()]);
        assert_ne!(preview_destination(retagged, url).digest, a.digest);
        let mut untagged = input("dev", ProviderId::Dev, Intent::Draft);
        untagged.fields.pop();
        assert_ne!(preview_destination(untagged, url).digest, a.digest);
    }

    #[test]
    fn approval_is_explicit_and_covers_only_what_was_approved() {
        let url = "https://blog.example.org/a/";
        let p = plan(vec![
            preview_destination(input("dev", ProviderId::Dev, Intent::Draft), url),
            preview_destination(input("m", ProviderId::Medium, Intent::Manual), url),
        ]);
        assert_eq!(
            approve(&p, "nope", "t").unwrap_err(),
            ApprovalError::PlanChanged
        );
        let approval = approve(&p, &p.digest, "t").unwrap();
        assert_eq!(approval.covers(&p, "dev"), Ok(()));
        assert_eq!(
            approval.covers(&p, "other"),
            Err(ApprovalError::DestinationNotApproved)
        );
        let mut edited = input("dev", ProviderId::Dev, Intent::Draft);
        edited.content = "Edited";
        let changed = plan(vec![preview_destination(edited, url)]);
        assert_eq!(
            approval.covers(&changed, "dev"),
            Err(ApprovalError::PreviewChanged)
        );
        // The same body under the same revision, with only the tags edited, is not covered.
        let mut retagged = input("dev", ProviderId::Dev, Intent::Draft);
        retagged.fields[1] = RequestField::list("tags", &["go".into()]);
        let retagged = plan(vec![preview_destination(retagged, url)]);
        assert_eq!(retagged.revision, p.revision);
        assert_eq!(
            approval.covers(&retagged, "dev"),
            Err(ApprovalError::PreviewChanged)
        );
        let mut revised = p.clone();
        revised.revision = "r2".into();
        assert_eq!(
            approval.covers(&revised, "dev"),
            Err(ApprovalError::SourceChanged)
        );
        let mut publishing = p.clone();
        publishing.publish = true;
        assert_eq!(
            approval.covers(&publishing, "dev"),
            Err(ApprovalError::IntentChanged)
        );
    }

    #[test]
    fn a_breaking_manifest_change_voids_the_approval_and_a_compatible_one_keeps_it() {
        let url = "https://blog.example.org/a/";
        let p = plan(vec![preview_destination(
            input("dev", ProviderId::Dev, Intent::Draft),
            url,
        )]);
        let approval = approve(&p, &p.digest, "t").unwrap();
        let with = |change: &dyn Fn(&mut ProviderManifest)| {
            let mut i = input("dev", ProviderId::Dev, Intent::Draft);
            i.manifest.policy_version = "2027-01-01".into();
            change(&mut i.manifest);
            plan(vec![preview_destination(i, url)])
        };
        let compatible = with(&|m| {
            m.capabilities.insert(
                Capability::Schedule,
                crate::provider_manifest::Support::Adapter,
            );
        });
        assert_eq!(approval.covers(&compatible, "dev"), Ok(()));
        let breaking = with(&|m| m.login.scopes.push("extra".into()));
        assert_eq!(
            approval.covers(&breaking, "dev"),
            Err(ApprovalError::PolicyChanged)
        );
    }

    #[test]
    fn blocked_or_empty_plans_cannot_be_approved() {
        let url = "https://blog.example.org/a/";
        let mut blocked = input("dev", ProviderId::Dev, Intent::Draft);
        blocked
            .blocking
            .push(Problem::blocking("target-misconfigured", "Set it up."));
        let p = plan(vec![preview_destination(blocked, url)]);
        assert_eq!(
            approve(&p, &p.digest, "t").unwrap_err(),
            ApprovalError::DestinationBlocked
        );
        let empty = plan(Vec::new());
        assert!(empty.fallback.is_some());
        assert_eq!(
            approve(&empty, &empty.digest, "t").unwrap_err(),
            ApprovalError::NothingToApprove
        );
    }

    #[test]
    fn the_approvals_file_round_trips_and_refuses_anything_unknown() {
        let url = "https://blog.example.org/a/";
        let p = plan(vec![preview_destination(
            input("dev", ProviderId::Dev, Intent::Draft),
            url,
        )]);
        let mut approvals = Approvals::default();
        approvals.record(approve(&p, &p.digest, "2026-10-29T00:00:00Z").unwrap());
        let text = approvals.to_json();
        assert_eq!(Approvals::from_json(&text), Ok(approvals));
        for bad in [
            text.replace("\"version\": 1", "\"version\": 2"),
            text.replace("\"publish\": false", "\"publish\": false, \"extra\": 1"),
            text.replace("\"provider\": \"dev\"", "\"provider\": \"mastodon\""),
            text.replace("\"manifestVersion\": 1", "\"manifestVersion\": 9"),
            "[]".into(),
        ] {
            assert_eq!(
                Approvals::from_json(&bad),
                Err(ApprovalError::InvalidApprovals)
            );
        }
    }

    #[test]
    fn the_preview_page_is_static_escaped_and_structured() {
        let url = "https://blog.example.org/a/";
        let p = plan(vec![
            preview_destination(input("dev", ProviderId::Dev, Intent::Draft), url),
            preview_destination(input("m", ProviderId::Medium, Intent::Manual), url),
        ]);
        let page = preview_page(
            &p,
            &["01-dev.md".into(), "02-medium.md".into()],
            "approve it",
        );
        assert!(page.starts_with("<!doctype html>\n<html lang=\"en\">"));
        assert!(!page.contains("<script"));
        assert!(!page.contains("<b>") && page.contains("Body &lt;b&gt;"));
        assert!(page.contains("A &lt;title&gt;"));
        assert!(page.contains("Everything else the request to dev carries"));
        assert!(page.contains("<code>About &lt;i&gt;</code>"));
        assert!(page.contains("<code>rust</code>, <code>web</code>"));
        assert_eq!(page.matches("<h1").count(), 1);
        assert!(page.contains("<caption>"));
        assert!(page.contains("Preview, not sent."));
        assert!(page.contains("By hand: open.blog sends nothing here"));
        assert!(page.contains("approve it"));
        let fallback = preview_page(&plan(Vec::new()), &[], "");
        assert!(fallback.contains("No destination is configured"));
        assert!(!fallback.contains("Approve this plan"));
    }
}
