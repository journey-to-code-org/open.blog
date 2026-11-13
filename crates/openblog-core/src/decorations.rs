//! Decorations as pieces (Studio slice 3b): a theme may say which of its tokens make up each
//! decoration ("garland": `decorGarland`, `decorGarlandHeight`), what turns it off, and other
//! versions of it ("from the toy shelf"). The owner's choices live in `openblog.json` under
//! `decorations: { theme: { piece: false | "variant" } }` and only ever name pieces and variants
//! the theme declares, never CSS. With no choices a theme is exactly as it was.

use std::collections::BTreeMap;

use serde::de::Error as _;
use serde::{Deserialize, Deserializer, Serialize, Serializer};

/// One decoration a theme declares.
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct DecorPiece {
    /// What she reads: "Garland".
    pub label: String,
    /// The tokens this piece owns. `off` and every variant may set only these.
    pub tokens: Vec<String>,
    /// The token values that take the piece down.
    pub off: BTreeMap<String, String>,
    /// Other versions of the piece, by id.
    pub variants: BTreeMap<String, DecorVariant>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct DecorVariant {
    pub label: String,
    pub tokens: BTreeMap<String, String>,
}

/// The owner's choice for one piece: take it down, or put up one of its variants.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DecorChoice {
    Off,
    Variant(String),
}

impl Serialize for DecorChoice {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            DecorChoice::Off => serializer.serialize_bool(false),
            DecorChoice::Variant(id) => serializer.serialize_str(id),
        }
    }
}

impl<'de> Deserialize<'de> for DecorChoice {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        match serde_json::Value::deserialize(deserializer)? {
            serde_json::Value::Bool(false) => Ok(DecorChoice::Off),
            serde_json::Value::String(id) if valid_id(&id) => Ok(DecorChoice::Variant(id)),
            other => Err(D::Error::custom(format!(
                "a decoration is `false` (taken down) or the name of one of its versions, not {other}"
            ))),
        }
    }
}

/// Every choice, by theme then piece.
pub type DecorChoices = BTreeMap<String, BTreeMap<String, DecorChoice>>;

/// A piece or variant id: lowercase letters, digits and `-`.
pub fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

/// Check a theme's pieces: every `off` and variant token belongs to its piece. Words for the owner.
pub fn check_pieces(theme: &str, pieces: &BTreeMap<String, DecorPiece>) -> Result<(), String> {
    for (id, piece) in pieces {
        if !valid_id(id) {
            return Err(format!("theme `{theme}`: decoration `{id}` needs a name of lowercase letters, digits and -"));
        }
        let owned = |token: &String| piece.tokens.contains(token);
        if let Some(token) = piece.off.keys().find(|t| !owned(t)) {
            return Err(format!("theme `{theme}`: decoration `{id}` turns off `{token}`, which isn't one of its tokens"));
        }
        for (variant, version) in &piece.variants {
            if !valid_id(variant) {
                return Err(format!("theme `{theme}`: decoration `{id}` has a version `{variant}` that needs a name of lowercase letters, digits and -"));
            }
            if let Some(token) = version.tokens.keys().find(|t| !owned(t)) {
                return Err(format!("theme `{theme}`: decoration `{id}` version `{variant}` sets `{token}`, which isn't one of its tokens"));
            }
        }
    }
    Ok(())
}

/// Lay the owner's choices over a theme's tokens. Returns which choices took effect (a choice for a
/// piece or version the theme doesn't have is left out, so a renamed theme never breaks a build).
pub fn apply(
    tokens: &mut BTreeMap<String, String>,
    pieces: &BTreeMap<String, DecorPiece>,
    choices: &BTreeMap<String, DecorChoice>,
) -> BTreeMap<String, DecorChoice> {
    let mut applied = BTreeMap::new();
    for (id, choice) in choices {
        let Some(piece) = pieces.get(id) else {
            continue;
        };
        let values = match choice {
            DecorChoice::Off => &piece.off,
            DecorChoice::Variant(variant) => match piece.variants.get(variant) {
                Some(version) => &version.tokens,
                None => continue,
            },
        };
        for (token, value) in values {
            tokens.insert(token.clone(), value.clone());
        }
        applied.insert(id.clone(), choice.clone());
    }
    applied
}

/// A short, stable fingerprint of the choices that took effect, for the stylesheet's address.
pub fn fingerprint(applied: &BTreeMap<String, DecorChoice>) -> Option<String> {
    if applied.is_empty() {
        return None;
    }
    let text = serde_json::to_string(applied).unwrap_or_default();
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in text.bytes() {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    Some(format!("{hash:016x}")[..10].to_string())
}

/// The problems with saved choices against the themes they name (for a save; a build ignores them).
pub fn problems(
    choices: &DecorChoices,
    pieces_of: impl Fn(&str) -> Option<BTreeMap<String, DecorPiece>>,
) -> Vec<String> {
    let mut out = Vec::new();
    for (theme, picks) in choices {
        let Some(pieces) = pieces_of(theme) else {
            out.push(format!("There is no theme called `{theme}`"));
            continue;
        };
        for (id, choice) in picks {
            match (pieces.get(id), choice) {
                (None, _) => out.push(format!("`{theme}` has no decoration called `{id}`")),
                (Some(piece), DecorChoice::Variant(v)) if !piece.variants.contains_key(v) => out
                    .push(format!(
                        "`{theme}`'s {} has no version called `{v}`",
                        piece.label.to_lowercase()
                    )),
                _ => {}
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn garland() -> BTreeMap<String, DecorPiece> {
        let piece: DecorPiece = serde_json::from_value(serde_json::json!({
            "label": "Garland",
            "tokens": ["decorGarland", "decorGarlandHeight"],
            "off": { "decorGarland": "none", "decorGarlandHeight": "0px" },
            "variants": { "toyshelf": { "label": "From the toy shelf", "tokens": { "decorGarland": "url(toys.svg)" } } }
        }))
        .unwrap();
        BTreeMap::from([("garland".to_string(), piece)])
    }

    #[test]
    fn no_choices_change_nothing() {
        let mut tokens = BTreeMap::from([("decorGarland".to_string(), "url(g.svg)".to_string())]);
        let before = tokens.clone();
        let applied = apply(&mut tokens, &garland(), &BTreeMap::new());
        assert_eq!(tokens, before);
        assert_eq!(fingerprint(&applied), None);
    }

    #[test]
    fn off_and_variants_set_only_their_tokens_and_unknown_choices_are_skipped() {
        let mut tokens = BTreeMap::from([
            ("decorGarland".to_string(), "url(g.svg)".to_string()),
            ("other".to_string(), "x".to_string()),
        ]);
        let choices = BTreeMap::from([
            ("garland".to_string(), DecorChoice::Off),
            ("wreath".to_string(), DecorChoice::Off),
        ]);
        let applied = apply(&mut tokens, &garland(), &choices);
        assert_eq!(tokens["decorGarland"], "none");
        assert_eq!(tokens["decorGarlandHeight"], "0px");
        assert_eq!(tokens["other"], "x");
        assert_eq!(applied.len(), 1);
        let mut tokens = BTreeMap::new();
        apply(
            &mut tokens,
            &garland(),
            &BTreeMap::from([(
                "garland".to_string(),
                DecorChoice::Variant("toyshelf".into()),
            )]),
        );
        assert_eq!(tokens["decorGarland"], "url(toys.svg)");
        let mut none = BTreeMap::new();
        assert!(apply(
            &mut none,
            &garland(),
            &BTreeMap::from([("garland".to_string(), DecorChoice::Variant("gone".into()))])
        )
        .is_empty());
    }

    #[test]
    fn pieces_may_only_set_their_own_tokens() {
        let mut pieces = garland();
        pieces
            .get_mut("garland")
            .unwrap()
            .off
            .insert("colorAccent".into(), "red".into());
        assert!(check_pieces("christmas", &pieces)
            .unwrap_err()
            .contains("colorAccent"));
        assert!(check_pieces("christmas", &garland()).is_ok());
    }

    #[test]
    fn choices_read_and_write_as_false_or_a_version_name() {
        let choices: BTreeMap<String, DecorChoice> =
            serde_json::from_str(r#"{"garland": false, "wreath": "toyshelf"}"#).unwrap();
        assert_eq!(choices["garland"], DecorChoice::Off);
        assert_eq!(
            serde_json::to_string(&choices).unwrap(),
            r#"{"garland":false,"wreath":"toyshelf"}"#
        );
        assert!(serde_json::from_str::<DecorChoice>("true").is_err());
        assert!(serde_json::from_str::<DecorChoice>(r#""<b>""#).is_err());
    }

    #[test]
    fn saving_names_unknown_pieces_and_versions() {
        let choices: DecorChoices = serde_json::from_str(
            r#"{"christmas": {"garland": "nope", "bells": false}, "gone": {}}"#,
        )
        .unwrap();
        let found = problems(&choices, |name| (name == "christmas").then(garland));
        assert_eq!(found.len(), 3, "{found:?}");
    }
}
