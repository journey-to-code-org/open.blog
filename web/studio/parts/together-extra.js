// Your other parts (#705, on Your part): a writer may add parts beside her first, each with its own
// place in the layout. Each is its own words box, saved against the version she opened (a save
// made elsewhere first keeps her words on screen beside the newer copy, as Your part does), kept
// on this computer as she types, moved up and down, and taken out for good after one question
// that says exactly what goes. Adding one needs a rule about the whole piece; the server decides,
// and the screen says so in her words. "Let the others read it" offers every current part together.
import { fill, h } from "./dom.js";
import { use } from "../zubra.js";
import { say } from "./words.js";
import { ask } from "./dialogs.js";
import { createDidLine } from "./did-line.js";
import { togetherProblem } from "./together-rules.js";
import { emptyAddedPart, ownParts, partOffers, partOrderPayload } from "./part-rules.js";

export async function createExtraParts({ api, id, kept, onChange }) {
  await use("action-button", "alert-banner", "text-field");
  const did = createDidLine();
  const list = h("ol", { class: "studio-extra-parts", start: "2" });
  const add = h("action-button", { variant: "secondary", onClick: () => addPart() }, say("extra.add"));
  const element = h("section", { class: "studio-extra", "aria-labelledby": "studio-extra-h", hidden: true },
    h("h3", { id: "studio-extra-h", class: "studio-together-h3", text: say("extra.title") }),
    h("p", { class: "studio-help", text: say("extra.help") }), list, h("div", { class: "studio-row" }, add), did.element);
  let first = null;
  let extras = []; // { id, number, saved, text, newer }
  let orderRevision = 0;
  const keyOf = (part) => `together/${id}/${part.id}`;
  const isDirty = (part) => part.text !== part.saved;
  const focusSoon = (selector) => requestAnimationFrame(() => (list.querySelector(selector)?.querySelector?.("textarea, button") || list.querySelector(selector))?.focus?.());

  /** Reads her parts. With `keep`, words she has on screen stay over what the server holds. */
  async function load({ keep = false } = {}) {
    const reply = await api.get(`collaboration/contributions?publicationId=${encodeURIComponent(id)}`);
    const read = ownParts(reply);
    const before = new Map(extras.map((part) => [part.id, part]));
    first = read.first;
    orderRevision = read.orderRevision;
    extras = read.extras.map((part) => {
      const was = keep ? before.get(part.id) : null;
      const copy = was ? null : kept.get(keyOf(part));
      const text = was && isDirty(was) ? was.text : copy && typeof copy.form?.words === "string" ? copy.form.words : part.text;
      return { id: part.id, number: part.number, saved: part.text, text, newer: null };
    });
    element.hidden = false;
    draw();
  }

  function draw() {
    fill(list, ...extras.map((part, index) => row(part, index)));
    list.hidden = !extras.length;
  }

  function row(part, index) {
    const n = index + 2;
    const state = h("p", { class: "studio-help studio-extra-state", text: isDirty(part) ? say("extra.notSaved") : say("part.saved") });
    const field = h("text-field", { label: say("extra.partLabel", { n }), rows: 8, value: part.text, onValuechange: (e) => {
      part.text = String(e.detail ?? "");
      if (isDirty(part)) kept.keep(keyOf(part), String(part.number), { words: part.text }); else kept.clear(keyOf(part));
      state.textContent = isDirty(part) ? say("extra.notSaved") : say("part.saved");
      onChange?.();
    } });
    const newer = part.newer ? h("div", { class: "studio-part-conflict", role: "alert" },
      h("p", {}, h("strong", { text: say("part.conflict") }), " ", say("part.conflictText")),
      h("h4", { class: "studio-together-h4", text: say("part.onBlogNow") }), h("div", { class: "studio-part-copy", tabindex: "0", text: part.newer.text }),
      h("div", { class: "studio-row" },
        h("action-button", { onClick: async () => { part.number = part.newer.number; part.saved = part.newer.text; part.newer = null; await save(part); draw(); focusSoon(`[data-part="${part.id}"]`); } }, say("part.keepMine")),
        h("action-button", { variant: "secondary", onClick: () => { part.number = part.newer.number; part.saved = part.newer.text; part.text = part.newer.text; part.newer = null; kept.clear(keyOf(part)); draw(); onChange?.(); focusSoon(`[data-part="${part.id}"]`); } }, say("part.useOther")))) : null;
    return h("li", { class: "studio-extra-part", "data-part": part.id }, field, state, newer,
      h("div", { class: "studio-row" },
        h("action-button", { variant: "secondary", size: "sm", onClick: async () => { if (await save(part)) did.tell(say("extra.saved", { n })); draw(); focusSoon(`[data-part="${part.id}"]`); } }, say("extra.save")),
        index > 0 ? h("action-button", { variant: "secondary", size: "sm", class: "studio-extra-up", label: say("extra.moveUpLabel", { n }), onClick: () => move(index, -1) }, say("part.moveUp")) : null,
        index < extras.length - 1 ? h("action-button", { variant: "secondary", size: "sm", class: "studio-extra-down", label: say("extra.moveDownLabel", { n }), onClick: () => move(index, 1) }, say("part.moveDown")) : null,
        h("action-button", { variant: "ghost", size: "sm", label: say("extra.takeOutLabel", { n }), onClick: (e) => takeOut(part, n, e.currentTarget) }, say("extra.takeOut"))));
  }

  const tell = (error) => { if (error.status === 401) throw error; did.tell(togetherProblem(error, "part").words, { variant: "problem" }); };

  async function addPart() {
    try {
      await api.post("collaboration/contributions", { publicationId: id, markdown: "" });
      await load({ keep: true });
      did.tell(say("extra.added", { n: extras.length + 1 }));
      onChange?.();
      focusSoon(".studio-extra-part:last-child");
    } catch (error) {
      if (error.status === 401) throw error;
      // The server allows more parts only under a rule about the whole piece.
      if (error.status === 409 && !error.data?.current) did.tell(say("extra.needsWholePiece"), { variant: "problem" });
      else tell(error);
    }
  }

  /** Sends one part's words as a version. True once the server holds what is on screen. */
  async function save(part) {
    if (!isDirty(part)) return true;
    try {
      const reply = await api.put("collaboration/contributions", { publicationId: id, contributionId: part.id, expectedRevision: part.number, markdown: part.text });
      part.number = reply?.stamp?.number || part.number + 1;
      part.saved = part.text;
      part.newer = null;
      kept.clear(keyOf(part));
      onChange?.();
      return true;
    } catch (error) {
      if (error.status === 401) throw error;
      // Saved somewhere else first: her words stay, and the newer copy is shown beside them.
      if (error.status === 409 && error.data?.current) part.newer = { number: error.data.current.stamp?.number || part.number, text: String(error.data.current.markdown ?? "") };
      else tell(error);
      return false;
    }
  }

  async function move(index, by) {
    if (!partOrderPayload(id, first, extras, index, by, orderRevision)) return;
    const moved = extras[index];
    try {
      // Every save moves the number the server checks an order against, so it is read just before;
      // the order she sees is still sent as what she expects, so a change elsewhere is refused.
      const now = ownParts(await api.get(`collaboration/contributions?publicationId=${encodeURIComponent(id)}`));
      orderRevision = now.orderRevision;
      const body = partOrderPayload(id, first, extras, index, by, orderRevision);
      const reply = await api.put("collaboration/contributions/order", body);
      orderRevision = Number.isInteger(reply?.orderRevision) ? reply.orderRevision : orderRevision;
      extras.splice(index, 1);
      extras.splice(index + by, 0, moved);
      draw();
      did.tell(say("extra.moved", { n: index + by + 2 }));
      onChange?.();
      focusSoon(`[data-part="${moved.id}"] .studio-extra-${by < 0 ? "up" : "down"}, [data-part="${moved.id}"]`);
    } catch (error) {
      if (error.status === 401) throw error;
      if (error.status === 409) { await load({ keep: true }).catch(() => {}); did.tell(say("extra.changedElsewhere"), { variant: "problem" }); } else tell(error);
    }
  }

  async function takeOut(part, n, opener) {
    const choice = await ask({ heading: say("extra.takeOutAsk", { n }), text: [say("extra.takeOutText"), say("extra.takeOutLayout")],
      choices: [{ label: say("extra.takeOutGo"), value: "go", variant: "danger" }, { label: say("extra.takeOutNo"), value: "no", variant: "secondary" }] });
    if (choice !== "go") { opener?.focus?.(); return; }
    try {
      await api.post("collaboration/contributions/withdraw", { publicationId: id, contributionId: part.id, expectedRevision: part.number, confirmed: true });
      kept.clear(keyOf(part));
      await load({ keep: true });
      did.tell(say("extra.tookOut"));
      onChange?.();
      add.focus();
    } catch (error) {
      if (error.status === 401) throw error;
      if (error.status === 409) { await load({ keep: true }).catch(() => {}); did.tell(say("extra.changedElsewhere"), { variant: "problem" }); } else tell(error);
    }
  }

  return {
    element,
    load,
    count: () => extras.length,
    dirty: () => extras.some(isDirty),
    /** The number of the first added part with no words, or 0. */
    empty: () => emptyAddedPart(extras),
    /** Saves every added part. True when all are saved. */
    async saveAll() {
      let ok = true;
      for (const part of extras) ok = (await save(part)) && ok;
      if (!ok) draw();
      return ok;
    },
    /** Every current part at its saved version, the first at `number`, for "Let the others read it". */
    offers: (number) => (first ? partOffers({ ...first, number }, extras) : []),
  };
}
