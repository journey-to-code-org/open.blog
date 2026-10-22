//! HTML escaping helpers shared by the renderer and the feeds.

/// Escape text for placement inside an HTML element or attribute.
pub fn text(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    push_text(&mut out, input);
    out
}

/// Append escaped text to an existing buffer.
pub fn push_text(out: &mut String, input: &str) {
    for ch in input.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            _ => out.push(ch),
        }
    }
}

/// Escape text for placement inside a double-quoted attribute value.
pub fn attr(input: &str) -> String {
    text(input)
}

/// Escape text for an XML text node or attribute (feeds, sitemaps).
pub fn xml(input: &str) -> String {
    text(input)
}

/// Wrap arbitrary HTML in a CDATA section, splitting any `]]>` sequences.
pub fn cdata(input: &str) -> String {
    format!("<![CDATA[{}]]>", input.replace("]]>", "]]]]><![CDATA[>"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escapes_all_special_characters() {
        assert_eq!(
            text("<a href=\"x\">'&'</a>"),
            "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;"
        );
    }

    #[test]
    fn cdata_splits_terminator() {
        assert_eq!(cdata("a]]>b"), "<![CDATA[a]]]]><![CDATA[>b]]>");
    }
}
