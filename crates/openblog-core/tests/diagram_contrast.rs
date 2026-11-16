//! Diagram colours stay readable in every bundled look, light and dark (ADR 0417).
//!
//! `web/base.css` defines a diagram's colours from the look's own: text on the raised surface,
//! lines in the muted colour, a highlight tinted with the accent, and six accents that mix a hue
//! with the text colour. This test reads those definitions from the stylesheet and checks every
//! pair a diagram draws, for every curated look and bundled theme, in both schemes: text at least
//! 4.5:1 against what it sits on, lines and shapes at least 3:1.

use openblog_core::look_contrast::{contrast, Rgb};
use openblog_core::look_presets::LOOKS;

struct Palette {
    name: String,
    page: Rgb,
    raised: Rgb,
    text: Rgb,
    muted: Rgb,
    accent: Rgb,
}

fn rgb(text: &str) -> Rgb {
    Rgb::parse(text).unwrap_or_else(|| panic!("not a colour: {text}"))
}

fn palettes() -> Vec<Palette> {
    let mut out = Vec::new();
    for look in LOOKS {
        for (scheme, colors) in [("light", look.light), ("dark", look.dark)] {
            out.push(Palette {
                name: format!("{}/{scheme}", look.id),
                page: rgb(colors.page),
                raised: rgb(colors.surface_raised),
                text: rgb(colors.text),
                muted: rgb(colors.muted),
                accent: rgb(colors.accent),
            });
        }
    }
    let themes = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../themes");
    let read = |name: &str| -> serde_json::Value {
        serde_json::from_str(
            &std::fs::read_to_string(themes.join(name).join("theme.json")).unwrap(),
        )
        .unwrap()
    };
    let base = read("base");
    for entry in std::fs::read_dir(&themes).unwrap() {
        let name = entry.unwrap().file_name().into_string().unwrap();
        let theme = read(&name);
        for scheme in ["light", "dark"] {
            let color = |key: &str| {
                theme["colors"][scheme][key]
                    .as_str()
                    .or_else(|| base["colors"][scheme][key].as_str())
                    .map(rgb)
                    .unwrap()
            };
            out.push(Palette {
                name: format!("theme {name}/{scheme}"),
                page: color("page"),
                raised: color("surfaceRaised"),
                text: color("text"),
                muted: color("muted"),
                accent: color("accent"),
            });
        }
    }
    out
}

/// The six accent hues and how much of each is mixed with the text colour, read from base.css.
fn accents() -> Vec<(Rgb, f64)> {
    let css = include_str!("../../../web/base.css");
    let mut found = Vec::new();
    for n in 1..=6 {
        let marker = format!("--ob-diagram-accent-{n}: color-mix(in srgb, ");
        let at = css
            .find(&marker)
            .unwrap_or_else(|| panic!("accent {n} is not defined"));
        let rest = &css[at + marker.len()..];
        let (hue, rest) = rest.split_once(' ').unwrap();
        let percent: f64 = rest.split_once('%').unwrap().0.parse().unwrap();
        assert!(
            rest.contains("var(--ob-color-text)"),
            "accent {n} mixes with the text colour"
        );
        found.push((rgb(hue), percent / 100.0));
    }
    found
}

fn highlight_share() -> f64 {
    let css = include_str!("../../../web/base.css");
    let marker = "--ob-diagram-highlight: color-mix(in srgb, var(--ob-color-accent) ";
    let at = css.find(marker).expect("highlight is defined");
    css[at + marker.len()..]
        .split_once('%')
        .unwrap()
        .0
        .parse::<f64>()
        .unwrap()
        / 100.0
}

#[test]
fn diagram_colours_are_readable_in_every_look_and_scheme() {
    let accents = accents();
    let share = highlight_share();
    let mut failures = Vec::new();
    let palettes = palettes();
    assert!(palettes.len() >= 20, "every look and theme is checked");
    for p in &palettes {
        let highlight = p.raised.mix(p.accent, share);
        let mut check = |what: &str, a: Rgb, b: Rgb, minimum: f64| {
            let ratio = contrast(a, b);
            if ratio < minimum {
                failures.push(format!("{}: {what} {ratio:.2}:1 < {minimum}:1", p.name));
            }
        };
        check("text on fill", p.text, p.raised, 4.5);
        check("text on highlight", p.text, highlight, 4.5);
        check("text on page", p.text, p.page, 4.5);
        check("lines on page", p.muted, p.page, 3.0);
        check("lines on fill", p.muted, p.raised, 3.0);
        for (n, (hue, amount)) in accents.iter().enumerate() {
            let accent = p.text.mix(*hue, *amount);
            check(&format!("accent {} on page", n + 1), accent, p.page, 3.0);
            check(&format!("accent {} on fill", n + 1), accent, p.raised, 3.0);
            check(
                &format!("fill-coloured text on accent {}", n + 1),
                p.raised,
                accent,
                4.5,
            );
        }
    }
    assert!(failures.is_empty(), "{failures:#?}");
}

#[cfg(feature = "diagram-rendering")]
#[test]
fn every_variable_a_diagram_uses_is_defined_for_screen_print_and_forced_colours() {
    let css = include_str!("../../../web/base.css");
    let start = css.find("/* ---------- Diagrams").expect("diagram styles");
    let block = &css[start..];
    for variable in openblog_core::diagram_theme::VARIABLES {
        assert_eq!(
            block.matches(&format!("{variable}:")).count(),
            3,
            "{variable} is defined on screen, in print and in forced colours"
        );
    }
}
