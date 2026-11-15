// Moments (Studio R14b, from Your part, ?sheet=moments): places in what started it that her part
// points to, each with the words said there (who said it, the rights, where the words came from) or
// what she noticed, kept private or put with her part. The checks are the server's, said in her
// words; the server's notices about quotations never stop a save. Changing or taking one out can be
// undone. Moments the others shared are listed as text.
import { h } from "./dom.js";
import { use } from "../zubra.js";
import { say, isolating } from "./words.js";
import { partsNodes } from "./stranger.js";
import { createSheet } from "./sheet.js";
import { createDidLine } from "./did-line.js";
import { togetherProblem } from "./together-rules.js";
import { MOMENT_LOCATOR_KINDS, QUOTATION_PROVENANCE, QUOTATION_RIGHTS, momentLinkText, momentPayload, momentText, quotationNotices, rightsGuidanceText, sortMoments } from "./moment-rules.js";

export async function createMomentsSheet({ api, id, onChange }) {
  await use("action-button", "alert-banner", "select-field", "text-field", "toggle-switch");
  const sheet = await createSheet({ label: say("moments.title"), wide: true });
  const did = createDidLine();
  const listHost = h("div");
  const formHost = h("div", { class: "studio-together-shape" });
  let data = null;
  let typed = false;

  async function open(opener) {
    typed = false;
    sheet.show({ heading: say("moments.sheetTitle"), opener, dirty: () => typed, save: () => false,
      question: { heading: say("together.leaveAsk"), text: say("together.leaveText"), save: say("together.leaveStay"), leave: say("together.leaveGo") },
      children: [h("p", { class: "studio-help", text: say("moments.lede") }), did.element, listHost, formHost],
      focus: () => sheet.element.querySelector("button")?.focus() });
    await load();
  }

  async function load() {
    try {
      data = await api.get(`collaboration/moments?publicationId=${encodeURIComponent(id)}`);
    } catch (error) {
      if (error.status === 401) throw error;
      listHost.replaceChildren(h("p", { class: "studio-help", text: error.status === 404 ? say("moments.cantWrite") : togetherProblem(error).words }));
      formHost.replaceChildren();
      return;
    }
    drawList();
    drawForm();
  }

  const sources = () => (data.sources || []);

  function row(moment, mine) {
    const href = moment.link?.href && /^https?:\/\//.test(moment.link.href) ? moment.link.href : "";
    return h("li", { class: "studio-together-item" },
      h("p", {}, ...partsNodes(momentText(moment, sources(), isolating))),
      moment.quotation?.text ? h("blockquote", { class: "studio-stranger", dir: "auto", text: moment.quotation.text }) : null,
      moment.observation ? h("p", { class: "studio-stranger", dir: "auto", text: moment.observation }) : null,
      href ? h("a", { href, target: "_blank", rel: "noopener noreferrer nofollow", referrerpolicy: "no-referrer", text: momentLinkText(moment) }) : null,
      ...(moment.notices || []).map((notice) => h("p", { class: "studio-help", text: notice.message })),
      mine ? h("div", { class: "studio-row" },
        h("action-button", { variant: "secondary", size: "sm", label: say("moments.changeLabel", { where: moment.location || "" }), onClick: () => drawForm(moment) }, say("moments.change")),
        h("action-button", { variant: "ghost", size: "sm", label: say("moments.removeLabel", { where: moment.location || "" }), onClick: () => remove(moment) }, say("moments.remove"))) : null);
  }

  function drawList() {
    const mine = sortMoments(data.moments || [], sources());
    const shared = (data.shared || []).flatMap((group) => sortMoments(group.moments || [], sources()).map((m) => ({ m, who: group.participant?.displayName || "" })));
    listHost.replaceChildren(h("h3", { class: "studio-together-h3", text: say("moments.yours") }),
      mine.length ? h("ul", { class: "studio-together-items" }, ...mine.map((m) => row(m, true))) : h("p", { class: "studio-help", text: say("moments.none") }),
      shared.length ? h("h3", { class: "studio-together-h3", text: say("moments.theirs") }) : null,
      shared.length ? h("ul", { class: "studio-together-items" }, ...shared.map(({ m, who }) => h("li", {}, h("p", { class: "studio-help" }, h("bdi", { class: "studio-stranger", text: who })), row(m, false)))) : null);
  }

  function drawForm(editing = null) {
    const first = editing?.locators?.[0] || {};
    const source = h("select-field", { label: say("moments.source"), options: sources().map((s) => ({ value: s.id, label: s.title })), value: editing?.source || sources()[0]?.id || "" });
    const kind = h("select-field", { label: say("moments.whereKind"), options: MOMENT_LOCATOR_KINDS.map((k) => ({ value: k.value, label: k.words() })), value: first.kind || "timestamp",
      onValuechange: () => paintHint() });
    const from = h("text-field", { label: say("moments.from"), value: first.value || "" });
    const to = h("text-field", { label: say("moments.to"), value: first.to || "" });
    const quote = h("text-field", { label: say("moments.quote"), rows: 3, value: editing?.quotation?.text || "", onValuechange: () => paintNotices() });
    const speaker = h("text-field", { label: say("moments.speaker"), value: editing?.quotation?.speaker || "", onValuechange: () => paintNotices() });
    const rights = h("select-field", { label: say("moments.rights"), options: [{ value: "", label: "" }, ...QUOTATION_RIGHTS.map((r) => ({ value: r.value, label: r.words() }))], value: editing?.quotation?.rights || "",
      onValuechange: () => paintNotices() });
    const rightsNote = h("text-field", { label: say("moments.rightsNote"), value: editing?.quotation?.rightsNote || "" });
    const provenance = h("select-field", { label: say("moments.provenance"), options: [{ value: "", label: "" }, ...QUOTATION_PROVENANCE.map((p) => ({ value: p.value, label: p.words() }))], value: editing?.quotation?.provenance || "" });
    const observation = h("text-field", { label: say("moments.observation"), rows: 3, value: editing?.observation || "" });
    const publish = h("toggle-switch", { label: say("moments.publish"), description: say("moments.publishHelp"), checked: editing?.intent === "publication" });
    const notices = h("div", { "aria-live": "polite" });
    const fields = { source, value: from, to, quote, rights, provenance };
    function paintHint() { from.description = (MOMENT_LOCATOR_KINDS.find((k) => k.value === kind.value) || MOMENT_LOCATOR_KINDS[0]).hint(); }
    function paintNotices() {
      const form = { quote: String(quote.value || ""), speaker: String(speaker.value || ""), rights: String(rights.value || "") };
      notices.replaceChildren(...quotationNotices(form, data.quotationGuide).map((n) => h("p", { class: "studio-help", text: n.message })),
        form.quote ? h("p", { class: "studio-help", text: rightsGuidanceText(form.rights, data.quotationGuide) }) : "");
    }
    for (const field of [source, kind, from, to, quote, speaker, rights, rightsNote, provenance, observation]) field.addEventListener("valuechange", () => { typed = true; });
    const save = h("action-button", { onClick: async () => {
      for (const field of Object.values(fields)) field.error = "";
      const form = { source: String(source.value || ""), kind: String(kind.value || "timestamp"), value: String(from.value || ""), to: String(to.value || ""),
        quote: String(quote.value || ""), speaker: String(speaker.value || ""), rights: String(rights.value || ""), rightsNote: String(rightsNote.value || ""),
        provenance: String(provenance.value || ""), observation: String(observation.value || ""), publish: Boolean(publish.checked) };
      const asked = momentPayload(form, editing ? { locators: (editing.locators || []).slice(1), language: editing.quotation?.language } : {});
      if (asked.error) {
        const field = fields[asked.field] || quote;
        // A select-field has no error line of its own, so its refusal goes in the status line.
        if (field.localName === "text-field") field.error = asked.error;
        else did.tell(asked.error, { variant: "problem" });
        field.querySelector("input, textarea, select")?.focus();
        return;
      }
      save.loading = true;
      const change = editing ? { action: "edit", id: editing.id, moment: asked.moment } : { action: "add", moment: asked.moment };
      const before = editing ? { action: "edit", id: editing.id, moment: bodyOf(editing) } : null;
      try {
        data = await api.post("collaboration/moments", { publicationId: id, expectedRevision: data.revision, change });
        typed = false;
        did.tell(asked.moment.intent === "publication" ? say("moments.savedProposed") : say("moments.saved"),
          before ? { undo: () => send(before, say("moments.saved")), undoLabel: say("part.undo") } : {});
        drawList();
        drawForm();
        onChange?.();
      } catch (error) {
        if (error.status === 401) throw error;
        did.tell(failure(error), { variant: "problem" });
        // What she typed stays in the boxes; the list is read again around it.
        try { data = { ...(await api.get(`collaboration/moments?publicationId=${encodeURIComponent(id)}`)) }; drawList(); } catch (again) { if (again.status === 401) throw again; }
      } finally {
        save.loading = false;
      }
    } }, say("moments.save"));
    paintHint();
    paintNotices();
    formHost.replaceChildren(h("h3", { class: "studio-together-h3", text: editing ? say("moments.change") : say("moments.add") }),
      source, kind, from, to, quote, speaker, rights, rightsNote, provenance, notices, observation, publish, save);
    if (editing) requestAnimationFrame(() => from.querySelector("input")?.focus());
  }

  const bodyOf = (moment) => ({ source: moment.source, locators: moment.locators, ...(moment.quotation ? { quotation: moment.quotation } : {}),
    ...(moment.observation ? { observation: moment.observation } : {}), intent: moment.intent });

  function failure(error) {
    const said = togetherProblem(error);
    if (said.code === "changed") return say("together.changedElsewhere", { what: say("moments.title") });
    if (/^moment-/.test(said.code)) return say("moments.cantUse");
    return said.words;
  }

  async function send(change, words) {
    try {
      data = await api.post("collaboration/moments", { publicationId: id, expectedRevision: data.revision, change });
      did.tell(words);
      drawList();
      onChange?.();
    } catch (error) {
      if (error.status === 401) throw error;
      did.tell(failure(error), { variant: "problem" });
    }
  }

  async function remove(moment) {
    try {
      data = await api.post("collaboration/moments", { publicationId: id, expectedRevision: data.revision, change: { action: "remove", id: moment.id } });
      did.tell(say("moments.removed"), { undo: () => send({ action: "add", moment: bodyOf(moment) }, say("moments.saved")), undoLabel: say("part.undo"), focus: true });
      drawList();
      onChange?.();
    } catch (error) {
      if (error.status === 401) throw error;
      did.tell(failure(error), { variant: "problem" });
    }
  }

  return { sheet, open };
}
