// "It happened. [Undo]": one polite status line that says what an action did and, while it can be
// taken back, offers Undo beside the words (Zubra UI's toast can carry a link but not an action).
// The next thing said replaces it. Everything is placed as text.
import { h } from "./dom.js";

/**
 * `{ element, tell(words, { undo, undoLabel, link, variant, focus }), clear() }`. `undo` runs once;
 * `link` is `{ label, href }` for a place to go (a new draft, say).
 */
export function createDidLine({ className = "" } = {}) {
  const element = h("p", { class: `studio-did ${className}`.trim(), role: "status", "aria-live": "polite", hidden: true });
  function clear() {
    element.replaceChildren();
    element.hidden = true;
  }
  function tell(words, { undo = null, undoLabel = "", link = null, variant = "", focus = false } = {}) {
    element.replaceChildren(h("span", { class: "studio-did-words", text: String(words ?? "") }));
    element.dataset.variant = variant;
    if (link?.href && /^#\//.test(link.href)) element.append(h("a", { class: "studio-did-link", href: link.href, text: link.label }));
    if (undo) {
      let used = false;
      const button = h("action-button", { variant: "secondary", size: "sm", onClick: async () => {
        if (used) return;
        used = true;
        button.loading = true;
        try { await undo(); } finally { button.loading = false; }
      } }, undoLabel);
      element.append(button);
      if (focus) requestAnimationFrame(() => button.querySelector("button")?.focus());
    }
    element.hidden = false;
  }
  return { element, tell, clear };
}
