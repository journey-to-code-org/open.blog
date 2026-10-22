// <ob-code highlight> wraps rendered Markdown. It adds a "Copy" button to every
// code block and, when the `highlight` attribute is present, colours the code
// with a small built-in tokenizer: no external library, no network request.
//
// Colours come from theme tokens (--ob-color-code-keyword and friends), so a
// theme restyles the palette without touching this file. A theme that ships
// its own highlighter sets "codeHighlighting": false in theme.json, which
// drops the attribute, and loads its script through "scripts".
//
// The tokenizer lives in ob-highlight.js. Blocks without a language are
// guessed from their content. Tokens are emitted as <span class="tok-…">
// elements built with DOM calls, never innerHTML, so code can never inject markup.

import { detectLanguage, highlight, isKnownLanguage } from "./ob-highlight.js";

function paint(codeEl) {
  if (codeEl.dataset.highlighted) return;
  const match = /(?:^|\s)language-([\w+#-]+)/.exec(codeEl.className || "");
  // A fence without a language (common in imported posts) is guessed from its
  // content; an unknown or plain-text language stays as written.
  const language = match ? match[1].toLowerCase() : detectLanguage(codeEl.textContent);
  if (!language) return;
  if (!match) codeEl.dataset.language = language;
  if (!isKnownLanguage(language)) return;
  const tokens = highlight(codeEl.textContent, language);
  if (tokens.every((t) => !t.cls)) return;
  const frag = document.createDocumentFragment();
  for (const t of tokens) {
    if (t.cls) {
      const span = document.createElement("span");
      span.className = `tok-${t.cls}`;
      span.textContent = t.text;
      frag.append(span);
    } else {
      frag.append(t.text);
    }
  }
  codeEl.replaceChildren(frag);
  codeEl.dataset.highlighted = "true";
}

class ObCode extends HTMLElement {
  connectedCallback() {
    const doHighlight = this.hasAttribute("highlight");
    for (const pre of this.querySelectorAll("pre")) {
      const code = pre.querySelector("code");
      if (doHighlight && code) {
        try {
          paint(code);
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
