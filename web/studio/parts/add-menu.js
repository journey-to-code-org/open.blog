// Add something (Studio R6): the sheet that lists what she can put in her words and the form for
// each, and everything a card does in place (Change, Move, Take it out) with Undo. Built once per
// Write screen; every box of words (Words, Your story, the notes, a job's parts) asks it through
// `host`. It says where a thing goes before she adds it, keeps a form she filled in, and puts what
// she adds where she was.
import { h } from "./dom.js";
import { say } from "./words.js";
import { use } from "../zubra.js";
import { createSheet } from "./sheet.js";
import { addItems, countWords, filterItems, whereItGoes } from "./add-words.js";
import { addFootnote, insertBlock, moveBlock, removeBlock, replaceBlock, splitBlocks, splitChunks } from "./word-blocks.js";
import { headingAt, linkAt, quoteAt } from "./block-forms.js";
import { buildForm } from "./piece-forms.js";
import { blockThing, cardSummary, firstWords, thingName } from "./piece-words.js";
import { sketch } from "./piece-cards.js";
import { BANNER_CODES } from "./piece-rules.js";
import { insertAbstract, insertResearchSection, sectionHeadingIn } from "./research-sections.js";
import { pasteToMarkdown, pasteWords } from "./paste.js";

const DETAILS_KEY = "studio-add-details";
const store = (() => { try { return globalThis.sessionStorage; } catch { return null; } })();
const keep = (key, value) => { try { if (value === null) store?.removeItem(key); else store?.setItem(key, JSON.stringify(value)); } catch { /* kept for this page only */ } };
const kept = (key) => { try { return JSON.parse(store?.getItem(key) || "null"); } catch { return null; } };

/** The words a problem code says beside its field. */
function problemWords(problem, kind) {
  switch (problem.code) {
    case "required": return { question: say("form.needQuestion"), answer: say("form.needAnswer"), days: say("form.needDays"), hours: say("form.needHours"), label: kind === "social" ? say("form.needName") : kind === "button" ? say("form.needButton") : say("form.fillThis"), title: kind === "video" ? say("form.needVideoAbout") : say("form.fillThis"), alt: say("form.needDescribe") }[problem.field] || say("form.fillThis");
    case "too-long": return say("form.shorter", { max: problem.max || "" });
    case "one-line": return say("form.oneLine");
    case "bad-address": return kind === "social" ? say("form.needHttps") : kind === "link" ? say("form.linkAddress") : say("form.badAddress");
    case "bad-video": return say("form.badVideo");
    case "bad-email": return say("form.badEmail");
    case "bad-phone": return say("form.badPhone");
    case "out-of-range": return say("form.offMap");
    case "html": return say("form.noTags");
    case "bad-choice": return say("form.choose");
    case "photo": return say("form.needPhoto");
    case "describe": return say("form.needDescribe");
    case "tip": return say("form.needTip");
    case "checklist": return say("form.needThings");
    case "table": return say("form.needColumn");
    case "video-about": return say("form.needVideoAbout");
    case "link-words": return say("form.needLinkWords");
    case "heading": return say("form.needHeading");
    case "quote": return say("form.needQuote");
    case "before-photo": return say("form.needBefore");
    case "after-photo": return say("form.needAfter");
    case "before-describe": return say("form.describeBefore");
    case "after-describe": return say("form.describeAfter");
    case "map-short": return say("form.mapShort");
    case "map-none": return say("form.mapNone");
    case "contact": return say("form.needContact");
    case "quiz-required": return problem.field === "question" ? say("form.needQuestion") : say("form.quizNeedAnswers");
    case "quiz-bad-choice": return say("form.quizNeedRight");
    case "quiz-links": return say("form.quizNoLinks");
    case "quiz-backticks": return say("form.noTicks");
    case "code-lines": return say("form.codeBadLines");
    case "code-body": return say("form.codeNeed");
    case "run-required": return say("form.runNeed");
    case "run-expected": return say("form.runNeedExpected");
    case "run-web-parts": return say("form.runWebParts");
    case "run-todo": return say("form.runTodo");
    case "run-backticks": return say("form.noTicks");
    case "codepen": return say("form.penBad");
    case "footnote": return say("form.needNote");
    default: return say("form.fillThis");
  }
}

/**
 * `{ api, meta, context, path(), post(), boxes(), changed(), preview(opener, box, text), extra(box,
 * block), removedPhoto(url) }`. Returns `{ host, open(box, opener, how), command(id), palette(),
 * openFromRoute(query), sheet, leave(), toggleAsWritten() }`.
 */
export async function createAddMenu(ctx) {
  await use("side-sheet", "text-field", "select-field", "segmented-control", "toggle-switch", "file-drop", "status-badge", "action-button", "dropdown-menu", "alert-banner", "empty-state", "loading-spinner", "cluster-layout");
  const sheet = await createSheet({ label: say("add.heading"), wide: false });
  sheet.element.classList.add("studio-add-sheet");
  let target = null; // { box, caret, slash }
  let form = null; // the open form, with its item and what it changes
  let last = null; // the last piece action, for Undo: { box, before, what }
  let tipShown = false;
  const asWrittenKey = () => `studio-as-written:${ctx.path() || "new"}`;
  const asWritten = () => Boolean(kept(asWrittenKey()));
  const lowerFirst = (words) => words.replace(/^./, (c) => c.toLowerCase());
  const focusHeading = () => {
    const head = sheet.element.querySelector("[slot=heading]");
    if (!head) return;
    head.tabIndex = -1;
    head.focus();
  };
  const items = () => addItems(ctx.meta, ctx.post());
  const allItems = () => { const g = items(); return [...g.most, ...g.more, ...g.details]; };
  const waitingKey = (kind) => `studio-add:${ctx.path() || "new"}:${kind}`;

  // ---- what happened, with Undo

  function did(box, before, words, focus) {
    if (last && last.box !== box) last.box.clearUndo();
    last = { box, before, what: words.replace(/\.$/, "").toLowerCase() };
    box.tell(words, () => undo());
    box.notify();
    ctx.afterPiece?.(box);
    if (focus) box.focus(focus);
  }

  function undo() {
    if (!last) return;
    const { box, before } = last;
    last = null;
    box.set(before, { at: box.caret() });
    box.tell(say("did.undone"));
    box.notify();
    ctx.afterPiece?.(box);
  }

  // ---- the sheet: the list

  function where() {
    const box = target?.box;
    if (!box) return "";
    return whereItGoes(box.place || box.name, box.value, target.caret);
  }

  function showList({ filter = "", focusFilter = false } = {}) {
    form = null;
    const lede = h("p", { class: "studio-help studio-add-where", "aria-live": "polite", text: where() });
    const count = h("p", { class: "studio-visually-hidden", "aria-live": "polite" });
    const groups = h("div", { class: "studio-add-groups" });
    const finder = h("text-field", { label: say("add.find"), value: filter, type: "search", class: "studio-add-find" });
    finder.addEventListener("valuechange", () => draw(String(finder.value || "")));
    const waiting = allItems().filter((item) => kept(waitingKey(item.id)));
    const resume = waiting.map((item) => h("action-button", { variant: "secondary", onClick: () => showForm(item.id) }, say("add.finish", { thing: thingName(item.id).toLowerCase() })));
    // Named by the item, described by its words.
    function itemButton(item) {
      const about = `studio-add-about-${item.id}`;
      const name = `studio-add-name-${item.id}`;
      return h("li", {}, h("button", { type: "button", class: "studio-add-item", "data-item": item.id, "aria-labelledby": name, "aria-describedby": about, onClick: () => showForm(item.id) },
        h("span", { class: "studio-add-name", id: name, text: item.name }), h("span", { class: "studio-add-about", id: about, text: item.about })));
    }
    function draw(query) {
      const g = items();
      const most = filterItems(g.most, query);
      const more = filterItems(g.more, query);
      const deep = filterItems(g.details, query);
      const total = most.length + more.length + (query ? deep.length : 0);
      const open = Boolean(kept(DETAILS_KEY)) || (Boolean(query) && deep.length > 0);
      const detailsEl = h("details", { class: "studio-add-details", open },
        h("summary", { text: say("common.forHelper") }),
        h("ul", { class: "studio-add-list" }, deep.map(itemButton)),
        h("toggle-switch", { label: say("add.asWritten"), description: say("add.asWrittenHelp"), checked: asWritten(), onCheckedchange: () => toggleAsWritten() }),
        h("p", { class: "studio-help", text: say("add.detailsNote", { file: (ctx.path() || "").replace(/^posts\//, "") || "…" }) }));
      detailsEl.addEventListener("toggle", () => keep(DETAILS_KEY, detailsEl.open ? 1 : null));
      groups.replaceChildren(
        ...(most.length ? [h("h3", { class: "studio-add-group", text: say("add.mostUsed") }), h("ul", { class: "studio-add-list" }, most.map(itemButton))] : []),
        ...(more.length ? [h("h3", { class: "studio-add-group", text: say("add.moreThings") }), h("ul", { class: "studio-add-list" }, more.map(itemButton))] : []),
        total ? null : h("empty-state", { heading: say("add.nothing", { words: query.replace(/^\//, "") }), description: say("add.nothingHelp") }),
        detailsEl);
      count.textContent = query ? countWords(total) : "";
    }
    draw(filter);
    const never = h("action-button", { variant: "secondary", onClick: () => close() }, say("add.never"));
    const content = [lede, ...resume, finder, count, groups, h("div", { class: "studio-sheet-footer" }, never)];
    sheet.show({
      heading: say("add.heading"), children: content, opener: target?.opener,
      focus: () => (focusFilter ? finder.querySelector("input")?.focus() : focusHeading()),
      onClose: () => afterClose(),
    });
  }

  // ---- the sheet: one thing's form

  function showForm(kind, { block = null, link = null, heading = null, quote = null, file = null } = {}) {
    if (kind === "abstract" || kind === "references") { research(kind); return; }
    const box = target?.box;
    const live = h("div", { class: "studio-add-sketch", "aria-hidden": "true" });
    const writes = h("pre", { class: "studio-mono studio-add-writes" });
    const banner = h("div", { "aria-live": "polite" });
    const footerStatus = h("p", { class: "studio-help", role: "status" });
    const changing = Boolean(block || link || heading || quote);
    const opened = buildForm(kind, {
      api: ctx.api, meta: ctx.meta, block, link, heading, quote, file, maxBytes: ctx.meta.capture?.maxPhotoBytes || 0,
      selection: link ? "" : box?.selection?.() || "",
      posts: () => (ctx.context.posts?.list?.() || ctx.api.get("documents?kind=posts").then((r) => r.items || []))
        .then((list) => list.filter((item) => item.url && item.status !== "draft").sort((a, b) => String(b.date || "").localeCompare(String(a.date || ""))).map((item) => ({ url: item.url, title: item.title || item.url }))),
      onChange: () => { drawSketch(); clearProblems(); },
    });
    const saved = kept(waitingKey(kind));
    if (saved && !changing) opened.restore(saved);
    form = { kind, opened, block, link, heading, quote, changing, box };
    const title = link ? say("form.changeLink") : heading ? say("form.changeHeading") : quote ? say("form.changeQuote") : thingName(kind);
    const back = h("action-button", { variant: "link", class: "studio-add-back", onClick: () => backToList() }, say("add.back"));
    const preview = h("action-button", { variant: "secondary", onClick: (e) => seeIt(e.currentTarget) }, say("form.seeIt"));
    const addIt = h("action-button", { class: "studio-add-it", onClick: () => commit() }, changing ? say("form.done") : say("form.addIt"));
    const takeOff = link ? h("action-button", { variant: "secondary", onClick: () => unlink() }, say("form.takeLinkOff")) : null;
    function drawSketch() {
      try { live.replaceChildren(sketch(opened.sketch())); } catch { live.replaceChildren(); }
    }
    drawSketch();
    let linked = [];
    function clearProblems() {
      for (const control of linked) control.error = "";
      linked = [];
      banner.replaceChildren();
    }
    const content = [
      changing ? null : back,
      h("p", { class: "studio-help studio-add-where", text: changing ? "" : where() }),
      banner,
      opened.element,
      h("section", { class: "studio-add-looks", "aria-label": say("form.howItLooks") }, h("h3", { class: "studio-label", text: say("form.howItLooks") }), live),
      h("details", { class: "studio-form-details" }, h("summary", { text: say("form.whatItWrites") }), writes),
      h("div", { class: "studio-sheet-footer studio-add-footer" }, footerStatus, h("p", { class: "studio-help", text: say("form.seeItNote") }), h("cluster-layout", { gap: "0.5rem" }, takeOff, preview, addIt)),
    ];
    const question = changing
      ? { heading: say("form.keepChanges", { thing: thingName(kind).toLowerCase() }), text: say("form.keepChangesText"), save: say("form.keepThem"), leave: say("form.leaveAsWas") }
      : { heading: say("form.addThis", { thing: thingName(kind).toLowerCase() }), text: say("form.addThisText"), save: say("form.addIt"), leave: say("form.leaveOut") };
    const guard = { dirty: () => Boolean(form?.opened.dirty()), save: () => commit(), question };
    const keys = (event) => {
      if (event.altKey && event.key === "ArrowLeft" && !changing) { event.preventDefault(); backToList(); }
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); event.stopPropagation(); commit(); }
    };
    sheet.show({ heading: title, children: content, opener: target?.opener, focus: () => opened.focus(), onClose: () => afterClose(), ...guard });
    sheet.element.onkeydown = keys;

    function showProblems(problems) {
      clearProblems();
      const top = [];
      let first = null;
      for (const problem of problems) {
        const control = problem.control || (problem.item !== null && problem.item !== undefined ? opened.rowControl?.(problem.item, problem.field) : null) || opened.controls?.[problem.field];
        const words = problemWords(problem, kind);
        if (control && !BANNER_CODES.has(problem.code) && "error" in control) {
          control.error = words;
          linked.push(control);
          first ||= control;
        } else if (control && !BANNER_CODES.has(problem.code)) {
          top.push(words);
          first ||= control;
        } else {
          top.push(["unknown-kind", "unknown-field", "repeated"].includes(problem.code) ? say("form.cantAddYet") : ["too-large", "too-many"].includes(problem.code) ? say("form.tooMuch") : problem.code === "bad-request" ? say("form.didntWork") : say("form.checkHelp"));
        }
      }
      if (top.length) {
        banner.append(h("alert-banner", { variant: "warning", role: "alert" }, h("ul", {}, [...new Set(top)].map((words) => h("li", { text: words }))),
          problems.some((p) => p.message) ? h("details", { class: "studio-help" }, h("summary", { text: say("common.forHelper") }), problems.filter((p) => p.message).map((p) => h("p", { text: p.message }))) : null));
      }
      (first?.querySelector?.("input, textarea, select, button") || first || banner.querySelector("alert-banner"))?.focus?.();
    }

    async function result() {
      addIt.loading = true;
      try {
        return await opened.read();
      } finally {
        addIt.loading = false;
      }
    }

    async function seeIt(opener) {
      const got = await result();
      if (got.problems) { showProblems(got.problems); return; }
      if (got.waiting || got.failed) { waitingNote(got); return; }
      writes.textContent = got.markdown || "";
      const placed = place(got);
      if (placed) await ctx.preview(opener, box, placed.text);
    }

    function waitingNote(got) {
      keep(waitingKey(kind), opened.values());
      footerStatus.replaceChildren(got.waiting ? say("form.waiting") : say("form.noAnswer"), got.failed ? h("action-button", { variant: "secondary", size: "sm", onClick: () => commit() }, say("form.tryAgain")) : "");
    }

    // Done with nothing changed writes nothing.
    async function commit() {
      if (changing && !opened.dirty()) { close(); return true; }
      const got = await result();
      if (got.problems) { showProblems(got.problems); return false; }
      if (got.waiting || got.failed) { waitingNote(got); return false; }
      writes.textContent = got.markdown || "";
      const placed = place(got);
      if (!placed) { footerStatus.textContent = say("form.moved"); return false; }
      keep(waitingKey(kind), null);
      const before = box.value;
      const words = kind === "photo" && !changing ? say("did.photoIn") : changing ? say("did.changed", { thing: thingName(kind, got.markdown?.match(/\[!([A-Z]+)\]/)?.[1]) }) : say("did.added", { thing: thingName(kind, got.markdown?.match(/\[!([A-Z]+)\]/)?.[1]) });
      form = null;
      sheet.close();
      box.set(placed.text, placed.focus);
      did(box, before, words, null);
      return true;
    }

    function unlink() {
      const before = box.value;
      const text = before.slice(0, link.start) + link.words + before.slice(link.end);
      form = null;
      sheet.close();
      box.set(text, { at: link.start + link.words.length });
      did(box, before, say("did.takenOut", { thing: thingName("link") }), null);
    }

    /** Where the Markdown goes: `{ text, focus }`, or null when the card moved since. */
    function place(got) {
      const value = box.value;
      if (block) {
        const replaced = replaceBlock(value, block.start, block.source, got.markdown);
        return replaced && { text: replaced.text, focus: { card: replaced.start } };
      }
      if (link || heading || quote) {
        const range = link || heading || quote;
        const next = value.slice(0, range.start) + got.markdown + value.slice(range.end);
        return { text: next, focus: { at: range.start + got.markdown.length } };
      }
      if (opened.footnote) {
        const added = addFootnote(value, target.caret, got.note);
        return { text: added.text, focus: { at: added.caret } };
      }
      if (opened.inline) {
        const at = target.caret;
        const selection = box.selection();
        const from = selection && value.slice(at - selection.length, at) === selection ? at - selection.length : at;
        const next = value.slice(0, from) + got.markdown + value.slice(at);
        return { text: next, focus: { at: from + got.markdown.length } };
      }
      const put = insertBlock(value, target.caret, got.markdown);
      const blocks = splitBlocks(put.text);
      const card = blocks.find((b) => b.start === put.start && b.type === "card");
      return { text: put.text, focus: card ? { card: put.start } : { at: put.end } };
    }
  }

  function backToList() {
    if (form?.opened.dirty()) keep(waitingKey(form.kind), form.opened.values());
    showList();
  }

  function afterClose() {
    form = null;
    if (target?.slash) target.box.focus({ at: target.caret });
  }

  function close() {
    if (form?.opened.dirty()) { sheet.cancel(); return; }
    sheet.close();
  }

  // ---- Abstract and References (research posts): a heading, no form

  function research(kind) {
    const boxes = ctx.boxes();
    const thing = thingName(kind);
    const whole = boxes.map((b) => b.value).join("\n\n");
    if (sectionHeadingIn(whole, kind)) {
      sheet.close();
      const holder = boxes.find((b) => sectionHeadingIn(b.value, kind)) || boxes[0];
      holder.tell(kind === "abstract" ? say("add.alreadyThere", { thing }) : say("add.alreadyThereRefs", { thing }));
      const at = holder.value.search(new RegExp(`^#{1,6}[ \\t]+${thing}`, "im"));
      holder.focus({ at: Math.max(0, at) });
      return;
    }
    const box = kind === "abstract" ? boxes[0] : boxes[boxes.length - 1];
    const before = box.value;
    const out = kind === "abstract" ? insertAbstract(before) : insertResearchSection(before, "references");
    sheet.close();
    box.set(out.value, { at: out.start });
    did(box, before, say("did.added", { thing }), null);
  }

  // ---- toggles

  function toggleAsWritten() {
    keep(asWrittenKey(), asWritten() ? null : 1);
    for (const box of ctx.boxes()) box.redraw();
    sheet.close();
  }

  // ---- what a box asks

  function open(box, opener, { slash = false, kind = "", file = null } = {}) {
    target = { box, caret: box.caret(), opener, slash };
    // Once a visit: the quicker way in.
    if (!tipShown && !slash && !kept("studio-slash-tip")) {
      tipShown = true;
      keep("studio-slash-tip", 1);
      box.tell(say("add.slashTip"));
    }
    if (kind) { showForm(kind, { file }); return; }
    // In a link, a heading or a quote: change that one.
    const value = box.value;
    const at = target.caret;
    const inLink = linkAt(value, at);
    if (inLink && !slash) { showForm("link", { link: inLink }); return; }
    const inHeading = headingAt(value, at);
    if (inHeading && !slash) { showForm("heading", { heading: inHeading }); return; }
    const inQuote = quoteAt(value, at);
    if (inQuote && !slash) { showForm("quote", { quote: inQuote }); return; }
    const keyboard = Boolean((opener?.querySelector?.("button") || opener)?.matches?.(":focus-visible"));
    showList({ focusFilter: slash || keyboard });
  }

  function card(box, action, block, element) {
    const before = box.value;
    if (action === "change") {
      target = { box, caret: block.start + block.source.length, opener: element };
      showForm(block.form, { block });
      return;
    }
    if (action === "remove") {
      const out = removeBlock(before, block.start);
      if (!out) return;
      const photo = /\]\((\/images\/uploads\/[^)\s]+)\)/.exec(block.source)?.[1];
      if (photo) ctx.removedPhoto?.(photo);
      // Focus goes to the box before it, at its end.
      box.set(out.text, { at: Math.max(0, out.at - 1) });
      did(box, before, say("did.takenOut", { thing: blockThing(block) }), null);
      return;
    }
    const by = action === "up" ? -1 : 1;
    const moved = moveBlock(before, block.start, by);
    if (!moved) { box.tell(by < 0 ? say("did.cantMoveUp") : say("did.cantMoveDown")); return; }
    const { chunks } = splitChunks(moved.text);
    const index = chunks.findIndex((chunk) => chunk.start === moved.start);
    const previous = chunks[index - 1];
    const near = (chunk) => (chunk.type === "card" ? cardSummary(chunk).name : firstWords(chunk.source, 4));
    const words = by < 0 ? (previous ? say("did.movedUp", { words: near(previous) }) : say("did.movedTop")) : say("did.movedDown", { words: near(previous) });
    box.set(moved.text, { card: moved.start });
    did(box, before, words, null);
  }

  /** A paste in any box: a photo file opens Put a photo in; HTML becomes plain Markdown. */
  function paste(box, area, event) {
    const data = event.clipboardData;
    const file = [...(data?.files || [])].find((f) => /^image\//.test(f.type));
    if (file) {
      event.preventDefault();
      open(box, area, { kind: "photo", file });
      return;
    }
    const html = data?.getData("text/html");
    if (!html) return;
    const result = pasteToMarkdown(html, { minHeading: 2 });
    if (!result.markdown) return;
    event.preventDefault();
    area.setRangeText(result.markdown, area.selectionStart, area.selectionEnd, "end");
    area.dispatchEvent(new Event("input", { bubbles: true }));
    const computer = !globalThis.matchMedia?.("(pointer: coarse)").matches;
    const words = pasteWords(result, { computer, mac: /Mac|iPhone|iPad/.test(globalThis.navigator?.platform || "") });
    if (words) box.tell(words);
  }

  const host = {
    pieces: () => ctx.meta.pieces || [],
    asWritten,
    changed: (box) => ctx.changed(box),
    add: (box, opener, how) => open(box, opener, how),
    photo: (box, opener, file) => open(box, opener, { kind: "photo", file }),
    card,
    paste,
    extra: (box, block) => ctx.extra?.(box, block) || null,
  };

  return {
    host,
    sheet,
    open,
    toggleAsWritten,
    undo,
    did,
    /** Find: Add something, each item, Show the words as written, Undo. */
    palette() {
      const out = [{ id: "add", label: say("add.heading") }];
      for (const item of allItems()) out.push({ id: `add:${item.id}`, label: say("add.findAdd", { thing: lowerFirst(item.name) }) });
      out.push({ id: "as-written", label: say("add.asWritten") });
      if (last) out.push({ id: "undo-piece", label: say("did.undoFind", { what: last.what }) });
      return out;
    },
    command(id) {
      const boxes = ctx.boxes();
      const box = boxes.find((b) => b.element.contains(document.activeElement)) || boxes[0];
      if (!box) return false;
      if (id === "add") { open(box, document.activeElement, {}); return true; }
      if (id.startsWith("add:")) { open(box, document.activeElement, { kind: id.slice(4) }); return true; }
      if (id === "as-written") { toggleAsWritten(); return true; }
      if (id === "undo-piece") { undo(); return true; }
      return false;
    },
    /** ?add=1 opens the list, ?add=<kind> that form, in the first box. */
    openFromRoute(value) {
      const box = ctx.boxes()[0];
      if (!box || !value) return;
      if (value === "1" || value === "true") open(box, null, {});
      else if (allItems().some((item) => item.id === value)) open(box, null, { kind: value });
    },
    leave: () => sheet.leave(),
  };
}
