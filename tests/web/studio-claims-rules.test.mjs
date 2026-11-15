// Claims and evidence's rules (Studio R12), ported from admin-research-claims.test.mjs: the pure
// cases, minus the Visual editor's selection mapping (gone with Visual mode). The sheet's cases are
// in tests/browser/studio-claims.spec.mjs.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as rules from "../../web/studio/parts/claims-rules.js";
import { sayId } from "../../web/studio/parts/research-says.js";
const { CLAIM_RELATIONS,relationWords,CLAIM_REVIEW_STATES,reviewStateWords,MAX_CLAIM_STATEMENT_CHARS,MAX_CLAIM_RATIONALE_CHARS,CLAIM_UNSAFE_TEXT,claimEncoder,utf8Length,claimSelectionAnchor,claimAnchorStatusText,claimLinkColumns,claimFindings,CLAIM_FINDING_OUTCOMES,claimFindingsSummary,claimCountsText,claimDraft,claimPayload,evidenceLinkDraft,evidenceLinkPayload,validateEvidenceLinkDraft,claimDiagnosticControl,claimsErrorMessage,boxSelectionToBody,occurrences } = rules;

// Claims and evidence links in Evidence Studio (A4.2, ADR 0073): selection anchors in UTF-8
// bytes, opposing links side by side and never netted, stale and ambiguous ranges refused,
// conflicts that keep the draft, undo, keyboard labels, and hostile text kept as text.



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

const SOURCES = () => [
  { id: "plato-republic", kind: "work", title: "Πολιτεία" },
  { id: "slings-2003", kind: "edition", of: "plato-republic", title: "Platonis Rempublicam" },
  { id: "scholar", kind: "work", title: "A study" },
];

const PASSAGES = () => [{ id: "passage-1", source: "slings-2003", locators: [{ kind: "page", value: "514" }], preview: "the cave" }];

const CLAIM = () => ({ id: "c1", post: "on-caves", statement: HOSTILE, anchor: { start: 4, end: 8, text: "cave" }, recordedBy: { kind: "author" }, origin: "authored", visibility: "private", shelf: 1 });

const LINKS = () => [
  { id: "l1", claim: "c1", relation: "supports", evidence: { source: "slings-2003", locators: [{ kind: "page", value: "514" }], margin: "kept" }, rationale: "Socrates says so.", confidence: "plausible", reviewState: "unreviewed", recordedBy: { kind: "author" }, origin: "authored", visibility: "private" },
  { id: "l2", claim: "c1", relation: "contradicts", evidence: { source: "scholar" }, confidence: "tentative", uncertainty: "Disputed.", reviewState: "reviewed", recordedBy: { kind: "author" }, origin: "authored", visibility: "private" },
  { id: "l3", claim: "c1", relation: "contradicts", evidence: { source: "plato-republic" }, confidence: "strong", reviewState: "unreviewed", recordedBy: { kind: "author" }, origin: "authored", visibility: "private" },
];

const view = (over = {}) => ({
  file: ".openblog/private/research/claims.json",
  revision: "r1",
  stored: true,
  post: "on-caves",
  claims: [CLAIM(), { id: "c9", post: "elsewhere", statement: "Another post's claim", visibility: "private" }],
  links: LINKS(),
  notices: [],
  anchors: { c1: { status: "verified" } },
  counts: { c1: { supports: 1, contradicts: 2, contextualizes: 0 }, c9: { supports: 0, contradicts: 0, contextualizes: 0 } },
  projected: [],
  sources: SOURCES(),
  passages: PASSAGES(),
  ...over,
});

function claimsApi(handlers = {}) {
  const calls = [];
  const all = { "GET research/claims?path=posts%2F2026-01-07-on-caves.md": () => view(), ...handlers };
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

const POST = { path: "posts/2026-01-07-on-caves.md", etag: "e1", dirty: false, slug: "on-caves" };

async function mountStudio(api, { post = POST, selection = () => ({ anchor: { start: 4, end: 8, text: "cave" } }) } = {}) {
  const studio = createClaimsStudio({ api, post: () => post, selection });
  globalThis.document.body.append(studio.element);
  await studio.load();
  return studio;
}

const byId = (root, id) => root.querySelector(`#${id}`);

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const buttonLabelled = (root, text) => root.querySelectorAll("button").find((button) => button.textContent === text || button.getAttribute("aria-label") === text);

const allNodes = (root) => root.children.flatMap((child) => [child, ...allNodes(child)]);

const withData = (root, key, value) => allNodes(root).filter((node) => node.dataset?.[key] === value);

const type = async (control, value, event = "input") => {
  control.value = value;
  await control.dispatch(event, { target: control });
};

const choose = (control, value) => type(control, value, "change");

const submit = (root) => root.querySelector("form").dispatch("submit");

// ---------------------------------------------------------------- pure helpers

test("selections become UTF-8 byte anchors in the saved draft's terms", () => {
  assert.equal(utf8Length("Πλάτων 🙂"), 17);
  const body = "The cave. Πλάτων 🙂 says so.";
  const start = body.indexOf("Πλάτων");
  assert.deepEqual(claimSelectionAnchor(body, start, start + "Πλάτων 🙂".length), { anchor: { start: 10, end: 27, text: "Πλάτων 🙂" } });
  // Surrounding spaces are trimmed, CRLF folds to LF, and leading line breaks do not count: the
  // server's anchor text drops them too, as an Admin save trims them after the front matter.
  assert.deepEqual(claimSelectionAnchor("\n\nab  cd\r\nef ", 6, 13), { anchor: { start: 4, end: 9, text: "cd\nef" } });
  assert.equal(claimSelectionAnchor(body, 3, 3).error, "claims.selectFirst");
  assert.equal(claimSelectionAnchor("a \u202e b", 0, 5).error, "claims.plainWords");
  assert.deepEqual(claimSelectionAnchor("x".repeat(2100), 0, 2100), { error: "claims.tooMuch", vars: { max: 2000 } });
});

test("links are grouped by relation in file order and counted apart, never netted", () => {
  const columns = claimLinkColumns(LINKS(), "c1");
  assert.deepEqual(columns.supports.map((link) => link.id), ["l1"]);
  assert.deepEqual(columns.contradicts.map((link) => link.id), ["l2", "l3"]);
  assert.deepEqual(columns.contextualizes, []);
  const text = claimCountsText({ supports: 1, contradicts: 2, contextualizes: 0 });
  assert.equal(text, "1 supporting, 2 contradicting, 0 giving context", "three figures, never combined");
  assert.doesNotMatch(text, /net|score|verdict|-1|total/i);
  assert.deepEqual(["moved", "stale", "ambiguous", "verified"].map((status) => claimAnchorStatusText({ status })), ["claims.moved", "claims.lost", "claims.ambiguous", "claims.inPlace"]);
  assert.equal(claimAnchorStatusText({ status: "stale", missingPost: true }), "claims.saveFirst");
  assert.equal(claimAnchorStatusText(null), "claims.whole");
});

test("payloads keep unknown fields, and a relation is never defaulted", () => {
  const claim = claimDraft(CLAIM());
  claim.statement = " Reworded. ";
  claim.approved = true;
  assert.deepEqual(claimPayload(claim), { ...CLAIM(), statement: "Reworded.", visibility: "approved" });
  const fresh = evidenceLinkDraft(null, { claim: "c1" });
  assert.equal(fresh.relation, "");
  assert.equal(validateEvidenceLinkDraft(fresh, { sources: SOURCES(), passages: PASSAGES() }).field, "relation");
  const link = evidenceLinkDraft(LINKS()[0]);
  link.rationale = "Plainly.";
  assert.deepEqual(evidenceLinkPayload(link), { ...LINKS()[0], rationale: "Plainly." });
  link.evidence.passage = "passage-1";
  link.evidence.source = "scholar";
  assert.equal(validateEvidenceLinkDraft(link, { sources: SOURCES(), passages: PASSAGES() }).field, "passage");
  link.evidence.source = "slings-2003";
  link.approved = true;
  assert.equal(validateEvidenceLinkDraft(link, { sources: SOURCES(), passages: PASSAGES() }).id, "claims.noPassagePublic");
  link.approved = false;
  link.evidence.locators = "514";
  assert.equal(validateEvidenceLinkDraft(link, { sources: SOURCES(), passages: PASSAGES() }).field, "locators");
  assert.equal(claimDiagnosticControl("evidence.passage", "link"), "passage");
  assert.equal(claimDiagnosticControl("anchor", "claim"), "statement");
  assert.match(claimsErrorMessage({ data: { diagnostics: [{ field: "claim", message: "stale words", code: "stale-anchor" }] } }), /stale-anchor claim: stale words/, "the server's own sentence, for the details");
});

const FINDINGS = () => [
  { code: "claim-contradiction-undiscussed", outcome: "needs-review", source: { path: "posts/2026-01-07-on-caves.md", field: "claims[c1].uncertainty" }, message: "Claim `c1` has 2 contradicting evidence links and no uncertainty note saying how the post addresses them.", repair: "Discuss the contradicting evidence in the post, then record how in the claim's uncertainty note in Evidence Studio.", object: { claim: "c1" } },
  { code: "claim-location-unreviewed", outcome: "needs-review", source: { path: "posts/2026-01-07-on-caves.md", field: "links[l1].reviewState" }, message: `Evidence link \`l1\` gives a location. ${HOSTILE}`, repair: "Compare the location with the source.", object: { claim: "c1", link: "l1" } },
  { code: "claim-locator-missing", outcome: "potential", source: { path: "posts/2026-01-07-on-caves.md", field: "links[l2].evidence.locators" }, message: "Evidence link `l2` names source `scholar` but no page or other location in it.", repair: "Add where it is.", object: { claim: "c1", link: "l2" } },
  { code: "claim-evidence-missing", outcome: "potential", source: { path: ".openblog/private/research/claims.json", field: "claims[c9]" }, message: "Claim `c9` has no evidence links.", repair: "Link the sources you relied on.", object: { claim: "c9" } },
];

test("evidence gaps are kept per claim in review order and summarised as gaps, never verdicts", () => {
  assert.deepEqual(claimFindings(FINDINGS(), "c1").map((finding) => finding.code), ["claim-contradiction-undiscussed", "claim-location-unreviewed", "claim-locator-missing"]);
  assert.deepEqual(claimFindings([null, { object: { claim: "c1" } }, ...FINDINGS()], "c9").map((finding) => finding.code), ["claim-evidence-missing"]);
  const summary = claimFindingsSummary(claimFindings(FINDINGS(), "c1"));
  assert.equal(summary, "0 found, 1 possible, 2 to review.");
  assert.match(claimFindingsSummary([]), /^No gaps or prompts/);
  assert.doesNotMatch(`${summary} ${claimFindingsSummary([])}`, /verified|score|proven|correct/i);
  // A position check is never labelled as verifying the claim.
  assert.equal(sayId(claimAnchorStatusText({ status: "verified" })), "In place.", "a position check never says the claim is verified");
});

// ---------------------------------------------------------------- wiring

test("Write reaches Claims and evidence, and its code builds no markup from text", () => {
  const read = (path) => readFileSync(new URL(`../../web/studio/${path}`, import.meta.url), "utf8");
  const wiring = read("parts/write-research.js");
  assert.match(wiring, /name === "claims"/, "?sheet=claims opens it");
  assert.match(wiring, /query\.claim/, "?claim= names the claim to show (R10 links here)");
  assert.match(read("router.js"), /evidence: "claims"/, "the old Evidence pane opens it");
  const code = ["parts/claims-rules.js", "parts/claims-sheet.js"].map(read).join("\n");
  assert.doesNotMatch(code, /innerHTML|insertAdjacentHTML|outerHTML|createContextualFragment/);
  assert.match(code, /role: "alert"|"aria-live": "polite"/);
  assert.doesNotMatch(code, /[\u202a-\u202e\u2066-\u2069]/u, "no literal direction-override characters in the source");
});

test("a selection in one box maps to the body, stays in one part, and is found once", () => {
  assert.deepEqual(boxSelectionToBody({ start: 0, text: "One. Two." }, 5, 9), { start: 5, end: 9 });
  assert.deepEqual(boxSelectionToBody({ start: 10, text: "abc" }, 0, 3), { start: 10, end: 13 }, "a box's own place in the body is added");
  assert.deepEqual(boxSelectionToBody({ start: 0, text: "First part.\n\nSecond part." }, 0, 25), { error: "claims.onePart" });
  assert.deepEqual(boxSelectionToBody({ start: 0, text: "abc" }, 2, 2), { error: "claims.selectFirst" });
  assert.equal(occurrences("the cave and the cave", "the cave"), 2);
  assert.equal(occurrences("the cave", "cave"), 1);
  assert.equal(occurrences("x", "  "), 0);
});

test("claims styles put supporting and contradicting side by side and add no motion", () => {
  const css = readFileSync(new URL("../../web/studio/studio.css", import.meta.url), "utf8");
  assert.match(css, /\.studio-claims-columns \{[^}]*display: grid;[^}]*minmax\(min\(14rem, 100%\), 1fr\)/, "three columns where they fit, one after another where not");
  const block = css.slice(css.indexOf("/* R12 research */"));
  assert.ok(block.length > 100);
  assert.doesNotMatch(block, /animation|transition/, "no motion");
});
