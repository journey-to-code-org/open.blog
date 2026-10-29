//! The versioned provider capability contract of distribution (epic #381, ADRs 0720 to 0722).
//!
//! A **provider manifest** says, for one destination open.blog can reach (the cross-posting
//! targets of `openblog syndicate` and the social accounts of scheduled publishing), what this
//! release's adapter does there: which capabilities it performs through the provider's API, which
//! the author has to do by hand in the provider, and which are not possible at all; how it logs in;
//! the provider limits it holds a request to; how the canonical address travels; and the dated
//! provider policy those facts were verified against.
//!
//! The contract is closed. A manifest is read only in a version this release knows, every
//! capability must be declared, and anything unknown (a field, a capability, a support level, a
//! provider) refuses the whole manifest. A request names capabilities from the same closed list,
//! and a capability that is not done by the adapter makes the destination ineligible, never
//! silently skipped. `netlify/lib/social-capabilities.mjs` is the hosted function's half for the
//! social providers; both are held to `tests/fixtures/provider-manifests.json`.
//!
//! Pure: no environment, no network, no credential. Errors are fixed text and never repeat a value
//! they refused.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt;

use serde::{Deserialize, Serialize};

use crate::config::SyndicationProvider;
use crate::portability::{destination_policy, DestinationPublication};
use crate::social_schedule::{self, MAX_HORIZON_SECONDS, MIN_LEAD_SECONDS};

/// The manifest format this release reads and writes. A different number is refused.
pub const MANIFEST_VERSION: u32 = 1;

/// The day the built-in manifests were checked against the providers' own documentation.
pub const BUILTIN_POLICY_VERSION: &str = "2026-10-29";

/// The largest manifest text read, in bytes.
pub const MAX_MANIFEST_BYTES: usize = 64 * 1024;

/// Every destination this release has an adapter or a guided workflow for. A new provider is a
/// code change on purpose.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProviderId {
    Dev,
    Hashnode,
    Ghost,
    Wordpress,
    Medium,
    Linkedin,
    Facebook,
}

impl ProviderId {
    pub const ALL: [ProviderId; 7] = [
        Self::Dev,
        Self::Hashnode,
        Self::Ghost,
        Self::Wordpress,
        Self::Medium,
        Self::Linkedin,
        Self::Facebook,
    ];

    pub fn parse(value: &str) -> Result<Self, ManifestError> {
        Self::ALL
            .into_iter()
            .find(|provider| provider.as_str() == value)
            .ok_or(ManifestError::UnknownProvider)
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Dev => "dev",
            Self::Hashnode => "hashnode",
            Self::Ghost => "ghost",
            Self::Wordpress => "wordpress",
            Self::Medium => "medium",
            Self::Linkedin => "linkedin",
            Self::Facebook => "facebook",
        }
    }

    pub fn family(self) -> Family {
        match self {
            Self::Linkedin | Self::Facebook => Family::Social,
            _ => Family::Syndication,
        }
    }
}

impl From<SyndicationProvider> for ProviderId {
    fn from(provider: SyndicationProvider) -> Self {
        match provider {
            SyndicationProvider::Dev => Self::Dev,
            SyndicationProvider::Hashnode => Self::Hashnode,
            SyndicationProvider::Ghost => Self::Ghost,
            SyndicationProvider::Wordpress => Self::Wordpress,
            SyndicationProvider::Medium => Self::Medium,
        }
    }
}

impl From<social_schedule::Provider> for ProviderId {
    fn from(provider: social_schedule::Provider) -> Self {
        match provider {
            social_schedule::Provider::LinkedIn => Self::Linkedin,
            social_schedule::Provider::Facebook => Self::Facebook,
        }
    }
}

/// Which seam a provider is reached through: a full copy of the article (`openblog syndicate`,
/// ADR 0004) or an announcement that links the canonical post (social publishing, epic #353).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Family {
    Syndication,
    Social,
}

/// What a distribution can ask of a destination. The list is closed: a name that is not here is
/// refused wherever it appears.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Capability {
    /// A post that carries a link to the canonical page.
    Link,
    /// A short plain-text body written for the destination (a caption).
    Text,
    /// The whole article, as a portable projection of the canonical post.
    Article,
    /// Images reaching the destination with the post.
    Image,
    /// Video reaching the destination as video, not as a link.
    Video,
    /// A copy saved at the destination unpublished, for the author to review there.
    Draft,
    /// Delivery at a chosen later time.
    Schedule,
}

impl Capability {
    pub const ALL: [Capability; 7] = [
        Self::Link,
        Self::Text,
        Self::Article,
        Self::Image,
        Self::Video,
        Self::Draft,
        Self::Schedule,
    ];

    pub fn parse(value: &str) -> Result<Self, ManifestError> {
        Self::ALL
            .into_iter()
            .find(|capability| capability.as_str() == value)
            .ok_or(ManifestError::UnknownCapability)
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Link => "link",
            Self::Text => "text",
            Self::Article => "article",
            Self::Image => "image",
            Self::Video => "video",
            Self::Draft => "draft",
            Self::Schedule => "schedule",
        }
    }

    /// Reads a requested list of capability names, refusing the whole list on one unknown name.
    pub fn parse_list<'a>(
        values: impl IntoIterator<Item = &'a str>,
    ) -> Result<BTreeSet<Self>, ManifestError> {
        values.into_iter().map(Self::parse).collect()
    }
}

/// How far this release goes for one capability at one destination. The order is the order of
/// support, from none to full, which the compatibility policy compares.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Support {
    /// Neither the adapter nor a guided workflow can do it.
    Unsupported,
    /// The provider can do it, but only the author can, by hand, in the provider.
    Manual,
    /// The adapter does it through the provider's API.
    Adapter,
}

impl Support {
    fn parse(value: &str) -> Result<Self, ManifestError> {
        match value {
            "unsupported" => Ok(Self::Unsupported),
            "manual" => Ok(Self::Manual),
            "adapter" => Ok(Self::Adapter),
            _ => Err(ManifestError::UnknownSupport),
        }
    }
}

/// How the adapter authenticates. Credentials themselves are never part of a manifest.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum LoginMethod {
    /// Nothing is sent to the provider by open.blog (a manual import).
    None,
    /// A key or token the deployer puts in the server's environment.
    EnvironmentCredential,
    /// An OAuth 2.0 grant the author makes, sealed server-side (ADRs 0295, 0299).
    Oauth2,
}

impl LoginMethod {
    fn parse(value: &str) -> Result<Self, ManifestError> {
        match value {
            "none" => Ok(Self::None),
            "environment-credential" => Ok(Self::EnvironmentCredential),
            "oauth2" => Ok(Self::Oauth2),
            _ => Err(ManifestError::InvalidLogin),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Login {
    pub method: LoginMethod,
    /// The provider permissions every connection asks for, in the provider's spelling.
    pub scopes: Vec<String>,
}

/// How the canonical address reaches the destination.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum CanonicalLink {
    /// Sent as the copy's canonical URL.
    Sent,
    /// The post is a link to the canonical page; there is no copy to mark.
    Linked,
    /// The author sets or checks it by hand in the provider.
    Manual,
    /// The provider cannot record an external canonical URL.
    NotSupported,
}

impl CanonicalLink {
    fn parse(value: &str) -> Result<Self, ManifestError> {
        match value {
            "sent" => Ok(Self::Sent),
            "linked" => Ok(Self::Linked),
            "manual" => Ok(Self::Manual),
            "not-supported" => Ok(Self::NotSupported),
            _ => Err(ManifestError::InvalidPolicy),
        }
    }
}

/// What makes something public at the destination.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Publishing {
    /// Public only after the author's explicit approval for that destination.
    ExplicitApproval,
    /// The adapter never makes anything public; the author publishes in the provider.
    DraftOnly,
    /// Nothing is sent; the author imports and publishes by hand.
    Manual,
}

impl Publishing {
    fn parse(value: &str) -> Result<Self, ManifestError> {
        match value {
            "explicit-approval" => Ok(Self::ExplicitApproval),
            "draft-only" => Ok(Self::DraftOnly),
            "manual" => Ok(Self::Manual),
            _ => Err(ManifestError::InvalidPolicy),
        }
    }
}

/// The limits a request is held to. `None` means no limit was verified for this destination; the
/// caller's own limits (such as the stored caption length) still apply.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Constraints {
    pub max_text_chars: Option<u32>,
    pub max_tags: Option<u32>,
    pub max_tag_name_chars: Option<u32>,
    pub max_request_body_bytes: Option<u32>,
    pub schedule_min_lead_seconds: Option<u32>,
    pub schedule_max_horizon_seconds: Option<u32>,
}

impl Constraints {
    pub const NAMES: [&'static str; 6] = [
        "maxTextChars",
        "maxTags",
        "maxTagNameChars",
        "maxRequestBodyBytes",
        "scheduleMinLeadSeconds",
        "scheduleMaxHorizonSeconds",
    ];

    fn values(&self) -> [Option<u32>; 6] {
        [
            self.max_text_chars,
            self.max_tags,
            self.max_tag_name_chars,
            self.max_request_body_bytes,
            self.schedule_min_lead_seconds,
            self.schedule_max_horizon_seconds,
        ]
    }

    /// Whether a larger value of the constraint at this index is the looser one. Every limit is a
    /// maximum except the schedule lead time, where a larger value is tighter.
    fn larger_is_looser(index: usize) -> bool {
        Self::NAMES[index] != "scheduleMinLeadSeconds"
    }
}

/// One destination's declared capabilities, login, limits and policy, at one policy version.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderManifest {
    pub manifest_version: u32,
    pub provider: ProviderId,
    pub family: Family,
    pub label: String,
    /// The provider policy these facts were verified against: `YYYY-MM-DD` or `YYYY-MM-DD.N`.
    pub policy_version: String,
    pub capabilities: BTreeMap<Capability, Support>,
    pub login: Login,
    pub constraints: Constraints,
    pub canonical: CanonicalLink,
    pub publishing: Publishing,
    /// The provider's own documentation the facts were checked against (`https` only).
    pub sources: Vec<String>,
}

/// Why a manifest or a capability name was refused. Every message is fixed text.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ManifestError {
    Malformed,
    TooLarge,
    UnsupportedManifestVersion,
    UnknownProvider,
    FamilyMismatch,
    UnknownCapability,
    MissingCapability,
    UnknownSupport,
    InvalidLabel,
    InvalidPolicyVersion,
    InvalidLogin,
    InvalidConstraint,
    InvalidPolicy,
    InvalidSource,
    Inconsistent,
}

impl ManifestError {
    pub fn code(self) -> &'static str {
        match self {
            Self::Malformed => "manifest-malformed",
            Self::TooLarge => "manifest-too-large",
            Self::UnsupportedManifestVersion => "unsupported-manifest-version",
            Self::UnknownProvider => "unknown-provider",
            Self::FamilyMismatch => "family-mismatch",
            Self::UnknownCapability => "unknown-capability",
            Self::MissingCapability => "missing-capability",
            Self::UnknownSupport => "unknown-support",
            Self::InvalidLabel => "invalid-label",
            Self::InvalidPolicyVersion => "invalid-policy-version",
            Self::InvalidLogin => "invalid-login",
            Self::InvalidConstraint => "invalid-constraint",
            Self::InvalidPolicy => "invalid-policy",
            Self::InvalidSource => "invalid-source",
            Self::Inconsistent => "manifest-inconsistent",
        }
    }

    fn message(self) -> &'static str {
        match self {
            Self::Malformed => {
                "The provider manifest is not a manifest object with only known fields."
            }
            Self::TooLarge => "The provider manifest is too large.",
            Self::UnsupportedManifestVersion => {
                "The provider manifest uses a format version this release does not read."
            }
            Self::UnknownProvider => "The provider is not one this release supports.",
            Self::FamilyMismatch => {
                "The provider manifest names the wrong family for its provider."
            }
            Self::UnknownCapability => {
                "A capability is not one this release knows, so nothing is assumed about it."
            }
            Self::MissingCapability => "The provider manifest does not declare every capability.",
            Self::UnknownSupport => "A capability has a support level this release does not know.",
            Self::InvalidLabel => "The provider label must be 1 to 60 printable characters.",
            Self::InvalidPolicyVersion => {
                "The policy version must be a date such as 2026-10-29, optionally followed by .N."
            }
            Self::InvalidLogin => {
                "The provider login must name a known method and plain scope names."
            }
            Self::InvalidConstraint => {
                "A provider limit must be a positive whole number or absent."
            }
            Self::InvalidPolicy => {
                "The canonical link or publishing policy is not one this release knows."
            }
            Self::InvalidSource => {
                "Every source must be an https address of the provider's documentation."
            }
            Self::Inconsistent => "The provider manifest contradicts itself.",
        }
    }
}

impl fmt::Display for ManifestError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.message())
    }
}

impl std::error::Error for ManifestError {}

// The wire form, read strictly: an unknown field anywhere refuses the manifest.
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct RawManifest {
    manifest_version: serde_json::Value,
    provider: String,
    family: String,
    label: String,
    policy_version: String,
    capabilities: BTreeMap<String, String>,
    login: RawLogin,
    constraints: RawConstraints,
    canonical: String,
    publishing: String,
    sources: Vec<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawLogin {
    method: String,
    scopes: Vec<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct RawConstraints {
    max_text_chars: Option<serde_json::Value>,
    max_tags: Option<serde_json::Value>,
    max_tag_name_chars: Option<serde_json::Value>,
    max_request_body_bytes: Option<serde_json::Value>,
    schedule_min_lead_seconds: Option<serde_json::Value>,
    schedule_max_horizon_seconds: Option<serde_json::Value>,
}

fn limit(value: Option<serde_json::Value>) -> Result<Option<u32>, ManifestError> {
    match value {
        None | Some(serde_json::Value::Null) => Ok(None),
        Some(serde_json::Value::Number(number)) => number
            .as_u64()
            .filter(|n| *n >= 1 && *n <= u64::from(u32::MAX))
            .map(|n| Some(n as u32))
            .ok_or(ManifestError::InvalidConstraint),
        Some(_) => Err(ManifestError::InvalidConstraint),
    }
}

/// `YYYY-MM-DD` or `YYYY-MM-DD.N` (N 1 to 99), compared as (date, N).
pub fn policy_version_key(value: &str) -> Option<(String, u8)> {
    let (date, revision) = match value.split_once('.') {
        Some((date, revision)) => {
            if revision.is_empty()
                || revision.len() > 2
                || revision.starts_with('0')
                || !revision.bytes().all(|b| b.is_ascii_digit())
            {
                return None;
            }
            (date, revision.parse::<u8>().ok()?)
        }
        None => (value, 0),
    };
    let bytes = date.as_bytes();
    let shaped = bytes.len() == 10
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes
            .iter()
            .enumerate()
            .all(|(i, b)| i == 4 || i == 7 || b.is_ascii_digit());
    if !shaped {
        return None;
    }
    let month: u8 = date[5..7].parse().ok()?;
    let day: u8 = date[8..10].parse().ok()?;
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) || &date[..4] < "2020" {
        return None;
    }
    Some((date.to_string(), revision))
}

fn valid_scope(scope: &str) -> bool {
    (1..=80).contains(&scope.len())
        && scope
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'.' | b':' | b'-'))
}

fn valid_source(source: &str) -> bool {
    source.len() <= 500
        && url::Url::parse(source).is_ok_and(|url| {
            url.scheme() == "https"
                && url.username().is_empty()
                && url.password().is_none()
                && url.host_str().is_some_and(|host| host.contains('.'))
        })
}

impl ProviderManifest {
    /// Reads a manifest from JSON text, refusing it whole on anything unknown or out of shape.
    pub fn from_json(text: &str) -> Result<Self, ManifestError> {
        if text.len() > MAX_MANIFEST_BYTES {
            return Err(ManifestError::TooLarge);
        }
        let value: serde_json::Value =
            serde_json::from_str(text).map_err(|_| ManifestError::Malformed)?;
        Self::from_value(value)
    }

    /// Reads a manifest from a JSON value, with the same rules as [`ProviderManifest::from_json`].
    pub fn from_value(value: serde_json::Value) -> Result<Self, ManifestError> {
        // The version is read first, so a manifest of a later format is named as such rather than
        // as malformed because of the fields it added.
        let version = value
            .get("manifestVersion")
            .ok_or(ManifestError::Malformed)?;
        if version.as_u64() != Some(u64::from(MANIFEST_VERSION)) {
            return Err(ManifestError::UnsupportedManifestVersion);
        }
        let raw: RawManifest =
            serde_json::from_value(value).map_err(|_| ManifestError::Malformed)?;
        let _ = raw.manifest_version;
        let provider = ProviderId::parse(&raw.provider)?;
        let family = match raw.family.as_str() {
            "syndication" => Family::Syndication,
            "social" => Family::Social,
            _ => return Err(ManifestError::FamilyMismatch),
        };
        if family != provider.family() {
            return Err(ManifestError::FamilyMismatch);
        }
        let label_chars = raw.label.chars().count();
        if !(1..=60).contains(&label_chars)
            || raw.label.trim() != raw.label
            || raw.label.chars().any(char::is_control)
        {
            return Err(ManifestError::InvalidLabel);
        }
        if policy_version_key(&raw.policy_version).is_none() {
            return Err(ManifestError::InvalidPolicyVersion);
        }
        let mut capabilities = BTreeMap::new();
        for (name, support) in &raw.capabilities {
            capabilities.insert(Capability::parse(name)?, Support::parse(support)?);
        }
        if capabilities.len() != Capability::ALL.len() {
            return Err(ManifestError::MissingCapability);
        }
        let method = LoginMethod::parse(&raw.login.method)?;
        if raw.login.scopes.len() > 20
            || !raw.login.scopes.iter().all(|scope| valid_scope(scope))
            || raw.login.scopes.iter().collect::<BTreeSet<_>>().len() != raw.login.scopes.len()
            || (method != LoginMethod::Oauth2 && !raw.login.scopes.is_empty())
        {
            return Err(ManifestError::InvalidLogin);
        }
        let constraints = Constraints {
            max_text_chars: limit(raw.constraints.max_text_chars)?,
            max_tags: limit(raw.constraints.max_tags)?,
            max_tag_name_chars: limit(raw.constraints.max_tag_name_chars)?,
            max_request_body_bytes: limit(raw.constraints.max_request_body_bytes)?,
            schedule_min_lead_seconds: limit(raw.constraints.schedule_min_lead_seconds)?,
            schedule_max_horizon_seconds: limit(raw.constraints.schedule_max_horizon_seconds)?,
        };
        if raw.sources.is_empty()
            || raw.sources.len() > 20
            || !raw.sources.iter().all(|source| valid_source(source))
        {
            return Err(ManifestError::InvalidSource);
        }
        let manifest = Self {
            manifest_version: MANIFEST_VERSION,
            provider,
            family,
            label: raw.label,
            policy_version: raw.policy_version,
            capabilities,
            login: Login {
                method,
                scopes: raw.login.scopes,
            },
            constraints,
            canonical: CanonicalLink::parse(&raw.canonical)?,
            publishing: Publishing::parse(&raw.publishing)?,
            sources: raw.sources,
        };
        manifest.consistent()?;
        Ok(manifest)
    }

    // Facts that cannot hold together: a remote adapter that needs no login, a manual-only
    // destination that claims an adapter, a schedule window that closes before it opens.
    fn consistent(&self) -> Result<(), ManifestError> {
        let any_adapter = self.capabilities.values().any(|s| *s == Support::Adapter);
        let incoherent = (any_adapter
            && (self.login.method == LoginMethod::None || self.publishing == Publishing::Manual))
            || (self.publishing == Publishing::DraftOnly
                && self.support(Capability::Draft) != Support::Adapter)
            || (self.family == Family::Social && self.canonical != CanonicalLink::Linked)
            || matches!(
                (
                    self.constraints.schedule_min_lead_seconds,
                    self.constraints.schedule_max_horizon_seconds
                ),
                (Some(min), Some(max)) if min >= max
            );
        if incoherent {
            Err(ManifestError::Inconsistent)
        } else {
            Ok(())
        }
    }

    /// The declared support for one capability. A manifest that was read always declares all of
    /// them; anything missing is treated as unsupported.
    pub fn support(&self, capability: Capability) -> Support {
        self.capabilities
            .get(&capability)
            .copied()
            .unwrap_or(Support::Unsupported)
    }

    /// Everything that keeps this destination from taking `request` through its adapter, in a
    /// fixed order. Empty means eligible. A capability the author would have to perform by hand
    /// is reported as manual, never performed or skipped silently.
    pub fn check(&self, request: &DistributionRequest) -> Vec<Ineligibility> {
        let mut problems = Vec::new();
        for capability in &request.capabilities {
            match self.support(*capability) {
                Support::Adapter => {}
                Support::Manual => problems.push(Ineligibility::ManualOnly(*capability)),
                Support::Unsupported => problems.push(Ineligibility::Unsupported(*capability)),
            }
        }
        let c = &self.constraints;
        let over = |value: Option<usize>, limit: Option<u32>| matches!((value, limit), (Some(v), Some(l)) if v > l as usize);
        if over(request.text_chars, c.max_text_chars) {
            problems.push(Ineligibility::TextTooLong(c.max_text_chars.unwrap_or(0)));
        }
        if over(Some(request.tags), c.max_tags) {
            problems.push(Ineligibility::TooManyTags(c.max_tags.unwrap_or(0)));
        }
        if over(Some(request.longest_tag_chars), c.max_tag_name_chars) {
            problems.push(Ineligibility::TagTooLong(c.max_tag_name_chars.unwrap_or(0)));
        }
        if over(request.body_bytes, c.max_request_body_bytes) {
            problems.push(Ineligibility::BodyTooLarge(
                c.max_request_body_bytes.unwrap_or(0),
            ));
        }
        if let Some(lead) = request.schedule_lead_seconds {
            if !request.capabilities.contains(&Capability::Schedule) {
                problems.push(Ineligibility::ScheduleNotRequested);
            } else if matches!(c.schedule_min_lead_seconds, Some(min) if lead < i64::from(min)) {
                problems.push(Ineligibility::ScheduleTooSoon(
                    c.schedule_min_lead_seconds.unwrap_or(0),
                ));
            } else if matches!(c.schedule_max_horizon_seconds, Some(max) if lead > i64::from(max)) {
                problems.push(Ineligibility::ScheduleTooFar(
                    c.schedule_max_horizon_seconds.unwrap_or(0),
                ));
            }
        }
        problems
    }

    /// The manifest as canonical JSON (keys in a fixed order), as the fixture holds it.
    pub fn to_json_value(&self) -> serde_json::Value {
        serde_json::to_value(self).unwrap_or(serde_json::Value::Null)
    }
}

/// What one distribution asks of one destination.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct DistributionRequest {
    pub capabilities: BTreeSet<Capability>,
    /// The length of the destination-written text, in Unicode scalar values.
    pub text_chars: Option<usize>,
    pub tags: usize,
    pub longest_tag_chars: usize,
    /// The size of the request body the adapter would send, when it is known.
    pub body_bytes: Option<usize>,
    /// Seconds from now to the scheduled delivery, when one is asked for.
    pub schedule_lead_seconds: Option<i64>,
}

impl DistributionRequest {
    pub fn new(capabilities: impl IntoIterator<Item = Capability>) -> Self {
        Self {
            capabilities: capabilities.into_iter().collect(),
            ..Self::default()
        }
    }
}

/// A destination-specific reason a request cannot go through the adapter. Messages are fixed text
/// plus the provider's label and the declared limit, never the author's content.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Ineligibility {
    ManualOnly(Capability),
    Unsupported(Capability),
    TextTooLong(u32),
    TooManyTags(u32),
    TagTooLong(u32),
    BodyTooLarge(u32),
    ScheduleNotRequested,
    ScheduleTooSoon(u32),
    ScheduleTooFar(u32),
}

impl Ineligibility {
    pub fn code(&self) -> &'static str {
        match self {
            Self::ManualOnly(_) => "capability-manual",
            Self::Unsupported(_) => "capability-unsupported",
            Self::TextTooLong(_) => "text-too-long",
            Self::TooManyTags(_) => "too-many-tags",
            Self::TagTooLong(_) => "tag-too-long",
            Self::BodyTooLarge(_) => "body-too-large",
            Self::ScheduleNotRequested => "schedule-not-requested",
            Self::ScheduleTooSoon(_) => "schedule-too-soon",
            Self::ScheduleTooFar(_) => "schedule-too-far",
        }
    }

    pub fn capability(&self) -> Option<Capability> {
        match self {
            Self::ManualOnly(capability) | Self::Unsupported(capability) => Some(*capability),
            _ => None,
        }
    }

    pub fn message(&self, label: &str) -> String {
        match self {
            Self::ManualOnly(capability) => format!(
                "{label} can take {} only by hand; open.blog will not do it for you.",
                capability.as_str()
            ),
            Self::Unsupported(capability) => format!(
                "{label} cannot take {} from open.blog.",
                capability.as_str()
            ),
            Self::TextTooLong(limit) => {
                format!("{label} takes at most {limit} characters of text.")
            }
            Self::TooManyTags(limit) => format!("{label} takes at most {limit} tags."),
            Self::TagTooLong(limit) => {
                format!("{label} takes tags of at most {limit} characters.")
            }
            Self::BodyTooLarge(limit) => {
                format!("{label} takes a request of at most {limit} bytes.")
            }
            Self::ScheduleNotRequested => {
                format!("A time was given for {label} without asking to schedule.")
            }
            Self::ScheduleTooSoon(min) => {
                format!("{label} needs a scheduled time at least {min} seconds ahead.")
            }
            Self::ScheduleTooFar(max) => {
                format!("{label} takes a scheduled time at most {max} seconds ahead.")
            }
        }
    }
}

/// The manifest this release's adapter for `provider` implements.
pub fn builtin_manifest(provider: ProviderId) -> ProviderManifest {
    use Capability::*;
    use Support::*;
    let support = |pairs: [(Capability, Support); 7]| pairs.into_iter().collect();
    let sources = |list: &[&str]| list.iter().map(|s| (*s).to_string()).collect();
    match provider.family() {
        Family::Syndication => {
            let syndication = match provider {
                ProviderId::Dev => SyndicationProvider::Dev,
                ProviderId::Hashnode => SyndicationProvider::Hashnode,
                ProviderId::Ghost => SyndicationProvider::Ghost,
                ProviderId::Wordpress => SyndicationProvider::Wordpress,
                _ => SyndicationProvider::Medium,
            };
            // The limits and the publishing rule are the destination policy's own (ADR 0004), so
            // a policy change shows up here and in the fixture at once.
            let policy = destination_policy(syndication);
            let (publishing, login) = match policy.publication {
                DestinationPublication::RemoteDraftByDefault => (
                    Publishing::ExplicitApproval,
                    LoginMethod::EnvironmentCredential,
                ),
                DestinationPublication::RemoteDraftOnly => {
                    (Publishing::DraftOnly, LoginMethod::EnvironmentCredential)
                }
                DestinationPublication::ManualImport => (Publishing::Manual, LoginMethod::None),
            };
            let (capabilities, canonical, docs): (BTreeMap<_, _>, _, &[&str]) = match provider {
                ProviderId::Dev => (
                    support([
                        (Link, Unsupported),
                        (Text, Unsupported),
                        (Article, Adapter),
                        (Image, Adapter),
                        (Video, Unsupported),
                        (Draft, Adapter),
                        (Schedule, Unsupported),
                    ]),
                    CanonicalLink::Sent,
                    &[
                        "https://developers.forem.com/api/v1#tag/articles",
                        "https://github.com/forem/forem/blob/main/app/models/article.rb",
                    ],
                ),
                ProviderId::Hashnode => (
                    support([
                        (Link, Unsupported),
                        (Text, Unsupported),
                        (Article, Adapter),
                        (Image, Adapter),
                        (Video, Unsupported),
                        (Draft, Adapter),
                        (Schedule, Unsupported),
                    ]),
                    CanonicalLink::Sent,
                    &[
                        "https://github.com/Hashnode/gql-skill/blob/main/skills/gql-api/references/schema.graphql",
                        "https://github.com/Hashnode/gql-skill/blob/main/skills/gql-api/references/errors-and-limits.md",
                    ],
                ),
                ProviderId::Ghost => (
                    support([
                        (Link, Unsupported),
                        (Text, Unsupported),
                        (Article, Adapter),
                        (Image, Adapter),
                        (Video, Unsupported),
                        (Draft, Adapter),
                        (Schedule, Unsupported),
                    ]),
                    CanonicalLink::Sent,
                    &[
                        "https://docs.ghost.org/admin-api/posts/creating-a-post",
                        "https://ghost.org/changelog/canonical-urls/",
                    ],
                ),
                ProviderId::Wordpress => (
                    support([
                        (Link, Unsupported),
                        (Text, Unsupported),
                        (Article, Adapter),
                        (Image, Adapter),
                        (Video, Unsupported),
                        (Draft, Adapter),
                        (Schedule, Manual),
                    ]),
                    CanonicalLink::NotSupported,
                    &["https://developer.wordpress.org/rest-api/reference/posts/"],
                ),
                _ => (
                    support([
                        (Link, Unsupported),
                        (Text, Unsupported),
                        (Article, Manual),
                        (Image, Manual),
                        (Video, Unsupported),
                        (Draft, Manual),
                        (Schedule, Unsupported),
                    ]),
                    CanonicalLink::Manual,
                    &["https://help.medium.com/hc/en-us/articles/214550207-Importing-a-post-to-Medium"],
                ),
            };
            ProviderManifest {
                manifest_version: MANIFEST_VERSION,
                provider,
                family: Family::Syndication,
                label: policy.label.to_string(),
                policy_version: BUILTIN_POLICY_VERSION.to_string(),
                capabilities,
                login: Login {
                    method: login,
                    scopes: Vec::new(),
                },
                constraints: Constraints {
                    max_tags: policy.max_tags.map(|n| n as u32),
                    max_tag_name_chars: policy.max_tag_name_chars.map(|n| n as u32),
                    max_request_body_bytes: policy.max_request_body_bytes.map(|n| n as u32),
                    ..Constraints::default()
                },
                canonical,
                publishing,
                sources: sources(docs),
            }
        }
        Family::Social => {
            // Scheduling is open.blog's own queue (ADRs 0308, 0316), so its window is the queue's.
            let schedule = Constraints {
                schedule_min_lead_seconds: Some(MIN_LEAD_SECONDS as u32),
                schedule_max_horizon_seconds: Some(MAX_HORIZON_SECONDS as u32),
                ..Constraints::default()
            };
            let social = support([
                (Link, Adapter),
                (Text, Adapter),
                (Article, Unsupported),
                (Image, Manual),
                (Video, Manual),
                (Draft, Unsupported),
                (Schedule, Adapter),
            ]);
            let (label, scopes, constraints, docs): (_, &[&str], _, &[&str]) = if provider
                == ProviderId::Linkedin
            {
                (
                        "LinkedIn",
                        &["openid", "profile", "w_member_social"],
                        Constraints {
                            max_text_chars: Some(3000),
                            ..schedule
                        },
                        &[
                            "https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api",
                            "https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/post-api-schema",
                        ],
                    )
            } else {
                (
                    "Facebook",
                    &["pages_show_list", "pages_manage_posts"],
                    schedule,
                    &[
                        "https://developers.facebook.com/docs/pages-api/posts",
                        "https://developers.facebook.com/docs/graph-api/reference/page/feed",
                    ],
                )
            };
            ProviderManifest {
                manifest_version: MANIFEST_VERSION,
                provider,
                family: Family::Social,
                label: label.to_string(),
                policy_version: BUILTIN_POLICY_VERSION.to_string(),
                capabilities: social,
                login: Login {
                    method: LoginMethod::Oauth2,
                    scopes: scopes.iter().map(|s| (*s).to_string()).collect(),
                },
                constraints,
                canonical: CanonicalLink::Linked,
                publishing: Publishing::ExplicitApproval,
                sources: sources(docs),
            }
        }
    }
}

/// Every built-in manifest, in [`ProviderId::ALL`] order.
pub fn builtin_manifests() -> Vec<ProviderManifest> {
    ProviderId::ALL.into_iter().map(builtin_manifest).collect()
}

/// How a newer manifest of a provider relates to an older one (ADR 0722).
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Compatibility {
    /// Nothing that a plan depends on changed.
    Same,
    /// Only widened support, looser limits or documentation changed: approvals stand.
    Compatible,
    /// Something a plan may depend on narrowed or changed: approvals made under the older policy
    /// version are void and the author previews and approves again.
    Breaking,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CompatibilityReport {
    pub level: Compatibility,
    /// Fixed change codes such as `capability-narrowed:image`, in a stable order.
    pub changes: Vec<String>,
}

/// Why two manifests cannot be compared as an upgrade.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UpgradeError {
    /// They describe different providers.
    DifferentProvider,
    /// The newer manifest changed something but kept or lowered the policy version.
    PolicyVersionNotRaised,
}

impl UpgradeError {
    pub fn code(self) -> &'static str {
        match self {
            Self::DifferentProvider => "different-provider",
            Self::PolicyVersionNotRaised => "policy-version-not-raised",
        }
    }
}

/// Classifies the move from `old` to `new`. Any change at all must raise the policy version, so an
/// approval pinned to a policy version always means one set of facts.
pub fn compatibility(
    old: &ProviderManifest,
    new: &ProviderManifest,
) -> Result<CompatibilityReport, UpgradeError> {
    if old.provider != new.provider {
        return Err(UpgradeError::DifferentProvider);
    }
    let mut breaking = Vec::new();
    let mut compatible = Vec::new();
    if old.manifest_version != new.manifest_version || old.family != new.family {
        breaking.push("manifest-format-changed".to_string());
    }
    for capability in Capability::ALL {
        let (before, after) = (old.support(capability), new.support(capability));
        if after < before {
            breaking.push(format!("capability-narrowed:{}", capability.as_str()));
        } else if after > before {
            compatible.push(format!("capability-widened:{}", capability.as_str()));
        }
    }
    let (before, after) = (old.constraints.values(), new.constraints.values());
    for index in 0..Constraints::NAMES.len() {
        let name = Constraints::NAMES[index];
        let tighter = match (before[index], after[index]) {
            (a, b) if a == b => continue,
            (None, Some(_)) => Constraints::larger_is_looser(index),
            (Some(_), None) => !Constraints::larger_is_looser(index),
            (Some(a), Some(b)) => (b < a) == Constraints::larger_is_looser(index),
            (None, None) => continue,
        };
        if tighter {
            breaking.push(format!("constraint-tightened:{name}"));
        } else {
            compatible.push(format!("constraint-loosened:{name}"));
        }
    }
    if old.login != new.login {
        breaking.push("login-changed".to_string());
    }
    if old.canonical != new.canonical {
        breaking.push("canonical-changed".to_string());
    }
    if old.publishing != new.publishing {
        breaking.push("publishing-changed".to_string());
    }
    if old.label != new.label || old.sources != new.sources {
        compatible.push("documentation-changed".to_string());
    }
    let level = if !breaking.is_empty() {
        Compatibility::Breaking
    } else if !compatible.is_empty() {
        Compatibility::Compatible
    } else {
        Compatibility::Same
    };
    let raised = match (
        policy_version_key(&old.policy_version),
        policy_version_key(&new.policy_version),
    ) {
        (Some(a), Some(b)) => b > a,
        _ => false,
    };
    if level != Compatibility::Same && !raised {
        return Err(UpgradeError::PolicyVersionNotRaised);
    }
    breaking.extend(compatible);
    Ok(CompatibilityReport {
        level,
        changes: breaking,
    })
}

/// Whether an approval given under `approved_policy_version` still stands for `current`. It stands
/// only for the same policy version, or when every manifest between is compatible; the caller
/// passes the manifest the approval was given under so that the step can be classified.
pub fn approval_stands(approved_under: &ProviderManifest, current: &ProviderManifest) -> bool {
    approved_under.policy_version == current.policy_version
        || compatibility(approved_under, current)
            .is_ok_and(|report| report.level != Compatibility::Breaking)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_builtin_manifest_reads_back_as_itself() {
        for manifest in builtin_manifests() {
            let text = serde_json::to_string(&manifest).unwrap();
            assert_eq!(ProviderManifest::from_json(&text), Ok(manifest));
        }
    }

    #[test]
    fn policy_versions_order_by_date_then_revision() {
        let key = |v| policy_version_key(v).unwrap();
        assert!(key("2026-10-29.2") > key("2026-10-29"));
        assert!(key("2026-11-01") > key("2026-10-29.9"));
        for bad in [
            "2026-13-01",
            "2026-10-29.0",
            "2026-10-29.",
            "26-10-29",
            "2026-10-29.100",
            "latest",
        ] {
            assert_eq!(policy_version_key(bad), None, "{bad}");
        }
    }

    #[test]
    fn a_syndication_manifest_keeps_the_destination_policy_limits() {
        for provider in crate::portability::destination_policies() {
            let manifest = builtin_manifest(provider.provider.into());
            assert_eq!(manifest.label, provider.label);
            assert_eq!(
                manifest.constraints.max_tags,
                provider.max_tags.map(|n| n as u32)
            );
            assert_eq!(
                manifest.constraints.max_request_body_bytes,
                provider.max_request_body_bytes.map(|n| n as u32)
            );
        }
    }
}
