//! The provider capability contract (ADRs 0325 to 0327), held to
//! `tests/fixtures/provider-manifests.json`, which the hosted function's tests read too.

use openblog_core::provider_manifest::*;
use serde_json::Value;

fn fixture() -> Value {
    serde_json::from_str(include_str!(
        "../../../tests/fixtures/provider-manifests.json"
    ))
    .unwrap()
}

fn strings(value: &Value) -> Vec<String> {
    value
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s.as_str().unwrap().to_string())
        .collect()
}

// Applies a case's `changes` (`{ "set": [path], "value": v }` or `{ "delete": [path] }`).
fn changed(base: &Value, changes: &Value) -> Value {
    let mut value = base.clone();
    for change in changes.as_array().unwrap() {
        let (path, remove) = match change.get("set") {
            Some(path) => (path, false),
            None => (&change["delete"], true),
        };
        let keys = strings(path);
        let (last, parents) = keys.split_last().unwrap();
        let mut target = &mut value;
        for key in parents {
            target = target.get_mut(key.as_str()).unwrap();
        }
        let object = target.as_object_mut().unwrap();
        if remove {
            object.remove(last.as_str());
        } else {
            object.insert(last.clone(), change["value"].clone());
        }
    }
    value
}

fn shipped(provider: &str) -> Value {
    fixture()["manifests"][provider].clone()
}

#[test]
fn the_shipped_manifests_are_the_fixture_exactly() {
    let fixture = fixture();
    assert_eq!(fixture["manifestVersion"], MANIFEST_VERSION);
    let names: Vec<_> = ProviderId::ALL
        .iter()
        .map(|p| p.as_str().to_string())
        .collect();
    let mut listed: Vec<_> = fixture["manifests"]
        .as_object()
        .unwrap()
        .keys()
        .cloned()
        .collect();
    listed.sort();
    let mut sorted = names.clone();
    sorted.sort();
    assert_eq!(listed, sorted, "one manifest per provider, no more");
    for manifest in builtin_manifests() {
        assert_eq!(
            manifest.to_json_value(),
            fixture["manifests"][manifest.provider.as_str()],
            "{}: a provider change must update the fixture and raise its policy version",
            manifest.provider.as_str()
        );
        let read = ProviderManifest::from_value(shipped(manifest.provider.as_str())).unwrap();
        assert_eq!(read, manifest);
    }
    let capabilities: Vec<_> = Capability::ALL
        .iter()
        .map(|c| c.as_str().to_string())
        .collect();
    assert_eq!(strings(&fixture["capabilities"]), capabilities);
}

#[test]
fn every_refused_manifest_fails_closed_with_its_code() {
    for case in fixture()["refused"].as_array().unwrap() {
        let value = changed(&shipped(case["base"].as_str().unwrap()), &case["changes"]);
        let error = ProviderManifest::from_value(value.clone()).unwrap_err();
        assert_eq!(error.code(), case["code"], "{}", case["name"]);
        // The same through the text reader, and the message never repeats what it refused.
        let text = serde_json::to_string(&value).unwrap();
        assert_eq!(ProviderManifest::from_json(&text).unwrap_err(), error);
        for word in [
            "carousel", "partial", "twitter", "password", "maybe", "auto", "webhooks",
        ] {
            assert!(!error.to_string().contains(word), "{}", case["name"]);
        }
    }
    assert_eq!(
        ProviderManifest::from_json("[]").unwrap_err(),
        ManifestError::Malformed
    );
    assert_eq!(
        ProviderManifest::from_json("not json").unwrap_err(),
        ManifestError::Malformed
    );
    let huge = format!("{{\"x\":\"{}\"}}", "a".repeat(MAX_MANIFEST_BYTES));
    assert_eq!(
        ProviderManifest::from_json(&huge).unwrap_err(),
        ManifestError::TooLarge
    );
}

fn request(value: &Value) -> DistributionRequest {
    let names = strings(&value["capabilities"]);
    let number = |key: &str| value.get(key).and_then(Value::as_u64).map(|n| n as usize);
    DistributionRequest {
        capabilities: Capability::parse_list(names.iter().map(String::as_str)).unwrap(),
        text_chars: number("textChars"),
        tags: number("tags").unwrap_or(0),
        longest_tag_chars: number("longestTagChars").unwrap_or(0),
        body_bytes: number("bodyBytes"),
        schedule_lead_seconds: value.get("scheduleLeadSeconds").and_then(Value::as_i64),
    }
}

#[test]
fn a_request_is_checked_against_its_destination() {
    for case in fixture()["requests"].as_array().unwrap() {
        let provider = ProviderId::parse(case["provider"].as_str().unwrap()).unwrap();
        let manifest = builtin_manifest(provider);
        let problems = manifest.check(&request(&case["request"]));
        let codes: Vec<_> = problems.iter().map(|p| p.code().to_string()).collect();
        assert_eq!(codes, strings(&case["codes"]), "{case}");
        for problem in problems {
            let message = problem.message(&manifest.label);
            assert!(message.starts_with(&manifest.label) || message.contains(&manifest.label));
        }
    }
}

#[test]
fn an_unknown_requested_capability_refuses_the_whole_request() {
    for names in fixture()["unknownRequests"].as_array().unwrap() {
        let names = strings(names);
        assert_eq!(
            Capability::parse_list(names.iter().map(String::as_str)),
            Err(ManifestError::UnknownCapability),
            "{names:?}"
        );
    }
}

#[test]
fn an_announcement_needs_only_what_both_social_adapters_do() {
    let needs = strings(&fixture()["announcementNeeds"]);
    let request =
        DistributionRequest::new(Capability::parse_list(needs.iter().map(String::as_str)).unwrap());
    for provider in [ProviderId::Linkedin, ProviderId::Facebook] {
        assert_eq!(builtin_manifest(provider).check(&request), vec![]);
    }
}

#[test]
fn provider_upgrades_are_classified_by_the_compatibility_policy() {
    for case in fixture()["compatibility"].as_array().unwrap() {
        let base = shipped(case["base"].as_str().unwrap());
        let old = ProviderManifest::from_value(base.clone()).unwrap();
        let new = ProviderManifest::from_value(changed(&base, &case["changes"])).unwrap();
        let expect = &case["expect"];
        match compatibility(&old, &new) {
            Ok(report) => {
                let level = serde_json::to_value(report.level).unwrap();
                assert_eq!(level, expect["level"], "{}", case["name"]);
                assert_eq!(
                    report.changes,
                    strings(&expect["changes"]),
                    "{}",
                    case["name"]
                );
                assert_eq!(
                    approval_stands(&old, &new),
                    report.level != Compatibility::Breaking,
                    "{}",
                    case["name"]
                );
            }
            Err(error) => {
                assert_eq!(error.code(), expect["error"], "{}", case["name"]);
                assert_eq!(
                    approval_stands(&old, &new),
                    old.policy_version == new.policy_version,
                    "{}",
                    case["name"]
                );
            }
        }
    }
}

#[test]
fn the_builtin_policy_version_is_a_valid_one() {
    assert!(policy_version_key(BUILTIN_POLICY_VERSION).is_some());
    for manifest in builtin_manifests() {
        assert_eq!(manifest.policy_version, BUILTIN_POLICY_VERSION);
        assert!(manifest.sources.iter().all(|s| s.starts_with("https://")));
    }
}
