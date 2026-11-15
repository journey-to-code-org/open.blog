// Suggestions as she types (Studio R8): off until she turns it on in the Writing helper sheet, for
// this post and this visit only. While it is on, a line under her words says so (her words are
// going out each time she pauses) with Turn off. A suggestion shows under the box she is in as
// plain words; Tab or Use it puts it in at her caret, Escape or No thanks drops it, and anything
// she does meanwhile drops it without a word. Nothing is remembered and nothing is sent later.
import { h, toast } from "./dom.js";
import { say } from "./words.js";
import { helperProblem } from "./helper-rules.js";
import { captureIsCurrent, captureKey, completionRequest, insertCompletion, MAX_FAILURES, PAUSE_MS, plainCompletion, shouldSuggest } from "./suggest-rules.js";

/**
 * `write` is `{ form(), boxes(), element (her words), contextIds(), company() }`.
 * Returns `{ line, isOn(), set(on, { quiet }), stop() }`.
 */
export function createSuggest({ api, write }) {
  const lineText = h("span", {});
  const off = h("action-button", { variant: "secondary", size: "sm", onClick: () => set(false) }, say("suggest.turnOff"));
  const line = h("p", { class: "studio-suggest-line studio-row", hidden: true }, lineText, off);
  const announce = h("p", { class: "studio-visually-hidden", "aria-live": "polite" });
  const words = h("bdi", { class: "studio-suggest-words" });
  const useIt = h("action-button", { size: "sm", label: say("suggest.useItName"), onClick: () => take() }, say("suggest.useIt"));
  const noThanks = h("action-button", { variant: "secondary", size: "sm", onClick: () => drop({ focus: true }) }, say("suggest.noThanks"));
  const card = h("div", { class: "studio-suggest-card", hidden: true },
    h("p", { class: "studio-suggest-text" }, h("span", { class: "studio-label", text: say("suggest.label") }), " ", words),
    h("div", { class: "studio-row" }, useIt, noThanks));

  let on = false;
  let timer = 0;
  let busy = false;
  let again = false;
  let failures = 0;
  let shown = null; // { key, box, at, words }
  let controller = null;

  const online = () => globalThis.navigator?.onLine !== false;

  /** Where she is now: the box, her caret in it, and the words on each side. Null outside her words. */
  function where() {
    const area = document.activeElement;
    if (!area || area.tagName !== "TEXTAREA" || !write.element.contains(area)) return null;
    const boxes = write.boxes();
    const index = boxes.findIndex((box) => box.element.contains(area));
    if (index < 0) return null;
    const value = boxes[index].value;
    // The box remembers her caret in its whole text (typing above a card moves a later part).
    const at = boxes[index].caret();
    const before = area.value.slice(0, area.selectionEnd ?? 0);
    if (at < before.length || value.slice(at - before.length, at) !== before) return null;
    return {
      box: index, at, kind: "words", prefix: value.slice(0, at), suffix: value.slice(at), area,
      selecting: area.selectionStart !== area.selectionEnd, inCard: Boolean(area.closest(".studio-piece-card")),
    };
  }

  const keyNow = () => {
    const at = where();
    return at ? captureKey(at, write.form(), write.contextIds()) : "";
  };

  function paintLine(text = say("suggest.on")) {
    lineText.textContent = text;
    line.hidden = !on && text === say("suggest.on");
    off.hidden = !on;
  }

  function drop({ focus = false } = {}) {
    if (!shown) return;
    const { area } = shown;
    shown = null;
    card.hidden = true;
    card.remove();
    words.textContent = "";
    if (focus) area?.focus?.();
  }

  /** Put the suggestion in at her caret, as plain words, with Undo under the box. */
  function take() {
    if (!shown) return;
    const { box: index, at, text, key } = shown;
    const box = write.boxes()[index];
    // Anything changed since it was asked for: it no longer fits, so it is dropped.
    if (!box || !captureIsCurrent(key, captureKey({ box: index, at, prefix: box.value.slice(0, at), suffix: box.value.slice(at) }, write.form(), write.contextIds()))) { drop(); return; }
    drop();
    const out = insertCompletion(box.value, at, text);
    const added = out.text.slice(at, out.at);
    box.set(out.text, { at: out.at });
    box.notify();
    toast(say("suggest.added"));
    box.tell(say("suggest.added"), () => {
      const now = box.value;
      if (now.slice(at, at + added.length) !== added) { box.tell(say("found.cantUndo")); return; }
      box.set(now.slice(0, at) + now.slice(at + added.length), { at });
      box.notify();
      box.tell(say("found.putBack"));
    });
  }

  function stopWith(why) {
    set(false, { quiet: true });
    lineText.textContent = why;
    line.hidden = false;
  }

  async function ask() {
    timer = 0;
    if (!on) return;
    const at = where();
    const form = write.form();
    const decision = shouldSuggest({ ...(at || { kind: "" }), body: form.body, online: online(), busy });
    if (!decision.ask) {
      if (decision.why === "long") stopWith(say("suggest.tooLong"));
      else if (decision.why === "signal") paintLine(say("suggest.waiting"));
      else if (decision.why === "busy") again = true;
      return;
    }
    paintLine();
    const ids = write.contextIds();
    const key = captureKey(at, form, ids);
    busy = true;
    controller = new AbortController();
    try {
      // `retry: false`: a session that ran out never interrupts her typing with a dialog.
      const reply = await api.call("POST", "assistant/complete", { json: completionRequest(at, form, ids, { turnedOn: on }), retry: false, signal: controller.signal });
      failures = 0;
      if (!on || !captureIsCurrent(key, keyNow())) return;
      const text = plainCompletion(reply?.completion);
      if (!text) return;
      shown = { key, box: at.box, at: at.at, text, area: at.area };
      words.textContent = text;
      write.boxes()[at.box].element.after(card);
      card.hidden = false;
      announce.textContent = "";
      requestAnimationFrame(() => { announce.textContent = say("suggest.announce", { words: text.trim().slice(0, 160) }); });
    } catch (error) {
      if (!on) return;
      const problem = helperProblem(error, { company: write.company() });
      if (problem.signal) { paintLine(say("suggest.waiting")); return; }
      if (problem.quiet) return;
      failures += 1;
      if (problem.off || problem.code === "key-rejected" || problem.code === "signed-out" || failures >= MAX_FAILURES) stopWith(say("suggest.stopped", { why: problem.words }));
    } finally {
      busy = false;
      controller = null;
      if (again && on) { again = false; schedule(); }
    }
  }

  function schedule() {
    clearTimeout(timer);
    if (on) timer = setTimeout(ask, PAUSE_MS);
  }

  // Typing asks again after a pause; typing, moving the caret or selecting drops what is shown.
  write.element.addEventListener("input", () => { drop(); schedule(); });
  for (const type of ["keyup", "click", "select"]) {
    write.element.addEventListener(type, () => { if (shown && !captureIsCurrent(shown.key, keyNow())) drop(); });
  }
  // Tab and Escape only while a suggestion shows and she is in that box; otherwise Tab moves on.
  write.element.addEventListener("keydown", (event) => {
    if (!shown || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.target !== shown.area) return;
    if (event.key === "Tab") { event.preventDefault(); event.stopPropagation(); take(); }
    else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); drop(); }
  }, true);
  addEventListener("online", () => { if (on) { paintLine(); schedule(); } });

  function set(next, { quiet = false } = {}) {
    if (on === Boolean(next)) return;
    on = Boolean(next);
    failures = 0;
    again = false;
    clearTimeout(timer);
    timer = 0;
    if (!on) { controller?.abort(); drop(); }
    paintLine();
    if (!quiet) toast(on ? say("suggest.onToast") : say("suggest.offToast"));
    listeners.forEach((fn) => fn(on));
  }
  const listeners = new Set();

  return {
    line: h("div", {}, line, announce),
    isOn: () => on,
    set,
    onChange: (fn) => { listeners.add(fn); },
    /** Leaving Write: it stops, and nothing is asked again. */
    stop() { on = false; clearTimeout(timer); controller?.abort(); drop(); },
  };
}
