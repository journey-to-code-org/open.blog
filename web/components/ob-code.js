// <ob-code highlight> wraps rendered Markdown. It adds a "Copy" button to every
// code block and, when the `highlight` attribute is present, colours the code
// with a small built-in tokenizer: no external library, no network request.
//
// Colours come from theme tokens (--ob-color-code-keyword and friends), so a
// theme restyles the palette without touching this file. A theme that ships
// its own highlighter sets "codeHighlighting": false in theme.json, which
// drops the attribute, and loads its script through "scripts".
//
// With the `line-numbers` attribute, blocks of two or more lines are numbered.
// The numbers are drawn by CSS (a counter on each .ob-line), so they are never
// part of the text: copying, by button or by selection, gives only the code.
// Plain-text fences (`text`, `output`) and unrecognised untagged blocks,
// which are usually program output or prose, are not numbered.
//
// The tokenizer lives in ob-highlight.js. Blocks without a language are
// guessed from their content. Tokens are emitted as <span class="tok-…">
// elements built with DOM calls, never innerHTML, so code can never inject markup.

import { detectLanguage, highlight, isKnownLanguage, isPlainText, splitLines } from "./ob-highlight.js";

/** Append one token to `parent`: a classed span, or plain text. */
function append(parent, token) {
  if (token.cls) {
    const span = document.createElement("span");
    span.className = `tok-${token.cls}`;
    span.textContent = token.text;
    parent.append(span);
  } else {
    parent.append(token.text);
  }
}

function enhance(codeEl, { colour, numbers }) {
  if (codeEl.dataset.enhanced) return;
  const text = codeEl.textContent;
  const match = /(?:^|\s)language-([\w+#-]+)/.exec(codeEl.className || "");
  // A fence without a language (common in imported posts) is guessed from its
  // content; an unknown or plain-text language stays as written.
  const language = match ? match[1].toLowerCase() : detectLanguage(text);
  if (language && !match && colour) codeEl.dataset.language = language;

  let tokens = null;
  if (colour && language && isKnownLanguage(language)) {
    const painted = highlight(text, language);
    if (painted.some((t) => t.cls)) tokens = painted;
  }
  const lineCount = text.replace(/\n$/, "").split("\n").length;
  const numbered = numbers && lineCount >= 2 && Boolean(language) && !isPlainText(language);
  if (!tokens && !numbered) return;

  const frag = document.createDocumentFragment();
  const all = tokens || [{ text, cls: null }];
  if (numbered) {
    const lines = splitLines(all);
    lines.forEach((line, i) => {
      const row = document.createElement("span");
      row.className = "ob-line";
      for (const t of line) append(row, t);
      frag.append(row);
      if (i < lines.length - 1) frag.append("\n");
    });
    if (text.endsWith("\n")) frag.append("\n"); // keep the text exactly as written
    codeEl.classList.add("ob-numbered");
    codeEl.style.setProperty("--ob-line-digits", String(String(lines.length).length));
  } else {
    for (const t of all) append(frag, t);
  }
  codeEl.replaceChildren(frag);
  codeEl.dataset.enhanced = "true";
  if (tokens) codeEl.dataset.highlighted = "true";
}

class ObCode extends HTMLElement {
  connectedCallback() {
    const options = { colour: this.hasAttribute("highlight"), numbers: this.hasAttribute("line-numbers") };
    for (const pre of this.querySelectorAll("pre")) {
      const code = pre.querySelector("code");
      if (code && (options.colour || options.numbers)) {
        try {
          enhance(code, options);
        } catch {
          // A tokenizer bug must never blank out the code; the plain text stays.
        }
      }
      if (navigator.clipboard && !pre.querySelector(".ob-copy")) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "ob-copy";
        button.textContent = "Copy";
        button.setAttribute("aria-label", "Copy code to clipboard");
        button.addEventListener("click", async () => {
          try {
            await navigator.clipboard.writeText(code?.textContent ?? pre.textContent);
            button.textContent = "Copied";
          } catch {
            button.textContent = "Failed";
          }
          setTimeout(() => (button.textContent = "Copy"), 1600);
        });
        pre.append(button);
      }
    }
  }
}

if (!customElements.get("ob-code")) {
  customElements.define("ob-code", ObCode);
}
