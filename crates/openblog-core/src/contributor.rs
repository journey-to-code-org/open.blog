//! Reusable contributor identities and ordered, work-specific credit relationships.

use std::collections::{BTreeMap, HashSet};

use http::Uri;
use serde::{Deserialize, Serialize};

use crate::config::Author;

const CROSSREF_ROLES: &[&str] = &[
    "author",
    "corresponding-author",
    "editor",
    "chair",
    "other",
    "reviewer",
    "review-assistant",
    "reviewer-external",
    "stats-reviewer",
    "reader",
    "translator",
];

const CREDIT_ROLES: &[&str] = &[
    "conceptualization",
    "data-curation",
    "formal-analysis",
    "funding-acquisition",
    "investigation",
    "methodology",
    "project-administration",
    "resources",
    "software",
    "supervision",
    "validation",
    "visualization",
    "writing-original-draft",
    "writing-review-editing",
];

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct Contributor {
    pub name: String,
    pub url: String,
    pub same_as: Vec<String>,
    /// A manually supplied ORCID iD. Editable configuration can never assert
    /// authenticated provenance.
    pub orcid: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum RoleVocabulary {
    Crossref,
    Credit,
}

impl RoleVocabulary {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Crossref => "crossref",
            Self::Credit => "credit",
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct CreditRole {
    pub vocabulary: RoleVocabulary,
    pub role: String,
}

impl CreditRole {
    pub fn is_author(&self) -> bool {
        self.vocabulary == RoleVocabulary::Crossref && self.role == "author"
    }

    /// Stable, human-readable label for the controlled role value.
    pub fn label(&self) -> &'static str {
        match (self.vocabulary, self.role.as_str()) {
            (RoleVocabulary::Crossref, "author") => "Author",
            (RoleVocabulary::Crossref, "corresponding-author") => "Corresponding author",
            (RoleVocabulary::Crossref, "editor") => "Editor",
            (RoleVocabulary::Crossref, "chair") => "Chair",
            (RoleVocabulary::Crossref, "other") => "Other",
            (RoleVocabulary::Crossref, "reviewer") => "Reviewer",
            (RoleVocabulary::Crossref, "review-assistant") => "Review assistant",
            (RoleVocabulary::Crossref, "reviewer-external") => "External reviewer",
            (RoleVocabulary::Crossref, "stats-reviewer") => "Statistical reviewer",
            (RoleVocabulary::Crossref, "reader") => "Reader",
            (RoleVocabulary::Crossref, "translator") => "Translator",
            (RoleVocabulary::Credit, "conceptualization") => "Conceptualization",
            (RoleVocabulary::Credit, "data-curation") => "Data curation",
            (RoleVocabulary::Credit, "formal-analysis") => "Formal analysis",
            (RoleVocabulary::Credit, "funding-acquisition") => "Funding acquisition",
            (RoleVocabulary::Credit, "investigation") => "Investigation",
            (RoleVocabulary::Credit, "methodology") => "Methodology",
            (RoleVocabulary::Credit, "project-administration") => "Project administration",
            (RoleVocabulary::Credit, "resources") => "Resources",
            (RoleVocabulary::Credit, "software") => "Software",
            (RoleVocabulary::Credit, "supervision") => "Supervision",
            (RoleVocabulary::Credit, "validation") => "Validation",
            (RoleVocabulary::Credit, "visualization") => "Visualization",
            (RoleVocabulary::Credit, "writing-original-draft") => "Writing – original draft",
            (RoleVocabulary::Credit, "writing-review-editing") => "Writing – review & editing",
            _ => "Contributor",
        }
    }
}

/// Controlled role values in stable UI order.
pub fn role_catalog() -> Vec<CreditRole> {
    CROSSREF_ROLES
        .iter()
        .map(|role| CreditRole {
            vocabulary: RoleVocabulary::Crossref,
            role: (*role).to_string(),
        })
        .chain(CREDIT_ROLES.iter().map(|role| CreditRole {
            vocabulary: RoleVocabulary::Credit,
            role: (*role).to_string(),
        }))
        .collect()
}

/// The contributor id of a legacy post's default credit, which comes from the site author in
/// `openblog.json` rather than from the contributor registry.
pub const SITE_AUTHOR_ID: &str = "site-author";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ResolvedCredit {
    pub contributor_id: String,
    pub contributor: Contributor,
    pub roles: Vec<CreditRole>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CreditProvenance {
    LegacySiteAuthor,
    ExplicitSidecar,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct CreditFile {
    version: u32,
    credits: Vec<AuthoredCredit>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct AuthoredCredit {
    contributor: String,
    roles: Vec<CreditRole>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct SnapshotCreditFile {
    version: u32,
    credits: Vec<SnapshotCredit>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct SnapshotCredit {
    identity: SnapshotIdentity,
    roles: Vec<CreditRole>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
enum SnapshotIdentity {
    Profile {
        contributor: String,
        profile: Contributor,
    },
    DisplayName {
        id: String,
        name: String,
    },
}

pub fn normalize_registry(contributors: &mut BTreeMap<String, Contributor>) -> Result<(), String> {
    for (id, contributor) in contributors {
        if !valid_registry_key(id) {
            return Err(format!(
                "contributors.{id}: key must be a lowercase ASCII slug such as `ada-lovelace`"
            ));
        }
        if contributor.name.trim().is_empty() {
            return Err(format!("contributors.{id}.name must not be empty"));
        }
        contributor.name = contributor.name.trim().to_string();
        contributor.url = contributor.url.trim().to_string();
        if !contributor.url.is_empty() && !safe_profile_url(&contributor.url) {
            return Err(format!(
                "contributors.{id}.url must be an absolute HTTP(S) URL or a site-root path"
            ));
        }
        contributor.same_as = contributor
            .same_as
            .iter()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .collect();
        if contributor
            .same_as
            .iter()
            .any(|value| value.starts_with('/') || !safe_profile_url(value))
        {
            return Err(format!(
                "contributors.{id}.sameAs must contain only absolute HTTP(S) URLs"
            ));
        }
        contributor.orcid = normalize_orcid(&contributor.orcid)
            .map_err(|error| format!("contributors.{id}.orcid: {error}"))?;
    }
    Ok(())
}

pub fn resolve(
    legacy_author: &Author,
    contributors: &BTreeMap<String, Contributor>,
    sidecar: Option<&str>,
) -> Result<(Vec<ResolvedCredit>, CreditProvenance), String> {
    let Some(sidecar) = sidecar else {
        let contributor = Contributor {
            name: legacy_author.name.clone(),
            url: legacy_author.url.clone(),
            same_as: legacy_author.same_as.clone(),
            orcid: String::new(),
        };
        return Ok((
            vec![ResolvedCredit {
                contributor_id: SITE_AUTHOR_ID.into(),
                contributor,
                roles: vec![CreditRole {
                    vocabulary: RoleVocabulary::Crossref,
                    role: "author".into(),
                }],
            }],
            CreditProvenance::LegacySiteAuthor,
        ));
    };

    let version = serde_json::from_str::<serde_json::Value>(sidecar)
        .map_err(|error| format!("invalid credit JSON: {error}"))?
        .get("version")
        .and_then(serde_json::Value::as_u64);
    if version == Some(2) {
        return resolve_snapshots(sidecar);
    }
    let authored: CreditFile =
        serde_json::from_str(sidecar).map_err(|error| format!("invalid credit JSON: {error}"))?;
    if authored.version != 1 {
        return Err(format!(
            "unsupported credit file version {}; expected version 1 or 2",
            authored.version
        ));
    }

    let mut seen_contributors = HashSet::new();
    let mut resolved = Vec::with_capacity(authored.credits.len());
    for credit in authored.credits {
        if !seen_contributors.insert(credit.contributor.clone()) {
            return Err(format!(
                "duplicate contributor `{}`; combine that person's roles in one credit",
                credit.contributor
            ));
        }
        let contributor = contributors.get(&credit.contributor).ok_or_else(|| {
            format!(
                "unknown contributor `{}`; add it to openblog.json `contributors`",
                credit.contributor
            )
        })?;
        validate_roles(&credit.contributor, &credit.roles)?;
        resolved.push(ResolvedCredit {
            contributor_id: credit.contributor,
            contributor: contributor.clone(),
            roles: credit.roles,
        });
    }
    Ok((resolved, CreditProvenance::ExplicitSidecar))
}

fn validate_roles(contributor: &str, roles: &[CreditRole]) -> Result<(), String> {
    if roles.is_empty() {
        return Err(format!(
            "contributor `{}` must have at least one role",
            contributor
        ));
    }
    let mut seen_roles = HashSet::new();
    for role in roles {
        let known = match role.vocabulary {
            RoleVocabulary::Crossref => CROSSREF_ROLES.contains(&role.role.as_str()),
            RoleVocabulary::Credit => CREDIT_ROLES.contains(&role.role.as_str()),
        };
        if !known {
            return Err(format!(
                "unknown {} role `{}` for contributor `{}`",
                role.vocabulary.as_str(),
                role.role,
                contributor
            ));
        }
        if !seen_roles.insert((role.vocabulary, role.role.as_str())) {
            return Err(format!(
                "duplicate role `{}:{}` for contributor `{}`",
                role.vocabulary.as_str(),
                role.role,
                contributor
            ));
        }
    }
    Ok(())
}

fn resolve_snapshots(sidecar: &str) -> Result<(Vec<ResolvedCredit>, CreditProvenance), String> {
    let file: SnapshotCreditFile =
        serde_json::from_str(sidecar).map_err(|error| format!("invalid credit JSON: {error}"))?;
    if file.version != 2 {
        return Err("unsupported snapshot credit version".into());
    }
    let mut ids = HashSet::new();
    let mut resolved = Vec::with_capacity(file.credits.len());
    for credit in file.credits {
        let (id, contributor) = match credit.identity {
            SnapshotIdentity::Profile {
                contributor,
                profile,
            } => {
                if !crate::collaboration::valid_contributor_id(&contributor)
                    || !crate::collaboration::valid_text(
                        &profile.name,
                        crate::collaboration::MAX_DISPLAY_NAME_BYTES,
                    )
                {
                    return Err("invalid snapshot contributor".into());
                }
                let mut registry = BTreeMap::from([(contributor.clone(), profile.clone())]);
                normalize_registry(&mut registry)?;
                if registry.get(&contributor) != Some(&profile) {
                    return Err("snapshot contributor is not canonical".into());
                }
                (contributor, profile)
            }
            SnapshotIdentity::DisplayName { id, name } => {
                if id.len() != 32
                    || !id
                        .bytes()
                        .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
                    || !crate::collaboration::valid_text(
                        &name,
                        crate::collaboration::MAX_DISPLAY_NAME_BYTES,
                    )
                {
                    return Err("invalid display-name credit".into());
                }
                (
                    format!("~display-{id}"),
                    Contributor {
                        name,
                        ..Contributor::default()
                    },
                )
            }
        };
        if !ids.insert(id.clone()) {
            return Err("duplicate snapshot credit".into());
        }
        validate_roles(&id, &credit.roles)?;
        resolved.push(ResolvedCredit {
            contributor_id: id,
            contributor,
            roles: credit.roles,
        });
    }
    Ok((resolved, CreditProvenance::ExplicitSidecar))
}

/// The contributor registry keys of a credits sidecar, in the order it lists
/// them, or `None` when it is not a readable supported sidecar. Display-name-only
/// identities have no registry key and are omitted. No private record or registry is read.
pub fn credited_ids(sidecar: &str) -> Option<Vec<String>> {
    if let Ok(file) = serde_json::from_str::<SnapshotCreditFile>(sidecar) {
        if file.version == 2 {
            return Some(
                file.credits
                    .into_iter()
                    .filter_map(|credit| match credit.identity {
                        SnapshotIdentity::Profile { contributor, .. } => Some(contributor),
                        SnapshotIdentity::DisplayName { .. } => None,
                    })
                    .collect(),
            );
        }
    }
    let file: CreditFile = serde_json::from_str(sidecar).ok()?;
    (file.version == 1).then(|| {
        file.credits
            .into_iter()
            .map(|credit| credit.contributor)
            .collect()
    })
}

/// The ordered, escaped "Contributions" list: each credited name (linked through
/// `link` when the contributor has a URL), its role labels, and a manually
/// entered ORCID iD marked as unauthenticated. `orcid_icon` is the bundled
/// icon's path, left out where the output has no site assets. This is
/// attribution for the work, never a list of references.
pub(crate) fn contributions_html<E>(
    credits: &[ResolvedCredit],
    link: impl Fn(&str) -> Result<String, E>,
    orcid_icon: Option<&str>,
) -> Result<String, E> {
    use crate::escape::{attr, text};
    let mut html = String::from(
        "<aside class=\"ob-contributions\" aria-labelledby=\"ob-contributions-title\">\n<h2 id=\"ob-contributions-title\" class=\"ob-contributions-title\">Contributions</h2>\n<ul>\n",
    );
    for credit in credits {
        html.push_str("<li><div><span class=\"ob-contributor-name\">");
        let url = credit.contributor.url.trim();
        if url.is_empty() {
            html.push_str(&text(&credit.contributor.name));
        } else {
            html.push_str(&format!(
                "<a href=\"{}\">{}</a>",
                attr(&link(url)?),
                text(&credit.contributor.name)
            ));
        }
        html.push_str("</span><span class=\"ob-contributor-roles\">");
        html.push_str(&text(
            &credit
                .roles
                .iter()
                .map(|role| role.label())
                .collect::<Vec<_>>()
                .join(", "),
        ));
        html.push_str("</span></div>");
        if !credit.contributor.orcid.is_empty() {
            let id = credit
                .contributor
                .orcid
                .trim_start_matches("https://orcid.org/");
            let icon = orcid_icon.map_or_else(String::new, |icon| {
                format!(
                    "<span class=\"ob-orcid-icon\" aria-hidden=\"true\"><img src=\"{}\" alt=\"\" loading=\"lazy\" decoding=\"async\"></span>",
                    attr(icon)
                )
            });
            html.push_str(&format!(
                "<p class=\"ob-orcid\"><a href=\"{}\" aria-label=\"View unauthenticated ORCID record – {}\">{icon}{}</a> (unauthenticated)</p>",
                attr(&credit.contributor.orcid),
                attr(id),
                text(&credit.contributor.orcid)
            ));
        }
        html.push_str("</li>\n");
    }
    html.push_str("</ul>\n</aside>\n");
    Ok(html)
}

pub fn sidecar_path(post_path: &str) -> Option<String> {
    let normalized = post_path.replace('\\', "/");
    let stem = normalized
        .strip_suffix(".markdown")
        .or_else(|| normalized.strip_suffix(".md"))?;
    Some(format!("{stem}.credits.json"))
}

pub fn portability_sidecar_path(post_path: &str) -> Option<String> {
    let normalized = post_path.replace('\\', "/");
    let stem = normalized
        .strip_suffix(".markdown")
        .or_else(|| normalized.strip_suffix(".md"))?;
    Some(format!("{stem}.portability.json"))
}

pub(crate) fn valid_registry_key(value: &str) -> bool {
    !value.is_empty()
        && !value.starts_with('-')
        && !value.ends_with('-')
        && value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        && !value.contains("--")
}

pub(crate) fn safe_profile_url(value: &str) -> bool {
    if value
        .chars()
        .any(|character| character.is_control() || character.is_whitespace())
    {
        return false;
    }
    if value.starts_with('/') {
        return !value.starts_with("//") && !value.contains('\\');
    }
    let Ok(uri) = value.parse::<Uri>() else {
        return false;
    };
    if !matches!(uri.scheme_str(), Some("http" | "https")) {
        return false;
    }
    let Some(authority) = uri.authority() else {
        return false;
    };
    let authority_text = authority.as_str();
    if authority_text.contains('@') {
        return false;
    }
    let host = authority.host();
    let suffix = authority_text.strip_prefix(host).unwrap_or_default();
    if !suffix.is_empty()
        && (!suffix.starts_with(':')
            || suffix.len() == 1
            || !suffix[1..].bytes().all(|byte| byte.is_ascii_digit())
            || authority.port_u16().is_none())
    {
        return false;
    }
    !host.is_empty()
        && host != "."
        && !host.starts_with('.')
        && !host.ends_with('.')
        && !host.split('.').any(str::is_empty)
}

fn normalize_orcid(value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() {
        return Ok(String::new());
    }
    let id = value
        .strip_prefix("https://orcid.org/")
        .or_else(|| value.strip_prefix("http://orcid.org/"))
        .unwrap_or(value);
    if id.contains(['/', '?', '#']) {
        return Err("must be an ORCID iD or a full orcid.org URL".into());
    }
    let parts: Vec<&str> = id.split('-').collect();
    if parts.len() != 4 || parts.iter().any(|part| part.len() != 4) {
        return Err("must use the `0000-0000-0000-000X` format".into());
    }
    let compact = parts.concat().to_ascii_uppercase();
    let bytes = compact.as_bytes();
    if bytes.len() != 16
        || !bytes[..15].iter().all(u8::is_ascii_digit)
        || !bytes
            .last()
            .is_some_and(|byte| byte.is_ascii_digit() || *byte == b'X')
    {
        return Err("contains invalid characters".into());
    }
    let mut total = 0_u32;
    for byte in &bytes[..15] {
        total = (total + u32::from(*byte - b'0')) * 2;
    }
    let result = (12 - total % 11) % 11;
    let expected = if result == 10 {
        'X'
    } else {
        char::from_digit(result, 10).unwrap_or('0')
    };
    if !compact.ends_with(expected) {
        return Err("has an invalid MOD 11-2 checksum".into());
    }
    Ok(format!(
        "https://orcid.org/{}-{}-{}-{}",
        &compact[0..4],
        &compact[4..8],
        &compact[8..12],
        &compact[12..16]
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn role_catalog_has_stable_vocabulary_order_and_labels() {
        let catalog = role_catalog();
        assert_eq!(catalog.len(), CROSSREF_ROLES.len() + CREDIT_ROLES.len());
        assert_eq!(catalog[0].vocabulary, RoleVocabulary::Crossref);
        assert_eq!(catalog[0].role, "author");
        assert_eq!(catalog[0].label(), "Author");
        assert_eq!(
            catalog[CROSSREF_ROLES.len()].vocabulary,
            RoleVocabulary::Credit
        );
        assert_eq!(catalog[CROSSREF_ROLES.len()].role, "conceptualization");
        assert_eq!(
            catalog.last().unwrap().label(),
            "Writing – review & editing"
        );
    }

    #[test]
    fn sidecars_follow_both_markdown_extensions() {
        assert_eq!(
            sidecar_path("posts/a.md").as_deref(),
            Some("posts/a.credits.json")
        );
        assert_eq!(
            sidecar_path("posts/a.markdown").as_deref(),
            Some("posts/a.credits.json")
        );
        assert_eq!(
            portability_sidecar_path("posts/a.md").as_deref(),
            Some("posts/a.portability.json")
        );
        assert_eq!(
            portability_sidecar_path("posts/a.markdown").as_deref(),
            Some("posts/a.portability.json")
        );
        assert_eq!(portability_sidecar_path("posts/a.txt"), None);
        assert_eq!(sidecar_path("posts/a.txt"), None);
    }

    #[test]
    fn normalizes_and_checks_orcid() {
        assert_eq!(
            normalize_orcid("0000-0002-1825-0097").unwrap(),
            "https://orcid.org/0000-0002-1825-0097"
        );
        assert!(normalize_orcid("0000-0002-1825-0098")
            .unwrap_err()
            .contains("checksum"));
    }

    #[test]
    fn contributor_profile_urls_are_safe_links_or_site_paths() {
        for accepted in [
            "https://example.com/ada",
            "http://localhost:8080/ada",
            "/people/ada/",
        ] {
            assert!(safe_profile_url(accepted), "expected {accepted} to be safe");
        }
        for rejected in [
            "javascript:alert(1)",
            "data:text/html,boom",
            "//evil.example/ada",
            r"/\evil.example/ada",
            "https://user@example.com/ada",
            "https://bad host.example/ada",
        ] {
            assert!(
                !safe_profile_url(rejected),
                "expected {rejected} to be rejected"
            );
        }
    }

    #[test]
    fn snapshot_credits_freeze_public_details_and_do_not_need_the_registry() {
        let sidecar = r#"{"version":2,"credits":[
          {"identity":{"kind":"profile","contributor":"ann","profile":{"name":"Ann","url":"https://example.org/ann","sameAs":[],"orcid":""}},"roles":[{"vocabulary":"crossref","role":"author"}]},
          {"identity":{"kind":"displayName","id":"0123456789abcdef0123456789abcdef","name":"A. Writer"},"roles":[{"vocabulary":"crossref","role":"author"}]}
        ]}"#;
        let mut registry = BTreeMap::new();
        registry.insert(
            "ann".into(),
            Contributor {
                name: "Changed".into(),
                ..Contributor::default()
            },
        );
        let (credits, provenance) = resolve(&Author::default(), &registry, Some(sidecar)).unwrap();
        assert_eq!(provenance, CreditProvenance::ExplicitSidecar);
        assert_eq!(credits[0].contributor.name, "Ann");
        assert_eq!(credits[0].contributor.url, "https://example.org/ann");
        assert_eq!(credits[1].contributor.name, "A. Writer");
        assert!(credits[1].contributor.url.is_empty());
        assert_eq!(credited_ids(sidecar), Some(vec!["ann".into()]));
        registry.clear();
        assert_eq!(
            resolve(&Author::default(), &registry, Some(sidecar))
                .unwrap()
                .0,
            credits
        );
        let (empty, provenance) = resolve(
            &Author::default(),
            &registry,
            Some(r#"{"version":2,"credits":[]}"#),
        )
        .unwrap();
        assert!(empty.is_empty());
        assert_eq!(provenance, CreditProvenance::ExplicitSidecar);
    }

    #[test]
    fn snapshot_credits_refuse_unsafe_profiles_duplicate_ids_and_bad_roles() {
        for sidecar in [
            r#"{"version":2,"credits":[{"identity":{"kind":"profile","contributor":"ann","profile":{"name":"Ann","url":"javascript:alert(1)"}},"roles":[{"vocabulary":"crossref","role":"author"}]}]}"#,
            r#"{"version":2,"credits":[{"identity":{"kind":"displayName","id":"short","name":"Ann"},"roles":[{"vocabulary":"crossref","role":"author"}]}]}"#,
            r#"{"version":2,"credits":[{"identity":{"kind":"displayName","id":"0123456789abcdef0123456789abcdef","name":"Ann"},"roles":[]}]}"#,
            r#"{"version":2,"credits":[{"identity":{"kind":"displayName","id":"0123456789abcdef0123456789abcdef","name":"Ann"},"roles":[{"vocabulary":"crossref","role":"author"}]},{"identity":{"kind":"displayName","id":"0123456789abcdef0123456789abcdef","name":"Bo"},"roles":[{"vocabulary":"crossref","role":"author"}]}]}"#,
        ] {
            assert!(resolve(&Author::default(), &BTreeMap::new(), Some(sidecar)).is_err());
        }
    }
}
