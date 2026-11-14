// One box of her words with its cards in place (Studio R6): the words between cards are boxes she
// types in, each photo, tip, table or piece is a card with Change and Move, and "/" alone on a line
// opens Add something. The box's text is always exactly the post's Markdown for it: blocks she
// doesn't touch keep their bytes (word-blocks.js). Used for Words, Your story, the notes and a job's
// four parts. With "Show the words as written" it is one plain box.
import { h } from "./dom.js";
import { say } from "./words.js";
import { addRoom, fillBlock, joinBlocks, splitBlocks, withEndRoom } from "./word-blocks.js";
import { cardForm } from "./piece-words.js";
import { pieceCard } from "./piece-cards.js";

const shape = (blocks) => blocks.filter((block) => block.source !== "").map((block) => `${block.type}:${block.kind}`).join(",");

/**
 * `{ label, name, rows, description, value, host, plain }`. `name` is how Add something calls it
 * ("Your story"); `host` gives `pieces()`, `asWritten()`, `changed(box)`, `add(box, opener, how)`,
 * `photo(box, opener, file?)`, `card(box, action, block, card)`, `paste(box, area, event)`,
 * `extra(box, block)`. A `plain` box never shows cards (a recipe row would be, but rows aren't boxes).
 */
export function createWordBox({ label, name = label, place = name, rows = 8, description = "", value = "", host, data = {} }) {
  let text = String(value ?? "");
  let blocks = [];
  let caret = null; // { index, at } in a segment, or { card: start } after a card
  let pendingShape = false;
  const element = h("div", { ...data, class: `studio-word-box ${data.class || ""}`.trim() });
  const status = h("p", { class: "studio-help studio-piece-status", role: "status", "aria-live": "polite" });
  const undoSlot = h("span", { class: "studio-piece-undo" });
  const banner = h("div");
  const list = h("div", { class: "studio-word-blocks" });
  const putPhoto = h("action-button", { variant: "secondary", class: "studio-put-photo", label: say("add.photoTo", { box: name }), onClick: (e) => host.photo(box, e.currentTarget) }, say("add.putPhoto"));
  const addButton = h("action-button", { variant: "secondary", class: "studio-add-something", label: say("add.buttonTo", { box: name }), onClick: (e) => host.add(box, e.currentTarget, {}) }, say("add.button"));
  element.append(banner, list, h("div", { class: "studio-word-actions" }, putPhoto, addButton), h("p", { class: "studio-row studio-piece-said" }, status, undoSlot));

  const offsetOf = (index) => {
    let at = blocks[0]?.gapBefore.length || 0;
    for (let i = 0; i < index; i += 1) {
      if (blocks[i].source === "") continue;
      at += blocks[i].source.length + blocks[i].gapAfter.length;
    }
    return at;
  };
  // A segment's offset when it is an empty box: just after the block before it.
  const roomOffset = (index) => {
    const before = blocks.slice(0, index).findLastIndex((block) => block.source !== "");
    return before < 0 ? blocks[0]?.gapBefore.length || 0 : offsetOf(before) + blocks[before].source.length;
  };

  function emit() {
    host.changed?.(box);
  }

  function render({ focus = null, keep = false } = {}) {
    banner.replaceChildren();
    if (host.asWritten?.()) {
      blocks = [];
      list.replaceChildren(segment(0, text, { whole: true }));
      focusAfterRender(focus);
      return;
    }
    if (!keep) blocks = withEndRoom(splitBlocks(text));
    const open = blocks.find((block) => block.asWritten);
    if (open) {
      banner.append(h("alert-banner", { variant: "info", heading: say("card.unclosed") }, say("card.unclosedWhy"),
        h("details", { class: "studio-help" }, h("summary", { text: say("common.forHelper") }), h("p", { text: say("card.unclosedLine", { line: open.line }) }))));
    }
    const parts = blocks.filter((block) => block.type === "words").length;
    const children = [];
    let part = 0;
    blocks.forEach((block, index) => {
      if (block.type === "card") {
        if (index === 0 || blocks[index - 1]?.type === "card") children.push(writeHere(index));
        children.push(card(block, index));
        return;
      }
      part += 1;
      children.push(segment(index, block.source, { part, parts }));
    });
    list.replaceChildren(...children);
    pendingShape = false;
    focusAfterRender(focus);
  }

  function focusAfterRender(focus) {
    if (!focus) return;
    requestAnimationFrame(() => {
      if (focus.card !== undefined) {
        const target = list.querySelector(`[data-card-start="${focus.card}"]`) || list.querySelector(".studio-piece-card");
        target?.classList.add("studio-piece-new");
        target?.focus();
        return;
      }
      const areas = [...list.querySelectorAll("textarea")];
      if (focus.index !== undefined) { areas.find((a) => a.dataset.index === String(focus.index))?.focus(); return; }
      const area = focus.segment === "last" ? areas[areas.length - 1] : focus.at !== undefined ? areaAt(focus.at) : areas[0];
      if (!area) return;
      area.focus();
      if (focus.at !== undefined && area.dataset.offset !== undefined) {
        const local = Math.max(0, Math.min(area.value.length, focus.at - Number(area.dataset.offset)));
        area.setSelectionRange(local, local);
      } else if (focus.end) {
        area.setSelectionRange(area.value.length, area.value.length);
      }
    });
  }

  // The segment that holds offset `at` (its area), or the nearest one before it.
  function areaAt(at) {
    const areas = [...list.querySelectorAll("textarea")];
    let found = areas[0];
    for (const area of areas) if (Number(area.dataset.offset) <= at) found = area;
    return found;
  }

  function segment(index, source, { part = 1, parts = 1, whole = false } = {}) {
    const block = blocks[index];
    const room = Boolean(block?.room);
    // Where this segment starts in the text, now (typing above it moves it).
    const offset = () => (whole ? 0 : blocks[index]?.source === "" ? roomOffset(index) : offsetOf(index));
    const field = h("text-field", {
      label: whole || part === 1 ? label : say("card.part", { label, part, parts }),
      class: `studio-writing studio-segment${part > 1 ? " studio-segment-later" : ""}`,
      rows: whole || parts === 1 ? rows : Math.min(rows, Math.max(3, source.split("\n").length + 1)),
      value: source,
      description: part === 1 ? description : "",
      placeholder: room ? say("card.keepWriting") : "",
    });
    field.addEventListener("valuechange", (event) => {
      const next = String(event.detail ?? "");
      if (whole) text = next;
      else {
        blocks = fillBlock(blocks, index, next);
        text = joinBlocks(blocks);
        pendingShape = true;
      }
      remember(field, index, offset);
      slash(field);
      emit();
    });
    requestAnimationFrame(() => {
      const area = field.querySelector("textarea");
      if (!area) return;
      area.dataset.offset = String(offset());
      area.dataset.index = String(index);
      for (const type of ["keyup", "click", "focus", "select"]) area.addEventListener(type, () => remember(field, index, offset));
      area.addEventListener("keydown", (event) => keys(event, area, index));
      area.addEventListener("paste", (event) => host.paste?.(box, area, event));
    });
    return field;
  }

  function remember(field, index, offset) {
    const area = field.querySelector("textarea");
    if (!area) return;
    caret = { index, at: offset() + (area.selectionEnd ?? area.value.length), selection: area.value.slice(area.selectionStart ?? 0, area.selectionEnd ?? 0) };
  }

  // "/" alone on the line she just typed it on opens Add something with the filter ready.
  function slash(field) {
    const area = field.querySelector("textarea");
    if (!area || area.selectionStart !== area.selectionEnd) return;
    const at = area.selectionEnd;
    if (area.value[at - 1] !== "/") return;
    const start = area.value.lastIndexOf("\n", at - 2) + 1;
    const end = area.value.indexOf("\n", at);
    const line = area.value.slice(start, end < 0 ? area.value.length : end);
    if (line.trim() === "/") host.add(box, field, { slash: true });
  }

  function keys(event, area, index) {
    // Ctrl/⌘ B and I: the selected words bold or slanted.
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && ["b", "i"].includes(event.key.toLowerCase())) {
      event.preventDefault();
      const mark = event.key.toLowerCase() === "b" ? "**" : "_";
      const { selectionStart: from, selectionEnd: to } = area;
      area.setRangeText(`${mark}${area.value.slice(from, to)}${mark}`, from, to, from === to ? "end" : "select");
      if (from === to) area.setSelectionRange(from + mark.length, from + mark.length);
      area.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const before = area.value.slice(0, area.selectionStart);
    const after = area.value.slice(area.selectionEnd);
    if (event.key === "ArrowDown" && !after.includes("\n") && blocks[index + 1]?.type === "card") {
      event.preventDefault();
      focusCard(index + 1);
    } else if (event.key === "ArrowUp" && !before.includes("\n") && blocks[index - 1]?.type === "card") {
      event.preventDefault();
      focusCard(index - 1);
    }
  }

  const focusCard = (index) => list.querySelector(`[data-card-index="${index}"]`)?.focus();

  function card(block, index) {
    const start = offsetOf(index);
    const startOf = () => offsetOf(index);
    const cards = blocks.filter((b) => b.type === "card");
    const form = cardForm(block, host.pieces?.() || []);
    const element_ = pieceCard(block, {
      form,
      first: start === (blocks[0]?.gapBefore.length || 0),
      last: cards[cards.length - 1] === block && blocks.slice(index + 1).every((b) => b.source === ""),
      extra: host.extra?.(box, block) || null,
      on: {
        change: (el) => { caret = { card: startOf(), at: startOf() + block.source.length }; host.card(box, "change", { ...block, start: startOf(), form }, el); },
        move: (by) => host.card(box, by < 0 ? "up" : "down", { ...block, start: startOf() }),
        remove: () => host.card(box, "remove", { ...block, start: startOf() }),
      },
    });
    element_.dataset.cardStart = String(start);
    element_.dataset.cardIndex = String(index);
    element_.addEventListener("focusin", () => { caret = { card: startOf(), at: startOf() + block.source.length }; });
    element_.addEventListener("keydown", (event) => {
      if (event.target !== element_ || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const next = event.key === "ArrowDown" ? index + 1 : index - 1;
        const target = blocks[next]?.type === "card" ? list.querySelector(`[data-card-index="${next}"]`) : [...list.querySelectorAll("textarea")].find((a) => a.dataset.index === String(next));
        if (target) { event.preventDefault(); target.focus(); }
      }
    });
    return element_;
  }

  function writeHere(index) {
    return h("action-button", { variant: "link", class: "studio-write-here", onClick: () => {
      // A new empty box here; the text doesn't change until she types in it.
      blocks = addRoom(blocks, index);
      render({ keep: true, focus: { index } });
    } }, say("card.writeHere"));
  }

  // Words that now hold a card (a pasted table, a photo line) become a card once she leaves the box.
  element.addEventListener("focusout", (event) => {
    if (!pendingShape || element.contains(event.relatedTarget)) return;
    if (shape(splitBlocks(text)) !== shape(blocks.filter((block) => !block.room))) render();
    else pendingShape = false;
  });

  const box = {
    element,
    name,
    place,
    label,
    get value() { return text; },
    set value(next) { text = String(next ?? ""); render(); },
    /** Put new text in and say where focus goes: `{ card: start }`, `{ at }` or `{ segment: "last" }`. */
    set(next, focus = null) { text = String(next ?? ""); render({ focus }); },
    /** Where she was: an offset in the text (the end when she hasn't been in it yet). */
    caret: () => (caret ? caret.at : text.replace(/\s+$/, "").length),
    selection: () => caret?.selection || "",
    /** The line she typed "/" on is where the caret is. */
    focus(where = {}) { focusAfterRender(where.at !== undefined || where.card !== undefined ? where : { segment: where.segment || "first", end: where.end }); },
    redraw: () => render(),
    /** Tell the screen the text changed (after a piece action set it). */
    notify: () => emit(),
    tell(words, undo = null) {
      status.textContent = "";
      requestAnimationFrame(() => { status.textContent = words; });
      undoSlot.replaceChildren(undo ? h("action-button", { variant: "secondary", size: "sm", class: "studio-piece-undo-button", onClick: () => undo() }, say("did.undo")) : "");
    },
    clearUndo: () => undoSlot.replaceChildren(),
    /** Show a place in the text: select it in its box, or open the card it is in (Suggestions' Show me). */
    reveal(start, end = start) {
      if (host.asWritten?.()) {
        const area = list.querySelector("textarea");
        area?.focus();
        area?.setSelectionRange(start, end);
        return;
      }
      const index = blocks.findIndex((block, i) => block.source !== "" && offsetOf(i) <= start && start <= offsetOf(i) + block.source.length);
      const block = blocks[index];
      if (!block) return;
      if (block.type === "words") {
        const area = [...list.querySelectorAll("textarea")].find((a) => a.dataset.index === String(index));
        if (!area) return;
        area.focus();
        area.setSelectionRange(start - offsetOf(index), Math.min(area.value.length, end - offsetOf(index)));
        return;
      }
      const el = list.querySelector(`[data-card-index="${index}"]`);
      el?.focus();
      const form = cardForm(block, host.pieces?.() || []);
      if (form) host.card(box, "change", { ...block, start: offsetOf(index), form }, el);
    },
    /** Run `fn` with the text as `next` (for See it in your post), then put it back without drawing. */
    with(next, fn) { const was = text; text = next; try { return fn(); } finally { text = was; } },
  };
  render();
  return box;
}
