//! Word shingles of text, for the publication boundary's text guard (#63,
//! ADR 0137).
//!
//! Private text and every generated output are normalised the same way and
//! compared as hashes of [`SHINGLE_WORDS`] consecutive words. The same
//! sentence therefore matches whether an output wrapped it across lines,
//! joined it into a search index, stripped its emphasis and links, escaped it
//! as HTML entities or JSON, or changed its case or punctuation.
//!
//! Normalisation, in order, for generated output ([`Form::Output`]): JSON
//! escapes are decoded, markup is removed (tag and attribute names vanish,
//! while the text of `content`, `alt`, `title` and similar attributes stays,
//! each as its own run), HTML entities are decoded, and markup that was
//! escaped inside the output (a feed's `&lt;p&gt;`) is removed once more.
//! Private text and public input fields ([`Form::Plain`]) are already text and
//! are not decoded. Then both are folded and split into words: every
//! non-alphanumeric run (punctuation, markup remnants, newlines) separates
//! words, letters are lower-cased, full-width forms and ligatures are
//! mapped to their plain letters, and zero-width characters are dropped. No
//! Unicode normalisation tables are bundled, so a decomposed accent does not
//! equal its precomposed form: a stated gap.

use std::collections::HashSet;

/// How many consecutive words make one shingle. Six words are a clause: long
/// enough that common phrases rarely repeat by chance across a site's own
/// prose and generated boilerplate, short enough that a sentence fragment
/// of a note or passage is still found. Text of fewer words is not guarded.
pub const SHINGLE_WORDS: usize = 6;

/// How a text reaches the guard.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Form {
    /// Text as written: a private field, a post's text, a title.
    Plain,
    /// A generated file: HTML, JSON, XML, plain text or a feed.
    Output,
}

/// Separates runs that must not form a shingle across their boundary.
const BARRIER: char = '\u{E000}';
/// The attributes whose value is text a reader or a crawler sees.
const TEXT_ATTRIBUTES: &[&str] = &[
    "content",
    "alt",
    "title",
    "aria-label",
    "aria-description",
    "placeholder",
    "label",
    "summary",
    "value",
    "data-title",
    "data-label",
];
/// The longest tag the markup remover recognises.
const MAX_TAG: usize = 16 * 1024;

/// The word hashes of `text`, with `0` between runs that are not adjacent.
pub fn words(text: &str, form: Form) -> Vec<u64> {
    let prepared;
    let text = match form {
        Form::Plain => text,
        Form::Output => {
            prepared = prepare_output(text);
            prepared.as_str()
        }
    };
    split(text)
}

/// Call `each` with the hash of every shingle in `text`.
pub fn each_shingle(text: &str, form: Form, mut each: impl FnMut(u64)) {
    let words = words(text, form);
    for run in words.split(|&word| word == 0) {
        if run.len() < SHINGLE_WORDS {
            continue;
        }
        for window in run.windows(SHINGLE_WORDS) {
            let mut hash = 0xcbf2_9ce4_8422_2325u64;
            for &word in window {
                hash = (hash.rotate_left(7) ^ word).wrapping_mul(0x0100_0000_01b3);
            }
            each(hash);
        }
    }
}

/// The distinct shingle hashes of `text`.
pub fn shingle_set(text: &str, form: Form) -> HashSet<u64> {
    let mut set = HashSet::new();
    each_shingle(text, form, |hash| {
        set.insert(hash);
    });
    set
}

fn prepare_output(text: &str) -> String {
    let unescaped = if text.contains('\\') {
        json_unescape(text)
    } else {
        text.to_string()
    };
    let stripped = strip_markup(&unescaped);
    let decoded = decode_entities(&stripped);
    if decoded.contains('<') {
        decode_entities(&strip_markup(&decoded))
    } else {
        decoded
    }
}

fn json_unescape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        match chars.peek().copied() {
            Some('u') => {
                let mut ahead = chars.clone();
                ahead.next();
                let code = hex4(&mut ahead);
                match code {
                    Some(high @ 0xD800..=0xDBFF) => {
                        let mut pair = ahead.clone();
                        let low = (pair.next() == Some('\\') && pair.next() == Some('u'))
                            .then(|| hex4(&mut pair))
                            .flatten()
                            .filter(|low| (0xDC00..=0xDFFF).contains(low));
                        if let Some(low) = low {
                            let scalar = 0x10000 + ((high - 0xD800) << 10) + (low - 0xDC00);
                            out.push(char::from_u32(scalar).unwrap_or(' '));
                            chars = pair;
                        } else {
                            out.push(' ');
                            chars = ahead;
                        }
                    }
                    Some(code) => {
                        out.push(char::from_u32(code).unwrap_or(' '));
                        chars = ahead;
                    }
                    None => out.push('\\'),
                }
            }
            Some('n' | 'r' | 't' | 'b' | 'f') => {
                chars.next();
                out.push(' ');
            }
            Some(escaped @ ('"' | '/' | '\\')) => {
                chars.next();
                out.push(escaped);
            }
            _ => out.push('\\'),
        }
    }
    out
}

fn hex4(chars: &mut std::iter::Peekable<std::str::Chars<'_>>) -> Option<u32> {
    let mut code = 0;
    for _ in 0..4 {
        code = code * 16 + chars.next()?.to_digit(16)?;
    }
    Some(code)
}

/// Remove tags, keeping the text inside comments and CDATA, and the text of
/// text-bearing attributes, each as a run of its own after the document, so
/// the words around a tag stay adjacent.
fn strip_markup(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = String::with_capacity(text.len());
    let mut attributes = String::new();
    let mut index = 0;
    let mut plain = 0;
    while index < bytes.len() {
        if bytes[index] != b'<' {
            index += 1;
            continue;
        }
        let rest = &text[index..];
        let marker = rest
            .strip_prefix("<!--")
            .map(|_| 4)
            .or_else(|| rest.strip_prefix("<![CDATA[").map(|_| 9));
        let starts_tag = matches!(
            bytes.get(index + 1),
            Some(b'a'..=b'z' | b'A'..=b'Z' | b'/' | b'!' | b'?')
        );
        if marker.is_none() && !starts_tag {
            index += 1;
            continue;
        }
        out.push_str(&text[plain..index]);
        out.push(' ');
        if let Some(length) = marker {
            index += length;
            plain = index;
            continue;
        }
        match tag_end(rest) {
            Some(end) => {
                attribute_text(&rest[1..end], &mut attributes);
                index += end + 1;
            }
            None => {
                out.push('<');
                index += 1;
            }
        }
        plain = index;
    }
    out.push_str(&text[plain..]);
    out.push_str(&attributes);
    out
}

/// The offset of the `>` that closes the tag at the start of `rest`.
fn tag_end(rest: &str) -> Option<usize> {
    let mut quote = None;
    for (offset, byte) in rest.bytes().enumerate().take(MAX_TAG) {
        match (quote, byte) {
            (Some(open), byte) if byte == open => quote = None,
            (Some(_), _) => {}
            (None, b'"' | b'\'') => quote = Some(byte),
            (None, b'>') => return Some(offset),
            _ => {}
        }
    }
    None
}

/// Push the text-bearing attribute values of the tag body `tag` (the text
/// between `<` and `>`), each between barriers.
fn attribute_text(tag: &str, out: &mut String) {
    let mut chars = tag.char_indices().peekable();
    while let Some(&(_, c)) = chars.peek() {
        if c.is_whitespace() || c == '/' {
            chars.next();
            continue;
        }
        let start = chars.peek().map_or(tag.len(), |&(at, _)| at);
        let mut end = start;
        while let Some(&(at, c)) = chars.peek() {
            if c.is_whitespace() || c == '=' || c == '>' || c == '/' {
                break;
            }
            end = at + c.len_utf8();
            chars.next();
        }
        let name = tag[start..end].to_ascii_lowercase();
        while chars.peek().is_some_and(|&(_, c)| c.is_whitespace()) {
            chars.next();
        }
        if chars.peek().map(|&(_, c)| c) != Some('=') {
            continue;
        }
        chars.next();
        while chars.peek().is_some_and(|&(_, c)| c.is_whitespace()) {
            chars.next();
        }
        let value = match chars.peek().copied() {
            Some((at, quote @ ('"' | '\''))) => {
                chars.next();
                let from = at + 1;
                let mut to = tag.len();
                for (at, c) in chars.by_ref() {
                    if c == quote {
                        to = at;
                        break;
                    }
                }
                &tag[from.min(to)..to]
            }
            Some((at, _)) => {
                let mut to = tag.len();
                while let Some(&(next, c)) = chars.peek() {
                    if c.is_whitespace() {
                        to = next;
                        break;
                    }
                    chars.next();
                }
                &tag[at..to]
            }
            None => "",
        };
        if TEXT_ATTRIBUTES.contains(&name.as_str()) {
            out.push(BARRIER);
            out.push_str(value);
            out.push(BARRIER);
        }
    }
}

fn decode_entities(text: &str) -> String {
    if !text.contains('&') {
        return text.to_string();
    }
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find('&') {
        out.push_str(&rest[..at]);
        let tail = &rest[at + 1..];
        let end = tail
            .bytes()
            .take(12)
            .position(|byte| byte == b';')
            .filter(|&end| end > 0);
        match end {
            Some(end)
                if tail[..end]
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'#') =>
            {
                match entity(&tail[..end]) {
                    Some(decoded) => out.push_str(decoded.as_str()),
                    None => out.push(' '),
                }
                rest = &tail[end + 1..];
            }
            _ => {
                out.push('&');
                rest = tail;
            }
        }
    }
    out.push_str(rest);
    out
}

fn entity(name: &str) -> Option<String> {
    if let Some(number) = name.strip_prefix('#') {
        let code = match number.strip_prefix(['x', 'X']) {
            Some(hex) => u32::from_str_radix(hex, 16).ok()?,
            None => number.parse().ok()?,
        };
        return char::from_u32(code).map(String::from);
    }
    let decoded = match name {
        "amp" => "&",
        "lt" => "<",
        "gt" => ">",
        "quot" => "\"",
        "apos" => "'",
        "nbsp" => " ",
        "agrave" => "\u{e0}",
        "aacute" => "\u{e1}",
        "acirc" => "\u{e2}",
        "auml" => "\u{e4}",
        "ccedil" => "\u{e7}",
        "egrave" => "\u{e8}",
        "eacute" => "\u{e9}",
        "ecirc" => "\u{ea}",
        "euml" => "\u{eb}",
        "iacute" => "\u{ed}",
        "icirc" => "\u{ee}",
        "iuml" => "\u{ef}",
        "ntilde" => "\u{f1}",
        "oacute" => "\u{f3}",
        "ocirc" => "\u{f4}",
        "ouml" => "\u{f6}",
        "uacute" => "\u{fa}",
        "ucirc" => "\u{fb}",
        "uuml" => "\u{fc}",
        "szlig" => "\u{df}",
        _ => return None,
    };
    Some(decoded.to_string())
}

fn split(text: &str) -> Vec<u64> {
    const OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
    const PRIME: u64 = 0x0100_0000_01b3;
    fn push(hash: &mut u64, open: &mut bool, words: &mut Vec<u64>) {
        if *open {
            words.push((*hash).max(1));
        }
        *hash = OFFSET;
        *open = false;
    }
    fn add(c: char, hash: &mut u64, open: &mut bool) {
        let mut buffer = [0u8; 4];
        for byte in c.encode_utf8(&mut buffer).bytes() {
            *hash = (*hash ^ u64::from(byte)).wrapping_mul(PRIME);
        }
        *open = true;
    }
    let mut words = Vec::new();
    let mut hash = OFFSET;
    let mut open = false;
    for c in text.chars() {
        if c == BARRIER {
            push(&mut hash, &mut open, &mut words);
            if words.last() != Some(&0) && !words.is_empty() {
                words.push(0);
            }
            continue;
        }
        if matches!(
            c,
            '\u{ad}' | '\u{200b}'..='\u{200d}' | '\u{2060}' | '\u{feff}'
        ) {
            continue;
        }
        let c = match c {
            '\u{ff01}'..='\u{ff5e}' => char::from_u32(c as u32 - 0xfee0).unwrap_or(c),
            _ => c,
        };
        let ligature = match c {
            '\u{fb00}' => Some("ff"),
            '\u{fb01}' => Some("fi"),
            '\u{fb02}' => Some("fl"),
            '\u{fb03}' => Some("ffi"),
            '\u{fb04}' => Some("ffl"),
            '\u{fb05}' | '\u{fb06}' => Some("st"),
            _ => None,
        };
        if let Some(letters) = ligature {
            for letter in letters.chars() {
                add(letter, &mut hash, &mut open);
            }
        } else if c.is_alphanumeric() {
            for lower in c.to_lowercase() {
                add(lower, &mut hash, &mut open);
            }
        } else {
            push(&mut hash, &mut open, &mut words);
        }
    }
    push(&mut hash, &mut open, &mut words);
    words
}

#[cfg(test)]
mod tests {
    use super::*;

    fn same(private: &str, output: &str) -> bool {
        let want = shingle_set(private, Form::Plain);
        let got = shingle_set(output, Form::Output);
        assert!(!want.is_empty(), "{private}");
        !want.is_disjoint(&got)
    }

    const NOTE: &str = "Check again: Smith (2003) disagrees, see p. 41; the 1987 letter is key.";

    #[test]
    fn one_sentence_matches_through_wrapping_markup_entities_and_json() {
        for output in [
            "<p>Check again: Smith (2003) disagrees,\nsee p. 41; the 1987\nletter is key.</p>",
            "<p>Check <em>again</em>: <a href=\"https://x.example/a\">Smith</a> (2003) disagrees, see p. 41; the 1987 letter is key.</p>",
            "<meta name=\"description\" content=\"Check again: Smith (2003) disagrees, see p. 41; the 1987 letter is key.\">",
            "{\"text\":\"check again: smith (2003) disagrees, see p. 41; the 1987 letter is\\nkey.\"}",
            "{\"text\":\"Check again: Smith (2003) disagrees, see p. 41; the 1987 letter is key.\"}",
            "<description>&lt;p&gt;Check &lt;b&gt;again&lt;/b&gt;: Smith (2003) disagrees, see p. 41; the 1987 letter is key.&lt;/p&gt;</description>",
            "<p>Check again&#58; Smith &#x28;2003&#41; disagrees&comma; see p. 41&semi; the 1987 letter is key.</p>",
            "<![CDATA[Check again: Smith (2003) disagrees, see p. 41; the 1987 letter is key.]]>",
            "CHECK AGAIN \u{ff1a} Smith (2003) disagrees, see p. 41; the 1987 letter is key.",
        ] {
            assert!(same(NOTE, output), "{output}");
        }
    }

    #[test]
    fn unrelated_text_and_markup_words_do_not_match() {
        assert!(!same(
            NOTE,
            "<p>Check the cave again: a wall, some shadows, and a fire.</p>"
        ));
        assert!(!same(
            "A private reading of the allegory that only the author has seen",
            "<a href=\"a\">A private</a> reading of <em>the</em> cave"
        ));
    }

    #[test]
    fn text_shorter_than_a_shingle_is_not_guarded() {
        assert!(shingle_set("ask Dana before publishing", Form::Plain).is_empty());
        assert!(shingle_set("one two three four five", Form::Plain).is_empty());
        assert_eq!(
            shingle_set("one two three four five six", Form::Plain).len(),
            1
        );
    }

    #[test]
    fn attribute_values_are_runs_of_their_own() {
        // The attribute's words never join the text around the tag.
        let output = "alpha beta gamma <img alt=\"delta epsilon zeta eta\"> theta iota kappa";
        let all = shingle_set(output, Form::Output);
        let across = shingle_set("gamma delta epsilon zeta eta theta", Form::Plain);
        assert!(all.is_disjoint(&across));
        let inside = shingle_set("delta epsilon zeta eta theta iota", Form::Plain);
        assert!(all.is_disjoint(&inside));
        assert!(shingle_set("alpha beta gamma theta iota kappa", Form::Plain).is_subset(&all));
    }
}
