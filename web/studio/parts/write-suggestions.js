// Suggestions under her words (Studio R6): gentle checks (a photo with no description, a link that
// says "click here", a paragraph too long for a phone...), shown only when there are any, updated a
// moment after she stops typing. They never stop a save. Each has Show me and, when it is safe,
// Fix it, with Undo. An HTML note is only for the person who set up the site. The list ends with
// Check everything before you publish (R7), and `items()` gives the same suggestions, written once,
// to Before you publish.
import { h } from "./dom.js";
import { say } from "./words.js";
import { applyFix, checkMarkdown, checkWords, suggestionsHeading } from "./checks.js";

const WAIT_MS = 600;

/** `{ boxes(), did(box, before, words), reveal(box, start, end), body(), checkEverything() }`. */
export function createSuggestions({ boxes, did, reveal, body = () => "", checkEverything = null }) {
  const summary = h("summary", {});
  const list = h("ul", { class: "studio-suggestions" });
  const helper = h("ul", { class: "studio-suggestions" });
  const helperDetails = h("details", { class: "studio-help", hidden: true }, h("summary", { text: say("common.forHelper") }), helper);
  const live = h("p", { class: "studio-visually-hidden", "aria-live": "polite" });
  const everything = checkEverything ? h("action-button", { variant: "link", class: "studio-check-everything", onClick: () => checkEverything() }, say("ready.checkEverything")) : null;
  const element = h("details", { class: "studio-suggestions-box", hidden: true }, summary, list, helperDetails, everything);
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
        const answer = h("text-field", { label: ["picture-description", "picture-file-name"].includes(issue.rule) ? say("form.describe") : say("form.linkWords") });
        const use_ = h("action-button", { size: "sm", onClick: () => { if (String(answer.value || "").trim()) apply(box, issue, String(answer.value)); else answer.error = say("form.fillThis"); } }, say("check.useWords"));
        fix.replaceWith(h("span", { class: "studio-suggestion-fix" }, answer, use_));
        requestAnimationFrame(() => answer.querySelector("input")?.focus());
      } }, said.fix);
      parts.push(" ", fix);
    }
    return h("li", {}, ...parts);
  }

  /** Apply a fix; `{ box, before }` when it changed her words, else null. */
  function apply(box, issue, answer) {
    const before = box.value;
    const out = applyFix(before, issue, answer);
    if (!out.changed) { refresh(); return null; }
    box.set(out.markdown, { at: issue.start });
    did(box, before, say("did.fixed"));
    refresh();
    return { box, before };
  }

  /** Every suggestion in every box: `{ box, issue, text }`, HTML notes apart. */
  function found() {
    const rows = [];
    const notes = [];
    for (const box of boxes()) {
      const text = box.value;
      for (const issue of checkMarkdown(text, { html: true, headingBase: 1 })) (issue.rule === "html" ? notes : rows).push({ box, issue, text });
    }
    return { rows, notes };
  }

  function refresh() {
    const { rows, notes } = found();
    list.replaceChildren(...rows.map(({ box, issue, text }) => item(box, issue, text)));
    helper.replaceChildren(...notes.map(({ box, issue, text }) => item(box, issue, text)));
    helperDetails.hidden = !notes.length;
    element.hidden = !rows.length && !notes.length;
    summary.textContent = suggestionsHeading(rows.length) || say("check.none");
    if (shown && !rows.length) live.textContent = say("check.none");
    shown = rows.length;
  }

  /** The line (from 1) of a place in a box, counted in all her words. */
  function lineOf(box, start) {
    const all = String(body());
    const at = box.value ? all.indexOf(box.value) : -1;
    return at < 0 ? undefined : all.slice(0, at + start).split("\n").length;
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
    /** How many suggestions there are now (not the HTML notes). */
    count: () => found().rows.length,
    /**
     * The same suggestions for Before you publish: `{ rule, line, words, fixLabel, describe, show(), fix(answer) }`,
     * where `fix` returns `{ box, before }` (for its Undo) or null. HTML notes are `details: true`.
     */
    items() {
      const { rows, notes } = found();
      const make = ({ box, issue, text }, details) => {
        const said = checkWords(issue, text);
        return {
          rule: issue.rule, line: lineOf(box, issue.start), words: said.words, details,
          fixLabel: said.fix && issue.fix ? said.fix : "", describe: issue.fix?.kind === "describe",
          describeLabel: ["picture-description", "picture-file-name"].includes(issue.rule) ? say("form.describe") : say("form.linkWords"),
          show: () => reveal(box, issue.start, issue.end),
          fix: (answer = "") => apply(box, issue, answer),
        };
      };
      return [...rows.map((row) => make(row, false)), ...notes.map((row) => make(row, true))];
    },
  };
}
