// Write's side of the writing helper (Studio R8): the side card, where she was when she opened it,
// suggestions as she types, ?sheet=helper, and the More and Find entries. Write hands in what it
// has; this keeps write.js about writing.
import { h } from "./dom.js";
import { say } from "./words.js";
import { createHelperSheet } from "./helper-sheet.js";
import { createSuggest } from "./suggest-box.js";
import { boxSpans, captureTarget, companyName, helperLine } from "./helper-rules.js";
import { defaultContextIds } from "./helper-context-rules.js";

/**
 * `w` is Write: `{ api, meta, doc, read(), fieldsFor(values, intent), body, kind(), job(),
 * canWriteUp(), go(hash) }`. Returns `{ card, line, open(from, part), isSheet(name), commands(),
 * run(id, opener), changed(), leave() }`.
 */
export async function createWriteHelper(w) {
  const { api, meta, doc } = w;
  // "Probably ready" from meta, until the sheet asks the server (the card shows only when set up).
  let ready = meta.quizGeneration === true;
  let status = null;
  let catalog = null;

  // The box she was last in, with her caret and what she had selected: kept as she works, so
  // tapping the card (which moves focus, and on a phone clears the selection) doesn't lose it.
  let last = null;
  const note = (event) => {
    const area = event.target;
    if (!area || area.tagName !== "TEXTAREA") return;
    const boxes = w.body.boxes();
    const index = boxes.findIndex((box) => box.element.contains(area));
    if (index < 0) return;
    // After the box's own listeners have remembered the caret.
    queueMicrotask(() => { last = { box: index, at: boxes[index].caret(), text: boxes[index].selection() }; });
  };
  for (const type of ["keyup", "click", "select", "focusin", "input"]) w.body.element.addEventListener(type, note);

  /** The post as the helper is given it: `{ title, body, fields, boxes: [{ name, value }] }`. */
  const form = () => {
    const values = w.read();
    return { title: values.title.trim(), body: values.body, fields: w.fieldsFor(values, "draft"), boxes: w.body.boxes().map((box) => ({ name: box.name, value: box.value })) };
  };

  const suggest = createSuggest({
    api,
    write: {
      form, boxes: () => w.body.boxes(), element: w.body.element,
      // Her notes go with each suggestion, as the sheet says under the switch.
      contextIds: () => defaultContextIds(catalog || {}, { useNotes: true, soundLikeMe: false }),
      company: () => companyName(status || {}),
    },
  });

  const lineText = h("span", { class: "studio-about-line" });
  const cardName = h("span", { class: "studio-about-name", text: say("helper.name") });
  const card = h("action-button", { variant: "secondary", class: "studio-about-open studio-helper-open", hidden: !ready, onClick: (e) => open(e.currentTarget) }, cardName, lineText);

  const sheet = await createHelperSheet({
    api,
    write: {
      path: () => doc.path, kind: () => w.kind(), form, boxes: () => w.body.boxes(),
      target: () => captureTarget(form(), last),
      isJob: () => w.kind() === "job", canWriteUp: () => w.canWriteUp(), writeUp: (opener) => w.job()?.writeUp(opener),
      suggest, go: (hash) => w.go(hash), changedLine: () => paint(),
    },
  });

  function paint() {
    const line = helperLine(sheet.line());
    lineText.textContent = line;
    card.label = say("helper.cardName", { line });
    card.hidden = !ready;
  }
  paint();

  // The server's word on whether it is set up, and the light catalog (which notes exist): asked
  // once Write has opened, and again each time the sheet opens.
  async function refresh() {
    try {
      status = await api.get("assistant/status");
      ready = status?.configured === true;
    } catch {
      // No signal: what meta said stands.
    }
    if (ready) {
      try { catalog = await api.get(`assistant/context?content=none${doc.path ? `&path=${encodeURIComponent(doc.path)}` : ""}`); } catch { /* notes aren't sent until it is known */ }
    }
    paint();
    // More and Find follow what the server said.
    w.repaint?.();
  }

  async function open(from, part = "") {
    const opening = sheet.open({ from, part });
    refresh();
    await opening;
  }

  return {
    card,
    /** The server has said it is set up (not only what meta guessed). */
    confirmed: () => status?.configured === true,
    /** For Add something's forms (Write questions for me): whether it is set up, the company, the post. */
    ready: () => ready,
    company: () => companyName(status || {}),
    form,
    /** Where a box's words start in the whole post, or null when it is empty. */
    offsetOf(box) {
      const index = w.body.boxes().indexOf(box);
      return boxSpans(form()).find((span) => span.index === index)?.start ?? null;
    },
    /** The line under her words while suggestions as she types are on. */
    line: suggest.line,
    open,
    refresh,
    isSheet: (name) => name === "helper",
    /** More and Find. Not set up: only Find's "Writing helper", which opens the sheet saying so. */
    commands() {
      return [
        // More says "Writing helper…"; Find says "Writing helper" (and lists it even when it isn't
        // set up: the sheet then says so).
        { id: "helper", label: say("helper.open"), more: ready, palette: false },
        { id: "helper-sheet", label: say("helper.name"), more: false },
        ...(ready ? [
          { id: "helper-read", label: say("helper.readOver"), more: false },
          { id: "helper-selected", label: say("helper.findSelected"), more: false },
          { id: "helper-suggest", label: suggest.isOn() ? say("suggest.findOff") : say("suggest.findOn"), more: false },
          { id: "helper-note", label: say("hnote.tell"), more: false },
        ] : []),
        { id: "helper-setup", label: say("helper.findSetup"), more: false },
      ];
    },
    /** True when `id` was one of the helper's. */
    run(id, opener) {
      if (["helper", "helper-sheet", "helper-read", "helper-selected"].includes(id)) { open(opener); return true; }
      if (id === "helper-note") { open(opener, "note"); return true; }
      if (id === "helper-suggest") {
        // Turning it on is only ever done beside the words that say what goes; off is at once.
        if (suggest.isOn()) suggest.set(false); else open(opener, "suggest");
        return true;
      }
      if (id === "helper-setup") { w.go("#/helper?setup=1"); return true; }
      return false;
    },
    changed: paint,
    async leave() {
      suggest.stop();
      return sheet.leave();
    },
  };
}
