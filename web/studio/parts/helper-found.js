// What your helper found (Studio R8): the second step of the Writing helper sheet. One card per
// suggestion, in post order: where it is, her words quoted, why, and what to try. Use this swaps
// the exact quoted words inside one box (helper-rules `applyFinding`); every use has Undo, here
// and in the line under the box. Not this one moves it aside; nothing is sent.
//
// Everything a helper returned is untrusted: it is shown as text (textContent, clipped), never as
// a link, a picture, a button or an instruction, and nothing happens without her press. One with
// more than words in it (markup, a link, a list: helper-rules `moreThanWords`, or the server's
// `applicable: false`) has no Use this and is skipped by Use all: she types it herself.
import { fill, h, toast } from "./dom.js";
import { say } from "./words.js";
import { applyFinding, boxSpans, clip, findingInBoxes, findingPlace, shiftUsed, undoFinding } from "./helper-rules.js";

const CLIP = 600;

/** Text that may be long: clipped, with Show all. Always text. */
function clipped(tag, text, props = {}) {
  const cut = clip(text, CLIP);
  const words = h("bdi", { text: cut.text });
  const node = h(tag, props, words);
  if (cut.clipped) {
    const all = h("action-button", { variant: "link", size: "sm", onClick: () => { words.textContent = String(text); all.remove(); } }, say("found.showAll"));
    node.append(" ", all);
  }
  return node;
}

/**
 * `write` is `{ form(), boxes() }`; `closeAndShow(fn)` closes the sheet and then runs `fn`;
 * `changed()` tells the sheet a count changed. Returns `{ element, footer, show(result), left(),
 * applicable(), useAll(), has() }`.
 */
export function createFound({ write, closeAndShow, changed }) {
  const status = h("p", { class: "studio-ready-status", role: "status", tabindex: "-1" });
  const did = h("p", { class: "studio-ready-did", role: "status", hidden: true });
  const list = h("div", { class: "studio-found-list" });
  const aside = h("details", { class: "studio-ready-worth", hidden: true });
  const element = h("div", { class: "studio-ready-body studio-found" }, status, did, list, aside);
  let items = []; // { finding, n, state: "open" | "used" | "dismissed", record, box, cant, cantUndo }
  let used = [];
  let note = "";

  const formNow = () => write.form();
  const check = (item) => applyFinding(formNow(), item.finding, used);
  const open = () => items.filter((item) => item.state === "open");

  /** After a card is drawn again, put focus back in it (on its first button), so the keyboard stays where she was. */
  function focusCard(item, tries = 10) {
    const button = list.querySelector(`[data-finding="${item.n}"] .studio-found-actions button`);
    if (button) button.focus();
    else if (tries > 0) requestAnimationFrame(() => focusCard(item, tries - 1));
  }

  function tell(words, undo = null) {
    fill(did, h("span", { text: words }), undo ? h("action-button", { variant: "secondary", size: "sm", onClick: undo }, say("found.undo")) : "");
    did.hidden = false;
  }

  /** Use one suggestion. True when her words changed. */
  function use(item, { quiet = false } = {}) {
    const form = formNow();
    const out = applyFinding(form, item.finding, used);
    if (!out.ok) {
      item.cant = ["moved", "twice", "overlap"].includes(out.why);
      if (!quiet) { draw(); focusCard(item); }
      return false;
    }
    const box = write.boxes()[out.box];
    if (!box) return false;
    box.set(out.text, { at: out.end });
    used = [...shiftUsed(used, out.record), out.record];
    item.record = out.record;
    item.box = box;
    item.state = "used";
    box.notify();
    if (!quiet) {
      box.tell(say("found.changed"), () => undo(item));
      tell(say("found.changed"), () => undo(item));
      toast(say("found.changed"));
      draw();
      focusCard(item);
      changed();
    }
    return true;
  }

  /** Put one used suggestion back: the swap alone is reversed, so anything she typed since stays. */
  function undo(item, { quiet = false } = {}) {
    if (item.state !== "used" || !item.record) return false;
    const box = item.box;
    const out = box && write.boxes().includes(box) ? undoFinding(box.value, item.record) : { ok: false };
    if (!out.ok) {
      item.cantUndo = true;
      if (!quiet) { tell(say("found.cantUndo")); draw(); focusCard(item); }
      return false;
    }
    const record = item.record;
    box.set(out.text, { at: out.end });
    used = shiftUsed(used.filter((other) => other !== record), { ...record, at: out.at, evidence: record.suggestion, suggestion: record.evidence });
    item.record = null;
    item.box = null;
    item.state = "open";
    item.cant = false;
    box.notify();
    box.clearUndo();
    if (!quiet) {
      box.tell(say("found.putBack"));
      tell(say("found.putBack"));
      draw();
      focusCard(item);
      changed();
    }
    return true;
  }

  const applicable = () => open().filter((item) => check(item).ok);

  /** Use every suggestion that still fits, in order; one Undo puts them all back. */
  function useAll() {
    const done = [];
    for (const item of open()) if (use(item, { quiet: true })) done.push(item);
    if (!done.length) { draw(); return; }
    const undoAll = () => {
      // Last used first, so each swap is found where it was left.
      const back = [...done].reverse().filter((item) => undo(item, { quiet: true }));
      tell(back.length === done.length ? say("found.putBack") : say("found.cantUndo"));
      draw();
      changed();
      status.focus();
    };
    const words = done.length === 1 ? say("found.changed") : say("found.changedMany", { count: done.length });
    for (const box of new Set(done.map((item) => item.box))) box.tell(words, undoAll);
    tell(words, undoAll);
    toast(words);
    draw();
    changed();
    requestAnimationFrame(() => did.querySelector("button")?.focus());
  }

  function showMe(item) {
    closeAndShow(() => {
      const at = findingInBoxes(formNow(), item.finding);
      const box = at ? write.boxes()[at.box] : write.boxes()[0];
      if (box && at) box.reveal(at.start, at.end);
      else box?.focus();
    });
  }

  function card(item, spans) {
    const { finding } = item;
    const place = findingPlace(finding.range, spans, finding.evidence);
    const fit = item.state === "open" ? check(item) : { ok: false };
    const fits = fit.ok;
    // More than words (markup, a link, a list...): never put in for her, whatever her words are now.
    const more = item.state === "open" && fit.why === "more";
    const suggestion = typeof finding.suggestion === "string" ? finding.suggestion : null;
    const from = clip(finding.evidence, 60).text;
    const buttons = [];
    if (item.state === "used") {
      buttons.push(h("span", { class: "studio-found-used", text: say("found.used") }),
        h("action-button", { variant: "secondary", size: "sm", onClick: () => undo(item) }, say("found.undo")));
    } else {
      if (fits) buttons.push(h("action-button", { size: "sm", class: "studio-found-use", label: say("found.useThisName", { from, to: clip(suggestion, 60).text }), onClick: () => use(item) }, say("found.useThis")));
      buttons.push(h("action-button", { variant: "secondary", size: "sm", label: say("found.showMeName", { n: item.n, place }), onClick: () => showMe(item) }, say("found.showMe")));
      buttons.push(h("action-button", { variant: "ghost", size: "sm", label: say("found.notThisName", { n: item.n }), onClick: () => { item.state = "dismissed"; draw(); changed(); status.focus(); } }, say("found.notThis")));
    }
    // The card's heading is where the suggestion is ("In Your story").
    return h("content-card", { class: "studio-found-card", "data-finding": String(item.n), heading: place },
      finding.evidence ? clipped("blockquote", `“${finding.evidence}”`, { class: "studio-found-quote" }) : null,
      clipped("p", finding.explanation, { class: "studio-found-why" }),
      suggestion !== null && item.state !== "used" ? clipped("p", suggestion ? say("found.try", { words: suggestion }) : say("found.tryNothing"), { class: "studio-found-try" }) : null,
      finding.verification === "supplied-context" ? h("p", { class: "studio-help", text: say("found.fromNotes") }) : null,
      more ? h("p", { class: "studio-help studio-found-more", text: say("found.moreThanWords") }) : null,
      item.cant && item.state === "open" ? h("p", { class: "studio-help", text: say("found.cantUse") }) : null,
      item.cantUndo && item.state === "used" ? h("p", { class: "studio-help", text: say("found.cantUndo") }) : null,
      h("div", { class: "studio-found-actions" }, buttons),
      h("details", { class: "studio-help studio-found-details" }, h("summary", { text: say("common.forHelper") }),
        h("p", { class: "studio-mono", text: say("found.detail", {
          skill: clip(String(finding.skillId || "?"), 40).text, version: clip(String(finding.skillVersion || "?"), 16).text, category: clip(String(finding.category || "?"), 40).text,
          severity: clip(String(finding.severity || "?"), 12).text, verification: clip(String(finding.verification || "?"), 24).text, start: finding.range.start, end: finding.range.end,
        }) }),
        Array.isArray(finding.sources) && finding.sources.length ? h("p", { class: "studio-mono", text: say("found.sources", { list: clip(finding.sources.map(String).join(", "), 180).text }) }) : null));
  }

  function draw() {
    const spans = boxSpans(formNow());
    const shown = items.filter((item) => item.state !== "dismissed");
    const gone = items.filter((item) => item.state === "dismissed");
    const left = open().length;
    fill(status, h("span", { text: left === 1 ? say("found.countOne") : say("found.count", { count: left }) }), note ? h("span", { class: "studio-ready-nothing", text: note }) : "");
    fill(list, ...shown.map((item) => card(item, spans)));
    aside.hidden = !gone.length;
    fill(aside, h("summary", { text: say("found.notThisList", { count: gone.length }) }),
      h("ul", { class: "studio-ready-list" }, gone.map((item) => h("li", { class: "studio-ready-item" },
        clipped("span", item.finding.explanation),
        h("action-button", { variant: "secondary", size: "sm", label: say("found.bringBackName", { n: item.n }), onClick: () => { item.state = "open"; draw(); focusCard(item); changed(); } }, say("found.bringBack"))))));
  }

  return {
    element,
    status,
    /** Show a read's suggestions (already in post order). `changedWhile` adds the note that she edited meanwhile. */
    show(findings, { changedWhile = false } = {}) {
      items = findings.map((finding, index) => ({ finding, n: index + 1, state: "open", record: null, box: null, cant: false, cantUndo: false }));
      used = [];
      note = changedWhile ? say("helper.changedWhile") : "";
      did.hidden = true;
      draw();
    },
    redraw: draw,
    has: () => items.length > 0,
    /** Suggestions she hasn't used or set aside. */
    left: () => open().length,
    applicable: () => applicable().length,
    useAll,
    clear() { items = []; used = []; list.replaceChildren(); },
  };
}
