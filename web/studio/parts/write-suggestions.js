// Suggestions under her words (Studio R6): gentle checks (a photo with no description, a link that
// says "click here", a paragraph too long for a phone...), shown only when there are any, updated a
// moment after she stops typing. They never stop a save. Each has Show me and, when it is safe,
// Fix it, with Undo. An HTML note is only for the person who set up the site.
import { h } from "./dom.js";
import { say } from "./words.js";
import { applyFix, checkMarkdown, checkWords, suggestionsHeading } from "./checks.js";

const WAIT_MS = 600;

/** `{ boxes(), did(box, before, words), reveal(box, start, end) }`. */
export function createSuggestions({ boxes, did, reveal }) {
  const summary = h("summary", {});
  const list = h("ul", { class: "studio-suggestions" });
  const helper = h("ul", { class: "studio-suggestions" });
  const helperDetails = h("details", { class: "studio-help", hidden: true }, h("summary", { text: say("common.forHelper") }), helper);
  const live = h("p", { class: "studio-visually-hidden", "aria-live": "polite" });
  const element = h("details", { class: "studio-suggestions-box", hidden: true }, summary, list, helperDetails);
  let timer = 0;
  let shown = 0;

  function item(box, issue, text) {
    const said = checkWords(issue, text);
    const show = h("action-button", { variant: "link", onClick: () => reveal(box, issue.start, issue.end) }, say("check.showMe"));
    const parts = [h("span", { text: said.words }), " ", show];
    if (said.fix && issue.fix) {
      const fix = h("action-button", { variant: "secondary", size: "sm", onClick: () => {
        if (issue.fix.kind !== "describe") { apply(box, issue, ""); return; }
        // A describe-fix asks for her words first.
        const answer = h("text-field", { label: issue.rule === "picture-description" ? say("form.describe") : say("form.linkWords") });
        const use_ = h("action-button", { size: "sm", onClick: () => { if (String(answer.value || "").trim()) apply(box, issue, String(answer.value)); else answer.error = say("form.fillThis"); } }, say("check.useWords"));
        fix.replaceWith(h("span", { class: "studio-suggestion-fix" }, answer, use_));
        requestAnimationFrame(() => answer.querySelector("input")?.focus());
      } }, said.fix);
      parts.push(" ", fix);
    }
    return h("li", {}, ...parts);
  }

  function apply(box, issue, answer) {
    const before = box.value;
    const out = applyFix(before, issue, answer);
    if (!out.changed) { refresh(); return; }
    box.set(out.markdown, { at: issue.start });
    did(box, before, say("did.fixed"));
    refresh();
  }

  function refresh() {
    const rows = [];
    const notes = [];
    for (const box of boxes()) {
      const text = box.value;
      for (const issue of checkMarkdown(text, { html: true, headingBase: 1 })) {
        if (issue.rule === "html") notes.push(item(box, issue, text));
        else rows.push(item(box, issue, text));
      }
    }
    list.replaceChildren(...rows);
    helper.replaceChildren(...notes);
    helperDetails.hidden = !notes.length;
    element.hidden = !rows.length && !notes.length;
    summary.textContent = suggestionsHeading(rows.length) || say("check.none");
    if (shown && !rows.length) live.textContent = say("check.none");
    shown = rows.length;
  }

  return {
    element: h("div", {}, element, live),
    schedule() {
      clearTimeout(timer);
      timer = setTimeout(refresh, WAIT_MS);
    },
    refresh,
    open() {
      refresh();
      if (element.hidden) { live.textContent = say("check.none"); return; }
      element.open = true;
      summary.focus();
    },
  };
}
