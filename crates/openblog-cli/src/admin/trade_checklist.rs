//! The ten-minute checklist for a trade site (ADR 0401, #529): `GET /admin/api/trade-checklist`.
//!
//! Five steps take a new owner from `openblog init --starter trade` to a working site: business
//! facts, a first service, a first job, a first review and a place to share jobs. Every step is
//! worked out from the files each time the route is asked, never from what the owner clicked, so a
//! step is ticked exactly when the site really has it and unticks if it is taken away. The route
//! only reads; dismissing the card is a workspace preference (`tradeChecklistDismissed`).

use super::*;
use crate::job_share::{self, State, Status};

/// One step, in the order the card lists them.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct Step {
    pub id: &'static str,
    pub done: bool,
    /// Where the step is done in Admin, or `None` when it cannot be started yet.
    pub href: Option<String>,
}

/// What the files say, gathered once so the steps can be judged without any I/O.
#[derive(Debug, Default)]
pub(crate) struct Facts {
    /// A trade is named in the business facts: the checklist is for this site.
    pub trade_site: bool,
    /// A phone number or an email is stated, so a customer can reach the business.
    pub reachable: bool,
    pub published_service: bool,
    /// The newest published job's source path (`posts/<file>.md`), when there is one.
    pub newest_job: Option<String>,
    pub published_review: bool,
    /// Sending to Google Business Profile is turned on in `openblog.json`.
    pub google_on: bool,
    /// A job has been posted somewhere, by open.blog or by hand.
    pub job_shared: bool,
}

/// The five steps from the facts. Pure, so the rule is tested without a site.
pub(crate) fn steps(facts: &Facts) -> Vec<Step> {
    let job_href = |done: bool| {
        if done {
            facts
                .newest_job
                .as_ref()
                .map(|path| format!("#/edit/{}", url_component(path)))
        } else {
            Some("#/capture".to_string())
        }
    };
    vec![
        Step {
            id: "business",
            done: facts.reachable,
            href: Some("#/business".into()),
        },
        Step {
            id: "service",
            done: facts.published_service,
            href: Some("#/services".into()),
        },
        Step {
            id: "job",
            done: facts.newest_job.is_some(),
            href: job_href(facts.newest_job.is_some()),
        },
        Step {
            id: "review",
            done: facts.published_review,
            href: Some("#/reviews".into()),
        },
        Step {
            id: "destination",
            done: facts.google_on || facts.job_shared,
            // Sharing starts from a published job, in Write; there is nothing to open before one.
            href: facts
                .newest_job
                .as_ref()
                .map(|path| format!("#/edit/{}", url_component(path))),
        },
    ]
}

/// Percent-encode a source path for a hash route, as Admin's `encodeURIComponent` would.
fn url_component(value: &str) -> String {
    let mut out = String::new();
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&byte) {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

fn published(file: &SourceFile) -> Option<frontmatter::Document> {
    frontmatter::parse(&file.contents)
        .ok()
        .filter(|document| !openblog_core::model::is_draft(&document.front_matter))
}

/// Read what the steps need. Content that does not parse simply does not count yet.
pub(crate) fn facts(state: &AppState) -> Result<Facts, String> {
    let config = site::load_config(&state.root)?;
    let sources = site::read_sources(&state.root, &config)?;
    let mut facts = Facts {
        trade_site: !config.business.trade.trim().is_empty(),
        reachable: !config.business.phone.trim().is_empty()
            || !config.business.email.trim().is_empty(),
        google_on: config
            .syndication
            .google_business_profile
            .as_ref()
            .is_some_and(|google| google.enabled),
        ..Facts::default()
    };
    facts.published_service = sources.services.iter().any(|file| {
        openblog_core::service::declares_service(&file.contents) && published(file).is_some()
    });
    facts.published_review = sources.proof.iter().any(|file| {
        openblog_core::proof::declares_proof(&file.contents) && published(file).is_some()
    });
    let mut newest: Option<(String, String)> = None;
    for file in &sources.posts {
        let Some(document) = published(file) else {
            continue;
        };
        if document.front_matter.get("profile") != Some("job") {
            continue;
        }
        let date = document.front_matter.get("date").unwrap_or("").to_string();
        if newest.as_ref().is_none_or(|(best, _)| date > *best) {
            newest = Some((date, file.path.clone()));
        }
    }
    facts.newest_job = newest.map(|(_, path)| path);
    // An unreadable record says nothing was shared; the Share screen reports the problem itself.
    if let Ok(record) = State::load(&state.root.join(job_share::STATE_FILE)) {
        facts.job_shared = record.jobs.values().any(|places| {
            places
                .values()
                .any(|record| matches!(record.status, Status::Posted | Status::PostedByHand))
        });
    }
    Ok(facts)
}

pub(super) fn get(state: &AppState) -> Response {
    let facts = match facts(state) {
        Ok(facts) => facts,
        Err(error) => return Response::error(500, &error),
    };
    let steps = steps(&facts);
    let done = steps.iter().filter(|step| step.done).count();
    Response::json(
        200,
        &json!({
            "applies": facts.trade_site,
            "done": done,
            "total": steps.len(),
            "steps": steps
                .iter()
                .map(|step| json!({ "id": step.id, "done": step.done, "href": step.href }))
                .collect::<Vec<_>>(),
        }),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn by_id(steps: &[Step], id: &str) -> (bool, Option<String>) {
        let step = steps.iter().find(|step| step.id == id).unwrap();
        (step.done, step.href.clone())
    }

    #[test]
    fn a_new_trade_site_has_every_step_open_and_sharing_waits_for_a_job() {
        let steps = steps(&Facts {
            trade_site: true,
            ..Facts::default()
        });
        let ids: Vec<&str> = steps.iter().map(|step| step.id).collect();
        assert_eq!(ids, ["business", "service", "job", "review", "destination"]);
        assert!(steps.iter().all(|step| !step.done));
        assert_eq!(by_id(&steps, "job").1.as_deref(), Some("#/capture"));
        assert_eq!(by_id(&steps, "destination").1, None);
    }

    #[test]
    fn each_step_follows_its_own_fact_and_nothing_else() {
        let steps = steps(&Facts {
            trade_site: true,
            reachable: true,
            newest_job: Some("posts/new oak.md".into()),
            ..Facts::default()
        });
        assert!(by_id(&steps, "business").0);
        assert!(!by_id(&steps, "service").0);
        assert_eq!(
            by_id(&steps, "job"),
            (true, Some("#/edit/posts%2Fnew%20oak.md".into()))
        );
        assert_eq!(
            by_id(&steps, "destination"),
            (false, Some("#/edit/posts%2Fnew%20oak.md".into()))
        );
        for facts in [
            Facts {
                google_on: true,
                ..Facts::default()
            },
            Facts {
                job_shared: true,
                ..Facts::default()
            },
        ] {
            assert!(by_id(&super::steps(&facts), "destination").0);
        }
    }
}
