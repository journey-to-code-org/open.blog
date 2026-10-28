//! A theme with `codeWindows` frames every plain code block the way a titled one is framed
//! (ADR 0269): `<figure class="ob-code-block">` with a `<figcaption class="ob-code-title">`
//! naming the language. It is done while the page is written, so no script wraps the blocks
//! after the page paints. Feeds, portable copies and other themes keep the plain blocks.

/// Wraps each `<pre><code ...>` that is not already inside a framed block (a titled block's
/// figure, or a runnable example) in a captioned figure.
pub fn frame(html: &str) -> String {
    if !html.contains("<pre><code") {
        return html.to_string();
    }
    let mut out = String::with_capacity(html.len() + 256);
    // How many framed containers (and figures inside them) the cursor is within.
    let mut framed = 0usize;
    let mut rest = html;
    while let Some(lt) = rest.find('<') {
        out.push_str(&rest[..lt]);
        rest = &rest[lt..];
        if framed == 0 && rest.starts_with("<pre><code") {
            let Some(end) = rest.find("</pre>") else {
                break;
            };
            let block = &rest[..end + "</pre>".len()];
            out.push_str(&format!(
                "<figure class=\"ob-code-block\"><figcaption class=\"ob-code-title\">{}</figcaption>{block}</figure>",
                caption(block)
            ));
            rest = &rest[block.len()..];
            continue;
        }
        let tag_end = rest.find('>').map_or(rest.len(), |i| i + 1);
        let tag = &rest[..tag_end];
        if opens_framed(tag) || (framed > 0 && tag.starts_with("<figure")) {
            framed += 1;
        } else if framed > 0 && closes_framed(tag) {
            framed -= 1;
        }
        out.push_str(tag);
        rest = &rest[tag_end..];
    }
    out.push_str(rest);
    out
}

const RUNNABLE: [&str; 3] = ["ob-rust-playground", "ob-code-runner", "ob-web-sandbox"];

fn opens_framed(tag: &str) -> bool {
    tag.starts_with("<figure class=\"ob-code-block")
        || RUNNABLE.iter().any(|name| {
            tag.strip_prefix('<')
                .and_then(|t| t.strip_prefix(name))
                .is_some_and(|t| t.starts_with([' ', '>']))
        })
}

fn closes_framed(tag: &str) -> bool {
    tag == "</figure>" || RUNNABLE.iter().any(|name| tag == format!("</{name}>"))
}

/// The label a code window shows: what the reader is looking at, not the raw fence tag.
fn caption(block: &str) -> String {
    let open = &block[..block.find('>').map_or(0, |i| i + 1)];
    let code = &block[open.len()..];
    let code_tag = &code[..code.find('>').map_or(0, |i| i + 1)];
    let language = code_tag
        .split("class=\"")
        .nth(1)
        .and_then(|classes| classes.split('"').next())
        .and_then(|classes| {
            classes
                .split_whitespace()
                .find_map(|class| class.strip_prefix("language-"))
        });
    match language {
        Some("rust") => "Rust".into(),
        Some("bash" | "sh" | "shell" | "shell-session" | "console") => "Terminal".into(),
        Some("diff") => "Diff".into(),
        // A language name is a word (`toml`, `c++`, `f#`); anything else in a hand-written class
        // is dropped, so nothing from it becomes markup.
        Some(language) => {
            let name: String = language
                .chars()
                .filter(|c| c.is_ascii_alphanumeric() || "+#._-".contains(*c))
                .collect();
            if name.is_empty() {
                "Code".into()
            } else {
                name
            }
        }
        None => "Code".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::frame;

    #[test]
    fn plain_blocks_get_a_window_named_for_what_they_show() {
        let html = "<p>Run:</p>\n<pre><code class=\"language-bash\">cargo run\n</code></pre>\n<pre><code class=\"language-rust\">fn a() {}\n</code></pre>\n<pre><code class=\"language-toml\">[x]\n</code></pre>\n<pre><code>plain\n</code></pre>";
        assert_eq!(
            frame(html),
            "<p>Run:</p>\n<figure class=\"ob-code-block\"><figcaption class=\"ob-code-title\">Terminal</figcaption><pre><code class=\"language-bash\">cargo run\n</code></pre></figure>\n<figure class=\"ob-code-block\"><figcaption class=\"ob-code-title\">Rust</figcaption><pre><code class=\"language-rust\">fn a() {}\n</code></pre></figure>\n<figure class=\"ob-code-block\"><figcaption class=\"ob-code-title\">toml</figcaption><pre><code class=\"language-toml\">[x]\n</code></pre></figure>\n<figure class=\"ob-code-block\"><figcaption class=\"ob-code-title\">Code</figcaption><pre><code>plain\n</code></pre></figure>"
        );
    }

    #[test]
    fn framed_and_runnable_blocks_are_left_alone() {
        for html in [
            "<figure class=\"ob-code-block\"><figcaption class=\"ob-code-title\">main.rs</figcaption><pre><code class=\"language-rust\">x</code></pre></figure>",
            "<figure class=\"ob-code-block ob-runnable-code\"><figcaption class=\"ob-code-title\">Try</figcaption><ob-rust-playground data-x=\"1\"><pre><code class=\"language-rust\">x</code></pre></ob-rust-playground></figure>",
            "<ob-web-sandbox><figure class=\"inner\"><pre><code class=\"language-html\">a</code></pre></figure><pre><code class=\"language-css\">b</code></pre></ob-web-sandbox>",
            "<p>No code here, only <code>inline</code>.</p>",
        ] {
            assert_eq!(frame(html), html);
        }
        // A plain block after a framed one is still framed.
        let after = frame("<figure class=\"ob-code-block\"><pre><code>a</code></pre></figure><pre><code>b</code></pre>");
        assert!(after.ends_with("<figure class=\"ob-code-block\"><figcaption class=\"ob-code-title\">Code</figcaption><pre><code>b</code></pre></figure>"), "{after}");
    }

    #[test]
    fn a_hand_written_class_never_becomes_markup() {
        let framed = frame("<pre><code class=\"language-<b>x\">x</code></pre>");
        let caption = &framed
            [framed.find("ob-code-title\">").unwrap() + 15..framed.find("</figcaption>").unwrap()];
        assert!(
            caption.chars().all(|c| c.is_ascii_alphanumeric()),
            "{framed}"
        );
        assert!(frame("<pre><code class=\"language-c++\">x</code></pre>")
            .contains("<figcaption class=\"ob-code-title\">c++</figcaption>"));
        assert!(
            frame("<pre><code class=\"language-&lt;&gt;\">x</code></pre>")
                .contains("<figcaption class=\"ob-code-title\">ltgt</figcaption>")
        );
    }
}
