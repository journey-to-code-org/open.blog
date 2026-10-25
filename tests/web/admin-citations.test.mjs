import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  Editor,
  citationAt,
  citationChip,
  citationDraftPayload,
  citationFailure,
  citationLocatorsFromPassage,
  citationSourceChoices,
  citationSpans,
  createCitationForm,
  formatCitationText,
  insertCitationText,
  parseCitationText,
  validateCitationDraft,
} from "../../web/admin/admin.js";

const admin = readFileSync(new URL("../../web/admin/admin.js", import.meta.url), "utf8");
const styles = readFileSync(new URL("../../web/admin/admin.css", import.meta.url), "utf8");

// ---------------------------------------------------------------- DOM shim

class DomNode {
  static ELEMENT_NODE = 1;
  static TEXT_NODE = 3;

  constructor(tag, owner) {
    this.text = tag === "#text";
    this.nodeType = this.text ? 3 : 1;
    this.tagName = this.text ? "#text" : tag.toUpperCase();
    this.owner = owner;
    this.childNodes = [];
    this.parentNode = null;
    this.attributes = {};
    this.dataset = {};
    this.listeners = {};
    this.className = "";
    this.hidden = false;
    this.disabled = false;
    this.selected = false;
    this.checked = false;
    this.open = false;
    this.nodeValue = "";
    this._value = undefined;
    this.classList = { contains: (name) => this.className.split(/\s+/).includes(name) };
  }
  get children() {
    return this.childNodes.filter((node) => node.nodeType === 1);
  }
  get parentElement() {
    return this.parentNode;
  }
  get value() {
    if (this.tagName === "SELECT" && this._value === undefined) return this.children.find((child) => child.selected)?.value ?? "";
    if (this.tagName === "OPTION" && this._value === undefined) return this.attributes.value ?? "";
    return this._value ?? "";
  }
  set value(value) {
    this._value = String(value);
    if (this.tagName === "SELECT") for (const option of this.children) option.selected = option.value === this._value;
  }
  get textContent() {
    return this.text ? this.nodeValue : this.childNodes.map((node) => node.textContent).join("");
  }
  set textContent(value) {
    if (this.text) this.nodeValue = String(value);
    else this.replaceChildren(this.owner.createTextNode(String(value)));
  }
  get isConnected() {
    for (let node = this; node; node = node.parentNode) if (node === this.owner.body) return true;
    return false;
  }
  adopt(node) {
    if (node.parentNode) node.parentNode.childNodes.splice(node.parentNode.childNodes.indexOf(node), 1);
    node.parentNode = this;
    return node;
  }
  append(...nodes) {
    for (const node of nodes.flat()) {
      if (node === null || node === undefined || node === false) continue;
      this.childNodes.push(this.adopt(node instanceof DomNode ? node : this.owner.createTextNode(String(node))));
    }
  }
  replaceChildren(...nodes) {
    for (const node of this.childNodes) node.parentNode = null;
    this.childNodes = [];
    this.append(...nodes);
  }
  replaceWith(node) {
    const parent = this.parentNode;
    const index = parent.childNodes.indexOf(this);
    parent.adopt(node);
    parent.childNodes.splice(index, 1, node);
    this.parentNode = null;
  }
  remove() {
    if (this.parentNode) this.parentNode.childNodes.splice(this.parentNode.childNodes.indexOf(this), 1);
    this.parentNode = null;
  }
  cloneNode(deep) {
    const copy = new DomNode(this.text ? "#text" : this.tagName.toLowerCase(), this.owner);
    Object.assign(copy, { nodeValue: this.nodeValue, className: this.className, attributes: { ...this.attributes }, dataset: { ...this.dataset }, id: this.id });
    if (deep) for (const child of this.childNodes) copy.append(child.cloneNode(true));
    return copy;
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === "id") this.id = String(value);
    if (name === "hidden") this.hidden = true;
    if (name.startsWith("data-")) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = String(value);
  }
  getAttribute(name) {
    return this.attributes[name] ?? null;
  }
  removeAttribute(name) {
    delete this.attributes[name];
  }
  contains(node) {
    for (let current = node; current; current = current.parentNode) if (current === this) return true;
    return false;
  }
  matches(selector) {
    if (this.text) return false;
    return selector.split(",").map((part) => part.trim()).some((part) => {
      if (part.startsWith("#")) return this.id === part.slice(1);
      if (part.startsWith(".")) return this.classList.contains(part.slice(1));
      const attribute = /^([a-z]*)\[([a-z-]+)\]$/.exec(part);
      if (attribute) {
        if (attribute[1] && this.tagName !== attribute[1].toUpperCase()) return false;
        return attribute[2] in this.attributes;
      }
      return this.tagName === part.toUpperCase();
    });
  }
  closest(selector) {
    for (let node = this; node; node = node.parentNode) if (node.matches?.(selector)) return node;
    return null;
  }
  querySelectorAll(selector) {
    const found = [];
    const visit = (node) => {
      for (const child of node.children) {
        if (child.matches(selector)) found.push(child);
        visit(child);
      }
    };
    visit(this);
    return found;
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
  addEventListener(name, listener) {
    (this.listeners[name] ||= []).push(listener);
  }
  dispatch(name, event = {}) {
    const payload = { type: name, target: this, currentTarget: this, preventDefault() {}, ...event };
    return Promise.all((this.listeners[name] || []).map((listener) => listener(payload)));
  }
  dispatchEvent(event) {
    this.dispatch(event.type, { target: this });
    return true;
  }
  focus() {
    this.owner.activeElement = this;
  }
  showModal() {
    this.open = true;
  }
  close() {
    this.open = false;
  }
}

function installDom() {
  const previous = { Node: globalThis.Node, document: globalThis.document, HTMLElement: globalThis.HTMLElement };
  const documentShim = {
    activeElement: null,
    createElement: (tag) => new DomNode(tag, documentShim),
    createTextNode: (text) => Object.assign(new DomNode("#text", documentShim), { nodeValue: String(text) }),
  };
  documentShim.body = new DomNode("body", documentShim);
  globalThis.Node = DomNode;
  globalThis.HTMLElement = DomNode;
  globalThis.document = documentShim;
  return {
    document: documentShim,
    restore() {
      for (const [name, value] of Object.entries(previous)) {
        if (value === undefined) delete globalThis[name];
        else globalThis[name] = value;
      }
    },
  };
}

const withDom = (run) => async () => {
  const dom = installDom();
  try {
    await run(dom);
  } finally {
    dom.restore();
  }
};

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

function fakeApi(handler) {
  const calls = [];
  return {
    calls,
    async call(method, path, options = {}) {
      calls.push({ method, path, body: options.json });
      return handler(method, path, options.json);
    },
  };
}

function textarea(value, start = value.length, end = start) {
  const events = [];
  return {
    value,
    selectionStart: start,
    selectionEnd: end,
    events,
    focused: false,
    setSelectionRange(from, to) {
      this.selectionStart = from;
      this.selectionEnd = to;
    },
    focus() {
      this.focused = true;
      if (globalThis.document) globalThis.document.activeElement = this;
    },
    dispatchEvent(event) {
      events.push(event.type);
      return true;
    },
  };
}

const SOURCES = () => [
  { id: "plato-republic", kind: "work", title: "Πολιτεία", creators: [{ name: "Plato" }] },
  { id: "slings-2003", kind: "edition", of: "plato-republic", title: "Platonis Rempublicam", creators: [{ name: "S. R. Slings" }] },
  { id: "old-edition", kind: "edition", title: "Old", archived: true },
];
const PASSAGES = () => [
  { id: "passage-1", source: "slings-2003", preview: "ὁ δὲ Σωκράτης <b>", locators: [{ kind: "page", value: "514", to: "520" }, { kind: "canonical", value: "514a" }] },
];
const STATE = (over = {}) => ({ revision: "rev-1", sources: SOURCES(), passages: PASSAGES(), notebookAvailable: true, ...over });
const byId = (root, id) => root.querySelectorAll("*").find((node) => node.id === id) || root.querySelector(`#${id}`);
const control = (form, name) => form.element.querySelector(`#oba-citation-${name}`);
const type = (node, value) => {
  node.value = value;
  return node.dispatch("input", { target: node });
};
const choose = (node, value) => {
  node.value = value;
  return node.dispatch("change", { target: node });
};

// ---------------------------------------------------------------- Markdown helpers

test("citation spans skip code, escapes, links and definitions, and keep Unicode offsets", () => {
  const markdown = [
    "Intro [@slings-2003, page 5] and `[@code]` and \\[@escaped] and [@link](https://example.com) and [@ref][r].",
    "```",
    "[@fenced]",
    "```",
    "[@def]: https://example.com",
    "Πολιτεία [@plato-republic, section Βιβλίον ζ] 🙂 [@Bad Key]",
  ].join("\n");
  const spans = citationSpans(markdown);
  assert.deepEqual(spans.map((span) => span.text), ["[@slings-2003, page 5]", "[@plato-republic, section Βιβλίον ζ]", "[@Bad Key]"]);
  for (const span of spans) assert.equal(markdown.slice(span.start, span.end), span.text);
  const inside = markdown.indexOf("page 5");
  assert.equal(citationAt(markdown, inside)?.text, "[@slings-2003, page 5]");
  const after = markdown.indexOf("] and `") + 1;
  assert.equal(citationAt(markdown, after), null, "a caret just after a citation inserts a new one");
  assert.equal(citationAt(markdown, spans[0].start, spans[0].end)?.text, spans[0].text);
  assert.equal(citationAt(markdown, markdown.indexOf("[@code]") + 3), null);
});

test("citation text parses to parts and formats back, with ranges and Unicode", () => {
  for (const text of ["[@plato-republic]", "[@slings-2003, page 514 to 520; canonical 514a; section Βιβλίον ζ]", "[@x, x-stephanus 514a]"]) {
    assert.equal(formatCitationText(parseCitationText(text)), text);
  }
  assert.deepEqual(parseCitationText("[@slings-2003, page 514 to 520]"), { key: "slings-2003", locators: [{ kind: "page", value: "514", to: "520" }] });
  assert.equal(parseCitationText("[see](x)"), null);
  assert.equal(parseCitationText("[@a] tail"), null);
});

test("a passage's locators are copied as kind, value and end only", () => {
  const passage = { ...PASSAGES()[0], locators: [{ kind: "page", value: "514", hint: true, privateNote: "no" }, { kind: "canonical", value: "514a", to: "520a", scan: "p1.png" }, { kind: 5 }] };
  assert.deepEqual(citationLocatorsFromPassage(passage), [{ kind: "page", value: "514" }, { kind: "canonical", value: "514a", to: "520a" }]);
  assert.deepEqual(citationDraftPayload({ source: "slings-2003", locators: "page: 514 to 520\ncanonical: 514a" }), {
    key: "slings-2003",
    locators: [{ kind: "page", value: "514", to: "520" }, { kind: "canonical", value: "514a" }],
  });
});

test("inserting changes only the insertion point, and replacing changes only the edited citation", () => {
  const draft = "Claim one[^1] and a claim.\n\n[^1]: A hand-written footnote [@not-touched].\n";
  const at = draft.indexOf(" and");
  const inserted = insertCitationText(draft, at, at, "[@slings-2003, page 5]");
  assert.equal(inserted.value, "Claim one[^1] [@slings-2003, page 5] and a claim.\n\n[^1]: A hand-written footnote [@not-touched].\n");
  assert.equal(inserted.start, at + " [@slings-2003, page 5]".length);
  assert.equal(inserted.start, inserted.end);
  const afterSpace = insertCitationText("A claim ", 8, 8, "[@x]");
  assert.equal(afterSpace.value, "A claim [@x]");
  const selected = insertCitationText("Keep this selected.", 5, 18, "[@x]");
  assert.equal(selected.value, "Keep this selected [@x].", "the selected text stays and the citation follows it");
  const span = citationSpans(draft).find((item) => item.text === "[@not-touched]");
  const replaced = insertCitationText(draft, span.start + 3, span.start + 3, "[@slings-2003]", span);
  assert.equal(replaced.value, draft.replace("[@not-touched]", "[@slings-2003]"));
});

test("advisory validation and failure messages point at the right field", () => {
  assert.equal(validateCitationDraft({ source: "", locators: "" }, SOURCES()).field, "source");
  assert.equal(validateCitationDraft({ source: "gone", locators: "" }, SOURCES()).field, "source");
  assert.equal(validateCitationDraft({ source: "slings-2003", locators: "page 5" }, SOURCES()).field, "locators");
  assert.equal(validateCitationDraft({ source: "slings-2003", locators: Array(9).fill("line: 1").join("\n") }, SOURCES()).field, "locators");
  assert.equal(validateCitationDraft({ source: "slings-2003", locators: "page: 5" }, SOURCES()), null);
  assert.equal(citationFailure(new ApiError("x", 422, { diagnostics: [{ code: "unknown-key", message: "no source" }] })).field, "source");
  assert.equal(citationFailure(new ApiError("x", 422, { diagnostics: [{ code: "ambiguous-locator", message: "page on a work" }] })).field, "locators");
  assert.equal(citationFailure(new ApiError("x", 409, { error: "changed" })).field, "source");
  assert.match(citationFailure(new Error("offline")).message, /draft is unchanged/);
  const choices = citationSourceChoices(SOURCES(), "", "").map((source) => source.id);
  assert.deepEqual(choices, ["slings-2003", "plato-republic"], "archived sources are not offered");
  assert.deepEqual(citationSourceChoices(SOURCES(), "", "old-edition").map((source) => source.id).sort(), ["old-edition", "plato-republic", "slings-2003"]);
  assert.deepEqual(citationSourceChoices(SOURCES(), "πολι").map((source) => source.id), ["plato-republic"]);
});

// ---------------------------------------------------------------- visual round trips

function visualEditor(markdown) {
  const editor = Object.create(Editor.prototype);
  editor.ui = { body: textarea(markdown), richBody: document.createElement("div") };
  editor.editorMode = "visual";
  editor.visualDirty = false;
  editor.renderRichEditor();
  return editor;
}

test("visual mode keeps generated and hand-written citations byte for byte", withDom(() => {
  const markdown = [
    "# Title [@plato-republic]",
    "",
    "Claim [@slings-2003, page 514 to 520; canonical 514a] and _quiet [@x-1, section Βιβλίον ζ]_ text.",
    "",
    "- item [@Bad Key]",
    "- two",
    "",
    "> quote [@q]",
    "",
    "Escaped \\[@not-a-citation\\] stays text.",
    "",
    "A footnote[^1].",
    "",
    "[^1]: Manual [@inside-footnote].",
    "",
  ].join("\n");
  const editor = visualEditor(markdown);
  const chips = editor.ui.richBody.querySelectorAll(".oba-citation");
  assert.deepEqual(chips.map((chip) => chip.dataset.citation), ["[@plato-republic]", "[@slings-2003, page 514 to 520; canonical 514a]", "[@x-1, section Βιβλίον ζ]", "[@Bad Key]", "[@q]"]);
  for (const chip of chips) {
    assert.equal(chip.getAttribute("contenteditable"), "false");
    assert.equal(chip.getAttribute("role"), "button");
    assert.equal(chip.getAttribute("tabindex"), "0");
    assert.match(chip.getAttribute("aria-label"), /^Citation .+Press Enter to edit\.$/);
  }
  assert.equal(editor.richEditorMarkdown(), markdown.replace(/\n\n$/, "\n"));
}));

test("a pasted look-alike chip cannot smuggle Markdown into the draft", withDom(() => {
  const editor = visualEditor("Text.\n");
  const paragraph = editor.ui.richBody.children[0];
  const fake = citationChip("[@ok]");
  fake.setAttribute("data-citation", "[@x](javascript:alert(1))");
  fake.textContent = "[@x](javascript:alert(1))";
  paragraph.append(" ", fake);
  assert.equal(editor.richEditorMarkdown(), "Text. \\[@x\\](javascript:alert(1))\n");
}));

// ---------------------------------------------------------------- applying and undoing

test("inserting in Markdown mode and undoing restores the exact draft and caret", withDom(() => {
  const draft = "First claim.\n\nSecond[^n] claim.\n\n[^n]: Manual note.\n";
  const editor = Object.create(Editor.prototype);
  editor.editorMode = "markdown";
  editor.ui = { body: textarea(draft, 5, 11), citationUndo: { hidden: true }, citationStatus: { textContent: "" } };
  const target = editor.citationTarget();
  assert.deepEqual([target.start, target.end, target.span], [5, 11, null]);
  assert.equal(editor.applyCitation(target, "[@slings-2003, page 5]"), true);
  assert.equal(editor.ui.body.value, "First claim [@slings-2003, page 5].\n\nSecond[^n] claim.\n\n[^n]: Manual note.\n");
  assert.equal(editor.ui.body.selectionStart, "First claim [@slings-2003, page 5]".length);
  assert.equal(editor.ui.citationUndo.hidden, false);
  assert.equal(editor.citationUndoAvailable(), true);
  assert.equal(editor.undoCitation(), true);
  assert.equal(editor.ui.body.value, draft);
  assert.deepEqual([editor.ui.body.selectionStart, editor.ui.body.selectionEnd], [5, 11]);
  assert.equal(editor.ui.citationUndo.hidden, true);
  assert.deepEqual(editor.ui.body.events, ["input", "input"]);
}));

test("undo refuses once the draft changed after the citation", withDom(() => {
  const editor = Object.create(Editor.prototype);
  editor.editorMode = "markdown";
  editor.ui = { body: textarea("Claim.", 5), citationStatus: { textContent: "" } };
  editor.applyCitation(editor.citationTarget(), "[@x]");
  editor.ui.body.value += " more";
  assert.equal(editor.citationUndoAvailable(), false);
  assert.equal(editor.undoCitation(), false);
  assert.equal(editor.ui.body.value, "Claim [@x]. more");
  assert.match(editor.ui.citationStatus.textContent, /draft changed/);
}));

test("editing a citation chip in Visual mode replaces only it, and undo restores the editor", withDom((dom) => {
  const markdown = "Claim [@plato-republic] here and [@manual, page 2].\n";
  const editor = visualEditor(markdown);
  editor.ui.citationStatus = { textContent: "" };
  editor.ui.body.value = markdown;
  const chip = editor.ui.richBody.querySelectorAll(".oba-citation")[0];
  chip.focus();
  const target = editor.citationTarget(chip);
  assert.equal(target.chip, chip);
  assert.equal(editor.applyCitation(target, "[@slings-2003, page 514]"), true);
  assert.equal(editor.ui.body.value, "Claim [@slings-2003, page 514] here and [@manual, page 2].\n");
  assert.equal(editor.undoCitation(), true);
  assert.equal(editor.ui.body.value, markdown);
  assert.equal(editor.richEditorMarkdown(), markdown);
  assert.equal(dom.document.activeElement?.dataset?.citation, "[@plato-republic]", "focus returns to the restored chip");
}));

test("a malformed server reply never changes the draft", withDom(() => {
  const editor = Object.create(Editor.prototype);
  editor.editorMode = "markdown";
  editor.ui = { body: textarea("Claim."), citationStatus: { textContent: "" } };
  assert.equal(editor.applyCitation(editor.citationTarget(), "[@x](javascript:alert(1))"), false);
  assert.equal(editor.ui.body.value, "Claim.");
}));

// ---------------------------------------------------------------- the picker

test("the picker searches by keyboard, copies passage locators, and checks with the server", withDom(async () => {
  const api = fakeApi(() => ({ revision: "rev-1", markdown: "[@slings-2003, page 514 to 520; canonical 514a]" }));
  const inserted = [];
  const form = createCitationForm({ api, state: STATE(), onInsert: (result) => inserted.push(result) });
  document.body.append(form.element);
  form.focus();
  const search = control(form, "search");
  assert.equal(document.activeElement, search);
  for (const name of ["search", "source", "passage", "locators"]) {
    const input = control(form, name);
    assert.ok(form.element.querySelectorAll("label").some((label) => label.getAttribute("for") === input.id), `${name} is labelled`);
  }
  const sources = control(form, "source");
  assert.deepEqual(sources.children.map((option) => option.value), ["slings-2003", "plato-republic"]);
  await type(search, "Πολι");
  assert.deepEqual(sources.children.map((option) => option.value), ["plato-republic"]);
  await type(search, "");
  await choose(control(form, "passage"), "passage-1");
  assert.equal(sources.value, "slings-2003");
  assert.equal(control(form, "locators").value, "page: 514 to 520\ncanonical: 514a");
  assert.equal(byId(form.element, "oba-citation-preview").textContent, "[@slings-2003, page 514 to 520; canonical 514a]");
  assert.ok(!form.element.textContent.includes("<b>") || form.element.querySelectorAll("b").length === 0, "passage previews are text");
  await form.element.dispatch("submit");
  assert.deepEqual(api.calls, [{ method: "POST", path: "citations/check", body: { revision: "rev-1", citation: { key: "slings-2003", locators: [{ kind: "page", value: "514", to: "520" }, { kind: "canonical", value: "514a" }] } } }]);
  assert.equal(inserted[0].markdown, "[@slings-2003, page 514 to 520; canonical 514a]");
}));

test("a stale library keeps the author's choices and shows the refreshed sources", withDom(async () => {
  let attempt = 0;
  const api = fakeApi(() => {
    attempt += 1;
    if (attempt === 1) throw new ApiError("conflict", 409, { error: "The source library changed after the citation picker opened.", revision: "rev-2", sources: [...SOURCES(), { id: "new-source", kind: "work", title: "Newer" }] });
    return { revision: "rev-2", markdown: "[@slings-2003, page 5]" };
  });
  const state = STATE();
  const inserted = [];
  const form = createCitationForm({ api, state, initial: { key: "slings-2003", locators: [{ kind: "page", value: "5" }] }, onInsert: (result) => inserted.push(result) });
  document.body.append(form.element);
  assert.equal(form.element.querySelector("[data-citation-insert]").textContent, "Update citation");
  await form.element.dispatch("submit");
  assert.equal(inserted.length, 0);
  assert.equal(state.revision, "rev-2");
  const error = byId(form.element, "oba-citation-error");
  assert.equal(error.hidden, false);
  assert.equal(error.getAttribute("role"), "alert");
  assert.match(error.textContent, /changed/);
  const sources = control(form, "source");
  assert.equal(document.activeElement, sources);
  assert.equal(sources.getAttribute("aria-invalid"), "true");
  assert.ok(sources.children.some((option) => option.value === "new-source"));
  assert.equal(sources.value, "slings-2003");
  assert.equal(control(form, "locators").value, "page: 5");
  await form.element.dispatch("submit");
  assert.equal(api.calls[1].body.revision, "rev-2");
  assert.equal(inserted.length, 1);
}));

test("server diagnostics are scoped to a field and nothing is inserted", withDom(async () => {
  const api = fakeApi(() => {
    throw new ApiError("invalid", 422, { diagnostics: [{ code: "ambiguous-locator", message: "a page needs an edition", key: "plato-republic" }] });
  });
  const inserted = [];
  const form = createCitationForm({ api, state: STATE(), onInsert: (result) => inserted.push(result) });
  document.body.append(form.element);
  await choose(control(form, "source"), "plato-republic");
  await type(control(form, "locators"), "page: 5");
  await form.element.dispatch("submit");
  assert.equal(inserted.length, 0);
  assert.equal(control(form, "locators").getAttribute("aria-invalid"), "true");
  assert.equal(document.activeElement, control(form, "locators"));
  assert.match(byId(form.element, "oba-citation-error").textContent, /page needs an edition/);
}));

test("advisory checks run before any request, and Cancel leaves everything alone", withDom(async () => {
  const api = fakeApi(() => assert.fail("no request expected"));
  let cancelled = 0;
  const form = createCitationForm({ api, state: STATE({ notebookAvailable: false, passages: [] }), onCancel: () => { cancelled += 1; } });
  document.body.append(form.element);
  assert.ok(form.element.querySelector("[data-citation-notebook]"), "an unreadable notebook is explained");
  await form.element.dispatch("submit");
  assert.equal(api.calls.length, 0);
  assert.equal(document.activeElement, control(form, "source"));
  await form.element.querySelector("[data-citation-cancel]").dispatch("click");
  assert.equal(cancelled, 1);
}));

test("the editor dialog reopens a citation under the caret, replaces only it, and returns focus", withDom(async (dom) => {
  const draft = "See [@plato-republic, canonical 514a] and more.";
  const caret = draft.indexOf("canonical");
  const editor = Object.create(Editor.prototype);
  editor.editorMode = "markdown";
  editor.ui = { body: textarea(draft, caret), citationStatus: { textContent: "" } };
  editor.captureVisualSelection = () => {};
  editor.app = {
    api: fakeApi((method, path) => {
      if (path === "citations/library") return { revision: "rev-1", sources: SOURCES(), passages: [], notebookAvailable: true };
      return { revision: "rev-1", markdown: "[@plato-republic, canonical 514b]" };
    }),
  };
  await editor.openCitationDialog();
  const dialog = dom.document.body.querySelector(".oba-citation-dialog");
  assert.equal(dialog.open, true);
  assert.equal(dialog.querySelector("h2").textContent, "Edit citation");
  const locators = dialog.querySelector("#oba-citation-locators");
  assert.equal(locators.value, "canonical: 514a");
  locators.value = "canonical: 514b";
  await locators.dispatch("input", { target: locators });
  await dialog.querySelector("form").dispatch("submit");
  assert.equal(dialog.isConnected, false);
  assert.equal(editor.ui.body.value, "See [@plato-republic, canonical 514b] and more.");
  assert.equal(editor.ui.body.focused, true);

  // Escape cancels without touching the draft and restores the selection.
  editor.ui.body.setSelectionRange(2, 3);
  await editor.openCitationDialog();
  const again = dom.document.body.querySelector(".oba-citation-dialog");
  assert.equal(again.querySelector("h2").textContent, "Insert citation");
  await again.dispatch("cancel");
  assert.equal(again.isConnected, false);
  assert.equal(editor.ui.body.value, "See [@plato-republic, canonical 514b] and more.");
  assert.deepEqual([editor.ui.body.selectionStart, editor.ui.body.selectionEnd], [2, 3]);
  await tick();
}));

test("citation code builds DOM safely and its styles keep focus visible without motion", () => {
  const start = admin.indexOf("// ---------------------------------------------------------------- citations");
  const end = admin.indexOf(" * The capture form shared by");
  const dialog = admin.slice(admin.indexOf("  citationTarget(chip = null) {"), admin.indexOf("  sayCitation(message) {"));
  for (const code of [admin.slice(start, end), dialog]) assert.doesNotMatch(code, /innerHTML|insertAdjacentHTML|outerHTML|createContextualFragment/);
  assert.match(dialog, /showModal\(\)/);
  assert.match(dialog, /addEventListener\("cancel"[\s\S]*returnToDraft\(\)/);
  const css = styles.slice(styles.indexOf("/* Citations in the visual editor"));
  assert.match(css, /:focus-visible/);
  assert.doesNotMatch(css, /transition|animation/);
});
