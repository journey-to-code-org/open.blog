//! A deliberately small YAML-subset front matter parser.
//!
//! Supported:
//! - `key: value` scalars (bare, "double quoted", or 'single quoted')
//! - `key: [a, b, "c d"]` inline lists
//! - block lists:
//!   ```yaml
//!   tags:
//!     - rust
//!     - wasm
//!   ```
//! - `#` comments on their own line
//!
//! That covers what blog posts actually use (Hashnode, Hugo, Jekyll, Astro
//! exports) without pulling in a YAML dependency.

use std::collections::BTreeMap;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Value {
    Scalar(String),
    List(Vec<String>),
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct FrontMatter {
    pub fields: BTreeMap<String, Value>,
}

/// A document split into front matter and body.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Document {
    pub front_matter: FrontMatter,
    pub body: String,
    /// Line number (1-based) where the body starts; useful for error messages.
    pub body_line: usize,
}

impl FrontMatter {
    pub fn get(&self, key: &str) -> Option<&str> {
        match self.fields.get(key)? {
            Value::Scalar(s) => Some(s.as_str()),
            Value::List(items) => items.first().map(String::as_str),
        }
    }

    pub fn get_list(&self, key: &str) -> Vec<String> {
        match self.fields.get(key) {
            Some(Value::List(items)) => items.clone(),
            Some(Value::Scalar(s)) if !s.is_empty() => s
                .split(',')
                .map(|p| p.trim().to_string())
                .filter(|p| !p.is_empty())
                .collect(),
            _ => Vec::new(),
        }
    }

    pub fn get_bool(&self, key: &str) -> Option<bool> {
        match self.get(key)?.trim().to_ascii_lowercase().as_str() {
            "true" | "yes" | "on" => Some(true),
            "false" | "no" | "off" => Some(false),
            _ => None,
        }
    }

    pub fn get_u32(&self, key: &str) -> Option<u32> {
        self.get(key)?.trim().parse().ok()
    }
}

/// Split `---` delimited front matter from the body and parse it.
/// Documents without front matter return an empty `FrontMatter`.
pub fn parse(source: &str) -> Result<Document, String> {
    let source = source.strip_prefix('\u{feff}').unwrap_or(source);
    let mut lines = source.lines();
    let first = lines.next().unwrap_or("");
    if first.trim_end() != "---" {
        return Ok(Document {
            front_matter: FrontMatter::default(),
            body: source.to_string(),
            body_line: 1,
        });
    }
    let mut fm_lines = Vec::new();
    let mut line_no = 1;
    let mut closed = false;
    for line in lines.by_ref() {
        line_no += 1;
        let trimmed = line.trim_end();
        if trimmed == "---" || trimmed == "..." {
            closed = true;
            break;
        }
        fm_lines.push(line);
    }
    if !closed {
        return Err("front matter opened with --- but never closed".to_string());
    }
    let front_matter = parse_fields(&fm_lines)?;
    let body: Vec<&str> = lines.collect();
    Ok(Document {
        front_matter,
        body: body.join("\n"),
        body_line: line_no + 1,
    })
}

fn parse_fields(lines: &[&str]) -> Result<FrontMatter, String> {
    let mut fields = BTreeMap::new();
    let mut i = 0;
    while i < lines.len() {
        let line = lines[i].trim_end();
        i += 1;
        if line.trim().is_empty() || line.trim_start().starts_with('#') {
            continue;
        }
        if line.starts_with(' ') || line.starts_with('\t') {
            return Err(format!("unexpected indentation in front matter: `{line}`"));
        }
        let Some(colon) = find_key_colon(line) else {
            return Err(format!(
                "expected `key: value` in front matter, found `{line}`"
            ));
        };
        let key = line[..colon].trim().to_string();
        let rest = line[colon + 1..].trim();
        if rest.is_empty() {
            // A block list (or an empty scalar) follows.
            let mut items = Vec::new();
            while i < lines.len() {
                let next = lines[i];
                let t = next.trim();
                if t.is_empty() || t.starts_with('#') {
                    i += 1;
                    continue;
                }
                let indented = next.starts_with(' ') || next.starts_with('\t');
                if let Some(item) = t.strip_prefix("- ").or_else(|| (t == "-").then_some("")) {
                    items.push(unquote(item.trim()));
                    i += 1;
                } else if indented {
                    return Err(format!("unsupported nested value under `{key}`: `{t}`"));
                } else {
                    break;
                }
            }
            if items.is_empty() {
                fields.insert(key, Value::Scalar(String::new()));
            } else {
                fields.insert(key, Value::List(items));
            }
        } else if rest.starts_with('[') {
            let inner = rest.strip_prefix('[').and_then(|r| r.strip_suffix(']'));
            let Some(inner) = inner else {
                return Err(format!("unterminated inline list for `{key}`"));
            };
            fields.insert(key, Value::List(split_inline_list(inner)));
        } else {
            fields.insert(key, Value::Scalar(unquote(rest)));
        }
    }
    Ok(FrontMatter { fields })
}

/// Find the colon that separates key from value. Keys never contain `:`;
/// values may (`url: https://…`), so the first colon followed by whitespace
/// or end of line wins.
fn find_key_colon(line: &str) -> Option<usize> {
    let bytes = line.as_bytes();
    (0..bytes.len()).find(|&idx| {
        bytes[idx] == b':'
            && (idx + 1 == bytes.len() || bytes[idx + 1] == b' ' || bytes[idx + 1] == b'\t')
    })
}

fn split_inline_list(inner: &str) -> Vec<String> {
    let mut items = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    let mut chars = inner.chars();
    while let Some(ch) = chars.next() {
        match quote {
            Some(q) => {
                if ch == '\\' && q == '"' {
                    if let Some(next) = chars.next() {
                        current.push(next);
                    }
                } else if ch == q {
                    quote = None;
                } else {
                    current.push(ch);
                }
            }
            None => match ch {
                '"' | '\'' => quote = Some(ch),
                ',' => {
                    let item = current.trim().to_string();
                    if !item.is_empty() {
                        items.push(item);
                    }
                    current.clear();
                }
                _ => current.push(ch),
            },
        }
    }
    let item = current.trim().to_string();
    if !item.is_empty() {
        items.push(item);
    }
    items
}

fn unquote(value: &str) -> String {
    let v = value.trim();
    if v.len() >= 2 {
        let first = v.as_bytes()[0];
        let last = v.as_bytes()[v.len() - 1];
        if first == b'"' && last == b'"' {
            return unescape_double(&v[1..v.len() - 1]);
        }
        if first == b'\'' && last == b'\'' {
            return v[1..v.len() - 1].replace("''", "'");
        }
    }
    // Strip a trailing comment on bare scalars: `draft: true # not yet`
    match v.find(" #") {
        Some(idx) => v[..idx].trim_end().to_string(),
        None => v.to_string(),
    }
}

fn unescape_double(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(ch) = chars.next() {
        if ch == '\\' {
            match chars.next() {
                Some('n') => out.push('\n'),
                Some('t') => out.push('\t'),
                Some('"') => out.push('"'),
                Some('\\') => out.push('\\'),
                Some(other) => {
                    out.push('\\');
                    out.push(other);
                }
                None => out.push('\\'),
            }
        } else {
            out.push(ch);
        }
    }
    out
}

/// Serialize front matter back to text. Used by the importer and `new`.
pub fn serialize(fields: &[(&str, Value)]) -> String {
    let mut out = String::from("---\n");
    for (key, value) in fields {
        match value {
            Value::Scalar(s) => {
                out.push_str(key);
                out.push_str(": ");
                out.push_str(&quote_scalar(s));
                out.push('\n');
            }
            Value::List(items) => {
                out.push_str(key);
                out.push_str(":\n");
                for item in items {
                    out.push_str("  - ");
                    out.push_str(&quote_scalar(item));
                    out.push('\n');
                }
            }
        }
    }
    out.push_str("---\n");
    out
}

/// Preferred key order when writing a document, so edits produce stable diffs.
const KEY_ORDER: &[&str] = &[
    "title",
    "slug",
    "date",
    "updated",
    "description",
    "tags",
    "series",
    "seriesOrder",
    "cover",
    "coverAlt",
    "theme",
    "canonical",
    "sourceUrl",
    "draft",
    "name",
    "order",
    "nav",
];

/// Write a full document from a field map and a body. Known keys come first in
/// a fixed order and any other keys follow alphabetically, so unknown fields a
/// user added by hand survive an edit in the admin UI. Empty scalars and empty
/// lists are omitted.
pub fn compose(fields: &BTreeMap<String, Value>, body: &str) -> String {
    let mut ordered: Vec<(&str, Value)> = Vec::new();
    for key in KEY_ORDER {
        if let Some(v) = fields.get(*key) {
            ordered.push((key, v.clone()));
        }
    }
    for (key, v) in fields {
        if !KEY_ORDER.contains(&key.as_str()) {
            ordered.push((key.as_str(), v.clone()));
        }
    }
    ordered.retain(|(_, v)| match v {
        Value::Scalar(s) => !s.trim().is_empty(),
        Value::List(items) => !items.is_empty(),
    });
    let mut out = serialize(&ordered);
    out.push('\n');
    out.push_str(body.trim_start_matches(['\r', '\n']));
    if !out.ends_with('\n') {
        out.push('\n');
    }
    out
}

fn quote_scalar(s: &str) -> String {
    let needs_quotes = s.is_empty()
        || s.contains(": ")
        || s.contains(" #")
        || s.starts_with(['[', '{', '"', '\'', '-', '&', '*', '!', '|', '>', '%', '@', '`', '#'])
        // A raw newline would let a value smuggle in extra front matter fields.
        || s.chars().any(char::is_control)
        || s.ends_with(':')
        || s.trim() != s
        || matches!(s.to_ascii_lowercase().as_str(), "true" | "false" | "yes" | "no" | "null" | "~");
    if needs_quotes {
        let escaped = s
            .replace('\\', "\\\\")
            .replace('"', "\\\"")
            .replace('\r', "")
            .replace('\n', "\\n")
            .replace('\t', "\\t");
        format!("\"{escaped}\"")
    } else {
        s.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_scalars_lists_and_body() {
        let doc = parse(
            "---\ntitle: \"Hello: World\"\nurl: https://example.com/a\ndraft: true # soon\ntags: [rust, \"web assembly\", 'c']\nseries:\n  - guide\n---\n# Body\n\ntext\n",
        )
        .unwrap();
        let fm = doc.front_matter;
        assert_eq!(fm.get("title"), Some("Hello: World"));
        assert_eq!(fm.get("url"), Some("https://example.com/a"));
        assert_eq!(fm.get_bool("draft"), Some(true));
        assert_eq!(fm.get_list("tags"), vec!["rust", "web assembly", "c"]);
        assert_eq!(fm.get("series"), Some("guide"));
        assert_eq!(doc.body, "# Body\n\ntext");
        assert_eq!(doc.body_line, 9);
    }

    #[test]
    fn no_front_matter_is_fine() {
        let doc = parse("# Just markdown").unwrap();
        assert!(doc.front_matter.fields.is_empty());
        assert_eq!(doc.body, "# Just markdown");
    }

    #[test]
    fn unterminated_is_an_error() {
        assert!(parse("---\ntitle: x\n").is_err());
    }

    #[test]
    fn compose_orders_keys_keeps_unknown_and_drops_empties() {
        let mut fields = BTreeMap::new();
        fields.insert("zeta".to_string(), Value::Scalar("kept".into()));
        fields.insert("date".to_string(), Value::Scalar("2026-10-21".into()));
        fields.insert("title".to_string(), Value::Scalar("T: x".into()));
        fields.insert("tags".to_string(), Value::List(vec!["a".into()]));
        fields.insert("series".to_string(), Value::Scalar("".into()));
        fields.insert("draft".to_string(), Value::List(vec![]));
        let text = compose(&fields, "\n\nBody text");
        assert_eq!(
            text,
            "---\ntitle: \"T: x\"\ndate: 2026-10-21\ntags:\n  - a\nzeta: kept\n---\n\nBody text\n"
        );
        let doc = parse(&text).unwrap();
        assert_eq!(doc.front_matter.get("zeta"), Some("kept"));
        assert_eq!(doc.body.trim(), "Body text");
    }

    #[test]
    fn values_with_newlines_cannot_inject_fields() {
        let mut fields = BTreeMap::new();
        fields.insert("title".to_string(), Value::Scalar("T".into()));
        fields.insert(
            "description".to_string(),
            Value::Scalar("line one\nslug: evil\r\n---\ndraft: true".into()),
        );
        let text = compose(&fields, "body");
        let doc = parse(&text).unwrap();
        assert_eq!(doc.front_matter.get("slug"), None);
        assert_eq!(doc.front_matter.get("draft"), None);
        assert_eq!(
            doc.front_matter.get("description"),
            Some("line one\nslug: evil\n---\ndraft: true")
        );
        assert_eq!(doc.body.trim(), "body");
    }

    #[test]
    fn serialize_round_trips() {
        let text = serialize(&[
            ("title", Value::Scalar("A: colon".into())),
            (
                "tags",
                Value::List(vec!["rust".into(), "web assembly".into()]),
            ),
            ("draft", Value::Scalar("true".into())),
        ]);
        let doc = parse(&format!("{text}body")).unwrap();
        assert_eq!(doc.front_matter.get("title"), Some("A: colon"));
        assert_eq!(
            doc.front_matter.get_list("tags"),
            vec!["rust", "web assembly"]
        );
        assert_eq!(doc.front_matter.get("draft"), Some("true"));
    }
}
