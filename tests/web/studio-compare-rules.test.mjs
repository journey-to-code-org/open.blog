// Compare's rules (Studio R12), ported from admin-research-compare.test.mjs: the pure cases. The
// view cases of the old shell are in tests/browser/studio-compare.spec.mjs.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as rules from "../../web/studio/parts/compare-rules.js";
import { sayId } from "../../web/studio/parts/research-says.js";
import { say } from "../../web/studio/parts/words.js";
import { languageTag } from "../../web/studio/parts/draft-research-rules.js";
import { locatorText } from "../../web/studio/parts/notebook-rules.js";
import { rightsText } from "../../web/studio/parts/source-rules.js";
const { ALIGNMENT_CORRESPONDENCES,correspondenceWords,alignmentNotice,MAX_ALIGNMENT_MEMBERS,MAX_ALIGNMENT_RATIONALE_CHARS,MAX_ALIGNMENT_NORMALIZED_CHARS,RTL_LANGUAGES,RTL_SCRIPTS,LTR_SCRIPTS,VERSION_MAKERS,textDirection,certaintyText,versionMakerText,interpretersText,kindLanguage,comparisonColumns,rightsToConfirm,comparisonExportText,applyAlignmentState,alignableSources,alignmentMemberDraft,alignmentDraft,alignmentMemberPayload,publicPlaceText,comparisonBuildText,alignmentPayload,rebaseAlignmentDraft,alignmentMemberIdentity,validateAlignmentDraft,alignmentDiagnosticControl,alignmentErrorMessage } = rules;

// The comparison workspace (A6.3, ADR 0090 and ADR 0091): aligned places across versions side by
// side or in one column, original wording exactly with its direction, labelled normalizations,
// explicit absences, attribution on every place, copying only what is selected after the rights
// statements are read, and alignment editing that keeps the draft through a conflict.



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
  // Reflected like the browser's: `dir` and `lang` read their attributes, so code and tests that use either agree.
  get dir() {
    return this.attributes.dir ?? "";
  }
  get lang() {
    return this.attributes.lang ?? "";
  }
  get readOnly() {
    return "readonly" in this.attributes;
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
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const createObjectURL = URL.createObjectURL;
  const revokeObjectURL = URL.revokeObjectURL;
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
  globalThis.location = { hash: "#/compare" };
  const clipboard = { writes: [], fail: false, async writeText(text) { if (this.fail) throw new Error("denied"); this.writes.push(text); } };
  Object.defineProperty(globalThis, "navigator", { value: { clipboard }, configurable: true, writable: true });
  const downloads = { made: [], revoked: [] };
  URL.createObjectURL = (blob) => {
    downloads.made.push(blob);
    return `blob:test/${downloads.made.length}`;
  };
  URL.revokeObjectURL = (url) => downloads.revoked.push(url);
  return {
    document: documentShim,
    clipboard,
    downloads,
    restore() {
      for (const [name, value] of Object.entries(previous)) {
        if (value === undefined) delete globalThis[name];
        else globalThis[name] = value;
      }
      if (navigatorDescriptor) Object.defineProperty(globalThis, "navigator", navigatorDescriptor);
      URL.createObjectURL = createObjectURL;
      URL.revokeObjectURL = revokeObjectURL;
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

const HOSTILE = '<img src=x onerror="alert(1)"> 🙂 <script>alert(2)</script>';

// Hebrew with a decomposed vowel point (U+05B0 after its letter) and hostile markup, kept exactly.
const HEBREW = `ירדְתי אתמול ${HOSTILE}`;

const GREEK = "κατέβην χθὲς εἰς Πειραιᾶ\n  μετὰ Γλαύκωνος";

const RIGHTS = {
  publicDomain: { status: "publicDomain", label: "The author states the text is in the public domain", declared: true, note: "Published 2003, edition text ancient" },
  rightsReserved: { status: "rightsReserved", label: "The author states the text is under copyright", declared: true },
  unknown: { status: "unknown", label: "Rights not checked yet", declared: false },
  openLicense: { status: "openLicense", label: "The author states the text is under an open licence", declared: true, license: "CC-BY-4.0" },
};

const SOURCES = () => [
  { id: "plato", kind: "work", title: "Πολιτεία", chain: [] },
  { id: "slings", kind: "edition", of: "plato", title: "Platonis Rempublicam", creators: [{ name: "S. R. Slings", role: "editor", attribution: "stated" }], chain: [{ id: "plato", kind: "work", title: "Πολιτεία" }], rightsStatus: RIGHTS.publicDomain },
  { id: "bloom", kind: "translation", of: "plato", language: "en", title: "The Republic of Plato", creators: [{ name: "Allan Bloom", role: "translator", attribution: "attributed", note: "second edition" }], chain: [{ id: "plato", kind: "work", title: "Πολιτεία" }], rightsStatus: RIGHTS.rightsReserved },
  { id: "he", kind: "translation", of: "plato", language: "he", title: "פוליטאה", anonymous: true, chain: [{ id: "plato", kind: "work", title: "Πολιτεία" }], rightsStatus: RIGHTS.unknown },
  { id: "ms", kind: "witness", of: "plato", title: "Paris gr. 1807", repository: "BnF", shelfmark: "gr. 1807", volumes: 2, creators: [{ name: "John the Calligrapher", role: "scribe", attribution: "disputed" }], chain: [{ id: "plato", kind: "work", title: "Πολιτεία" }], rightsStatus: RIGHTS.openLicense },
  { id: "slings-2", kind: "edition", of: "plato", title: "Slings revised", revises: "slings", chain: [{ id: "plato", kind: "work", title: "Πολιτεία" }], rightsStatus: RIGHTS.unknown },
  { id: "gone", kind: "edition", of: "plato", title: "Gone", archived: true, chain: [{ id: "plato", kind: "work", title: "Πολιτεία" }], rightsStatus: RIGHTS.unknown },
];

const PASSAGES = () => [
  { id: "p-gr", source: "slings", excerpt: { text: GREEK, language: "grc" }, locators: [{ kind: "canonical", value: "327a" }], visibility: "private" },
  { id: "p-en1", source: "bloom", excerpt: { text: "I went down to the Piraeus yesterday", language: "en" }, locators: [{ kind: "canonical", value: "327a" }], visibility: "private" },
  { id: "p-en2", source: "bloom", excerpt: { text: "with Glaucon", language: "en" }, locators: [{ kind: "canonical", value: "327a", to: "327b" }], visibility: "private" },
  { id: "p-he", source: "he", excerpt: { text: HEBREW, language: "he" }, locators: [{ kind: "page", value: "3" }], visibility: "private" },
];

const INTERPRETATIONS = () => [
  { id: "mine", kind: "rendering", source: "slings", locators: [{ kind: "canonical", value: "327a" }], language: "en", text: "Down I went, yesterday", interpreters: [{ contributor: "ada", display: "Ada <b>Lovelace</b>", attribution: "uncertain" }], rightsStatus: { status: "ownWork", label: "The author states the text is their own work", declared: true } },
  { id: "gloss", kind: "reading", source: "ms", text: "A gloss", anonymous: true, rightsStatus: RIGHTS.unknown },
];

const OPENING = () => ({
  id: "opening",
  label: "Opening: the descent",
  correspondence: "partial",
  members: [
    { source: "slings", passage: "p-gr", locators: [{ kind: "canonical", value: "327a" }] },
    { source: "bloom", passage: "p-en1", locators: [{ kind: "canonical", value: "327a" }], shelf: "kept" },
    { source: "bloom", passage: "p-en2" },
    { source: "he", passage: "p-he", normalized: { text: "ירדתי אתמול", note: "vowel points removed", mark: 1 } },
    { source: "ms", absent: true, note: "the leaf is lost" },
    { interpretation: "mine" },
  ],
  rationale: "The first sentence in every version.",
  confidence: "plausible",
  recordedBy: { kind: "author" },
  evidence: [{ source: "slings", locators: [{ kind: "page", value: "1" }] }],
  visibility: "private",
  shelf: 7,
});

const SECOND = () => ({
  id: "second",
  correspondence: "corresponding",
  members: [
    { source: "slings", locators: [{ kind: "canonical", value: "327b" }] },
    { source: "bloom", locators: [{ kind: "canonical", value: "327b" }] },
  ],
  confidence: "tentative",
  recordedBy: { kind: "named", name: "A concordance" },
  visibility: "private",
});

const NOTICES = () => [{ code: "stale-locator", collection: "alignments", index: 0, id: "opening", field: "members[1].locators", message: "these locators no longer match passage `p-en1`, which may have been re-located since it was aligned; check the place and update one of them" }];

const CORRESPONDENCES = () => [
  { value: "corresponding", label: "The author reads these places as corresponding" },
  { value: "partial", label: "The author reads these places as corresponding in part" },
  { value: "divergent", label: "The author reads these places as corresponding but differing" },
];

const view = (over = {}) => ({
  file: ".openblog/private/research/alignments.json",
  revision: "r1",
  stored: true,
  alignments: [OPENING(), SECOND()],
  sources: SOURCES(),
  passages: PASSAGES(),
  interpretations: INTERPRETATIONS(),
  notices: NOTICES(),
  notice: "An alignment records where its author reads these places as corresponding. It does not say they mean the same thing, and no version is treated as authoritative.",
  correspondences: CORRESPONDENCES(),
  ...over,
});

const context = () => applyAlignmentState({}, view());

function compareApi(handlers = {}) {
  const calls = [];
  const all = { "GET research/alignments": () => view(), ...handlers };
  return {
    calls,
    async call(method, path, options = {}) {
      if (method !== "GET") calls.push({ method, path, body: structuredClone(options.json) });
      const handler = all[`${method} ${path}`];
      if (!handler) throw new ApiError(`unexpected ${method} ${path}`, 500, null);
      return handler(options.json);
    },
  };
}

function mountCompare(api) {
  const app = new ObAdmin();
  const root = new DomNode("div", globalThis.document);
  globalThis.document.body.append(root);
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

const toggle = async (control, checked) => {
  control.checked = checked;
  await control.dispatch("change", { target: control });
};

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const submit = (root) => root.querySelector("form").dispatch("submit");

const buttonLabelled = (root, text) => root.querySelectorAll("button").find((button) => button.textContent === text);

const all = (root, attribute) => root.querySelectorAll(`[${attribute}]`);

const openAlignment = async (root, id) => {
  await root.querySelectorAll("button").find((button) => button.dataset.compareAlignment === id).click();
  await tick();
};

const versionKeys = (root) => all(root, "data-compare-version").map((section) => section.dataset.compareVersion);

const place = (root, index) => all(root, "data-compare-place").find((item) => item.dataset.comparePlace === String(index));

// ---------------------------------------------------------------- pure helpers

test("text direction comes from the language tag, and unknown text lets the browser decide", () => {
  assert.equal(textDirection("he"), "rtl");
  assert.equal(textDirection("ar-EG"), "rtl");
  assert.equal(textDirection("fa"), "rtl");
  assert.equal(textDirection("az-Arab"), "rtl", "a right-to-left script subtag decides");
  assert.equal(textDirection("he-Latn"), "ltr", "a transliteration is left to right");
  assert.equal(textDirection("grc"), "ltr");
  assert.equal(textDirection("en"), "ltr");
  assert.equal(textDirection(""), "auto");
  for (const language of ["hbo", "arz", "ary", "aeb", "apc", "acm", "ajp", "azb", "ota", "prs", "glk", "lrc", "bal", "jrb", "jpr", "sam", "phn"]) {
    assert.equal(textDirection(language), "rtl", `${language} is written right to left`);
  }
  for (const script of ["Armi", "Avst", "Chrs", "Elym", "Hatr", "Khar", "Mani", "Merc", "Mero", "Narb", "Nbat", "Ougr", "Palm", "Phli", "Phlp", "Phnx", "Prti", "Sarb", "Sogd", "Sogo", "Lydi", "Cprt", "Hung"]) {
    assert.equal(textDirection(`und-${script}`), "rtl", `${script} runs right to left`);
  }
  assert.equal(textDirection("hbo-Hebr"), "rtl");
  assert.equal(textDirection("arc-Latn"), "ltr", "a known left-to-right script decides");
  assert.equal(textDirection("grc-Grek"), "ltr");
  assert.equal(textDirection("xx-Zzzz"), "auto", "an unknown script subtag is left to the browser, never assumed left to right");
  assert.equal(textDirection("he-Qaaa"), "auto");
  assert.equal(textDirection(undefined), "auto");
  assert.equal(textDirection('he" onmouseover="x'), "auto", "a hostile tag is no tag");
  assert.equal(languageTag(" grc "), "grc");
  assert.equal(languageTag("<b>"), "");
  assert.equal(languageTag("x"), "");
});

test("locators read as a person says them", () => {
  assert.equal(locatorText([{ kind: "canonical", value: "327a", to: "327b" }, { kind: "x-csl-volume", value: "2" }]), "canonical place 327a to 327b, volume 2");
  assert.equal(locatorText([]), "");
  assert.equal(locatorText(null), "");
});

test("rights read as the author's statement and never as permission", () => {
  assert.equal(rightsText(RIGHTS.publicDomain), "In the public domain, you say. Published 2003, edition text ancient");
  assert.match(rightsText(RIGHTS.openLicense), /you say/);
  assert.equal(rightsText(undefined), rightsText({ status: "unknown" }), "undeclared is unknown");
  for (const rights of Object.values(RIGHTS)) assert.doesNotMatch(rightsText(rights), /allowed|permitted|free to/i);
});

test("columns follow the author's member order, keep splits together, and say absence and attribution", () => {
  const columns = comparisonColumns(OPENING(), context());
  assert.deepEqual(columns.map((column) => column.key), ["source:slings", "source:bloom", "source:he", "source:ms", "interpretation:mine"]);
  const [slings, bloom, he, ms, mine] = columns;
  assert.deepEqual(bloom.places.map((item) => item.index), [1, 2], "a split keeps both places in one version");
  assert.equal(slings.places[0].original.text, GREEK, "the wording is exact, whitespace and all");
  assert.equal(slings.places[0].original.language, "grc");
  assert.equal(he.places[0].original.text, HEBREW);
  assert.equal(he.places[0].original.text.normalize("NFC") === HEBREW, true);
  assert.equal(he.places[0].locator, "page 3", "the passage's locators stand in when the member gives none");
  assert.equal(bloom.places[1].locator, "canonical place 327a to 327b");
  assert.equal(he.places[0].normalized.text, "ירדתי אתמול");
  assert.equal(he.places[0].normalized.note, "vowel points removed");
  assert.equal(ms.places[0].absent, true);
  assert.equal(ms.places[0].original, null);
  assert.equal(ms.places[0].note, "the leaf is lost");
  assert.equal(ms.maker, "Made by: John the Calligrapher (disputed)");
  assert.deepEqual(ms.facts.find((fact) => fact.label === say("compare.factHeldAt")).parts, [{ text: "BnF, gr. 1807" }]);
  assert.deepEqual(ms.facts.find((fact) => fact.label === say("compare.factVolumes")).parts, ["2"]);
  assert.equal(mine.type, "interpretation");
  assert.equal(mine.maker, "Made by: Ada <b>Lovelace</b> (uncertain)");
  assert.equal(mine.places[0].original.text, "Down I went, yesterday");
  assert.equal(mine.places[0].locator, "canonical place 327a");
  assert.equal(mine.rights.status, "ownWork");
  assert.match(bloom.places[0].notices[0], /no longer match passage `p-en1`/);
  assert.deepEqual(bloom.places[1].notices, []);
  assert.equal(he.rights.status, "unknown");
  const realizes = slings.facts.find((fact) => fact.label === say("compare.factOf"));
  assert.deepEqual(realizes.parts, [{ text: "Πολιτεία" }]);
  const revised = comparisonColumns({ id: "x", members: [{ source: "slings-2", locators: [{ kind: "page", value: "1" }] }, { source: "nowhere", absent: true }] }, context());
  assert.deepEqual(revised[0].facts.find((fact) => fact.label === say("compare.factRevises")).parts, [{ text: "Platonis Rempublicam" }]);
  assert.equal(revised[1].missing, true, "a member whose version is gone is shown as missing, not dropped");
  assert.equal(revised[1].title, "nowhere (not in your atlas)");
});

test("export text carries only selected places, each identified, with rights and exact wording", () => {
  const columns = comparisonColumns(OPENING(), context());
  const none = comparisonExportText(OPENING(), columns, new Set());
  assert.doesNotMatch(none, /The exact words/);
  const text = comparisonExportText(OPENING(), columns, new Set([0, 3, 4]), { correspondence: correspondenceWords("partial") });
  assert.match(text, /^Alignment: Opening: the descent\nYou read these places as corresponding in part\n/);
  assert.ok(text.includes(`The exact words, from your notebook:\n${GREEK}\n`), "the words exactly as kept");
  assert.ok(text.includes(`The exact words, from your notebook:\n${HEBREW}\n`));
  assert.ok(text.includes("Made by: S. R. Slings (stated)\nWhere: canonical place 327a\nRights: In the public domain, you say"));
  assert.ok(text.includes("Made by: John the Calligrapher (disputed)\nWhere: not recorded\n"));
  assert.ok(text.includes("This version doesn't have this passage.\n\n"));
  assert.ok(!text.includes("the leaf is lost"), "the author's private notes on places stay out by default");
  const withNotes = comparisonExportText(OPENING(), columns, new Set([4]), { notes: true });
  assert.ok(withNotes.includes("This version doesn't have this passage.\nYour note: the leaf is lost\n"), "notes are copied only when asked for");
  assert.ok(!text.includes("I went down"), "unselected places stay out");
  assert.ok(!text.includes("ירדתי אתמול\n"), "a normalization is left out unless asked for");
  const normalized = comparisonExportText(OPENING(), columns, new Set([3]), { normalized: true });
  assert.ok(normalized.includes("Your normalization, not the source's words\nירדתי אתמול\nYour note: vowel points removed"));
  assert.match(text, /nothing here decides what copying is allowed\.\n$/);
});

test("copying asks for confirmation only where rights are unchecked or reserved, and only for quoted text", () => {
  const columns = comparisonColumns(OPENING(), context());
  assert.deepEqual(rightsToConfirm(columns, new Set([0])).map((column) => column.id), [], "a public-domain statement needs no extra confirmation");
  assert.deepEqual(rightsToConfirm(columns, new Set([0, 1, 3])).map((column) => column.id), ["bloom", "he"]);
  assert.deepEqual(rightsToConfirm(columns, new Set([4])).map((column) => column.id), [], "an absent place quotes nothing");
});

test("payloads keep evidence and unknown fields, and drop what an absent place cannot have", () => {
  assert.deepEqual(alignmentPayload(alignmentDraft(OPENING())), OPENING(), "an untouched alignment round-trips exactly");
  const draft = alignmentDraft(OPENING());
  draft.label = "  The descent  ";
  draft.members[1].locators = "canonical: 327a\ncanonical: 327b";
  draft.members[3].normalized = "ירדתי  אתמול ";
  draft.members[0].absent = true;
  draft.correspondence = "divergent";
  const sent = alignmentPayload(draft);
  assert.equal(sent.label, "The descent");
  assert.equal(sent.shelf, 7);
  assert.deepEqual(sent.evidence, OPENING().evidence);
  assert.equal(sent.members[1].shelf, "kept");
  assert.deepEqual(sent.members[1].locators, [{ kind: "canonical", value: "327a" }, { kind: "canonical", value: "327b" }]);
  assert.deepEqual(sent.members[3].normalized, { text: "ירדתי  אתמול ", note: "vowel points removed", mark: 1 }, "a normalization is sent exactly as typed");
  assert.deepEqual(sent.members[0], { source: "slings", absent: true });
  assert.equal(sent.correspondence, "divergent");
  assert.equal(sent.visibility, "private");
  assert.deepEqual(sent.members[5], { interpretation: "mine" });
  const fresh = alignmentPayload(alignmentDraft(null));
  assert.deepEqual(fresh.recordedBy, { kind: "author" });
  assert.equal(fresh.confidence, "tentative");
});

test("a kept draft rests on the newer copy's unknown fields", () => {
  const draft = alignmentDraft(OPENING());
  draft.label = "Mine";
  const newer = { ...OPENING(), shelf: 8, members: OPENING().members.map((member, index) => (index === 1 ? { ...member, shelf: "newer" } : member)) };
  rebaseAlignmentDraft(draft, newer);
  const sent = alignmentPayload(draft);
  assert.equal(sent.label, "Mine");
  assert.equal(sent.shelf, 8);
  assert.equal(sent.members[1].shelf, "newer");
});

test("a rebase never moves one place's unknown fields onto another", () => {
  // A split: a second place added from the same version and passage as the first.
  const split = alignmentDraft(OPENING());
  split.members.splice(1, 0, { ...alignmentDraft(null).members[0], source: "slings", passage: "p-gr", locators: "canonical: 327a" });
  const newer = { ...OPENING(), members: OPENING().members.map((member, index) => (index === 0 ? { ...member, shelf: "first" } : member)) };
  rebaseAlignmentDraft(split, newer);
  let sent = alignmentPayload(split);
  assert.equal(sent.members[0].shelf, "first", "the place read from the stored member rests on its newer copy");
  assert.equal(sent.members[1].shelf, undefined, "the new place takes nobody's fields");
  // An edited version: place 2 now names the version and passage place 3 is in.
  const edited = alignmentDraft(OPENING());
  edited.members[1].source = "bloom";
  edited.members[1].passage = "p-en2";
  edited.members[1].locators = "";
  const marked = { ...OPENING(), members: OPENING().members.map((member, index) => ({ ...member, shelf: `stored-${index}` })) };
  rebaseAlignmentDraft(edited, marked);
  sent = alignmentPayload(edited);
  assert.equal(sent.members[1].shelf, "stored-1", "an edited place keeps the fields of the place it was read as");
  assert.equal(sent.members[2].shelf, "stored-2");
  // Reordered in storage: each place follows its own stored member by identity, each claimed once.
  const moved = alignmentDraft(OPENING());
  rebaseAlignmentDraft(moved, { ...OPENING(), members: [...marked.members].reverse() });
  sent = alignmentPayload(moved);
  assert.deepEqual(sent.members.map((member) => member.shelf), [0, 1, 2, 3, 4, 5].map((index) => `stored-${index}`));
  assert.deepEqual(moved.members.map((member) => member.from), [5, 4, 3, 2, 1, 0]);
  // A place whose stored member is gone keeps its own original.
  const gone = alignmentDraft(OPENING());
  rebaseAlignmentDraft(gone, { ...OPENING(), members: OPENING().members.filter((_, index) => index !== 1) });
  assert.equal(alignmentPayload(gone).members[1].shelf, "kept");
  assert.equal(gone.members[1].from, null);
});

test("notes are sent exactly as typed, so a round trip is lossless", () => {
  const record = { ...OPENING(), members: OPENING().members.map((member, index) => (index === 3 ? { ...member, note: "  spaced  ", normalized: { text: "x", note: " keep " } } : member)) };
  const sent = alignmentPayload(alignmentDraft(record));
  assert.equal(sent.members[3].note, "  spaced  ");
  assert.equal(sent.members[3].normalized.note, " keep ");
  const blank = alignmentDraft(record);
  blank.members[3].note = "   ";
  assert.equal(alignmentPayload(blank).members[3].note, undefined, "a blank note is dropped");
});

test("advisory checks name the first problem and the control for it", () => {
  const ctx = { sources: SOURCES(), passages: PASSAGES(), interpretations: INTERPRETATIONS(), used: ["opening"] };
  const draft = alignmentDraft(null);
  assert.equal(validateAlignmentDraft(draft, { ...ctx, creating: true }).field, "id");
  draft.id = "opening";
  assert.equal(validateAlignmentDraft(draft, { ...ctx, creating: true }).field, "id");
  draft.id = "fresh";
  assert.equal(validateAlignmentDraft(draft, { ...ctx, creating: true }).field, "member-0-source");
  draft.members[0].source = "plato";
  assert.equal(validateAlignmentDraft(draft, ctx).id, "compare.notAWork");
  draft.members[0].source = "slings";
  assert.equal(validateAlignmentDraft(draft, ctx).field, "member-0-locators");
  draft.members[0].locators = "514";
  assert.equal(validateAlignmentDraft(draft, ctx).id, "notebook.badPlace");
  draft.members[0].locators = "canonical: 327a";
  draft.members[1].source = "slings";
  draft.members[1].absent = true;
  assert.equal(validateAlignmentDraft(draft, ctx).field, "members", "one version is not a comparison");
  draft.members[1].source = "he";
  draft.members[1].absent = false;
  draft.members[1].passage = "p-gr";
  assert.equal(validateAlignmentDraft(draft, ctx).field, "member-1-passage");
  draft.members[1].passage = "p-he";
  assert.equal(validateAlignmentDraft(draft, ctx), null);
  draft.members[1].type = "interpretation";
  assert.equal(validateAlignmentDraft(draft, ctx).field, "member-1-interpretation");
  draft.members[1].interpretation = "mine";
  draft.recordedBy.kind = "named";
  assert.equal(validateAlignmentDraft(draft, ctx).field, "recorded-name");
});

test("server diagnostics map to the control that fixes them", () => {
  assert.equal(alignmentDiagnosticControl("members[2].source"), "member-2-source");
  assert.equal(alignmentDiagnosticControl("members[0].locators[1].kind"), "member-0-locators");
  assert.equal(alignmentDiagnosticControl("members[3].normalized"), "member-3-normalized");
  assert.equal(alignmentDiagnosticControl("members[3].normalized.note"), "member-3-normalized-note");
  assert.equal(alignmentDiagnosticControl("members[1]"), "member-1");
  assert.equal(alignmentDiagnosticControl("members"), "members");
  assert.equal(alignmentDiagnosticControl("recordedBy.name"), "recorded-name");
  assert.equal(alignmentDiagnosticControl("correspondence"), "correspondence");
  assert.equal(alignmentDiagnosticControl("evidence[0].source"), "");
  assert.equal(alignmentErrorMessage({ data: { diagnostics: [{ field: "members[0].source", message: "`w` is a work" }] } }), "members[0].source: `w` is a work");
  assert.equal(alignmentErrorMessage(new Error("offline")), "offline");
});

test("approval and the normalization choice round-trip, and nothing else marks an alignment public", () => {
  const approved = { ...SECOND(), visibility: "approved", publishNormalized: true };
  assert.deepEqual(alignmentPayload(alignmentDraft(approved)), approved, "an approved alignment round-trips exactly");
  const draft = alignmentDraft(approved);
  draft.approved = false;
  draft.publishNormalized = false;
  const sent = alignmentPayload(draft);
  assert.equal(sent.visibility, "private");
  assert.equal("publishNormalized" in sent, false, "the choice is written only when made");
  assert.equal(alignmentDraft(SECOND()).approved, false);
});

test("the public preview reads as what a page would show, never as permission", () => {
  assert.match(publicPlaceText("shown"), /Readers see these words/);
  assert.match(publicPlaceText("withheld-rights"), /not the words: the version's rights aren't cleared/);
  assert.match(publicPlaceText("withheld-length", 1000), /longer than 1000 letters/);
  assert.match(publicPlaceText("unquoted"), /no words are kept/);
  assert.match(publicPlaceText("absent"), /doesn't have it/);
  assert.equal(publicPlaceText("other"), "");
  assert.equal(comparisonBuildText(undefined), "");
  assert.equal(comparisonBuildText({ ok: true }), "compare.rebuilt");
  assert.equal(comparisonBuildText({ ok: false, error: "boom" }), "compare.rebuildFailed");
  for (const status of ["shown", "withheld-rights", "withheld-length", "unquoted", "absent"]) {
    assert.doesNotMatch(publicPlaceText(status), /allowed|permitted|legal/i);
  }
});

test("the comparison never parses stored text as markup and stores nothing in the browser", () => {
  const read = (path) => readFileSync(new URL(`../../web/studio/${path}`, import.meta.url), "utf8");
  const code = ["parts/compare-rules.js", "parts/alignment-form.js", "screens/compare.js"].map(read).join("\n");
  assert.doesNotMatch(code, /innerHTML|insertAdjacentHTML|outerHTML|DOMParser/);
  assert.doesNotMatch(code, /localStorage|sessionStorage|indexedDB/);
  assert.doesNotMatch(code, /\.normalize\(/, "stored wording is never normalized");
});

test("versions sit side by side on wide screens and follow one another on narrow ones", () => {
  const css = readFileSync(new URL("../../web/studio/studio.css", import.meta.url), "utf8");
  assert.match(css, /@media \(min-width: 70rem\) \{[^}]*\.studio-compare-side \{[^}]*display: grid;/);
  assert.match(css, /\.studio-compare-words \{[^}]*white-space: pre-wrap;[^}]*unicode-bidi: isolate;/);
});
