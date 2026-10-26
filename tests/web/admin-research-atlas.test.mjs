import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ObAdmin,
  atlasBuildText,
  atlasConfidenceText,
  atlasDatesText,
  atlasDiagnosticControl,
  atlasDissentDraft,
  atlasEndpointChoices,
  atlasEntryDraft,
  atlasEntryPayload,
  atlasErrorMessage,
  atlasEvidenceDraft,
  atlasEvidenceText,
  atlasFilterEntries,
  atlasRelationshipDraft,
  atlasRelationshipPayload,
  atlasRelationshipSentence,
  atlasStandingText,
  normalizeAdminPreferences,
  rebaseAtlasRelationshipDraft,
  safeDecodeURIComponent,
  suggestAtlasId,
  validAtlasId,
  validateAtlasEntryDraft,
  validateAtlasRelationshipDraft,
} from "../../web/admin/admin.js";

const admin = readFileSync(new URL("../../web/admin/admin.js", import.meta.url), "utf8");
const styles = readFileSync(new URL("../../web/admin/admin.css", import.meta.url), "utf8");
// ---------------------------------------------------------------- DOM shim

class DomNode {
  constructor(tag = "", owner = null) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.parent = null;
    this.attributes = {};
    this.listeners = {};
    this.dataset = {};
    this.style = {};
    this.owner = owner;
    this.hidden = false;
    this.disabled = false;
    this.checked = false;
    this.selected = false;
    this.open = false;
    this._text = "";
    this._value = undefined;
    this.classList = { contains: (name) => (this.className || "").split(/\s+/).includes(name) };
  }
  get value() {
    if (this.tagName === "SELECT" && this._value === undefined) return this.children.find((child) => child.selected)?.value ?? this.children[0]?.value ?? "";
    return this._value ?? "";
  }
  set value(value) {
    this._value = String(value);
  }
  append(...children) {
    for (const child of children.flat()) {
      if (child === null || child === undefined || child === false) continue;
      const node = child instanceof DomNode ? child : Object.assign(new DomNode("#text"), { textContent: String(child) });
      node.parent?.children.splice(node.parent.children.indexOf(node), 1);
      node.parent = this;
      this.children.push(node);
    }
  }
  replaceChildren(...children) {
    for (const child of this.children) child.parent = null;
    this.children = [];
    this.append(...children);
  }
  remove() {
    if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = null;
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === "id") this.id = String(value);
    if (name === "hidden") this.hidden = true;
    if (name.startsWith("data-")) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = String(value);
  }
  contains(node) {
    for (let current = node; current; current = current.parent) if (current === this) return true;
    return false;
  }
  removeAttribute(name) {
    delete this.attributes[name];
  }
  get isConnected() {
    for (let node = this; node; node = node.parent) if (node === this.owner?.body) return true;
    return false;
  }
  getAttribute(name) {
    return this.attributes[name] ?? null;
  }
  addEventListener(name, listener, options = {}) {
    (this.listeners[name] ||= []).push({ listener, once: Boolean(options.once) });
  }
  dispatch(name, event = {}) {
    const listeners = this.listeners[name] || [];
    this.listeners[name] = listeners.filter((entry) => !entry.once);
    const payload = { type: name, target: this, currentTarget: this, preventDefault() {}, ...event };
    return Promise.all(listeners.map((entry) => entry.listener(payload)));
  }
  click() {
    if (this.disabled) return Promise.resolve();
    return this.dispatch("click");
  }
  focus() {
    this.owner.activeElement = this;
  }
  showModal() {
    this.open = true;
  }
  close() {
    if (!this.open) return;
    this.open = false;
    // Browsers queue the close event as a task, after the code that closed the dialog.
    setTimeout(() => this.dispatch("close"), 0);
  }
  set textContent(value) {
    this.children = [];
    this._text = String(value);
  }
  get textContent() {
    return this._text + this.children.map((child) => child.textContent).join("");
  }
  matches(selector) {
    if (selector.startsWith("#")) return this.id === selector.slice(1);
    if (selector.startsWith(".")) return this.classList.contains(selector.slice(1));
    const attribute = selector.match(/^([a-z]*)\[([a-z-]+)\]$/);
    if (attribute) {
      const [, tag, name] = attribute;
      if (tag && this.tagName !== tag.toUpperCase()) return false;
      if (name === "open") return this.open;
      if (name.startsWith("data-")) return name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()) in this.dataset;
      return name in this.attributes;
    }
    return this.tagName === selector.toUpperCase();
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
}

function installDom() {
  const previous = { Node: globalThis.Node, document: globalThis.document, location: globalThis.location, open: globalThis.open, localStorage: globalThis.localStorage };
  const documentShim = {
    activeElement: null,
    documentElement: { dataset: {} },
    title: "",
    createElement: (tag) => new DomNode(tag, documentShim),
    createTextNode: (text) => Object.assign(new DomNode("#text", documentShim), { textContent: String(text) }),
    querySelector: (selector) => documentShim.body.querySelector(selector),
  };
  documentShim.body = new DomNode("body", documentShim);
  globalThis.Node = DomNode;
  globalThis.document = documentShim;
  globalThis.location = { hash: "#/overview" };
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

// ---------------------------------------------------------------- fixtures

class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

const HOSTILE = '<img src=x onerror="alert(1)"> Πλάτων 🙂 <script>alert(2)</script>';
const ANY = ["person", "work", "concept", "movement", "event"];
const KINDS = () => ({
  entries: ANY,
  relationships: [
    { kind: "authored", inverse: "authored by", from: ["person"], to: ["work"], symmetric: false, sameKind: false, acyclic: false },
    { kind: "influenced", inverse: "influenced by", from: ANY, to: ANY, symmetric: false, sameKind: false, acyclic: false },
    { kind: "member-of", inverse: "has member", from: ["person"], to: ["movement"], symmetric: false, sameKind: false, acyclic: false },
    { kind: "part-of", inverse: "has part", from: ["work", "concept", "movement", "event"], to: ["work", "concept", "movement", "event"], symmetric: false, sameKind: true, acyclic: true },
    { kind: "specializes", inverse: "generalized by", from: ["concept"], to: ["concept"], symmetric: false, sameKind: false, acyclic: true },
    { kind: "related-to", inverse: "related to", from: ANY, to: ANY, symmetric: true, sameKind: false, acyclic: false },
  ],
});
const SOURCES = () => [
  { id: "plato-republic", kind: "work", title: "Πολιτεία" },
  { id: "slings-2003", kind: "edition", of: "plato-republic", title: "Platonis Rempublicam" },
  { id: "gone", kind: "work", title: "Gone", archived: true },
];
const PASSAGES = () => [{ id: "passage-1", source: "slings-2003", locators: [{ kind: "page", value: "514" }], preview: "the cave" }];
const ENTRIES = () => [
  { id: "plato", kind: "person", label: HOSTILE, aliases: ["Aristocles"], visibility: "private", shelf: 1 },
  { id: "politeia", kind: "work", label: "Politeia", source: "plato-republic", dates: [{ id: "politeia-composed", aspect: "composition", date: { notBefore: { year: -380, circa: true } }, assertedBy: { kind: "author" }, unsourced: true, confidence: "tentative", visibility: "private", shelf: 2 }], visibility: "approved" },
  { id: "allegory", kind: "concept", label: "Allegory", visibility: "private" },
  { id: "academy", kind: "movement", label: "The Academy", visibility: "private" },
];
const RELATIONSHIP = () => ({
  id: "plato-authored-politeia",
  kind: "authored",
  from: "plato",
  to: "politeia",
  assertedBy: { kind: "author", why: "kept" },
  confidence: "plausible",
  evidence: [{ source: "slings-2003", locators: [{ kind: "page", value: "514", hint: true }], margin: "kept" }],
  uncertainty: "The dating is unsettled.",
  contestedBy: [{ by: { kind: "named", name: "A later editor" }, note: "Doubts the attribution.", tag: "kept" }],
  visibility: "private",
  extra: 7,
});
const atlas = (over = {}) => ({
  file: ".openblog/private/research/atlas.json",
  revision: "r1",
  stored: true,
  entries: ENTRIES(),
  relationships: [RELATIONSHIP()],
  notices: [],
  missingConcepts: [],
  kinds: KINDS(),
  sources: SOURCES(),
  passages: PASSAGES(),
  ...over,
});
const EXPLORE = {
  plato: () => ({ revision: "r1", entry: ENTRIES()[0], outgoing: [{ label: "authored", other: { id: "politeia", kind: "work", label: "Politeia" }, standing: "contested", projected: false, relationship: RELATIONSHIP() }], incoming: [], notes: [] }),
  politeia: () => ({ revision: "r1", entry: ENTRIES()[1], outgoing: [], incoming: [{ label: "authored by", other: { id: "plato", kind: "person", label: HOSTILE }, standing: "contested", projected: false, relationship: RELATIONSHIP() }], notes: [] }),
  allegory: () => ({ revision: "r1", entry: ENTRIES()[2], outgoing: [], incoming: [], notes: [{ id: "note-2", kind: "question", preview: "Why a cave?" }] }),
  academy: () => ({ revision: "r1", entry: ENTRIES()[3], outgoing: [], incoming: [], notes: [] }),
};

function atlasApi(handlers = {}) {
  const calls = [];
  const all = {
    "GET research/atlas": () => atlas(),
    "POST research/atlas/explore": (body) => {
      const found = EXPLORE[body.id];
      if (!found) throw new ApiError("missing", 404, { error: "No atlas entry has this id", missing: true });
      return found();
    },
    ...handlers,
  };
  return {
    calls,
    async call(method, path, options = {}) {
      if (method !== "GET" && path !== "research/atlas/explore") calls.push({ method, path, body: structuredClone(options.json) });
      const handler = all[`${method} ${path}`];
      if (!handler) throw new ApiError(`unexpected ${method} ${path}`, 500, null);
      return handler(options.json);
    },
  };
}

function mountAtlas(api) {
  const app = new ObAdmin();
  const root = new DomNode("div", globalThis.document);
  app.api = api;
  app.meta = { siteTitle: "Blog" };
  app.preferences = normalizeAdminPreferences({ preset: "advanced" });
  app.replaceChildren = (...nodes) => root.replaceChildren(...nodes);
  return { app, root };
}

const byId = (root, id) => root.querySelector(`#${id}`);
const type = async (control, value, event = "input") => {
  control.value = value;
  await control.dispatch(event, { target: control });
};
const choose = (control, value) => type(control, value, "change");
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const submit = (root) => root.querySelector("form").dispatch("submit");
const buttonLabelled = (root, text) => root.querySelectorAll("button").find((button) => button.textContent === text);
const entryIds = (root) => root.querySelectorAll("button").filter((button) => button.dataset.atlasEntry).map((button) => button.dataset.atlasEntry);
const options = (select) => select.children.map((option) => option.value).filter(Boolean);
const optionText = (select) => select.children.map((option) => option.textContent);

// ---------------------------------------------------------------- pure helpers

test("entries filter by kind and by any word of the id, label or other names", () => {
  const entries = ENTRIES();
  assert.deepEqual(atlasFilterEntries(entries, { kind: "work" }).map((entry) => entry.id), ["politeia"]);
  assert.deepEqual(atlasFilterEntries(entries, { query: "aristocles" }).map((entry) => entry.id), ["plato"]);
  assert.deepEqual(atlasFilterEntries(entries, { query: "  ΠΛΆΤΩΝ " }).map((entry) => entry.id), ["plato"]);
  assert.deepEqual(atlasFilterEntries(entries, { query: "the academy" }).map((entry) => entry.id), ["academy"]);
  assert.deepEqual(atlasFilterEntries(entries, { query: "academy", kind: "person" }), []);
  assert.equal(atlasFilterEntries(entries, {}).length, 4);
});

test("endpoint pickers offer only the entry kinds a relationship kind may join", () => {
  const entries = ENTRIES();
  const ids = (list) => list.map((entry) => entry.id);
  assert.deepEqual(ids(atlasEndpointChoices(KINDS(), "authored", "from", entries)), ["plato"]);
  assert.deepEqual(ids(atlasEndpointChoices(KINDS(), "authored", "to", entries)), ["politeia"]);
  assert.deepEqual(ids(atlasEndpointChoices(KINDS(), "member-of", "to", entries)), ["academy"]);
  // part-of joins two entries of one kind; the other end narrows the choice and is never offered itself.
  const work = entries[1];
  assert.deepEqual(ids(atlasEndpointChoices(KINDS(), "part-of", "to", [...entries, { id: "book-7", kind: "work", label: "Book 7" }], work)), ["book-7"]);
  assert.ok(!ids(atlasEndpointChoices(KINDS(), "influenced", "to", entries, entries[0])).includes("plato"), "no self-relationship");
  assert.equal(atlasEndpointChoices(KINDS(), "", "from", entries).length, 4, "with no kind, every entry");
});

test("identifiers are readable slugs that nothing uses yet", () => {
  assert.equal(suggestAtlasId("Théodore of Cyrene", []), "theodore-of-cyrene");
  assert.equal(suggestAtlasId("Πολιτεία", [], "work"), "work");
  assert.equal(suggestAtlasId("Plato", ["plato", "plato-2"]), "plato-3");
  assert.ok(suggestAtlasId("x".repeat(200)).length <= 64);
  assert.ok(validAtlasId("the-good") && !validAtlasId("The Good") && !validAtlasId("a--b") && !validAtlasId("x".repeat(65)));
});

test("standing is asserted or contested by named parties, and never consensus", () => {
  const sources = SOURCES();
  assert.equal(atlasStandingText({ contestedBy: [] }), "Asserted; no recorded dissent");
  const contested = atlasStandingText(RELATIONSHIP(), sources);
  assert.match(contested, /^Contested: 1 recorded dissent \(by A later editor\)$/);
  assert.match(atlasStandingText({ contestedBy: [{ by: { kind: "source", source: "plato-republic" } }, { by: { kind: "author" } }] }, sources), /2 recorded dissents \(by the source Πολιτεία; you \(the author\)\)/);
  for (const text of [contested, atlasConfidenceText({ confidence: "strong" }), atlasEvidenceText({ unsourced: true })]) {
    assert.doesNotMatch(text, /consensus|agreed|established|fact/i);
  }
  assert.match(atlasConfidenceText({}), /^Tentative confidence, as held by the asserting party$/);
  assert.equal(atlasEvidenceText({ unsourced: true }), "Unsourced draft: no evidence cited yet");
  assert.equal(atlasRelationshipSentence(RELATIONSHIP(), ENTRIES()), `${HOSTILE} authored Politeia`);
});

test("server diagnostics map to the control that fixes them", () => {
  assert.equal(atlasDiagnosticControl("dates[0].date.at.year", "entry"), "dates");
  assert.equal(atlasDiagnosticControl("visibility", "entry"), "approved");
  assert.equal(atlasDiagnosticControl("evidence[1].locators[0].kind", "relationship"), "evidence-1-locators");
  assert.equal(atlasDiagnosticControl("evidence", "relationship"), "evidence");
  assert.equal(atlasDiagnosticControl("assertedBy.name", "relationship"), "asserted-name");
  assert.equal(atlasDiagnosticControl("contestedBy[0].by.source", "relationship"), "dissent-0-source");
  assert.equal(atlasDiagnosticControl("contestedBy[2].evidence[0].passage", "relationship"), "dissent-2-evidence-0-passage");
  assert.equal(atlasDiagnosticControl("contestedBy[1]", "relationship"), "dissent-1");
  assert.equal(atlasDiagnosticControl("to", "relationship"), "to");
  const message = atlasErrorMessage({ data: { diagnostics: [{ code: "cycle", collection: "relationships", id: "a-b", field: "to", message: "part of a cycle" }] } });
  assert.equal(message, "Relationship a-b: to: part of a cycle");
});

test("payloads keep unknown fields at every level the form edits", () => {
  const entry = atlasEntryDraft(ENTRIES()[1]);
  entry.label = "  Republic ";
  const sent = atlasEntryPayload(entry);
  assert.deepEqual(sent.dates, ENTRIES()[1].dates, "datings, precision and unknown fields are carried over unchanged");
  assert.equal(sent.bounds, undefined);
  assert.equal(sent.label, "Republic");
  assert.equal(sent.source, "plato-republic");
  const person = atlasEntryDraft(ENTRIES()[0]);
  person.aliases = "Aristocles\n\n  Platon  ";
  assert.deepEqual(atlasEntryPayload(person).aliases, ["Aristocles", "Platon"]);
  assert.equal(atlasEntryPayload(person).shelf, 1);
  assert.equal(atlasEntryPayload(person).visibility, "private");

  const draft = atlasRelationshipDraft(RELATIONSHIP());
  const same = atlasRelationshipPayload(draft);
  assert.deepEqual(same, RELATIONSHIP(), "an untouched relationship round-trips exactly");
  draft.evidence[0].locators = "page: 515";
  draft.contestedBy[0].note = "Changed.";
  const edited = atlasRelationshipPayload(draft);
  assert.equal(edited.evidence[0].margin, "kept");
  assert.deepEqual(edited.evidence[0].locators, [{ kind: "page", value: "515" }]);
  assert.equal(edited.contestedBy[0].tag, "kept");
  assert.equal(edited.assertedBy.why, "kept");
  assert.equal(edited.extra, 7);
  const unsourced = atlasRelationshipDraft({ id: "r", kind: "influenced", from: "plato", to: "allegory", assertedBy: { kind: "author" }, unsourced: true });
  assert.equal(atlasRelationshipPayload(unsourced).unsourced, true);
  assert.equal(atlasRelationshipPayload(unsourced).evidence, undefined);
});

test("advisory checks name the first problem and the control for it", () => {
  const context = { entries: ENTRIES(), kinds: KINDS(), sources: SOURCES(), passages: PASSAGES() };
  const base = () => atlasRelationshipDraft({ id: "r", kind: "influenced", from: "plato", to: "allegory", assertedBy: { kind: "author" } });
  assert.equal(validateAtlasRelationshipDraft(atlasRelationshipDraft(null), context).field, "kind");
  const wrong = base();
  wrong.kind = "authored";
  wrong.to = "allegory";
  assert.equal(validateAtlasRelationshipDraft(wrong, context).field, "to");
  assert.equal(validateAtlasRelationshipDraft(base(), context).field, "evidence");
  const strong = base();
  strong.unsourced = true;
  strong.confidence = "strong";
  assert.equal(validateAtlasRelationshipDraft(strong, context).field, "confidence");
  const approved = base();
  approved.evidence = [atlasEvidenceDraft({ source: "slings-2003", passage: "passage-1" })];
  approved.approved = true;
  assert.match(validateAtlasRelationshipDraft(approved, context).message, /cannot point into your private notebook/);
  const mismatched = base();
  mismatched.evidence = [atlasEvidenceDraft({ source: "plato-republic", passage: "passage-1" })];
  assert.equal(validateAtlasRelationshipDraft(mismatched, context).field, "evidence-0-passage");
  const dissent = base();
  dissent.unsourced = true;
  dissent.contestedBy = [atlasDissentDraft({ by: { kind: "named", name: "X" } })];
  assert.equal(validateAtlasRelationshipDraft(dissent, context).field, "dissent-0-note");
  const named = base();
  named.unsourced = true;
  named.assertedBy.kind = "named";
  assert.equal(validateAtlasRelationshipDraft(named, context).field, "asserted-name");
  const ok = base();
  ok.unsourced = true;
  assert.equal(validateAtlasRelationshipDraft(ok, context), null);

  const entry = atlasEntryDraft(null, { kind: "person" });
  assert.equal(validateAtlasEntryDraft(entry, { creating: true }).field, "id");
  entry.id = "plato";
  assert.equal(validateAtlasEntryDraft(entry, { creating: true, used: ["plato"] }).field, "id");
  entry.id = "socrates";
  assert.equal(validateAtlasEntryDraft(entry, { creating: true }).field, "label");
  entry.label = "Socrates";
  assert.equal(validateAtlasEntryDraft(entry, { creating: true }), null);
});

test("the entry form names an entry's datings and keeps them, never flattening them to years", () => {
  assert.match(atlasDatesText(0), /^No datings\. /);
  assert.match(atlasDatesText(1), /^1 attributed dating, kept unchanged when you save\. /);
  assert.match(atlasDatesText(3), /^3 attributed datings, /);
  assert.match(atlasDatesText(2), /competing datings stay side by side/);
  assert.equal(atlasEntryDraft(ENTRIES()[1]).dates, 1);
  assert.equal(atlasEntryDraft(ENTRIES()[0]).dates, 0);
  assert.equal(atlasEntryPayload(atlasEntryDraft(ENTRIES()[0])).dates, undefined);
});

// ---------------------------------------------------------------- the atlas view

test("the atlas lists entries as text, searches them, and filters by kind", withDom(async () => {
  const { app, root } = mountAtlas(atlasApi());
  await app.showAtlas();
  assert.deepEqual(entryIds(root), ["plato", "politeia", "allegory", "academy"]);
  assert.equal(root.querySelectorAll("img").length + root.querySelectorAll("script").length, 0, "hostile labels render as text");
  assert.ok(root.textContent.includes("<img src=x"));
  assert.match(root.querySelector("[data-atlas-count]").textContent, /^4 entries, 1 relationship, 1 contested\.$/);
  await type(byId(root, "oba-atlas-search"), "aristocles");
  assert.deepEqual(entryIds(root), ["plato"]);
  assert.match(root.querySelector("[data-atlas-count]").textContent, /^1 of 4 entries shown/);
  await type(byId(root, "oba-atlas-search"), "");
  await choose(byId(root, "oba-atlas-kind-filter"), "movement");
  assert.deepEqual(entryIds(root), ["academy"]);
  await type(byId(root, "oba-atlas-search"), "plato");
  assert.match(root.textContent, /No entries match the search and kind/);
  assert.equal(byId(root, "oba-atlas-search").getAttribute("aria-controls"), "oba-atlas-entries");
}));

test("opening an entry moves focus to it and lists its relationships from its side, with labels", withDom(async () => {
  const { app, root } = mountAtlas(atlasApi());
  await app.showAtlas();
  await root.querySelectorAll("button").find((button) => button.dataset.atlasEntry === "politeia").click();
  await tick();
  assert.equal(globalThis.document.activeElement.id, "oba-atlas-heading");
  const explorer = root.querySelector("[data-atlas-explorer]");
  const incoming = explorer.querySelectorAll("section").find((section) => section.dataset.atlasDirection === "incoming");
  assert.match(incoming.textContent, /Incoming \(1\)/);
  assert.ok(incoming.textContent.includes(`Politeia authored by ${HOSTILE}`));
  assert.match(incoming.textContent, /Contested: 1 recorded dissent \(by A later editor\)/);
  assert.match(incoming.textContent, /Plausible confidence, as held by the asserting party/);
  assert.match(incoming.textContent, /Uncertain: The dating is unsettled\./);
  assert.match(incoming.textContent, /Rests on 1 piece of evidence/);
  assert.match(explorer.textContent, /Outgoing \(0\)/);
  assert.doesNotMatch(explorer.textContent, /consensus|agreed|established/i);
  assert.equal(explorer.querySelectorAll("img").length, 0);
  // Navigate along the relationship as text, from the keyboard.
  await buttonLabelled(explorer, `Explore ${HOSTILE}`).click();
  await tick();
  assert.equal(globalThis.document.activeElement.id, "oba-atlas-heading");
  assert.ok(root.querySelector("[data-atlas-explorer]").textContent.includes(`${HOSTILE} authored Politeia`));
  const edit = root.querySelector("[data-atlas-open-relationship]");
  assert.equal(edit.getAttribute("aria-label"), `Edit relationship: ${HOSTILE} authored Politeia`);
  await edit.click();
  assert.equal(globalThis.document.activeElement.id, "oba-atlas-heading");
  assert.equal(root.querySelector("[data-atlas-sentence]").textContent, `${HOSTILE} authored Politeia`);
  assert.equal(root.querySelector("p[data-atlas-standing]").dataset.atlasStanding, "contested");
}));

test("a concept lists the notebook notes that link it", withDom(async () => {
  const { app, root } = mountAtlas(atlasApi());
  await app.showAtlas("allegory");
  await tick();
  assert.equal(globalThis.document.activeElement.id, "oba-atlas-heading");
  const notes = root.querySelector("[data-atlas-notes]");
  assert.match(notes.textContent, /Notebook notes linking this concept \(1\)/);
  assert.match(notes.textContent, /Why a cave\? \(question, note-2\)/);
}));

test("creating an entry suggests an id, sends the revision, and focuses the saved entry", withDom(async () => {
  const api = atlasApi({
    "POST research/atlas/entries": (body) => ({ ...atlas({ revision: "r2", entries: [...ENTRIES(), body.entry] }), entry: body.entry }),
  });
  const { app, root } = mountAtlas(api);
  await app.showAtlas();
  await buttonLabelled(root, "New entry").click();
  assert.equal(globalThis.document.activeElement.id, "oba-atlas-heading");
  await choose(byId(root, "oba-atlas-entry-kind"), "person");
  await type(byId(root, "oba-atlas-entry-label"), "Socrates of Athens");
  assert.equal(byId(root, "oba-atlas-entry-id").value, "socrates-of-athens");
  assert.equal(byId(root, "oba-atlas-entry-from-year"), null, "years are no longer edited as bounds");
  assert.match(byId(root, "oba-atlas-entry-dates").textContent, /^No datings\./);
  await submit(root);
  assert.deepEqual(api.calls.map((call) => [call.method, call.path, call.body.revision]), [["POST", "research/atlas/entries", "r1"]]);
  assert.deepEqual(api.calls[0].body.entry, { id: "socrates-of-athens", kind: "person", label: "Socrates of Athens", visibility: "private" });
  await tick();
  assert.ok(entryIds(root).includes("socrates-of-athens"));
  assert.equal(globalThis.document.activeElement.id, "oba-atlas-heading");
  assert.equal(byId(root, "oba-atlas-heading").textContent, "Socrates of Athens");
  assert.match(root.textContent, /Entry saved to the private atlas/);
}));

test("a relationship is built with typed pickers, notebook evidence, and an explicit draft state", withDom(async () => {
  const api = atlasApi({
    "POST research/atlas/relationships": (body) => ({ ...atlas({ revision: "r2", relationships: [RELATIONSHIP(), body.relationship] }), relationship: body.relationship }),
  });
  const { app, root } = mountAtlas(api);
  await app.showAtlas();
  await buttonLabelled(root, "New relationship").click();
  const kind = byId(root, "oba-atlas-relationship-kind");
  await choose(kind, "member-of");
  assert.equal(globalThis.document.activeElement, byId(root, "oba-atlas-relationship-kind"), "focus stays on the kind after it changes");
  assert.deepEqual(options(byId(root, "oba-atlas-relationship-from")), ["plato"]);
  assert.deepEqual(options(byId(root, "oba-atlas-relationship-to")), ["academy"]);
  await choose(byId(root, "oba-atlas-relationship-from"), "plato");
  await choose(byId(root, "oba-atlas-relationship-to"), "academy");
  // A kind the chosen target cannot take clears it, and says so.
  await choose(byId(root, "oba-atlas-relationship-kind"), "authored");
  assert.equal(byId(root, "oba-atlas-relationship-to").value, "");
  assert.equal(byId(root, "oba-atlas-relationship-from").value, "plato");
  assert.match(root.querySelector("form").textContent, /The target entry does not fit a authored relationship, so it was cleared/);
  await choose(byId(root, "oba-atlas-relationship-kind"), "influenced");
  await choose(byId(root, "oba-atlas-relationship-to"), "allegory");
  assert.ok(!options(byId(root, "oba-atlas-relationship-to")).includes("plato"), "the starting entry is not offered as a target");

  // Without evidence or the draft state nothing is sent.
  await submit(root);
  assert.equal(api.calls.length, 0);
  assert.equal(byId(root, "oba-atlas-relationship-evidence").getAttribute("aria-invalid"), "true");
  assert.equal(globalThis.document.activeElement.id, "oba-atlas-relationship-evidence");
  assert.match(byId(root, "oba-atlas-relationship-error").textContent, /Add evidence, or mark this relationship as an unsourced draft/);

  await buttonLabelled(root, "Add evidence").click();
  assert.equal(globalThis.document.activeElement.id, "oba-atlas-relationship-evidence-0-source");
  assert.equal(byId(root, "oba-atlas-relationship-unsourced").disabled, true, "evidence and the draft state exclude each other");
  assert.ok(!options(byId(root, "oba-atlas-relationship-evidence-0-source")).includes("gone"), "archived sources are not offered");
  await choose(byId(root, "oba-atlas-relationship-evidence-0-passage"), "passage-1");
  assert.equal(byId(root, "oba-atlas-relationship-evidence-0-source").value, "slings-2003");
  assert.equal(byId(root, "oba-atlas-relationship-evidence-0-locators").value, "page: 514");
  assert.ok(optionText(byId(root, "oba-atlas-relationship-evidence-0-passage")).includes("the cave (passage-1)"));
  await choose(byId(root, "oba-atlas-relationship-confidence"), "plausible");
  byId(root, "oba-atlas-relationship-asserted-is-named").checked = true;
  await byId(root, "oba-atlas-relationship-asserted-is-named").dispatch("change");
  await type(byId(root, "oba-atlas-relationship-asserted-name"), "  Diogenes Laertius ");
  await type(byId(root, "oba-atlas-relationship-uncertainty"), "Only one late source says so.");
  await submit(root);
  assert.equal(api.calls.length, 1);
  assert.deepEqual(api.calls[0].body, {
    revision: "r1",
    relationship: {
      id: "plato-influenced-allegory",
      kind: "influenced",
      from: "plato",
      to: "allegory",
      assertedBy: { kind: "named", name: "Diogenes Laertius" },
      confidence: "plausible",
      evidence: [{ source: "slings-2003", locators: [{ kind: "page", value: "514" }], passage: "passage-1" }],
      uncertainty: "Only one late source says so.",
      visibility: "private",
    },
  });
  assert.match(root.textContent, /Relationship saved to the private atlas/);
  assert.equal(globalThis.document.activeElement.id, "oba-atlas-heading");
}));

test("an unsourced draft and a dissent are recorded from the keyboard", withDom(async () => {
  const api = atlasApi({
    "POST research/atlas/relationships": (body) => ({ ...atlas({ revision: "r2", relationships: [RELATIONSHIP(), body.relationship] }), relationship: body.relationship }),
  });
  const { app, root } = mountAtlas(api);
  await app.showAtlas("allegory");
  await tick();
  await buttonLabelled(root, "Add a relationship to this entry").click();
  assert.equal(byId(root, "oba-atlas-relationship-to").value, "allegory");
  await choose(byId(root, "oba-atlas-relationship-kind"), "related-to");
  await choose(byId(root, "oba-atlas-relationship-from"), "academy");
  const unsourced = byId(root, "oba-atlas-relationship-unsourced");
  unsourced.checked = true;
  await unsourced.dispatch("change", { target: unsourced });
  await buttonLabelled(root, "Add a dissent").click();
  assert.equal(globalThis.document.activeElement.id, "oba-atlas-relationship-dissent-0-name");
  await type(byId(root, "oba-atlas-relationship-dissent-0-name"), "A historian");
  await submit(root);
  assert.equal(api.calls.length, 0, "a dissent needs evidence or a note");
  assert.equal(globalThis.document.activeElement.id, "oba-atlas-relationship-dissent-0-note");
  await type(byId(root, "oba-atlas-relationship-dissent-0-note"), "Sees no link.");
  await submit(root);
  const sent = api.calls[0].body.relationship;
  assert.equal(sent.unsourced, true);
  assert.equal(sent.evidence, undefined);
  assert.deepEqual(sent.contestedBy, [{ by: { kind: "named", name: "A historian" }, note: "Sees no link." }]);
}));

test("a refused save is scoped to its field, keeps the draft, and says nothing was stored", withDom(async () => {
  const api = atlasApi({
    "PUT research/atlas/relationships": () => {
      throw new ApiError("cycle", 422, { error: "cycle", diagnostics: [{ code: "cycle", collection: "relationships", id: "plato-authored-politeia", field: "to", message: "part of a cycle of part-of relationships" }] });
    },
  });
  const { app, root } = mountAtlas(api);
  await app.showAtlas();
  await root.querySelectorAll("button").find((button) => button.dataset.atlasEntry === "plato").click();
  await tick();
  await root.querySelector("[data-atlas-open-relationship]").click();
  await type(byId(root, "oba-atlas-relationship-uncertainty"), "Edited doubt");
  await submit(root);
  assert.equal(api.calls.length, 1);
  assert.equal(api.calls[0].body.relationship.extra, 7, "unknown fields survive the edit");
  assert.equal(byId(root, "oba-atlas-relationship-to").getAttribute("aria-invalid"), "true");
  assert.equal(globalThis.document.activeElement.id, "oba-atlas-relationship-to");
  assert.match(byId(root, "oba-atlas-relationship-error").textContent, /Relationship plato-authored-politeia: to: part of a cycle/);
  assert.match(root.textContent, /Not saved\. The stored atlas is unchanged\./);
  assert.equal(byId(root, "oba-atlas-relationship-uncertainty").value, "Edited doubt");
}));

test("a conflict blocks saving until the author uses the stored copy or keeps the draft", withDom(async () => {
  const newer = { ...ENTRIES()[0], label: "Plato (stored)", added: "elsewhere" };
  let reads = 0;
  const api = atlasApi({
    "GET research/atlas": () => (reads++ ? atlas({ revision: "r9", entries: [newer, ...ENTRIES().slice(1)] }) : atlas()),
    "PUT research/atlas/entries": (body) => {
      if (body.revision !== "r9") throw new ApiError("changed", 409, { conflict: true, revision: "r9", current: newer });
      return { ...atlas({ revision: "r10", entries: [body.entry, ...ENTRIES().slice(1)] }), entry: body.entry };
    },
  });
  const { app, root } = mountAtlas(api);
  await app.showAtlas("plato");
  await tick();
  await type(byId(root, "oba-atlas-entry-label"), "My Plato");
  await submit(root);
  assert.ok(buttonLabelled(root, "Use the stored copy") && buttonLabelled(root, "Keep my draft"));
  assert.equal(buttonLabelled(root, "Save changes").disabled, true);
  assert.equal(globalThis.document.activeElement.dataset.atlasConflictUse, "stored");
  await submit(root);
  assert.equal(api.calls.length, 1, "nothing is resent before a choice");
  await buttonLabelled(root, "Keep my draft").click();
  assert.equal(byId(root, "oba-atlas-entry-label").value, "My Plato");
  await submit(root);
  assert.equal(api.calls[1].body.revision, "r9");
  assert.equal(api.calls[1].body.entry.added, "elsewhere", "fields added elsewhere are kept");
  assert.equal(api.calls[1].body.entry.label, "My Plato");

  const second = mountAtlas(atlasApi({
    "GET research/atlas": () => atlas({ revision: "r9" }),
    "PUT research/atlas/entries": () => {
      throw new ApiError("changed", 409, { conflict: true, revision: "r9", current: newer });
    },
  }));
  await second.app.showAtlas("plato");
  await tick();
  await type(byId(second.root, "oba-atlas-entry-label"), "Mine");
  await submit(second.root);
  await buttonLabelled(second.root, "Use the stored copy").click();
  assert.equal(byId(second.root, "oba-atlas-entry-label").value, "Plato (stored)");
  assert.ok(!buttonLabelled(second.root, "Save changes").disabled);
}));

test("keeping a relationship draft after a conflict keeps fields added elsewhere to its evidence, dissents and parties", withDom(async () => {
  const base = () => {
    const relationship = RELATIONSHIP();
    relationship.contestedBy[0].evidence = [{ source: "plato-republic", locators: [{ kind: "page", value: "1" }] }];
    return relationship;
  };
  const newer = base();
  newer.uncertainty = "Stored doubt.";
  newer.evidence[0].added = "elsewhere";
  newer.evidence[0].locators[0].added = "elsewhere";
  newer.contestedBy[0].added = "elsewhere";
  newer.contestedBy[0].by.added = "elsewhere";
  newer.contestedBy[0].evidence[0].added = "elsewhere";
  let reads = 0;
  const api = atlasApi({
    "GET research/atlas": () => (reads++ ? atlas({ revision: "r9", relationships: [newer] }) : atlas({ relationships: [base()] })),
    "POST research/atlas/explore": (body) => ({ ...EXPLORE[body.id](), outgoing: [{ label: "authored", other: { id: "politeia", kind: "work", label: "Politeia" }, standing: "contested", projected: false, relationship: base() }] }),
    "PUT research/atlas/relationships": (body) => {
      if (body.revision !== "r9") throw new ApiError("changed", 409, { conflict: true, revision: "r9", current: newer });
      return { ...atlas({ revision: "r10", relationships: [body.relationship] }), relationship: body.relationship };
    },
  });
  const { app, root } = mountAtlas(api);
  await app.showAtlas("plato");
  await tick();
  await root.querySelector("[data-atlas-open-relationship]").click();
  await type(byId(root, "oba-atlas-relationship-uncertainty"), "My doubt.");
  await submit(root);
  await buttonLabelled(root, "Keep my draft").click();
  await submit(root);
  assert.equal(api.calls.length, 2);
  const sent = api.calls[1].body.relationship;
  assert.equal(api.calls[1].body.revision, "r9");
  assert.equal(sent.uncertainty, "My doubt.", "the draft's own edit wins");
  assert.equal(sent.evidence[0].added, "elsewhere", "an evidence item keeps a field added elsewhere");
  assert.equal(sent.evidence[0].margin, "kept");
  assert.deepEqual(sent.evidence[0].locators, [{ kind: "page", value: "514", hint: true, added: "elsewhere" }], "an unchanged locator is compared with the newer copy");
  assert.equal(sent.contestedBy[0].added, "elsewhere", "a dissent keeps a field added elsewhere");
  assert.equal(sent.contestedBy[0].tag, "kept");
  assert.deepEqual(sent.contestedBy[0].by, { kind: "named", name: "A later editor", added: "elsewhere" }, "a dissenting party keeps a field added elsewhere");
  assert.equal(sent.contestedBy[0].evidence[0].added, "elsewhere", "a dissent's evidence keeps a field added elsewhere");
  assert.equal(sent.assertedBy.why, "kept");
}));

test("a rebased draft takes each nested item from the stored index it was read from, and leaves new items alone", () => {
  const draft = atlasRelationshipDraft(RELATIONSHIP());
  draft.evidence.unshift(atlasEvidenceDraft({ source: "plato-republic" }));
  draft.contestedBy.push(atlasDissentDraft({ by: { kind: "named", name: "New" }, note: "Mine." }));
  const newer = RELATIONSHIP();
  newer.evidence[0].added = "elsewhere";
  newer.contestedBy[0].by.added = "elsewhere";
  rebaseAtlasRelationshipDraft(draft, newer);
  const sent = atlasRelationshipPayload(draft);
  assert.deepEqual(sent.evidence[0], { source: "plato-republic" }, "a new item has nothing to rebase onto");
  assert.equal(sent.evidence[1].added, "elsewhere", "a moved item still rests on the item it came from");
  assert.equal(sent.contestedBy[0].by.added, "elsewhere");
  assert.deepEqual(sent.contestedBy[1], { by: { kind: "named", name: "New" }, note: "Mine." });
  const gone = atlasRelationshipDraft(RELATIONSHIP());
  rebaseAtlasRelationshipDraft(gone, { ...RELATIONSHIP(), evidence: [], contestedBy: [] });
  assert.equal(atlasRelationshipPayload(gone).evidence[0].margin, "kept", "an item removed elsewhere keeps the copy the draft holds");
});

test("a rebased draft keeps its own copy of an item whose stored index now holds another item", () => {
  const record = RELATIONSHIP();
  record.evidence = [
    { source: "removed-elsewhere", passage: "p-0", own: "first" },
    { source: "slings-2003", passage: "p-1", own: "second" },
  ];
  record.contestedBy = [
    { by: { kind: "named", name: "Removed elsewhere" }, note: "Gone.", own: "first" },
    { by: { kind: "named", name: "A later editor" }, note: "Doubts the attribution.", own: "second" },
  ];
  const draft = atlasRelationshipDraft(record);
  draft.evidence.shift();
  draft.contestedBy.shift();
  const newer = RELATIONSHIP();
  newer.evidence = [{ source: "slings-2003", passage: "p-1", own: "second", added: "elsewhere" }];
  newer.contestedBy = [{ by: { kind: "named", name: "A later editor" }, note: "Doubts the attribution.", own: "second", added: "elsewhere" }];
  rebaseAtlasRelationshipDraft(draft, newer);
  const sent = atlasRelationshipPayload(draft);
  assert.deepEqual(sent.evidence, [{ source: "slings-2003", passage: "p-1", own: "second" }], "the evidence item at index 1 does not rest on another stored item at index 1");
  assert.equal(sent.contestedBy.length, 1);
  assert.equal(sent.contestedBy[0].own, "second", "the dissent keeps its own fields");
  assert.equal(sent.contestedBy[0].added, undefined, "the dissent takes no fields from another stored dissent");

  const shifted = atlasRelationshipDraft(record);
  const elsewhere = RELATIONSHIP();
  elsewhere.evidence = [{ source: "slings-2003", passage: "p-1", own: "second" }];
  elsewhere.contestedBy = [{ by: { kind: "named", name: "A later editor" }, note: "Doubts the attribution.", own: "second" }];
  rebaseAtlasRelationshipDraft(shifted, elsewhere);
  const kept = atlasRelationshipPayload(shifted);
  assert.deepEqual(kept.evidence.map((item) => item.own), ["first", "second"], "an item removed elsewhere ahead of the draft's items neither loses nor borrows fields");
  assert.deepEqual(kept.contestedBy.map((item) => item.own), ["first", "second"]);
  assert.equal(kept.contestedBy[1].by.name, "A later editor");
});

test("removing asks first, a linked entry is refused with the reason, and unresolved notes are reported", withDom(async () => {
  let refuse = true;
  const api = atlasApi({
    "DELETE research/atlas/entries": () => {
      if (refuse) throw new ApiError("linked", 422, { diagnostics: [{ code: "still-linked", collection: "relationships", id: "plato-authored-politeia", field: "from", message: "this relationship still joins the entry `plato`" }] });
      return { ...atlas({ revision: "r2", entries: ENTRIES().filter((entry) => entry.id !== "allegory") }), unresolvedNotes: ["note-2", "note-5"] };
    },
  });
  const { app, root } = mountAtlas(api);
  await app.showAtlas("plato");
  await tick();
  assert.match(root.textContent, /1 relationship joins this entry, so it cannot be removed until it is removed/);
  globalThis.confirm = () => false;
  await root.querySelector("[data-atlas-remove]").click();
  assert.equal(api.calls.length, 0);
  globalThis.confirm = () => true;
  await root.querySelector("[data-atlas-remove]").click();
  assert.deepEqual(api.calls[0], { method: "DELETE", path: "research/atlas/entries", body: { revision: "r1", id: "plato" } });
  assert.match(root.textContent, /Relationship plato-authored-politeia: from: this relationship still joins/);
  assert.match(root.textContent, /The stored atlas is unchanged/);
  refuse = false;
  await root.querySelectorAll("button").find((button) => button.dataset.atlasEntry === "allegory").click();
  await tick();
  await root.querySelector("[data-atlas-remove]").click();
  assert.match(root.textContent, /2 notebook notes now link to a concept with no entry \(note-2, note-5\)/);
  assert.equal(entryIds(root).includes("allegory"), false);
  delete globalThis.confirm;
}));

test("a concept a note links to without an entry opens as a new concept with that identifier", withDom(async () => {
  const api = atlasApi({ "GET research/atlas": () => atlas({ missingConcepts: ["the-good"] }) });
  const { app, root } = mountAtlas(api);
  await app.showAtlas("the-good");
  assert.equal(byId(root, "oba-atlas-heading").textContent, "New concept the-good");
  assert.equal(globalThis.document.activeElement.id, "oba-atlas-heading");
  assert.equal(byId(root, "oba-atlas-entry-id").value, "the-good");
  assert.equal(byId(root, "oba-atlas-entry-kind").value, "concept");
  assert.match(root.textContent, /No entry has the identifier the-good yet/);
  assert.ok(buttonLabelled(root, "Add concept the-good"), "missing concepts are offered from the list too");
  await type(byId(root, "oba-atlas-entry-label"), "The Good");
  assert.equal(byId(root, "oba-atlas-entry-id").value, "the-good", "the linked identifier is kept");
  const hostile = mountAtlas(atlasApi());
  await hostile.app.showAtlas("<script>");
  assert.equal(byId(hostile.root, "oba-atlas-heading").textContent, "Knowledge Atlas", "an invalid id opens nothing");
}));

test("notices and a damaged atlas are reported as text, never with a way to overwrite", withDom(async () => {
  const noticed = mountAtlas(atlasApi({ "GET research/atlas": () => atlas({ notices: [{ code: "private-endpoint", id: "plato-authored-politeia", field: "from", message: "the entry `plato` is private, so this approved relationship stays out of public output until the entry is approved" }] }) }));
  await noticed.app.showAtlas();
  assert.match(noticed.root.textContent, /Relationship plato-authored-politeia, from: the entry `plato` is private/);
  const damaged = mountAtlas(atlasApi({
    "GET research/atlas": () => {
      throw new ApiError("bad", 422, { error: "invalid JSON", file: ".openblog/private/research/atlas.json", diagnostics: [{ message: "invalid JSON: eof" }] });
    },
  }));
  await damaged.app.showAtlas();
  assert.match(damaged.root.textContent, /The Knowledge Atlas could not be read/);
  assert.match(damaged.root.textContent, /Repair \.openblog\/private\/research\/atlas\.json by hand/);
  assert.equal(damaged.root.querySelectorAll("form").length, 0);
}));

test("every atlas control is labelled and grouped", withDom(async () => {
  const { app, root } = mountAtlas(atlasApi());
  await app.showAtlas();
  await root.querySelectorAll("button").find((button) => button.dataset.atlasEntry === "plato").click();
  await tick();
  await root.querySelector("[data-atlas-open-relationship]").click();
  const form = root.querySelector("form");
  const labels = new Set(form.querySelectorAll("label").map((label) => label.getAttribute("for")));
  for (const control of [...form.querySelectorAll("input"), ...form.querySelectorAll("select"), ...form.querySelectorAll("textarea")]) {
    assert.ok(labels.has(control.id), `control ${control.id} has a label`);
  }
  assert.ok(form.querySelectorAll("legend").length >= 4, "parties, evidence and dissent are fieldsets with legends");
  assert.ok(buttonLabelled(form, "Remove evidence 1") && buttonLabelled(form, "Remove dissent 1") && buttonLabelled(form, "Add evidence to dissent 1"));
}));

// ---------------------------------------------------------------- wiring

test("a note's concepts link to their atlas entries from the notebook", withDom(async () => {
  const api = {
    async call(method, path) {
      if (path === "research/backlinks") return { entries: [] };
      if (method === "GET" && path === "research/notebook") {
        return { file: ".openblog/private/research/notebook.json", revision: "r1", stored: true, sources: SOURCES(), passages: [], notes: [{ id: "note-2", kind: "question", text: "Why a cave?", concepts: ["allegory", "the-good"], visibility: "private" }] };
      }
      throw new ApiError(`unexpected ${method} ${path}`, 500, null);
    },
  };
  const { app, root } = mountAtlas(api);
  await app.showResearch();
  await root.querySelectorAll("button").find((button) => button.dataset.entryId === "note-2").click();
  const links = root.querySelector("[data-atlas-concepts]").querySelectorAll("a");
  assert.deepEqual(links.map((link) => link.getAttribute("href")), ["#/atlas/allegory", "#/atlas/the-good"]);
}));

test("the atlas is reachable from the research tools, the palette and the router", () => {
  assert.match(admin, /href: "#\/atlas" \}, "Atlas"\)/);
  assert.match(admin, /head === "atlas"\) await this\.showAtlas\(safeDecodeURIComponent\(tail\)\)/);
  assert.match(admin, /label: "Knowledge Atlas", category: "Research"/);
  assert.equal(safeDecodeURIComponent("the%20good"), "the good");
  assert.equal(safeDecodeURIComponent("%E0%A4%A"), "");
});

test("a save says whether the published atlas was rebuilt, only when the site publishes it", () => {
  assert.equal(atlasBuildText(undefined), "");
  assert.equal(atlasBuildText({ ok: true, files: 9 }), " The published Knowledge Atlas was rebuilt.");
  assert.equal(atlasBuildText({ ok: false, error: "the Knowledge Atlas cannot be published" }), " The change is saved, but the site could not be rebuilt: the Knowledge Atlas cannot be published");
});

test("atlas code never parses text as markup and announces changes", () => {
  const helpers = admin.slice(admin.indexOf("// ---------------------------------------------------------------- knowledge atlas"), admin.indexOf("export const SHARED_SOURCE_KINDS"));
  const view = admin.slice(admin.indexOf("  // ---- knowledge atlas"), admin.indexOf("  // ---- shared reflections"));
  for (const code of [helpers, view]) assert.doesNotMatch(code, /innerHTML|insertAdjacentHTML|outerHTML|createContextualFragment|<canvas|<svg/);
  assert.match(helpers, /role: "alert"/);
  assert.match(helpers, /"aria-live": "polite"/);
  assert.match(view, /"aria-live": "polite"/);
  assert.match(helpers, /aria-invalid/);
  assert.match(helpers, /h\("legend"/);
});

test("atlas styles keep focus visible, targets large, text wrapping, and add no motion", () => {
  const css = styles.slice(styles.indexOf("/* Knowledge Atlas"), styles.indexOf("/* Anchors styled as buttons"));
  assert.match(css, /:focus-visible/);
  assert.match(css, /min-height: 44px/);
  assert.match(css, /overflow-wrap: anywhere/);
  assert.match(css, /@media \(max-width: 40rem\)/);
  assert.doesNotMatch(css, /transition|animation/);
});
