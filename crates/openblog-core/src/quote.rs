//! Quote requests: the public settings, the `quote` fence and the accessible form (ADRs 0381, 0382).
//!
//! ````text
//! ```quote
//! service: Fence repair
//! service: New fence
//! ```
//! ````
//!
//! The form posts to the site's own hosted quote function (`netlify/functions/quote.mjs`), which
//! stores the request server-side. Nothing here reads or writes a request: the page carries the form
//! and nothing else, so no personal field can reach a static file. The form is a plain HTML form that
//! works without JavaScript; `ob-quote` only adds a token, checks and upload progress.
//!
//! Everything is off by default. With `quote.enabled` false a `quote` fence and a quote-form section
//! render nothing, and a site that never sets `quote` builds exactly as before.

use serde::{Deserialize, Serialize};

use crate::escape::{attr, text};

/// The capability a `quote` fence reports.
pub const CAPABILITY_ID: &str = "quote-request";
/// The fence's info string.
pub const FENCE: &str = "quote";
/// The custom element that enhances the form on a page.
pub const ELEMENT: &str = "ob-quote";
/// The function's public path when `quote.endpoint` is empty.
pub const DEFAULT_ENDPOINT: &str = "/api/quote";
pub const MAX_PHOTOS: usize = 5;
/// Per photo, in bytes: the hosted function enforces the same bound.
pub const MAX_PHOTO_BYTES: usize = 900 * 1024;
pub const MAX_SERVICES: usize = 30;
pub const MAX_NOTICE: usize = 240;
const MAX_NAME: usize = 100;
const DEFAULT_NOTICE: &str = "We use these details only to answer your request.";

/// The `quote` member of `openblog.json`. Absent, or `enabled: false`, means nothing changes.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct QuoteConfig {
    pub enabled: bool,
    /// Where the hosted function is: a path on this site such as `/api/quote` (the default) or an
    /// `https://` address. Public; it holds no secret.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub endpoint: String,
    /// One plain line under the form about what is done with the details.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub notice: String,
}

impl QuoteConfig {
    pub fn is_default(&self) -> bool {
        *self == Self::default()
    }

    /// The function's address without a trailing slash.
    pub fn base(&self) -> &str {
        let endpoint = self.endpoint.trim_end_matches('/');
        if endpoint.is_empty() {
            DEFAULT_ENDPOINT
        } else {
            endpoint
        }
    }

    pub fn notice_text(&self) -> &str {
        if self.notice.is_empty() {
            DEFAULT_NOTICE
        } else {
            &self.notice
        }
    }

    pub fn normalize(&mut self) -> Result<(), String> {
        self.endpoint = self.endpoint.trim().to_string();
        self.notice = self.notice.trim().to_string();
        if !self.endpoint.is_empty() {
            let path = self.endpoint.starts_with('/') && !self.endpoint.starts_with("//");
            let https = self.endpoint.starts_with("https://");
            let plain = !self.endpoint.chars().any(|c| {
                c.is_whitespace()
                    || c.is_control()
                    || matches!(c, '"' | '<' | '>' | '\\' | '?' | '#')
            });
            if !(path || https) || !plain || self.endpoint.len() > 500 {
                return Err(
                    "quote.endpoint must be a path such as /api/quote or an https:// address"
                        .into(),
                );
            }
        }
        if self.notice.chars().count() > MAX_NOTICE || self.notice.chars().any(char::is_control) {
            return Err(format!(
                "quote.notice must be one line of at most {MAX_NOTICE} characters"
            ));
        }
        Ok(())
    }
}

/// What a `quote` fence says: the services the form offers, when it names any.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct FenceOptions {
    pub services: Vec<String>,
}

/// Read a fence body: `service: <name>` lines, nothing else.
pub fn parse_fence(source: &str) -> Result<FenceOptions, Vec<String>> {
    let mut options = FenceOptions::default();
    let mut problems = Vec::new();
    for line in source.lines().map(str::trim).filter(|l| !l.is_empty()) {
        match line.split_once(':') {
            Some((key, value)) if key.trim().eq_ignore_ascii_case("service") => {
                let value = value.trim();
                if value.is_empty() || value.chars().count() > MAX_NAME {
                    problems.push(format!(
                        "a service needs 1 to {MAX_NAME} characters: `{}`",
                        line.chars().take(40).collect::<String>()
                    ));
                } else if !options.services.iter().any(|s| s == value) {
                    options.services.push(value.to_string());
                }
            }
            _ => problems.push(format!(
                "`{}` is not a line of a quote form; write `service: <name>` lines or leave it empty",
                line.chars().take(40).collect::<String>()
            )),
        }
    }
    if options.services.len() > MAX_SERVICES {
        problems.push(format!("list at most {MAX_SERVICES} services"));
    }
    if problems.is_empty() {
        Ok(options)
    } else {
        Err(problems)
    }
}

fn field(uid: &str, name: &str, label: &str, control: &str, hint: &str) -> String {
    let describe = if hint.is_empty() {
        format!("{uid}-{name}-error")
    } else {
        format!("{uid}-{name}-hint {uid}-{name}-error")
    };
    let hint_html = if hint.is_empty() {
        String::new()
    } else {
        format!(
            "<p class=\"ob-quote-hint\" id=\"{uid}-{name}-hint\">{}</p>",
            text(hint)
        )
    };
    let control = control.replace("{describe}", &describe);
    format!(
        "<div class=\"ob-quote-field\"><label for=\"{uid}-{name}\">{}</label>{hint_html}{control}<p class=\"ob-quote-error\" id=\"{uid}-{name}-error\"></p></div>\n",
        text(label)
    )
}

fn select(uid: &str, name: &str, autocomplete: &str, choices: &[String]) -> String {
    let mut out = format!(
        "<select id=\"{uid}-{name}\" name=\"{name}\" required aria-describedby=\"{{describe}}\"{autocomplete}><option value=\"\">Choose one</option>",
    );
    for choice in choices {
        out.push_str(&format!("<option>{}</option>", text(choice)));
    }
    out.push_str("</select>");
    out
}

/// The form. `uid` makes ids unique when a page holds more than one. Towns and services become
/// choices when the site lists them, plain text boxes when it does not. Escaped throughout.
pub fn form_html(config: &QuoteConfig, uid: &str, towns: &[String], services: &[String]) -> String {
    let base = config.base();
    let text_input = |name: &str, kind: &str, auto: &str, max: usize, required: bool| {
        format!(
            "<input id=\"{uid}-{name}\" name=\"{name}\" type=\"{kind}\" autocomplete=\"{auto}\" maxlength=\"{max}\"{} aria-describedby=\"{{describe}}\">",
            if required { " required" } else { "" }
        )
    };
    let mut h = format!(
        "<ob-quote class=\"ob-quote\" endpoint=\"{}\">\n<form class=\"ob-quote-form\" method=\"post\" action=\"{}/submit\" enctype=\"multipart/form-data\" aria-describedby=\"{uid}-notice\">\n",
        attr(base),
        attr(base)
    );
    h.push_str(&field(
        uid,
        "name",
        "Your name",
        &text_input("name", "text", "name", MAX_NAME, true),
        "",
    ));
    h.push_str(&field(
        uid,
        "phone",
        "Phone",
        &text_input("phone", "tel", "tel", 30, true),
        "Include the area code.",
    ));
    h.push_str(&field(
        uid,
        "email",
        "Email (optional)",
        &text_input("email", "email", "email", 200, false),
        "",
    ));
    let town = if towns.is_empty() {
        text_input("town", "text", "address-level2", MAX_NAME, true)
    } else {
        select(uid, "town", " autocomplete=\"address-level2\"", towns)
    };
    h.push_str(&field(uid, "town", "Town", &town, ""));
    let service = if services.is_empty() {
        text_input("service", "text", "off", MAX_NAME, true)
    } else {
        select(uid, "service", "", services)
    };
    h.push_str(&field(uid, "service", "Service you need", &service, ""));
    h.push_str(&field(
        uid,
        "description",
        "What do you need done?",
        &format!("<textarea id=\"{uid}-description\" name=\"description\" rows=\"5\" required minlength=\"10\" maxlength=\"2000\" aria-describedby=\"{{describe}}\"></textarea>"),
        "At least a sentence: what, where and when.",
    ));
    h.push_str(&field(
        uid,
        "photos",
        "Photos (optional)",
        &format!("<input id=\"{uid}-photos\" name=\"photos\" type=\"file\" accept=\"image/jpeg,image/png,image/webp\" multiple aria-describedby=\"{{describe}}\">"),
        &format!("Up to {MAX_PHOTOS} photos, JPEG, PNG or WebP, {} KB each.", MAX_PHOTO_BYTES / 1024),
    ));
    h.push_str(&format!(
        "<div class=\"ob-quote-trap\" aria-hidden=\"true\"><label>Leave this empty<input name=\"website\" type=\"text\" tabindex=\"-1\" autocomplete=\"off\"></label></div>\n<input type=\"hidden\" name=\"token\" value=\"\">\n<input type=\"hidden\" name=\"page\" value=\"\">\n<p class=\"ob-quote-notice\" id=\"{uid}-notice\">{}</p>\n<button type=\"submit\" class=\"ob-quote-send\">Send request</button>\n<progress class=\"ob-quote-progress\" max=\"100\" hidden></progress>\n<div class=\"ob-quote-status\" role=\"status\" aria-live=\"polite\"></div>\n</form>\n</ob-quote>\n",
        text(config.notice_text())
    ));
    h
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn it_is_absent_and_off_by_default() {
        assert!(QuoteConfig::default().is_default());
        assert!(!QuoteConfig::default().enabled);
        assert_eq!(QuoteConfig::default().base(), "/api/quote");
    }

    #[test]
    fn the_endpoint_is_a_path_or_https_and_nothing_else() {
        for ok in [
            "",
            "/api/quote",
            "/api/quote/",
            "https://x.example/api/quote",
        ] {
            let mut config = QuoteConfig {
                enabled: true,
                endpoint: ok.into(),
                ..Default::default()
            };
            assert!(config.normalize().is_ok(), "{ok}");
        }
        for bad in [
            "http://x.example/q",
            "//evil.example/q",
            "javascript:alert(1)",
            "/a b",
            "/q?x=1",
            "/q\"onload=",
        ] {
            let mut config = QuoteConfig {
                enabled: true,
                endpoint: bad.into(),
                ..Default::default()
            };
            assert!(config.normalize().is_err(), "{bad}");
        }
    }

    #[test]
    fn the_form_has_every_field_labelled_and_a_honeypot() {
        let html = form_html(
            &QuoteConfig::default(),
            "q1",
            &["Bend, OR".into()],
            &["Fence <repair>".into()],
        );
        for name in [
            "name",
            "phone",
            "email",
            "town",
            "service",
            "description",
            "photos",
        ] {
            assert!(
                html.contains(&format!("<label for=\"q1-{name}\">")),
                "{name}"
            );
            assert!(html.contains(&format!("id=\"q1-{name}\"")), "{name}");
            assert!(html.contains(&format!("id=\"q1-{name}-error\"")), "{name}");
        }
        assert!(html.contains("action=\"/api/quote/submit\""));
        assert!(html.contains("enctype=\"multipart/form-data\""));
        assert!(html.contains("name=\"website\""));
        assert!(html.contains("<option>Fence &lt;repair&gt;</option>"));
        assert!(html.contains("role=\"status\" aria-live=\"polite\""));
        assert!(
            !html.contains("value=\"x"),
            "no request value is ever in the markup"
        );
    }

    #[test]
    fn without_lists_town_and_service_are_text_boxes() {
        let html = form_html(&QuoteConfig::default(), "q1", &[], &[]);
        assert!(html.contains("id=\"q1-town\" name=\"town\" type=\"text\""));
        assert!(html.contains("id=\"q1-service\" name=\"service\" type=\"text\""));
    }

    #[test]
    fn a_fence_lists_services_only() {
        let options =
            parse_fence("service: Fence repair\nservice: New fence\nservice: Fence repair")
                .unwrap();
        assert_eq!(options.services, ["Fence repair", "New fence"]);
        assert!(parse_fence("").unwrap().services.is_empty());
        assert!(parse_fence("action: https://evil.example").is_err());
        assert!(parse_fence("service:").is_err());
    }
}
