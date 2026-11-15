// Research in Write (Studio R11), on a site that uses research only (G92): Cite in Add something,
// Cited here under each box of words, quotation cards' Change, Your research beside the words
// (docked on a wide screen, decision 6; a sheet otherwise), Keep these words as a passage, and
// Sources in this post in About this post. Everything that goes into her words is checked by the
// server first and can be undone; the first citation in a post also turns on numbered notes, and
// its Undo takes both back (decision 4).
import { h } from "./dom.js";
import { say } from "./words.js";
import { createSheet } from "./sheet.js";
import { pieceChange, undoPieceChange, parseQuotation } from "./word-blocks.js";
import { citationAt, citationInsertionProblem, citationStyleField, citationsIn, insertCitationText, parseCitationText, removeCitation } from "./cite-rules.js";
import { convertedNoteMarkdown, insertMarkdownBlock, insertMarkdownInline, quotationMarkdown } from "./draft-research-rules.js";
import { curationPostSlug } from "./curation-rules.js";
import { createClaimsSheet } from "./claims-sheet.js";
import { createForReaders } from "./for-readers.js";
import { showCiteForm, refusalWords } from "./cite-form.js";
import { citedHere } from "./cite-chips.js";
import { createYourResearch } from "./your-research.js";
import { createNotebookForm } from "./notebook-form.js";
import { cachedSources, remember } from "./research-cache.js";
import { rememberPost } from "./research-ui.js";

const wide = () => Boolean(globalThis.matchMedia?.("(min-width: 70rem)").matches);
const shortWords = (text, count = 5) => {
  const words = String(text || "").replace(/[#>*_`[\]!()|]+/g, " ").trim().split(/\s+/).filter(Boolean);
  return words.length > count ? `${words.slice(0, count).join(" ")}…` : words.join(" ");
};

/**
 * The hooks Add something needs before Write has made everything else: `{ form, under }`, each
 * passed on to the research part once it exists.
 */
export function researchHooks() {
  let target = null;
  return {
    attach(part) { target = part; },
    form: (...args) => target?.form(...args),
    under: (...args) => target?.under(...args) ?? null,
  };
}

/**
 * `{ api, meta, doc, body, about, addMenu, request(), kind(), title(), grid, openChecks(opener), sourcesInPost, saved(), saveDraft() }`.
 * Returns `{ form, under, isSheet, open, commands, run, previewed, leave, start(query), redraw }`.
 */
export async function createWriteResearch(ctx) {
  const { api, body, about, addMenu } = ctx;
  let lastBox = null;
  let lastCaret = null; // a caret Add something › A quotation chose, until the next insertion
  let pendingSpan = null; // a chip's Change: the citation it changes
  let pendingPassage = ""; // ?add=cite&passage=: Cite starts from it
  let docked = null;
  const yoursSheet = await createSheet({ label: say("yours.title") });
  const keepSheet = await createSheet({ label: say("notebook.newPassage") });
  const claimsSheet = await createSheet({ label: say("claims.title") });
  let pendingClaim = ""; // ?sheet=claims&claim=: the claim to show (R10 links here)
  const claims = createClaimsSheet({ api, path: () => ctx.doc.path, saved: () => ctx.saved(), saveDraft: () => ctx.saveDraft(), boxes: () => body.boxes() });
  const forReaders = createForReaders({ api, post: () => ctx.doc.slug || curationPostSlug(ctx.title()) });
  body.element.addEventListener("focusin", (event) => {
    const box = body.boxes().find((b) => b.element.contains(event.target));
    if (box) { lastBox = box; lastCaret = null; }
  });

  const boxFor = () => (lastBox && body.boxes().includes(lastBox) ? lastBox : body.boxes()[0]);
  const caretFor = (box) => (lastCaret !== null && box === lastBox ? lastCaret : box.caret());
  const allText = () => body.boxes().map((b) => b.value).join("\n\n");

  /** What happened, with Undo: the box's words as they were (what she typed since stays), and `after` too. */
  function did(box, before, words, after = null) {
    const change = pieceChange(before, box.value);
    box.tell(words, () => {
      const out = undoPieceChange(change, box.value, box.caret());
      if (!out) { box.tell(say("did.cantUndo")); return; }
      box.set(out.text, { at: out.at });
      after?.();
      box.tell(say("did.undone"));
      box.notify();
    });
    box.notify();
  }

  /** The first citation in a post turns on numbered notes; `undo` puts the setting back. */
  function firstCitation() {
    if (citationsIn(allText()).length) return null;
    const next = citationStyleField({ citations: about.value("citations") }, true);
    if (!next) return null;
    const was = about.value("citations");
    about.setValue("citations", next);
    return () => about.setValue("citations", was);
  }

  function put(box, before, next, words, first) {
    box.set(next.value, { at: next.start });
    lastCaret = null;
    did(box, before, words, first);
  }

  // ---- Cite (Add something step 2), and Change on a chip or a quotation card

  function form(kind, { box, caret, opener, block, sheet, back, afterClose, where }) {
    const target = box || boxFor();
    if (kind === "quotation" && !block) {
      // A quotation comes from her notebook: Your research, showing passages.
      sheet.close();
      lastBox = target;
      lastCaret = caret ?? target.caret();
      open("research", opener, { filter: "passages" });
      return;
    }
    let span = pendingSpan;
    pendingSpan = null;
    let quotation = false;
    if (kind === "quotation" && block) {
      const quote = parseQuotation(block.source);
      if (!quote) return;
      const start = block.start + quote.at;
      span = { start, end: start + quote.citation.length, text: quote.citation, citation: parseCitationText(quote.citation) };
      quotation = true;
    } else if (!span) {
      const inside = citationAt(target.value, caret ?? 0);
      if (inside) span = { ...inside, citation: parseCitationText(inside.text) };
    }
    const passage = pendingPassage;
    pendingPassage = "";
    showCiteForm({
      api, sheet, path: ctx.doc.path, box: target, caret: caret ?? target.caret(), span, quotation, passage, back, afterClose, where, opener,
      asWritten: addMenu.host.asWritten?.() || false,
      onCited: ({ markdown, span: changing }) => {
        const before = target.value;
        const first = changing ? null : firstCitation();
        const next = changing ? insertCitationText(before, changing.start, changing.end, markdown, changing) : insertCitationText(before, caret ?? target.caret(), caret ?? target.caret(), markdown);
        put(target, before, next, changing ? say("cite.changed") : first ? say("cite.notesOn") : say("cite.done"), first);
      },
    });
  }

  // ---- Cited here, under each box of words

  function under(box, segment) {
    if (addMenu.host.asWritten?.()) return null;
    const local = (span) => {
      const offset = segment.whole ? 0 : Number(segment.offset?.() ?? 0);
      return { ...span, start: span.start + offset, end: span.end + offset };
    };
    return citedHere(segment.text, cachedSources(), {
      change: (span, menu) => {
        const abs = local(span);
        pendingSpan = { ...abs, citation: span.citation };
        addMenu.open(box, menu, { kind: "cite" });
      },
      show: (span) => { const abs = local(span); box.reveal(abs.start, abs.end); },
      takeOut: (span) => {
        const before = box.value;
        const out = removeCitation(before, local(span));
        if (!out) return;
        box.set(out.text, { at: out.at });
        did(box, before, say("cite.takenOut"));
      },
    });
  }

  // ---- Your research

  const yours = createYourResearch({
    api, path: () => ctx.doc.path, request: () => ctx.request(), kind: () => ctx.kind(),
    openChecks: (opener) => ctx.openChecks(opener),
    keepPassage: () => keepPassage(),
    quote: (passage, markdown) => {
      const block = quotationMarkdown(passage.excerpt?.text, markdown);
      if (!block) return say("yours.noCitation");
      const box = boxFor();
      const caret = caretFor(box);
      const before = box.value;
      const out = insertMarkdownBlock(before, caret, caret, block);
      if (out.problem) return say("yours.refusedBlock");
      const first = firstCitation();
      const words = shortWords(before.slice(0, caret).split(/\n\s*\n/).pop() || before);
      put(box, before, out, say("yours.quoted", { words }), first);
      return "";
    },
    cite: (markdown) => {
      const box = boxFor();
      const caret = caretFor(box);
      const refused = citationInsertionProblem(box.value, caret);
      if (refused) return refusalWords(refused);
      const before = box.value;
      const first = firstCitation();
      put(box, before, insertCitationText(before, caret, caret, markdown), first ? say("cite.notesOn") : say("cite.done"), first);
      return "";
    },
    link: (markdown) => {
      const box = boxFor();
      const caret = caretFor(box);
      const refused = citationInsertionProblem(box.value, caret);
      if (refused) return refusalWords(refused);
      const before = box.value;
      put(box, before, insertMarkdownInline(before, caret, caret, markdown), say("yours.linked"), null);
      return "";
    },
    convert: (note) => {
      const box = boxFor();
      const caret = caretFor(box);
      const before = box.value;
      const out = insertMarkdownBlock(before, caret, caret, convertedNoteMarkdown(note.text));
      if (out.problem) return say("yours.refusedBlock");
      put(box, before, out, say("yours.converted"), null);
      return "";
    },
  });

  function closeDocked() {
    if (!docked) return;
    docked.remove();
    ctx.grid.classList.remove("studio-docked");
    docked = null;
    boxFor()?.focus({ at: boxFor().caret() });
  }

  function open(name, opener = null, { filter = null, claim = "" } = {}) {
    if (name === "claims") {
      rememberPost({ path: ctx.doc.path, title: ctx.title() });
      claimsSheet.show({ heading: say("claims.title"), opener, children: [claims.element], focus: () => claims.focus() });
      claims.load(claim || pendingClaim);
      pendingClaim = "";
      return true;
    }
    if (name !== "research") return false;
    if (ctx.meta?.research?.curatedContext) forReaders.load();
    rememberPost({ path: ctx.doc.path, title: ctx.title() });
    if (wide()) {
      if (!docked) {
        const close = h("action-button", { variant: "ghost", size: "sm", label: say("yours.close"), onClick: () => closeDocked() }, "×");
        docked = h("aside", { class: "studio-your-research", "aria-labelledby": "studio-yours-h" },
          h("div", { class: "studio-research-top" }, h("h2", { id: "studio-yours-h", tabindex: "-1", text: say("yours.title") }), close), yours.element, ...(ctx.meta?.research?.curatedContext ? [forReaders.element] : []));
        docked.addEventListener("keydown", (event) => { if (event.key === "Escape") { event.preventDefault(); closeDocked(); } });
        ctx.grid.append(docked);
        ctx.grid.classList.add("studio-docked");
      }
      yours.load(filter);
      requestAnimationFrame(() => docked?.querySelector("h2")?.focus());
      return true;
    }
    yoursSheet.show({ heading: say("yours.title"), opener, children: [yours.element, ...(ctx.meta?.research?.curatedContext ? [forReaders.element] : [])], focus: () => yours.focus() });
    yours.load(filter);
    return true;
  }

  async function keepPassage() {
    const box = boxFor();
    const words = box?.selection?.() || "";
    let state = { revision: "", passages: [], notes: [], sources: [] };
    try {
      state = await api.get("research/notebook");
      remember(state);
    } catch (error) {
      if (error?.status === 401) throw error;
    }
    const passage = createNotebookForm({ api, state: () => state, type: "passage", prefill: words, allowFollow: false,
      onSaved: (reply) => {
        state = reply;
        keepSheet.close();
        box?.tell(say("notebook.kept"));
        box?.focus({ at: box.caret() });
      } });
    const keepIt = h("action-button", { class: "studio-primary", onClick: () => passage.save() }, say("notebook.keep"));
    keepSheet.show({ heading: say("notebook.newPassage"), children: [h("p", { class: "studio-lede", text: say("notebook.fromPostLede") }), passage.element, h("div", { class: "studio-sheet-footer" }, keepIt)],
      dirty: () => passage.dirty(), save: () => passage.save(), question: { heading: say("notebook.dropTitle"), text: [], save: say("notebook.keep"), leave: say("sources.dropGo") },
      focus: () => passage.focus() });
  }

  // Chips say a source's name: the library, once per visit.
  async function start(query = {}) {
    if (query.passage) pendingPassage = String(query.passage);
    if (query.claim) pendingClaim = String(query.claim);
    try {
      remember(await api.get("citations/library"));
      for (const box of body.boxes()) box.redraw();
    } catch (error) {
      if (error?.status === 401) throw error;
    }
  }

  const COMMANDS = () => [
    { id: "research-yours", label: say("yours.open") },
    { id: "research-keep", label: say("notebook.keepFromPost") },
    { id: "research-sources", label: `${say("cite.sourcesGroup")}…` },
    { id: "research-cite", label: say("cite.citeIt"), more: false },
    { id: "research-claims", label: say("claims.title") },
    { id: "research-claim", label: say("claims.make"), more: false },
    ...(ctx.meta?.research?.curatedContext ? [{ id: "research-readers", label: say("curate.find"), more: false }] : []),
  ];

  return {
    form,
    under,
    isSheet: (name) => name === "research" || name === "claims",
    open,
    commands: COMMANDS,
    run(id, opener) {
      if (id === "research-yours") return open("research", opener);
      if (id === "research-keep") { keepPassage(); return true; }
      if (id === "research-sources") { about.open({ group: "sources", from: opener }); return true; }
      if (id === "research-cite") return addMenu.command("add:cite");
      if (id === "research-claims") return open("claims", opener);
      if (id === "research-claim") { open("claims", opener); return true; }
      if (id === "research-readers") return open("research", opener);
      return false;
    },
    previewed: (reply) => ctx.sourcesInPost?.previewed(reply),
    start,
    async leave() {
      if (!(await yoursSheet.leave())) return false;
      if (!(await claimsSheet.leave())) return false;
      return keepSheet.leave();
    },
    elements: [yoursSheet.element, keepSheet.element, claimsSheet.element],
  };
}
