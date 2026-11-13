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
        if rest.is_empty() && key == NESTED_KEY && next_is_mapping(lines, i) {
            let indent = indent_of(lines[next_significant(lines, i)])?;
            parse_nested(lines, &mut i, indent, &key, 1, &mut fields)?;
        } else if rest.is_empty() && key == FAQ_KEY && next_is_faq_entry(lines, i) {
            parse_faq(lines, &mut i, &mut fields)?;
        } else if rest.is_empty() {
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

/// The one key whose value may be a nested mapping (the `job` profile, ADR
/// 0285). It is stored flattened to dotted keys (`job.place.town`), so the
/// `Value` shape and every other key are exactly as before.
const NESTED_KEY: &str = "job";
const MAX_NESTING: usize = 3;

/// The one key whose value may be a list of mappings (a service's questions
/// and answers, ADR 0311). Entry `n` (counting from 1) is stored flattened as
/// `faq.<n>.question` and `faq.<n>.answer`, so the `Value` shape is unchanged.
/// A list whose first entry does not start `- question:` is an ordinary list.
const FAQ_KEY: &str = "faq";
const FAQ_PREFIX: &str = "faq.";
const MAX_FAQ_ENTRIES: usize = 100;

fn next_is_faq_entry(lines: &[&str], from: usize) -> bool {
    lines
        .get(next_significant(lines, from))
        .is_some_and(|line| line.starts_with(' ') && line.trim().starts_with("- question:"))
}

fn parse_faq(
    lines: &[&str],
    i: &mut usize,
    fields: &mut BTreeMap<String, Value>,
) -> Result<(), String> {
    let mut entry = 0;
    while *i < lines.len() {
        let line = lines[*i].trim_end();
        if is_skipped(line) {
            *i += 1;
            continue;
        }
        if !line.starts_with(' ') {
            break;
        }
        let dash = indent_of(line)?;
        let Some(first) = line.trim_start().strip_prefix("- ") else {
            return Err(format!(
                "each `faq` entry starts with `- question:`, found `{}`",
                line.trim()
            ));
        };
        entry += 1;
        if entry > MAX_FAQ_ENTRIES {
            return Err(format!("`faq` has more than {MAX_FAQ_ENTRIES} entries"));
        }
        *i += 1;
        let mut pending = Some(first.trim().to_string());
        loop {
            let text = match pending.take() {
                Some(text) => text,
                None => {
                    let Some(next) = lines.get(*i).map(|l| l.trim_end()) else {
                        break;
                    };
                    if is_skipped(next) {
                        *i += 1;
                        continue;
                    }
                    if !next.starts_with(' ') || indent_of(next)? != dash + 2 {
                        break;
                    }
                    *i += 1;
                    next.trim().to_string()
                }
            };
            let Some(colon) = find_key_colon(&text) else {
                return Err(format!(
                    "expected `key: value` in a `faq` entry, found `{text}`"
                ));
            };
            let name = text[..colon].trim();
            fields.insert(
                format!("{FAQ_PREFIX}{entry}.{name}"),
                Value::Scalar(unquote(text[colon + 1..].trim())),
            );
        }
    }
    Ok(())
}

/// Write the flattened `faq.*` keys back as one block list, entry by entry in
/// numeric order, `question` then `answer` then any other key.
fn serialize_faq(fields: &[(&str, Value)], out: &mut String) {
    let mut entries: BTreeMap<usize, Vec<(&str, &str)>> = BTreeMap::new();
    for (key, value) in fields {
        let Some(rest) = key.strip_prefix(FAQ_PREFIX) else {
            continue;
        };
        let (Some((number, name)), Value::Scalar(text)) = (rest.split_once('.'), value) else {
            continue;
        };
        if let Ok(number) = number.parse::<usize>() {
            entries.entry(number).or_default().push((name, text));
        }
    }
    out.push_str(FAQ_KEY);
    out.push_str(":\n");
    for (_, mut keys) in entries {
        keys.sort_by_key(|(name, _)| match *name {
            "question" => (0, String::new()),
            "answer" => (1, String::new()),
            other => (2, other.to_string()),
        });
        for (position, (name, text)) in keys.into_iter().enumerate() {
            let lead = if position == 0 { "  - " } else { "    " };
            out.push_str(&format!("{lead}{name}: {}\n", quote_scalar(text)));
        }
    }
}

fn is_skipped(line: &str) -> bool {
    line.trim().is_empty() || line.trim_start().starts_with('#')
}

fn next_significant(lines: &[&str], from: usize) -> usize {
    (from..lines.len())
        .find(|&at| !is_skipped(lines[at]))
        .unwrap_or(lines.len())
}

fn next_is_mapping(lines: &[&str], from: usize) -> bool {
    let at = next_significant(lines, from);
    let Some(line) = lines.get(at) else {
        return false;
    };
    let trimmed = line.trim();
    line.starts_with(' ') && !trimmed.starts_with("- ") && trimmed != "-"
}

fn indent_of(line: &str) -> Result<usize, String> {
    if line.starts_with('\t') {
        return Err(format!("use spaces, not tabs, to indent `{}`", line.trim()));
    }
    Ok(line.len() - line.trim_start_matches(' ').len())
}

fn parse_nested(
    lines: &[&str],
    i: &mut usize,
    indent: usize,
    prefix: &str,
    depth: usize,
    fields: &mut BTreeMap<String, Value>,
) -> Result<(), String> {
    if depth > MAX_NESTING {
        return Err(format!("`{prefix}` is nested too deeply"));
    }
    while *i < lines.len() {
        let line = lines[*i].trim_end();
        if is_skipped(line) {
            *i += 1;
            continue;
        }
        let here = indent_of(line)?;
        if here < indent {
            break;
        }
        if here > indent {
            return Err(format!(
                "unexpected indentation under `{prefix}`: `{}`",
                line.trim()
            ));
        }
        let Some(colon) = find_key_colon(line.trim_start()) else {
            return Err(format!(
                "expected `key: value` under `{prefix}`, found `{}`",
                line.trim()
            ));
        };
        let content = line.trim_start();
        let key = format!("{prefix}.{}", content[..colon].trim());
        let rest = content[colon + 1..].trim();
        *i += 1;
        if !rest.is_empty() {
            let value = match rest.strip_prefix('[') {
                Some(inner) => match inner.strip_suffix(']') {
                    Some(inner) => Value::List(split_inline_list(inner)),
                    None => return Err(format!("unterminated inline list for `{key}`")),
                },
                None => Value::Scalar(unquote(rest)),
            };
            fields.insert(key, value);
            continue;
        }
        let at = next_significant(lines, *i);
        let Some(next) = lines.get(at) else {
            fields.insert(key, Value::Scalar(String::new()));
            continue;
        };
        let next_indent = indent_of(next)?;
        let trimmed = next.trim();
        if next_indent <= indent {
            fields.insert(key, Value::Scalar(String::new()));
        } else if let Some(first) = trimmed
            .strip_prefix("- ")
            .or((trimmed == "-").then_some(""))
        {
            let mut items = vec![unquote(first.trim())];
            *i = at + 1;
            while *i < lines.len() {
                let item_line = lines[*i];
                if is_skipped(item_line) {
                    *i += 1;
                    continue;
                }
                let item = item_line.trim();
                match item.strip_prefix("- ").or((item == "-").then_some("")) {
                    Some(item) if indent_of(item_line)? > indent => {
                        items.push(unquote(item.trim()));
                        *i += 1;
                    }
                    _ => break,
                }
            }
            fields.insert(key, Value::List(items));
        } else {
            *i = at;
            parse_nested(lines, i, next_indent, &key, depth + 1, fields)?;
        }
    }
    Ok(())
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
    let nested_prefix = format!("{NESTED_KEY}.");
    let mut nested_written = false;
    let mut faq_written = false;
    for (key, value) in fields {
        if key.starts_with(FAQ_PREFIX) {
            if !faq_written {
                faq_written = true;
                serialize_faq(fields, &mut out);
            }
            continue;
        }
        if key.starts_with(&nested_prefix) {
            if !nested_written {
                nested_written = true;
                serialize_nested(fields, &nested_prefix, &mut out);
            }
            continue;
        }
        match value {
            Value::Scalar(s) => {
                out.push_str(key);
                out.push_str(": ");
                // `draft` is a plain YAML boolean, which every reader agrees on.
                out.push_str(&scalar_for(key, s, None));
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

/// Write the flattened `job.*` keys back as one nested mapping, in key order,
/// so parsing the result gives the same fields.
fn serialize_nested(fields: &[(&str, Value)], prefix: &str, out: &mut String) {
    let mut entries: Vec<(Vec<&str>, &Value)> = fields
        .iter()
        .filter(|(key, _)| key.starts_with(prefix))
        .map(|(key, value)| (key.split('.').collect(), value))
        .collect();
    entries.sort_by(|a, b| a.0.cmp(&b.0));
    out.push_str(NESTED_KEY);
    out.push_str(":\n");
    let mut open: Vec<&str> = Vec::new();
    for (path, value) in entries {
        let parents = &path[1..path.len() - 1];
        let common = open
            .iter()
            .zip(parents)
            .take_while(|(left, right)| left == right)
            .count();
        open.truncate(common);
        for (depth, name) in parents.iter().enumerate().skip(common) {
            out.push_str(&"  ".repeat(depth + 1));
            out.push_str(name);
            out.push_str(":\n");
            open.push(name);
        }
        let indent = "  ".repeat(path.len() - 1);
        let name = path[path.len() - 1];
        match value {
            Value::Scalar(s) => {
                out.push_str(&format!("{indent}{name}: {}\n", quote_scalar(s)));
            }
            Value::List(items) => {
                out.push_str(&format!("{indent}{name}:\n"));
                for item in items {
                    out.push_str(&format!("{indent}  - {}\n", quote_scalar(item)));
                }
            }
        }
    }
}

/// Preferred key order when writing a document, so edits produce stable diffs.
const KEY_ORDER: &[&str] = &[
    "title",
    "subtitle",
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

/// Write `fields` and `body` into `original` changing as few bytes as possible:
/// a key whose value didn't change keeps its line exactly (order, quoting,
/// inline or block list, comments, empty values like `cover: ""`); a changed
/// value keeps the style it was written in; a removed or emptied key loses
/// only its own lines; a new key goes beside its neighbour in `KEY_ORDER`; an
/// unchanged body keeps its bytes. Returns `None` when the result would not
/// parse back to exactly `fields` and `body` (the caller then uses `compose`).
pub fn splice(original: &str, fields: &BTreeMap<String, Value>, body: &str) -> Option<String> {
    splice_explained(original, fields, body).ok()
}

/// `splice`, saying in a sentence why a file couldn't be kept as written.
pub fn splice_explained(
    original: &str,
    fields: &BTreeMap<String, Value>,
    body: &str,
) -> Result<String, String> {
    splice_inner(original, fields, body)
}

fn splice_inner(
    original: &str,
    fields: &BTreeMap<String, Value>,
    body: &str,
) -> Result<String, String> {
    let (bom, source) = match original.strip_prefix('\u{feff}') {
        Some(rest) => ("\u{feff}", rest),
        None => ("", original),
    };
    let eol = if source.lines().next().is_some_and(|_| {
        source
            .find('\n')
            .is_some_and(|at| at > 0 && source.as_bytes()[at - 1] == b'\r')
    }) {
        "\r\n"
    } else {
        "\n"
    };
    let old = parse(source).map_err(|error| format!("its front matter can't be read: {error}"))?;
    let wanted: BTreeMap<String, Value> = fields
        .iter()
        .filter(|(_, value)| !is_empty_value(value))
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect();
    let lines: Vec<&str> = source.split_inclusive('\n').collect();
    let has_front_matter = lines.first().is_some_and(|line| line.trim_end() == "---");

    let mut out = String::from(bom);
    let body_start = if has_front_matter {
        let close = (1..lines.len())
            .find(|&at| matches!(lines[at].trim_end(), "---" | "..."))
            .ok_or("its front matter is never closed")?;
        let mut pieces = front_matter_pieces(&lines[1..close])
            .ok_or("a line in its front matter isn't a plain `key: value` or list item")?;
        let mut seen = std::collections::BTreeSet::new();
        for piece in &pieces {
            if let Piece::Span { key, .. } = piece {
                if !seen.insert(key.clone()) {
                    // A key written twice: don't guess which one counts.
                    return Err(format!("`{key}` is written twice in its front matter"));
                }
            }
        }
        for piece in pieces.iter_mut() {
            let Piece::Span { key, lines } = piece else {
                continue;
            };
            *lines = match key.as_str() {
                NESTED_KEY | FAQ_KEY => {
                    let prefix = format!("{key}.");
                    let before = subset(&old.front_matter.fields, &prefix);
                    let after = subset(&wanted, &prefix);
                    if before == after {
                        continue;
                    }
                    render_block(key, &after, eol)
                }
                _ => {
                    let before = old
                        .front_matter
                        .fields
                        .get(key.as_str())
                        .filter(|v| !is_empty_value(v));
                    let after = wanted.get(key.as_str());
                    if before == after {
                        continue;
                    }
                    match after {
                        None => Vec::new(),
                        Some(value) => render_changed(key, lines, value, eol),
                    }
                }
            };
        }
        // Keys that are new to this file.
        let present: Vec<String> = pieces
            .iter()
            .filter_map(|piece| match piece {
                Piece::Span { key, .. } => Some(key.clone()),
                Piece::Free(_) => None,
            })
            .collect();
        let mut added: Vec<(String, Vec<String>)> = Vec::new();
        for (key, value) in &wanted {
            let top = key.split('.').next().unwrap_or(key);
            let grouped = top == NESTED_KEY || top == FAQ_KEY;
            if present.iter().any(|p| p == top) || added.iter().any(|(k, _)| k == top) {
                continue;
            }
            let rendered = if grouped {
                render_block(top, &subset(&wanted, &format!("{top}.")), eol)
            } else {
                render_value(key, value, eol)
            };
            added.push((top.to_string(), rendered));
        }
        for (key, rendered) in added {
            let at = insertion_point(&pieces, &key);
            pieces.insert(
                at,
                Piece::Span {
                    key,
                    lines: rendered,
                },
            );
        }
        out.push_str(lines[0]);
        for piece in &pieces {
            match piece {
                Piece::Free(line) => out.push_str(line),
                Piece::Span { lines, .. } => lines.iter().for_each(|line| out.push_str(line)),
            }
        }
        out.push_str(lines[close]);
        if !lines[close].ends_with('\n') {
            out.push_str(eol);
        }
        close + 1
    } else {
        if !wanted.is_empty() {
            let ordered = ordered_fields(&wanted);
            out.push_str(&serialize(&ordered).replace('\n', eol));
            out.push_str(eol);
        }
        0
    };

    let original_body: String = lines[body_start.min(lines.len())..].concat();
    if trim_newlines(&original_body) == trim_newlines(body)
        && trim_newlines(&old.body) == trim_newlines(body)
    {
        out.push_str(&original_body);
    } else {
        let lead_len = original_body.len() - original_body.trim_start_matches(['\r', '\n']).len();
        let lead = if trim_newlines(&original_body).is_empty() {
            eol
        } else {
            &original_body[..lead_len]
        };
        out.push_str(if has_front_matter { lead } else { "" });
        let content = body.replace("\r\n", "\n");
        let content = content.trim_start_matches('\n').trim_end_matches('\n');
        out.push_str(&content.replace('\n', eol));
        if original_body.is_empty() || original_body.ends_with('\n') {
            out.push_str(eol);
        }
    }

    // Self-check: the result must read back as exactly what was asked for.
    let check = parse(out.strip_prefix('\u{feff}').unwrap_or(&out))
        .map_err(|_| "the kept file wouldn't read back".to_string())?;
    let got: BTreeMap<String, Value> = check
        .front_matter
        .fields
        .into_iter()
        .filter(|(_, value)| !is_empty_value(value))
        .collect();
    if got != wanted {
        let differs = wanted
            .keys()
            .chain(got.keys())
            .find(|key| wanted.get(*key) != got.get(*key))
            .cloned()
            .unwrap_or_default();
        return Err(format!("`{differs}` wouldn't read back the same if kept"));
    }
    if trim_newlines(&check.body) != trim_newlines(body) {
        return Err("its words wouldn't read back the same if kept".to_string());
    }
    Ok(out)
}

enum Piece {
    /// A blank or comment line that belongs to no key; it stays where it is.
    Free(String),
    /// A top-level key's own lines: `key: value`, or `key:` and its items.
    Span { key: String, lines: Vec<String> },
}

fn front_matter_pieces(lines: &[&str]) -> Option<Vec<Piece>> {
    let mut pieces = Vec::new();
    let mut i = 0;
    while i < lines.len() {
        let line = lines[i];
        let bare = line.trim_end_matches(['\r', '\n']);
        if is_skipped(bare) {
            pieces.push(Piece::Free(line.to_string()));
            i += 1;
            continue;
        }
        if bare.starts_with([' ', '\t']) || bare.starts_with('-') {
            return None;
        }
        let colon = find_key_colon(bare)?;
        let key = bare[..colon].trim().to_string();
        let mut own = vec![line.to_string()];
        i += 1;
        // Items, indented lines, and blanks or comments between them.
        let mut held = Vec::new();
        while i < lines.len() {
            let next = lines[i].trim_end_matches(['\r', '\n']);
            if is_skipped(next) {
                held.push(lines[i].to_string());
                i += 1;
                continue;
            }
            if next.starts_with([' ', '\t']) || next.starts_with("- ") || next == "-" {
                own.append(&mut held);
                own.push(lines[i].to_string());
                i += 1;
            } else {
                break;
            }
        }
        pieces.push(Piece::Span { key, lines: own });
        pieces.extend(held.into_iter().map(Piece::Free));
    }
    Some(pieces)
}

fn is_empty_value(value: &Value) -> bool {
    match value {
        Value::Scalar(text) => text.trim().is_empty(),
        Value::List(items) => items.is_empty(),
    }
}

fn subset(fields: &BTreeMap<String, Value>, prefix: &str) -> BTreeMap<String, Value> {
    fields
        .iter()
        .filter(|(key, value)| key.starts_with(prefix) && !is_empty_value(value))
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect()
}

fn trim_newlines(text: &str) -> String {
    text.replace("\r\n", "\n").trim_matches('\n').to_string()
}

fn with_eol(text: &str, eol: &str) -> Vec<String> {
    text.lines().map(|line| format!("{line}{eol}")).collect()
}

/// The `job:` or `faq:` block written fresh (they are machine-shaped).
fn render_block(top: &str, fields: &BTreeMap<String, Value>, eol: &str) -> Vec<String> {
    if fields.is_empty() {
        return Vec::new();
    }
    let ordered: Vec<(&str, Value)> = fields
        .iter()
        .map(|(k, v)| (k.as_str(), v.clone()))
        .collect();
    let mut out = String::new();
    if top == FAQ_KEY {
        serialize_faq(&ordered, &mut out);
    } else {
        serialize_nested(&ordered, &format!("{top}."), &mut out);
    }
    with_eol(&out, eol)
}

/// A key that is new to the file, in the house style.
fn render_value(key: &str, value: &Value, eol: &str) -> Vec<String> {
    match value {
        Value::Scalar(text) => vec![format!("{key}: {}{eol}", scalar_for(key, text, None))],
        Value::List(items) => {
            let mut out = vec![format!("{key}:{eol}")];
            out.extend(
                items
                    .iter()
                    .map(|item| format!("  - {}{eol}", quote_scalar(item))),
            );
            out
        }
    }
}

/// A changed value written the way the old one was: same quotes, inline or
/// block list, same item indent, and a trailing `# comment` kept.
fn render_changed(key: &str, old_lines: &[String], value: &Value, eol: &str) -> Vec<String> {
    let first = old_lines[0].trim_end_matches(['\r', '\n']);
    let colon = find_key_colon(first).unwrap_or(first.len());
    let written_key = &first[..colon];
    let rest = first.get(colon + 1..).unwrap_or("").trim();
    match value {
        Value::Scalar(text) => {
            let (body, comment) = match rest.chars().next() {
                Some('"') | Some('\'') | Some('[') | None => (rest, ""),
                _ => match rest.find(" #") {
                    Some(at) => (&rest[..at], &rest[at..]),
                    None => (rest, ""),
                },
            };
            let written = match body.chars().next() {
                Some('"') => quote_double(text),
                Some('\'') if !text.chars().any(char::is_control) => {
                    format!("'{}'", text.replace('\'', "''"))
                }
                Some('\'') => quote_double(text),
                _ => scalar_for(key, text, Some(body)),
            };
            vec![format!("{written_key}: {written}{comment}{eol}")]
        }
        Value::List(items) if rest.starts_with('[') => {
            let inner: Vec<String> = items.iter().map(|item| inline_item(item)).collect();
            vec![format!("{written_key}: [{}]{eol}", inner.join(", "))]
        }
        Value::List(items) => {
            let lead = old_lines[1..]
                .iter()
                .map(|line| line.trim_end_matches(['\r', '\n']))
                .find_map(|line| {
                    let dash = line
                        .find("- ")
                        .or_else(|| (line.trim() == "-").then(|| line.find('-').unwrap_or(0)))?;
                    line[..dash]
                        .trim()
                        .is_empty()
                        .then(|| format!("{}- ", &line[..dash]))
                })
                .unwrap_or_else(|| "  - ".to_string());
            let mut out = vec![format!("{written_key}:{eol}")];
            out.extend(
                items
                    .iter()
                    .map(|item| format!("{lead}{}{eol}", quote_scalar(item))),
            );
            out
        }
    }
}

/// A bare scalar. `draft`, and any value that was a bare true/false before,
/// stays a bare boolean, which every YAML reader agrees on.
/// Front matter keys the engine reads as a switch (`get_bool`): written bare, `nav: true`, as people
/// write them by hand, not as the text `"true"`.
const SWITCH_KEYS: [&str; 7] = [
    "draft",
    "nav",
    "recipe",
    "highlight",
    "lineNumbers",
    "showLineNumbers",
    "codeHighlighting",
];

fn scalar_for(key: &str, text: &str, old_bare: Option<&str>) -> String {
    let was_bool = old_bare
        .is_some_and(|old| matches!(old.trim().to_ascii_lowercase().as_str(), "true" | "false"));
    let is_bool = matches!(text, "true" | "false");
    if is_bool && (SWITCH_KEYS.contains(&key) || was_bool) {
        text.to_string()
    } else {
        quote_scalar(text)
    }
}

fn quote_double(text: &str) -> String {
    let escaped = text
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\r', "")
        .replace('\n', "\\n")
        .replace('\t', "\\t");
    format!("\"{escaped}\"")
}

fn inline_item(item: &str) -> String {
    let plain = !item.is_empty()
        && item.trim() == item
        && !item.contains([',', '[', ']', '"', '\'', '#'])
        && !item.chars().any(char::is_control);
    if plain {
        item.to_string()
    } else {
        quote_double(item)
    }
}

/// Where a new key goes: after the last key that comes before it in
/// `KEY_ORDER`, else before the first that comes after it, else at the end.
fn insertion_point(pieces: &[Piece], key: &str) -> usize {
    let rank = |name: &str| KEY_ORDER.iter().position(|k| *k == name);
    let end = pieces
        .iter()
        .rposition(|piece| matches!(piece, Piece::Span { .. }))
        .map_or(pieces.len(), |at| at + 1);
    let Some(mine) = rank(key) else {
        return end;
    };
    let mut after = None;
    let mut before = None;
    for (at, piece) in pieces.iter().enumerate() {
        if let Piece::Span { key: other, .. } = piece {
            match rank(other) {
                Some(theirs) if theirs < mine => after = Some(at + 1),
                Some(theirs) if theirs > mine && before.is_none() => before = Some(at),
                _ => {}
            }
        }
    }
    after.or(before).unwrap_or(end)
}

fn ordered_fields(fields: &BTreeMap<String, Value>) -> Vec<(&str, Value)> {
    let mut ordered: Vec<(&str, Value)> = Vec::new();
    for key in KEY_ORDER {
        if let Some(value) = fields.get(*key) {
            ordered.push((key, value.clone()));
        }
    }
    for (key, value) in fields {
        if !KEY_ORDER.contains(&key.as_str()) {
            ordered.push((key.as_str(), value.clone()));
        }
    }
    ordered
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

    const PIE: &str = "---\ntitle: Grammi's Pumpkin Pie\ndate: 2026-11-06\ndraft: true\nseries: thanksgiving\nprofile: recipe\n# filled in by Grammi\nservings: 8\nprep: 15 min\ncook: 30 min\ntags: [thanksgiving]\ndescription: \"One sentence: about pie.\"\ncover: \"\"\n---\n\n\nThe story.\n\n## Ingredients\n\n- 1 can pumpkin\n";

    fn with(
        source: &str,
        change: impl FnOnce(&mut BTreeMap<String, Value>),
    ) -> BTreeMap<String, Value> {
        let mut fields = parse(source).unwrap().front_matter.fields;
        change(&mut fields);
        fields
    }

    fn body_of(source: &str) -> String {
        parse(source).unwrap().body
    }

    fn changed_lines(before: &str, after: &str) -> Vec<(String, String)> {
        let a: Vec<&str> = before.lines().collect();
        let b: Vec<&str> = after.lines().collect();
        assert_eq!(a.len(), b.len(), "line count changed:\n{after}");
        a.iter()
            .zip(&b)
            .filter(|(x, y)| x != y)
            .map(|(x, y)| (x.to_string(), y.to_string()))
            .collect()
    }

    #[test]
    fn splice_leaves_every_example_post_untouched_and_changes_one_line_at_a_time() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../content");
        let mut stack = vec![root];
        let mut checked = 0;
        while let Some(dir) = stack.pop() {
            for entry in std::fs::read_dir(&dir).unwrap() {
                let path = entry.unwrap().path();
                if path.is_dir() {
                    stack.push(path);
                    continue;
                }
                if path.extension().and_then(|e| e.to_str()) != Some("md") {
                    continue;
                }
                let source = std::fs::read_to_string(&path).unwrap();
                let Ok(doc) = parse(&source) else { continue };
                if doc.front_matter.fields.is_empty() {
                    continue;
                }
                let fields = doc.front_matter.fields.clone();
                assert_eq!(
                    splice(&source, &fields, &doc.body).as_deref(),
                    Some(source.as_str()),
                    "{}",
                    path.display()
                );
                if fields.contains_key("title") {
                    let mut retitled = fields.clone();
                    retitled.insert("title".into(), Value::Scalar("A new: title".into()));
                    let out = splice(&source, &retitled, &doc.body)
                        .unwrap_or_else(|| panic!("{}", path.display()));
                    let diff = source
                        .lines()
                        .zip(out.lines())
                        .filter(|(a, b)| a != b)
                        .count();
                    assert_eq!(diff, 1, "{}\n{out}", path.display());
                }
                checked += 1;
            }
        }
        assert!(checked > 10, "only {checked} posts found");
    }

    #[test]
    fn splice_keeps_an_untouched_file_byte_for_byte() {
        let fields = parse(PIE).unwrap().front_matter.fields;
        assert_eq!(splice(PIE, &fields, &body_of(PIE)).unwrap(), PIE);
        // Studio drops the leading blank lines it shows: still untouched.
        assert_eq!(
            splice(
                PIE,
                &fields,
                "The story.\n\n## Ingredients\n\n- 1 can pumpkin"
            )
            .unwrap(),
            PIE
        );
    }

    #[test]
    fn splice_changes_only_the_changed_line() {
        let fields = with(PIE, |f| {
            f.insert("servings".into(), Value::Scalar("10".into()));
        });
        let out = splice(PIE, &fields, &body_of(PIE)).unwrap();
        assert_eq!(
            changed_lines(PIE, &out),
            vec![("servings: 8".into(), "servings: 10".into())]
        );
        let fields = with(PIE, |f| {
            f.insert("description".into(), Value::Scalar("Pie: the best".into()));
        });
        let out = splice(PIE, &fields, &body_of(PIE)).unwrap();
        assert_eq!(
            changed_lines(PIE, &out),
            vec![(
                "description: \"One sentence: about pie.\"".into(),
                "description: \"Pie: the best\"".into()
            )]
        );
    }

    #[test]
    fn splice_publishing_removes_only_the_draft_line() {
        let fields = with(PIE, |f| {
            f.remove("draft");
        });
        let out = splice(PIE, &fields, &body_of(PIE)).unwrap();
        assert_eq!(out, PIE.replace("draft: true\n", ""));
    }

    #[test]
    fn splice_writes_draft_bare_and_keeps_list_style() {
        let published = PIE.replace("draft: true\n", "");
        let fields = with(&published, |f| {
            f.insert("draft".into(), Value::Scalar("true".into()));
            f.insert(
                "tags".into(),
                Value::List(vec!["thanksgiving".into(), "pie, sweet".into()]),
            );
        });
        let out = splice(&published, &fields, &body_of(&published)).unwrap();
        assert!(
            out.contains("tags: [thanksgiving, \"pie, sweet\"]\n"),
            "{out}"
        );
        assert!(out.contains("\ndraft: true\n"), "{out}");
        let page = "---\ntitle: About\n---\nHi\n";
        let fields = with(page, |f| {
            f.insert("nav".into(), Value::Scalar("true".into()));
            f.insert("theme".into(), Value::Scalar("true".into()));
        });
        let out = splice(page, &fields, &body_of(page)).unwrap();
        assert!(out.contains("\nnav: true\n"), "a switch is bare: {out}");
        assert!(
            out.contains("\ntheme: \"true\"\n"),
            "a word that happens to be true stays text: {out}"
        );
        let block = "---\ntitle: A\ntags:\n    - one\n---\nBody\n";
        let fields = with(block, |f| {
            f.insert("tags".into(), Value::List(vec!["one".into(), "two".into()]));
        });
        assert_eq!(
            splice(block, &fields, "Body").unwrap(),
            "---\ntitle: A\ntags:\n    - one\n    - two\n---\nBody\n"
        );
    }

    #[test]
    fn splice_keeps_comments_quotes_and_empty_values() {
        let source = "---\ntitle: 'Mom''s pie'\nsubtitle: plain # a note\ncover: \"\"\n---\nBody\n";
        let fields = with(source, |f| {
            f.insert("title".into(), Value::Scalar("Mom's best pie".into()));
            f.insert("subtitle".into(), Value::Scalar("still plain".into()));
        });
        let out = splice(source, &fields, "Body").unwrap();
        assert_eq!(out, "---\ntitle: 'Mom''s best pie'\nsubtitle: still plain # a note\ncover: \"\"\n---\nBody\n");
    }

    #[test]
    fn splice_body_edits_keep_the_gap_and_line_endings() {
        let out = splice(
            PIE,
            &parse(PIE).unwrap().front_matter.fields,
            "A new story.",
        )
        .unwrap();
        assert!(out.ends_with("---\n\n\nA new story.\n"), "{out}");
        let crlf = "---\r\ntitle: A\r\n---\r\nOld\r\n";
        let fields = with(crlf, |f| {
            f.insert("servings".into(), Value::Scalar("4".into()));
        });
        assert_eq!(
            splice(crlf, &fields, "New\nline").unwrap(),
            "---\r\ntitle: A\r\nservings: 4\r\n---\r\nNew\r\nline\r\n"
        );
        let bom = "\u{feff}---\ntitle: A\n---\nBody\n";
        assert!(splice(bom, &with(bom, |_| {}), "Body")
            .unwrap()
            .starts_with('\u{feff}'));
    }

    #[test]
    fn splice_removes_emptied_keys_and_handles_no_front_matter() {
        let fields = with(PIE, |f| {
            f.insert("prep".into(), Value::Scalar(String::new()));
        });
        let out = splice(PIE, &fields, &body_of(PIE)).unwrap();
        assert_eq!(out, PIE.replace("prep: 15 min\n", ""));
        let plain = "Just words\n";
        let mut fields = BTreeMap::new();
        fields.insert("title".to_string(), Value::Scalar("Hi".into()));
        let out = splice(plain, &fields, "Just words").unwrap();
        assert_eq!(parse(&out).unwrap().front_matter.get("title"), Some("Hi"));
        assert!(out.ends_with("Just words\n"));
    }

    #[test]
    fn splice_rewrites_a_changed_job_block_and_refuses_duplicates() {
        let source = "---\ntitle: Floor\njob:\n  trade: flooring\n  place:\n    town: Maple Falls\n---\nDone.\n";
        let fields = with(source, |f| {
            f.insert("job.place.town".into(), Value::Scalar("Elkins".into()));
        });
        let out = splice(source, &fields, "Done.").unwrap();
        assert_eq!(
            parse(&out).unwrap().front_matter.get("job.place.town"),
            Some("Elkins")
        );
        assert!(out.starts_with("---\ntitle: Floor\njob:\n"));
        let twice = "---\ntitle: A\ntitle: B\n---\nx\n";
        assert!(splice(twice, &with("---\ntitle: B\n---\nx\n", |_| {}), "x").is_none());
    }

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
    fn subtitles_are_written_directly_under_the_title() {
        let mut fields = BTreeMap::new();
        fields.insert("description".to_string(), Value::Scalar("D".into()));
        fields.insert("subtitle".to_string(), Value::Scalar("S".into()));
        fields.insert("title".to_string(), Value::Scalar("T".into()));
        let text = compose(&fields, "body");
        assert!(text.starts_with("---\ntitle: T\nsubtitle: S\n"), "{text}");
    }

    #[test]
    fn faq_entries_are_flattened_and_written_back_in_order() {
        let text = "---\nid: a\nfaq:\n  - question: How long?\n    answer: \"Two days: maybe three.\"\n  - question: Cost?\n    answer: Ask.\nnext: x\n---\nbody";
        let doc = parse(text).unwrap();
        let fm = &doc.front_matter;
        assert_eq!(fm.get("faq.1.question"), Some("How long?"));
        assert_eq!(fm.get("faq.1.answer"), Some("Two days: maybe three."));
        assert_eq!(fm.get("faq.2.answer"), Some("Ask."));
        assert_eq!(fm.get("next"), Some("x"));
        let mut fields = fm.fields.clone();
        for n in 3..=10 {
            fields.insert(format!("faq.{n}.question"), Value::Scalar(format!("Q{n}")));
            fields.insert(format!("faq.{n}.answer"), Value::Scalar(format!("A{n}")));
        }
        let written = compose(&fields, "body");
        let again = parse(&written).unwrap();
        assert_eq!(again.front_matter.fields, fields);
        let order: Vec<&str> = written
            .lines()
            .filter(|line| line.contains("question:"))
            .collect();
        assert_eq!(order[1], "  - question: Cost?");
        assert_eq!(order[9], "  - question: Q10");
    }

    #[test]
    fn a_plain_faq_list_stays_a_list() {
        let doc = parse("---\nfaq:\n  - one\n  - two\n---\n").unwrap();
        assert_eq!(doc.front_matter.get_list("faq"), vec!["one", "two"]);
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
