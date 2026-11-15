// A comparison of readings: its title, address and subject; the readings (who holds each, how firmly, what
// they hold, the evidence), how they relate and explanations by audience; reading and approving words an AI
// tool drafted; what readers will see; and Save draft / Publish / Update. Saving is explicit. Approving is
// done on the words as saved, on the server, and Studio never builds an approval. Undo puts back what a
// write replaced (approvals included). Studio R13; docs/specs/studio/r13/ux.md. Rules: parts/readings-rules.js.
import { h, toast } from "../parts/dom.js";
import { use } from "../zubra.js";
import { ask } from "../parts/dialogs.js";
import { sendOut, wentOutWords } from "../parts/publish.js";
import { say } from "../parts/words.js";
import { suggestAddress } from "../parts/path-rules.js";
import { readingPreview } from "../parts/reading-preview.js";
import * as undo from "../parts/path-undo.js";
import * as R from "../parts/readings-rules.js";

const BASE = "comparisons";

export async function createReadingEdit(context, route) {
  const { api, meta, go } = context;
  await use("action-button", "alert-banner", "breadcrumb-trail", "dropdown-menu", "select-field", "side-sheet", "skeleton-block", "status-badge", "text-field", "toggle-switch");
  const isNew = !route.arg || route.arg === "new";
  let slug = isNew ? "" : route.arg;
  let revision = null;
  let saved = null;
  let draft = R.readingDraft(null, slug);
  let states = [];
  let savedStates = [];
  let refs = { sources: [], links: [], problem: null };
  let publish = false;
  let url = null;
  let source = "";
  let unreadable = false;
  let addressTouched = false;
  let problems = [];
  let loaded = false;
  let takenAddresses = [];
  let previewTimer = 0;
  let previewOpen = false;
  let previewTarget = null;
  let previewReply = null;

  const trail = h("breadcrumb-trail", { items: [{ label: say("readings.crumbHome"), href: "#/" }, { label: say("readings.crumbResearch") }, { label: say("readings.title"), href: "#/research/readings" }, { label: say("readings.untitled") }] });
  const back = h("a", { class: "studio-back", href: "#/research/readings", text: say("readings.back") });
  const heading = h("h2", { id: "studio-reading-h", class: "studio-question", tabindex: "-1", text: say("readings.newHeading") });
  const standing = h("p", { class: "studio-help" });
  const banner = h("div", { class: "studio-banner", "aria-live": "polite" });
  const status = h("p", { class: "studio-help", role: "status", "aria-live": "polite" });
  const undoSlot = h("div", { "aria-live": "polite" });
  const title = h("text-field", { label: say("readings.fieldTitle"), maxlength: R.LIMITS.title, class: "studio-writing", onValuechange: () => edited("title") });
  const address = h("text-field", { label: say("readings.fieldAddress"), description: say("readings.addressHelp"), maxlength: R.LIMITS.address, onValuechange: () => { addressTouched = true; edited("address"); } });
  const addressLine = h("p", { class: "studio-help", hidden: true });
  const subject = h("text-field", { label: say("readings.fieldSubject"), description: say("readings.subjectHelp"), rows: 3, maxlength: R.LIMITS.subject, onValuechange: () => edited("subject") });
  const form = h("div", { class: "studio-path-form" }, title, address, addressLine, subject);
  const readingsList = h("ul", { class: "studio-path-steps", "aria-labelledby": "studio-reading-readings-h" });
  const relationsList = h("ul", { class: "studio-path-steps", "aria-labelledby": "studio-reading-relations-h" });
  const explanationsList = h("ul", { class: "studio-path-steps", "aria-labelledby": "studio-reading-explanations-h" });
  const addReading = h("action-button", { variant: "secondary", onClick: () => editReading(null) }, say("readings.addReading"));
  const addRelation = h("action-button", { variant: "secondary", onClick: () => editRelation(null) }, say("readings.addRelation"));
  const addExplanation = h("action-button", { variant: "secondary", onClick: () => editExplanation(null) }, say("readings.addExplanation"));
  const needTwo = h("p", { class: "studio-help", text: say("readings.needTwo") });
  const saveButton = h("action-button", { onClick: () => save() }, say("readings.saveDraft"));
  const publishButton = h("action-button", { variant: "secondary", onClick: () => save({ status: "published" }) }, say("readings.publish"));
  const see = h("action-button", { variant: "secondary", onClick: (e) => seeReaders(e.currentTarget) }, say("readings.seeReaders"));
  const more = h("dropdown-menu", { class: "studio-row-menu", items: [], onItemselect: (e) => moreAction(e.detail) }, h("span", { slot: "label" }, say("readings.more")));
  const sheet = h("side-sheet", { label: say("readings.sheetReading", { who: "" }), side: "right" });
  const bar = h("div", { class: "studio-write-bar studio-path-bar" }, see, publishButton, saveButton, more);
  const section = (id, headingText, ...kids) => h("section", { class: "studio-section", "aria-labelledby": id }, h("h3", { id, text: headingText }), ...kids);
  const element = h("section", { class: "studio-page studio-path", "aria-labelledby": "studio-reading-h" },
    h("div", { class: "studio-write-top" }, trail, back), heading, standing, status, undoSlot, banner, form,
    section("studio-reading-readings-h", say("readings.readingsHeading"), readingsList, addReading),
    section("studio-reading-relations-h", say("readings.relationsHeading"), h("p", { class: "studio-help", text: say("readings.relHelp") }), relationsList, addRelation, needTwo),
    section("studio-reading-explanations-h", say("readings.explanationsHeading"), h("p", { class: "studio-help", text: say("readings.explanationLede") }), explanationsList, addExplanation),
    bar, sheet);

  const dirty = () => loaded && !unreadable && (!saved ? Boolean(draft.title.trim() || draft.subject.trim() || draft.interpretations.length) : !R.readingSame(draft, saved));
  const titleOfSource = (id) => refs.sources.find((s) => s.id === id)?.title || id;
  const whoOf = (item) => R.readingWho(item, refs.sources);
  const nameOf = (id) => {
    const r = draft.interpretations.find((i) => i.id === id);
    if (r) return whoOf(r);
    const x = draft.explanations.find((e) => e.id === id);
    if (x) return R.levelWords(x.level);
    return draft.title || say("readings.untitled");
  };
  const stateFor = (id) => R.stateOf(states, id);

  // ---- drawing ------------------------------------------------------------------------------------

  function paintHead() {
    const name = draft.title || (saved ? say("readings.untitled") : say("readings.newHeading"));
    heading.textContent = saved ? name : say("readings.newHeading");
    trail.items = [{ label: say("readings.crumbHome"), href: "#/" }, { label: say("readings.crumbResearch") }, { label: say("readings.title"), href: "#/research/readings" }, { label: name }];
    const wasPublished = saved?.status === "published";
    saveButton.textContent = wasPublished ? say("readings.update") : say("readings.saveDraft");
    publishButton.hidden = wasPublished || draft.status === "published";
    address.hidden = Boolean(saved);
    addressLine.hidden = !saved;
    if (saved) addressLine.textContent = say("readings.addressFixed", { address: slug });
    standing.textContent = !saved ? "" : wasPublished ? (url ? say("readings.rowShown") : publish ? say("readings.rowNotShown") : say("readings.publishedSiteOff")) : say("readings.rowDraft");
    more.items = [
      ...(wasPublished ? [{ value: "draft", label: say("readings.makeDraft") }] : []),
      ...(saved ? [{ value: "delete", label: say("readings.delete") }] : []),
      { value: "written", label: say("readings.asWritten") },
    ];
    for (const part of element.querySelectorAll(".studio-section")) part.hidden = unreadable;
    bar.hidden = unreadable;
    needTwo.hidden = draft.interpretations.length >= 2;
    addRelation.hidden = draft.interpretations.length < 2;
  }

  const hidden = (text) => h("span", { class: "studio-visually-hidden", text: ` ${text}` });
  const problemLines = (id) => problems.filter((p) => p.item === id).map((p) => h("p", { class: "studio-error", role: "alert", text: R.problemWords(p.code, p.field) }));

  function moveMenu(list, index, name) {
    const items = [];
    if (index > 0) items.push({ value: "up", label: say("readings.moveUp") });
    if (index < list.length - 1) items.push({ value: "down", label: say("readings.moveDown") });
    if (!items.length) return null;
    return h("dropdown-menu", { class: "studio-row-menu", items, onItemselect: (e) => {
      const to = e.detail === "up" ? index - 1 : index + 1;
      const [item] = list.splice(index, 1);
      list.splice(to, 0, item);
      status.textContent = say("readings.moved", { title: name, number: String(to + 1), count: String(list.length) });
      changed(); paint();
      requestAnimationFrame(() => element.querySelector(`[data-id="${CSS.escape(item.id)}"] .studio-row-menu button, [data-id="${CSS.escape(item.id)}"]`)?.focus());
    } }, h("span", { slot: "label" }, say("readings.move"), hidden(name)));
  }

  function approvalButtons(kind, item, name) {
    const st = stateFor(item.id);
    if (!item.origin || item.origin.kind !== "ai-draft") return [];
    if (st?.standing === "approved" && item.approval) {
      return [h("p", { class: "studio-help", text: say("readings.approvedOn", { date: dateWords(item.approval.at) }) }),
        h("action-button", { variant: "secondary", size: "sm", onClick: () => withdraw(kind, item) }, say("readings.withdraw"), hidden(name))];
    }
    return [h("action-button", { size: "sm", onClick: () => readAndApprove(kind, item) }, say("readings.readApprove"), hidden(name))];
  }

  const dateWords = (at) => { const d = new Date(at); return Number.isNaN(d.getTime()) ? String(at || "") : d.toLocaleDateString(); };

  function evidenceSummary(item) {
    if (!item.evidence.length) return say("readings.evidenceNone");
    const st = stateFor(item.id);
    const privateOnes = (st?.evidence || []).filter((e) => e.state === "private").length;
    return say("readings.evidenceCount", { count: String(item.evidence.length) }) + (privateOnes ? ` (${privateOnes}: ${say("readings.evidencePrivate")})` : "");
  }

  function readingCard(item, index) {
    const name = whoOf(item);
    const st = stateFor(item.id);
    const first = [...(item.statement || "")].slice(0, 160).join("");
    const edit = h("action-button", { variant: "secondary", size: "sm", onClick: () => editReading(item) }, say("readings.change"), hidden(name));
    return h("li", { class: "studio-path-step", "data-id": item.id },
      h("strong", { class: "studio-path-step-title", text: name }),
      h("status-badge", { variant: st?.standing === "authored" || st?.standing === "approved" ? "success" : "warning" }, R.standingWords(st)),
      first ? h("p", { lang: item.language || undefined }, h("bdi", { text: first + ([...(item.statement || "")].length > 160 ? "…" : "") })) : null,
      h("p", { class: "studio-help", text: `${R.certaintyWords(item.attribution?.certainty)} · ${evidenceSummary(item)}` }),
      item.attribution?.kind === "source" && st?.attributionSource === "missing" ? h("p", { class: "studio-help", text: say("readings.sourceGone") }) : null,
      ...problemLines(item.id),
      h("div", { class: "studio-row" }, edit, moveMenu(draft.interpretations, index, name),
        h("action-button", { variant: "secondary", size: "sm", onClick: () => takeOutReading(item) }, say("readings.takeOut"), hidden(name)),
        ...approvalButtons("interpretation", item, name)));
  }

  function relationCard(relation, index) {
    const line = say("readings.relationLine", { from: nameOf(relation.from), kind: R.relationKindWords(relation.kind), to: nameOf(relation.to) });
    return h("li", { class: "studio-path-step", "data-id": `relation-${index}` },
      h("strong", { class: "studio-path-step-title", text: line }),
      relation.note ? h("p", { class: "studio-help", text: relation.note }) : null,
      h("div", { class: "studio-row" },
        h("action-button", { variant: "secondary", size: "sm", onClick: () => editRelation(relation) }, say("readings.change"), hidden(line)),
        h("action-button", { variant: "secondary", size: "sm", onClick: () => { const at = draft.relations.indexOf(relation); draft.relations.splice(at, 1); status.textContent = say("readings.tookOutExplanation", { level: line }); changed(); paint(); } }, say("readings.takeOut"), hidden(line))));
  }

  function explanationCard(item, index) {
    const line = say("readings.explanationLine", { level: R.levelWords(item.level), about: item.about ? nameOf(item.about) : say("readings.aboutWhole") });
    const st = stateFor(item.id);
    const facts = R.fileFacts(item);
    return h("li", { class: "studio-path-step", "data-id": item.id },
      h("strong", { class: "studio-path-step-title", text: line }),
      h("status-badge", { variant: st?.standing === "authored" || st?.standing === "approved" ? "success" : "warning" }, R.standingWords(st)),
      item.withdrawn ? h("p", { class: "studio-help", text: say("readings.withdrawn") }) : null,
      h("p", { lang: item.language || undefined }, h("bdi", { text: [...(item.text || "")].slice(0, 160).join("") })),
      facts.length ? h("p", { class: "studio-help", text: say("readings.factsLine", { facts: facts.join(" · ") }) }) : null,
      ...problemLines(item.id),
      h("div", { class: "studio-row" },
        h("action-button", { variant: "secondary", size: "sm", onClick: () => editExplanation(item) }, say("readings.change"), hidden(line)),
        moveMenu(draft.explanations, index, line),
        h("action-button", { variant: "secondary", size: "sm", onClick: () => { const at = draft.explanations.indexOf(item); draft.explanations.splice(at, 1); status.textContent = say("readings.tookOutExplanation", { level: R.levelWords(item.level) }); changed(); paint(); } }, say("readings.takeOut"), hidden(line)),
        ...approvalButtons("explanation", item, line)));
  }

  function paint() {
    paintHead();
    readingsList.replaceChildren(...(draft.interpretations.length ? draft.interpretations.map(readingCard) : [h("li", { class: "studio-help", text: say("readings.readingsEmpty") })]));
    relationsList.replaceChildren(...(draft.relations.length ? draft.relations.map(relationCard) : [h("li", { class: "studio-help", text: say("readings.relationsEmpty") })]));
    explanationsList.replaceChildren(...(draft.explanations.length ? draft.explanations.map(explanationCard) : [h("li", { class: "studio-help", text: say("readings.explanationsEmpty") })]));
  }

  // ---- editing ------------------------------------------------------------------------------------

  function edited(field) {
    if (field === "title") {
      draft.title = String(title.value ?? "");
      if (!saved && !addressTouched) { draft.slug = suggestAddress(draft.title, takenAddresses); address.value = draft.slug; }
      paintHead();
    }
    if (field === "address") draft.slug = String(address.value ?? "").trim();
    if (field === "subject") draft.subject = String(subject.value ?? "");
    changed();
  }

  function changed() {
    if (problems.length) { problems = []; banner.replaceChildren(); title.error = ""; subject.error = ""; address.error = ""; }
    schedulePreview();
  }

  function takeOutReading(item) {
    const name = whoOf(item);
    R.takeOutReading(draft, item.id);
    status.textContent = say("readings.tookOutReading", { who: name });
    changed(); paint();
  }

  const closeSheet = (focusId) => { sheet.open = false; requestAnimationFrame(() => (focusId ? element.querySelector(`[data-id="${CSS.escape(focusId)}"] button`) : null)?.focus()); };
  const sheetActions = (keep, cancel) => h("div", { class: "studio-sheet-actions" },
    h("action-button", { onClick: keep }, say("readings.done")),
    h("action-button", { variant: "secondary", onClick: cancel }, say("readings.cancel")));

  // The AI toggle and tool name, shared by readings and explanations.
  function aiFields(mine) {
    const tool = h("text-field", { label: say("readings.aiTool"), value: mine.origin?.tool || "", hidden: mine.origin?.kind !== "ai-draft", onValuechange: () => { if (mine.origin) mine.origin.tool = String(tool.value ?? ""); } });
    const toggle = h("toggle-switch", { label: say("readings.ai"), checked: mine.origin?.kind === "ai-draft", onCheckedchange: () => {
      R.setOrigin(mine, toggle.checked === true, String(tool.value ?? ""));
      tool.hidden = !toggle.checked;
      aiNote.textContent = toggle.checked ? say("readings.markedAi") : say("readings.markedOwn");
    } });
    const aiNote = h("p", { class: "studio-help", role: "status", "aria-live": "polite" });
    return [toggle, tool, aiNote];
  }

  // Evidence rows: each with its state in words and Take it out; a picker adds more.
  function evidenceFields(mine, choices, originalId) {
    const rows = h("ul", { class: "studio-pick-list" });
    const st = originalId ? stateFor(originalId) : null;
    const label = (ref) => (ref.link !== undefined ? (refs.links.find((l) => l.id === ref.link)?.label || ref.link) : titleOfSource(ref.source));
    const draw = () => {
      rows.replaceChildren(...(mine.evidence.length ? mine.evidence.map((ref, i) => {
        const word = R.evidenceWords(st?.evidence?.[i]?.state);
        const where = ref.link === undefined ? h("text-field", { label: say("readings.evidenceWhere"), value: ref.locator || "", onValuechange: (e) => { ref.locator = String(e.currentTarget.value ?? ""); } }) : null;
        return h("li", {}, h("strong", { text: label(ref) }), h("span", { class: "studio-help", text: ` ${word}` }), where,
          h("action-button", { variant: "secondary", size: "sm", onClick: () => { mine.evidence.splice(i, 1); draw(); } }, say("readings.evidenceTakeOut"), hidden(label(ref))));
      }) : [h("li", { class: "studio-help", text: say("readings.evidenceNoneYet") })]));
    };
    const picker = h("select-field", { label: say("readings.evidencePick"), options: [{ value: "", label: say("readings.evidenceAdd") }, ...choices.map((c) => ({ value: c.key, label: c.label }))], value: "", onValuechange: () => {
      const choice = choices.find((c) => c.key === picker.value);
      if (!choice) return;
      if (!mine.evidence.some((ref) => R.refKey(ref) === choice.key)) mine.evidence.push({ ...choice.ref });
      picker.value = "";
      draw();
    } });
    draw();
    return [h("h4", { text: say("readings.evidenceHeading") }), rows, picker];
  }

  function editReading(item) {
    const fresh = !item;
    const mine = item ? structuredClone(item) : R.newReading(draft.interpretations);
    const kind = h("select-field", { label: say("readings.who"), options: [{ value: "named", label: say("readings.whoNamed") }, { value: "source", label: say("readings.whoSource") }, { value: "anonymous", label: say("readings.whoAnonymous") }], value: mine.attribution.kind, onValuechange: () => { mine.attribution = R.attributionAs(mine.attribution, kind.value); drawWho(); } });
    const who = h("div", {});
    const drawWho = () => {
      const a = mine.attribution;
      if (a.kind === "source") {
        const pick = h("select-field", { label: say("readings.sourceLabel"), options: [{ value: "", label: say("readings.sourceChoose") }, ...refs.sources.map((s) => ({ value: s.id, label: s.title }))], value: a.source || "", onValuechange: () => { a.source = pick.value; } });
        who.replaceChildren(pick, ...(a.source && !refs.sources.some((s) => s.id === a.source) ? [h("p", { class: "studio-help", text: say("readings.sourceGone") })] : []));
      } else if (a.kind === "anonymous") {
        const d = h("text-field", { label: say("readings.describe"), description: say("readings.describeHelp"), value: a.description || "", maxlength: 200, onValuechange: () => { a.description = String(d.value ?? ""); } });
        who.replaceChildren(d);
      } else {
        const n = h("text-field", { label: say("readings.name"), value: a.name || "", maxlength: 200, onValuechange: () => { a.name = String(n.value ?? ""); } });
        who.replaceChildren(n);
      }
    };
    drawWho();
    const certainty = h("select-field", { label: say("readings.certainty"), options: ["", "stated", "attributed", "uncertain", "disputed"].map((v) => ({ value: v, label: R.certaintyWords(v) })), value: mine.attribution.certainty || "", onValuechange: () => { if (certainty.value) mine.attribution.certainty = certainty.value; else delete mine.attribution.certainty; } });
    const statement = h("text-field", { label: say("readings.statement"), rows: 6, maxlength: R.LIMITS.statement, value: mine.statement || "", onValuechange: () => { mine.statement = String(statement.value ?? ""); } });
    const uncertain = h("text-field", { label: say("readings.uncertain"), description: say("readings.uncertainHelp"), rows: 3, maxlength: R.LIMITS.uncertainty, value: mine.uncertainty || "", onValuechange: () => { mine.uncertainty = String(uncertain.value ?? ""); } });
    const language = h("text-field", { label: say("readings.language"), description: say("readings.languageHelp"), maxlength: 35, value: mine.language || "", onValuechange: () => { mine.language = String(language.value ?? ""); } });
    const choices = [
      ...refs.links.map((l) => ({ key: `link:${l.id}`, ref: { link: l.id }, label: `${say("readings.evidenceLinks")}: ${l.label || l.id}${l.sourceTitle ? ` (${l.sourceTitle})` : ""}` })),
      ...refs.sources.map((s) => ({ key: `source:${s.id}|`, ref: { source: s.id }, label: `${say("readings.evidenceSources")}: ${s.title}` })),
    ];
    const keep = () => {
      if (fresh) draft.interpretations.push(mine);
      else Object.assign(item, mine, { evidence: mine.evidence });
      for (const key of Object.keys(item || {})) if (!(key in mine) && item) delete item[key];
      changed(); paint();
      closeSheet(mine.id);
    };
    sheet.replaceChildren(
      h("span", { slot: "heading", text: say("readings.sheetReading", { who: whoOf(mine) }) }),
      h("p", { class: "studio-help", text: say("readings.savesWith") }),
      kind, who, certainty, statement, uncertain, language, ...evidenceFields(mine, choices, item?.id), ...aiFields(mine),
      h("details", { class: "studio-help" }, h("summary", { text: say("common.forHelper") }), h("p", { class: "studio-mono", text: say("readings.fileDetails", { id: mine.id }) })),
      sheetActions(keep, () => closeSheet(item?.id)));
    sheet.open = true;
    requestAnimationFrame(() => kind.focus?.());
  }

  function editRelation(relation) {
    const fresh = !relation;
    const ids = draft.interpretations.map((i) => i.id);
    const mine = relation ? { ...relation } : { from: ids[0] || "", to: ids[1] || "", kind: "differs-from" };
    const options = ids.map((id) => ({ value: id, label: nameOf(id) }));
    const from = h("select-field", { label: say("readings.relThis"), options, value: mine.from, onValuechange: () => { mine.from = from.value; } });
    const kind = h("select-field", { label: say("readings.relBy"), options: ["differs-from", "agrees-with", "builds-on", "responds-to"].map((v) => ({ value: v, label: R.relationKindWords(v) })), value: mine.kind, onValuechange: () => { mine.kind = kind.value; sym.hidden = !R.symmetric(mine.kind); } });
    const to = h("select-field", { label: say("readings.relThat"), options, value: mine.to, onValuechange: () => { mine.to = to.value; } });
    const note = h("text-field", { label: say("readings.relNote"), maxlength: R.LIMITS.note, value: mine.note || "", onValuechange: () => { mine.note = String(note.value ?? ""); } });
    const sym = h("p", { class: "studio-help", text: say("readings.eitherWay"), hidden: !R.symmetric(mine.kind) });
    const keep = () => {
      if (!mine.from || !mine.to || mine.from === mine.to) { toast(say("readings.pSelf"), { variant: "warning" }); return; }
      if (fresh) draft.relations.push(mine); else Object.assign(relation, mine);
      changed(); paint(); closeSheet();
    };
    sheet.replaceChildren(h("span", { slot: "heading", text: say("readings.sheetRelation") }), h("p", { class: "studio-help", text: say("readings.relHelp") }), from, kind, sym, to, note, sheetActions(keep, () => closeSheet()));
    sheet.open = true;
    requestAnimationFrame(() => from.focus?.());
  }

  function editExplanation(item) {
    const fresh = !item;
    const mine = item ? structuredClone(item) : R.newExplanation(draft.explanations, "beginner");
    const level = h("select-field", { label: say("readings.forLevel"), options: ["beginner", "student", "scholarly"].map((v) => ({ value: v, label: R.levelWords(v) })), value: mine.level, onValuechange: () => { mine.level = level.value; } });
    const about = h("select-field", { label: say("readings.about"), options: [{ value: "", label: say("readings.aboutWhole") }, ...draft.interpretations.map((i) => ({ value: i.id, label: whoOf(i) }))], value: mine.about || "", onValuechange: () => { if (about.value) mine.about = about.value; else delete mine.about; mine.evidence = mine.evidence.filter((ref) => R.explanationEvidenceChoices(draft, mine).some((c) => c.key === R.refKey(ref))); } });
    const text = h("text-field", { label: say("readings.explanationText"), rows: 8, maxlength: R.LIMITS.explanation, value: mine.text || "", onValuechange: () => { mine.text = String(text.value ?? ""); } });
    const choiceList = () => R.explanationEvidenceChoices(draft, mine).map((c) => ({ ...c, label: `${c.ref.link !== undefined ? say("readings.evidenceLinks") : say("readings.evidenceSources")}: ${c.ref.link !== undefined ? (refs.links.find((l) => l.id === c.ref.link)?.label || c.ref.link) : titleOfSource(c.ref.source)}` }));
    const keep = () => {
      if (fresh) draft.explanations.push(mine); else Object.assign(item, mine);
      changed(); paint(); closeSheet(mine.id);
    };
    const facts = item ? R.fileFacts(item) : [];
    sheet.replaceChildren(
      h("span", { slot: "heading", text: say("readings.sheetExplanation") }),
      h("p", { class: "studio-help", text: say("readings.explanationLede") }),
      level, about, text, h("p", { class: "studio-help", text: say("readings.evidenceFromReading") }), ...evidenceFields(mine, choiceList(), item?.id), ...aiFields(mine),
      facts.length ? h("p", { class: "studio-help", text: say("readings.factsLine", { facts: facts.join(" · ") }) }) : null,
      sheetActions(keep, () => closeSheet(item?.id)));
    sheet.open = true;
    requestAnimationFrame(() => level.focus?.());
  }

  // ---- reading what the server answers -------------------------------------------------------------

  function adopt(reply, { keep = null } = {}) {
    slug = reply.slug || slug;
    revision = reply.revision ?? null;
    unreadable = reply.valid === false;
    source = reply.source || "";
    publish = reply.publish === true;
    url = reply.url || null;
    states = reply.states || [];
    savedStates = states;
    if (unreadable) {
      saved = null;
      draft = R.readingDraft(null, slug);
    } else {
      saved = R.readingDraft(reply.comparison, slug);
      draft = keep || structuredClone(saved);
    }
    title.value = draft.title;
    address.value = draft.slug;
    subject.value = draft.subject;
    form.hidden = unreadable;
    problems = [];
    banner.replaceChildren();
    if (unreadable) {
      banner.replaceChildren(h("alert-banner", { variant: "warning", heading: say("readings.unreadable") }, say("common.tell"),
        h("details", { class: "studio-help", open: true }, h("summary", { text: say("common.forHelper") }), h("p", { class: "studio-mono", text: (reply.problems || []).map((p) => p.text || p.message).join(" ") || source }))));
    } else if (reply.researchProblem) {
      banner.replaceChildren(h("alert-banner", { variant: "warning", heading: say("readings.researchTrouble") }));
    }
    paint();
  }

  async function load() {
    try {
      const [loadedRefs, reply, all] = await Promise.all([
        api.get(`${BASE}/references`).catch(() => null),
        isNew ? Promise.resolve(null) : api.get(`${BASE}/item?slug=${encodeURIComponent(slug)}`),
        api.get(BASE).catch(() => ({ items: [] })),
      ]);
      if (loadedRefs) refs = loadedRefs;
      takenAddresses = (all.items || []).map((i) => i.slug);
      publish = all.publish === true;
      if (reply) adopt(reply); else paint();
      loaded = true;
      const entry = undo.current(BASE);
      if (entry && entry.what === "delete") undo.forget();
      drawUndo(undo.current(BASE));
    } catch (error) {
      banner.replaceChildren(h("alert-banner", { variant: "danger", heading: error?.status === 404 ? say("readings.eMissing") : say("readings.eGeneric") },
        h("action-button", { variant: "secondary", onClick: () => load() }, say("readings.tryAgain")), h("a", { href: "#/research/readings", text: say("readings.back") })));
    }
  }

  // ---- saving -------------------------------------------------------------------------------------

  async function save({ status: nextStatus, quiet = false } = {}) {
    if (unreadable) return false;
    const target = nextStatus || draft.status;
    const mineNow = { ...draft, status: target };
    problems = R.localProblems(mineNow, { isNew: !saved });
    if (problems.length) { showProblems(); paint(); return false; }
    if (saved && R.readingSame(mineNow, saved)) { if (!quiet) toast(say("readings.nothingChanged")); return true; }
    const wasPublished = saved?.status === "published";
    const approvedBefore = [...(saved?.interpretations || []).map((i) => ({ item: i, kind: "interpretation" })), ...(saved?.explanations || []).map((i) => ({ item: i, kind: "explanation" }))].filter((e) => e.item.approval);
    saveButton.loading = true;
    publishButton.loading = true;
    try {
      const body = { slug: mineNow.slug, comparison: R.readingPayload(mineNow) };
      const reply = saved ? await api.call("PUT", BASE, { json: { ...body, revision } }) : await api.post(BASE, body);
      const wasNew = !saved;
      const kept = R.readingSame({ ...draft, status: mineNow.status }, mineNow) ? null : draft;
      adopt(reply, { keep: kept });
      takenAddresses = [...new Set([...takenAddresses, slug])];
      if (wasNew) context.replaceRoute?.(`#/research/reading/${encodeURIComponent(slug)}`);
      const now = (e) => (e.kind === "interpretation" ? saved.interpretations : saved.explanations).find((n) => n.id === e.item.id);
      const lost = approvedBefore.find((e) => now(e) && !now(e).approval);
      const shown = reply.projection ? reply.projection.withheld === false : true;
      const said = R.savedWords({ wasPublished, status: mineNow.status, shown, siteOn: publish, url, droppedWho: lost ? (lost.kind === "interpretation" ? whoOf(lost.item) : R.levelWords(lost.item.level)) : "" });
      if (reply.replaced) undo.remember({ base: BASE, slug, name: reply.replaced, revision, title: draft.title, what: "save", said });
      drawUndo(undo.current(BASE));
      status.textContent = said;
      const out = await sendOut(api, `${wasPublished || mineNow.status === "published" ? "Update" : "Change"} the comparison ${draft.title.trim()}`);
      const sentWords = wentOutWords(out, { meta, action: "saved" });
      if (!quiet) toast(`${said} ${sentWords.words.replace(/^Saved\.\s*/, "")}`.trim(), { variant: sentWords.variant, duration: out.sent === "failed" ? 0 : undefined });
      schedulePreview();
      return true;
    } catch (error) {
      return failed(error, mineNow);
    } finally {
      saveButton.loading = false;
      publishButton.loading = false;
    }
  }

  function showProblems() {
    const items = problems.map((p) => h("li", {}, R.problemWords(p.code, p.field), " ",
      p.item ? h("action-button", { variant: "secondary", size: "sm", onClick: () => openItem(p.item) }, say("readings.goTo", { title: nameOf(p.item) })) : null));
    banner.replaceChildren(h("alert-banner", { variant: "warning", heading: say("readings.problemsHeading") },
      problems.length === 1 ? say("readings.problemsOne") : say("readings.problemsMany", { count: String(problems.length) }), h("ul", {}, items)));
    title.error = problems.find((p) => p.field === "title") ? R.problemWords("required", "title") : "";
    subject.error = problems.find((p) => p.field === "subject") ? R.problemWords("required", "subject") : "";
    address.error = problems.find((p) => p.field === "address") ? R.problemWords("bad-address") : "";
  }

  function openItem(id) {
    const r = draft.interpretations.find((i) => i.id === id);
    if (r) { editReading(r); return; }
    const x = draft.explanations.find((e) => e.id === id);
    if (x) editExplanation(x);
  }

  async function failed(error, mineNow) {
    const data = error?.data || {};
    if ((data.code === "changed" || data.conflict) && saved) return conflict(data.current, mineNow);
    if (data.code === "exists" || data.exists) {
      address.error = say("readings.eExists");
      address.hidden = false;
      address.querySelector("input")?.focus();
      return false;
    }
    const found = R.readingsProblem(error);
    if (found.length) { problems = found; showProblems(); paint(); return false; }
    banner.replaceChildren(h("alert-banner", { variant: "danger", heading: say("readings.problemsHeading") }, R.errorWords(error),
      data.error ? h("details", { class: "studio-help" }, h("summary", { text: say("common.forHelper") }), h("p", { class: "studio-mono", text: `${say("readings.eSentence")} ${data.error}` })) : null));
    return false;
  }

  async function conflict(current, mineNow) {
    const choice = await ask({ heading: say("readings.changedHeading"), text: say("readings.changedText"), choices: [{ label: say("readings.useMine"), value: "mine" }, { label: say("readings.showTheirs"), value: "theirs", variant: "secondary" }] });
    if (!choice) return false;
    const fresh = current || await api.get(`${BASE}/item?slug=${encodeURIComponent(slug)}`).catch(() => null);
    if (!fresh) return false;
    if (choice === "mine") {
      const sure = await ask({ heading: say("readings.useMineSure"), text: say("readings.useMineSureText"), choices: [{ label: say("readings.useMineYes"), value: "yes" }, { label: say("readings.goBack"), value: "no", variant: "secondary" }] });
      if (sure !== "yes") return false;
      revision = fresh.revision;
      saved = R.readingDraft(fresh.comparison, slug);
      return save({ status: mineNow.status });
    }
    adopt(fresh);
    toast(say("readings.theirsShown"));
    return false;
  }

  // ---- approving ----------------------------------------------------------------------------------

  async function readAndApprove(kind, item) {
    if (dirty()) {
      const choice = await ask({ heading: say("readings.saveFirstTitle"), text: say("readings.saveFirstText"), choices: [{ label: say("readings.saveNow"), value: "save" }, { label: say("readings.notNow"), value: "no", variant: "secondary" }] });
      if (choice !== "save") return;
      if (!(await save({ quiet: true }))) return;
    }
    // The words shown are the saved ones, from the server, never the draft.
    const list = kind === "interpretation" ? saved.interpretations : saved.explanations;
    const words = list.find((i) => i.id === item.id);
    const st = R.stateOf(savedStates, item.id);
    if (!words || !st) return;
    const who = kind === "interpretation" ? R.readingWho(words, refs.sources) : R.levelWords(words.level);
    const lines = [who, kind === "interpretation" ? words.statement : words.text];
    if (words.uncertainty) lines.push(say("readings.previewUncertain", { text: words.uncertainty }));
    if (words.language) lines.push(words.language);
    lines.push(say("readings.approveMeans"));
    const choice = await ask({ heading: say("readings.approveTitle"), text: lines, choices: [{ label: say("readings.approveThese"), value: "yes" }, { label: say("readings.notNow"), value: "no", variant: "secondary" }], focus: 1 });
    if (choice !== "yes") return;
    try {
      const reply = await api.post(`${BASE}/approve`, { slug, revision, kind, id: item.id, digest: st.digest });
      adopt(reply);
      const said = say("readings.approvedStatus", { who });
      if (reply.replaced) undo.remember({ base: BASE, slug, name: reply.replaced, revision, title: draft.title, what: "save", said });
      drawUndo(undo.current(BASE));
      status.textContent = said;
      toast(said);
      sendOut(api, `Approve words in the comparison ${draft.title.trim()}`).catch(() => {});
    } catch (error) {
      const data = error?.data || {};
      if (data.code === "changed" || data.conflict) { await conflict(data.current, { ...draft }); return; }
      banner.replaceChildren(h("alert-banner", { variant: "danger", heading: say("readings.problemsHeading") }, R.errorWords(error)));
    }
  }

  async function withdraw(kind, item) {
    if (dirty() && !(await save({ quiet: true }))) return;
    const live = saved.status === "published";
    if (live) {
      const choice = await ask({ heading: say("readings.withdrawPublishedTitle"), text: say("readings.withdrawPublishedText"), choices: [{ label: say("readings.withdrawPublishedYes"), value: "yes" }, { label: say("readings.notNow"), value: "no", variant: "secondary" }], focus: 1 });
      if (choice !== "yes") return;
    }
    try {
      const reply = await api.post(`${BASE}/revoke`, { slug, revision, kind, id: item.id, unpublish: live });
      adopt(reply);
      const said = say("readings.approvalWithdrawn");
      if (reply.replaced) undo.remember({ base: BASE, slug, name: reply.replaced, revision, title: draft.title, what: "save", said });
      drawUndo(undo.current(BASE));
      status.textContent = said;
      toast(said);
      sendOut(api, `Withdraw an approval in the comparison ${draft.title.trim()}`).catch(() => {});
    } catch (error) {
      banner.replaceChildren(h("alert-banner", { variant: "danger", heading: say("readings.problemsHeading") }, R.errorWords(error)));
    }
  }

  // ---- more ---------------------------------------------------------------------------------------

  async function moreAction(what) {
    if (what === "draft") await save({ status: "draft" });
    if (what === "delete") await remove();
    if (what === "written") showWritten();
  }

  async function remove() {
    if (!saved) return;
    const live = saved.status === "published";
    const choice = await ask({ heading: say("readings.deleteAsk", { title: draft.title }), text: live ? say("readings.deleteAskLive") : say("readings.deleteAskText"), choices: [{ label: say("readings.delete"), value: "delete", variant: "destructive" }, { label: say("readings.keepIt"), value: "keep", variant: "secondary" }], focus: 1 });
    if (choice !== "delete") return;
    try {
      const reply = await api.call("DELETE", `${BASE}?slug=${encodeURIComponent(slug)}&revision=${encodeURIComponent(revision)}`);
      const name = draft.title;
      saved = draft;
      loaded = false;
      undo.remember({ base: BASE, slug, name: reply.replaced || reply.trashedTo, revision: null, title: name, what: "delete" });
      sendOut(api, `Delete the comparison ${name.trim()}`).catch(() => {});
      go("#/research/readings");
    } catch (error) {
      if ((error?.data || {}).code === "changed") await load();
      banner.replaceChildren(h("alert-banner", { variant: "danger", heading: say("readings.problemsHeading") }, R.errorWords(error)));
    }
  }

  function drawUndo(entry) {
    if (!entry || entry.what !== "save") { undoSlot.replaceChildren(); return; }
    undoSlot.replaceChildren(undo.undoLine({ words: entry.said || say("readings.saved"), undo: say("readings.undo"), dismiss: say("readings.dismiss"), onUndo: () => undoSave(entry), onClose: () => undo.forget() }));
  }
  undo.watch((entry) => { if (loaded) drawUndo(entry && entry.base === BASE ? entry : null); });

  async function undoSave(entry) {
    const out = await undo.putBack(api, { ...entry, revision });
    if (out.reply) {
      adopt(out.reply);
      undo.remember({ base: BASE, slug, name: out.reply.replaced, revision, title: draft.title, what: "save", said: say("readings.undone") });
      status.textContent = say("readings.undone");
      toast(say("readings.undone"));
      sendOut(api, `Change the comparison ${draft.title.trim()}`).catch(() => {});
      return;
    }
    toast(say("readings.undoFailed"), { variant: "warning", duration: 0 });
  }

  function showWritten() {
    const text = unreadable || !saved ? source : source || JSON.stringify(R.readingPayload(draft), null, 2);
    sheet.replaceChildren(
      h("span", { slot: "heading", text: say("readings.writtenHeading") }),
      h("p", { class: "studio-help", text: say("readings.writtenHelp") }),
      h("pre", { class: "studio-mono studio-written", tabindex: "0", text }),
      h("div", { class: "studio-sheet-actions" }, h("action-button", { variant: "secondary", onClick: () => { sheet.open = false; } }, say("readings.writtenClose"))));
    sheet.open = true;
  }

  // ---- what readers will see ----------------------------------------------------------------------

  async function seeReaders(opener) {
    previewOpen = true;
    const body = h("div", { "aria-live": "polite" }, h("p", { class: "studio-help", text: say("readings.previewRefresh") }));
    const close = h("action-button", { variant: "secondary", onClick: () => { sheet.open = false; } }, say("readings.previewClose"));
    sheet.replaceChildren(h("span", { slot: "heading", text: say("readings.previewHeading") }), h("p", { class: "studio-help", text: say("readings.previewOnlyYou") }), close, body);
    sheet.open = true;
    const onClose = (e) => { if (e.detail) return; previewOpen = false; sheet.removeEventListener("openchange", onClose); opener?.focus?.(); };
    sheet.addEventListener("openchange", onClose);
    previewTarget = body;
    await refreshPreview();
    requestAnimationFrame(() => close.querySelector("button")?.focus());
  }

  async function refreshPreview() {
    if (!previewOpen || !previewTarget) return;
    try {
      previewReply = await api.post(`${BASE}/preview`, { slug: draft.slug || "preview", comparison: R.readingPayload(draft) });
      states = previewReply.states || states;
      previewTarget.replaceChildren(...readingPreview(previewReply, { titleOfSource, nameOf }));
    } catch {
      previewTarget.replaceChildren(h("p", { class: "studio-help", role: "alert", text: say("readings.previewFailed") }));
    }
  }
  function schedulePreview() {
    if (!previewOpen) return;
    clearTimeout(previewTimer);
    previewTimer = setTimeout(refreshPreview, 600);
  }

  async function leave() {
    if (!dirty()) return true;
    const choice = await ask({ heading: say("readings.leaveHeading"), text: say("readings.leaveText"), choices: [{ label: say("readings.leaveSave"), value: "save" }, { label: say("readings.leaveGo"), value: "go", variant: "secondary" }] });
    if (choice === "save") return save();
    return choice === "go";
  }

  return {
    title: say("readings.title"),
    element,
    load,
    leave,
    isDirty: dirty,
    focus: () => heading.focus(),
    get palette() {
      return [
        { id: "reading", label: say("readings.findAddReading"), group: say("readings.title") },
        { id: "relation", label: say("readings.findAddRelation"), group: say("readings.title") },
        { id: "explanation", label: say("readings.findAddExplanation"), group: say("readings.title") },
        { id: "save", label: say("readings.findSave"), group: say("readings.title") },
      ];
    },
    command(id) {
      if (id === "reading") editReading(null);
      if (id === "relation" && draft.interpretations.length >= 2) editRelation(null);
      if (id === "explanation") editExplanation(null);
      if (id === "save") save();
    },
  };
}
