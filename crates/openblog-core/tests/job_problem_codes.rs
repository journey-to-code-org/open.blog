//! Every sentence the job check gives has a field and a code a screen can say in its own words.

use openblog_core::frontmatter::FrontMatter;
use openblog_core::job::{from_front_matter, problem_code};

fn problems(pairs: &[(&str, &str)]) -> Vec<String> {
    let mut fm = FrontMatter::default();
    for (key, value) in pairs {
        fm.fields.insert(
            (*key).to_string(),
            openblog_core::frontmatter::Value::Scalar((*value).to_string()),
        );
    }
    from_front_matter(&fm, &[]).err().unwrap_or_default()
}

fn codes(pairs: &[(&str, &str)]) -> Vec<(String, &'static str)> {
    problems(pairs).iter().map(|p| problem_code(p)).collect()
}

#[test]
fn an_empty_job_names_each_missing_field() {
    let found = codes(&[]);
    for field in [
        "job.trade",
        "job.service",
        "job.place.town",
        "job.place.region",
        "job.started",
        "job.finished",
    ] {
        assert!(
            found.contains(&(field.to_string(), "missing")),
            "{field}: {found:?}"
        );
    }
}

#[test]
fn wrong_values_get_their_own_codes() {
    let found = codes(&[
        ("job.trade", "astronaut"),
        ("job.service", "Not An Id!"),
        ("job.place.town", "12 Main Street 26241"),
        ("job.place.region", "WV"),
        ("job.started", "2026-11-13"),
        ("job.finished", "2026-11-01"),
        ("job.costBand", "cheap"),
        ("job.media.after", "javascript:alert(1)"),
    ]);
    for expected in [
        ("job.trade", "unknown-trade"),
        ("job.service", "bad-service"),
        ("job.place.town", "address"),
        ("job.finished", "order"),
        ("job.costBand", "bad-cost-band"),
        ("job.media.after", "bad-media"),
    ] {
        assert!(
            found.contains(&(expected.0.to_string(), expected.1)),
            "{expected:?}: {found:?}"
        );
    }
    assert_eq!(
        codes(&[("job.started", "soon")])
            .iter()
            .find(|(f, _)| f == "job.started")
            .map(|(_, c)| *c),
        Some("bad-date")
    );
}

#[test]
fn the_builds_service_and_review_checks_and_anything_else() {
    let service =
        openblog_core::service::unknown_service_problem(&["roof-repair"], "gutters").unwrap();
    assert_eq!(
        problem_code(&service),
        ("job.service".to_string(), "unknown-service")
    );
    let review = openblog_core::proof::unknown_review_problem(&["a"], "b").unwrap();
    assert_eq!(
        problem_code(&review),
        ("job.review".to_string(), "unknown-review")
    );
    assert_eq!(
        problem_code("something odd happened"),
        ("job".to_string(), "invalid")
    );
}
