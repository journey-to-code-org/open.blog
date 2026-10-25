import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { ARRANGEMENT_LAYOUTS, TURN_LABEL_MAX_BYTES, ObAdmin, REFLECTION_PROMPTS, arrangementDraft, arrangementFailure, arrangementPayload, draftFailure, moveItem, nextRoundId, partBreakInsertion, validateArrangement, draftStateText, insertAtSelection, previewSectionText, previewStateText, promptInsertion, revealSlotText } from "../../web/admin/admin.js";

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
    const valued = selector.match(/^([a-z]*)\[([a-z-]+)="([^"]*)"\]$/);
    if (valued) return (!valued[1] || this.tagName === valued[1].toUpperCase()) && this.attributes[valued[2]] === valued[3];
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
  globalThis.location = { hash: "#/shared", origin: "https://blog.example" };
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
const settle = async () => {
  for (let i = 0; i < 8; i += 1) await tick();
};

class FakeApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

const PUBLICATION = "shared-0a1b2c3d4e5f";
const stampOf = (number) => ({ number, contributionId: "participant-1", digest: "d" });

/** A stand-in for the Admin API: it checks the expected revision like the server does. */
function fakeApi({ number = 0, markdown = "", reveal = {}, failures = {} } = {}) {
  const state = { number, markdown, calls: [], reveal: { policy: "voluntary", ready: false, canSetPolicy: false, slots: [], ...reveal } };
  return {
    state,
    async call(method, path, options = {}) {
      const key = `${method} ${path.split("?")[0]}`;
      state.calls.push({ key, body: options.json });
      if (failures[key]) {
        const failure = failures[key];
        delete failures[key];
        throw failure;
      }
      switch (key) {
        case "GET collaboration/draft":
          return { draft: state.number ? { stamp: stampOf(state.number), markdown: state.markdown } : null };
        case "PUT collaboration/draft":
          if (options.json.expectedRevision !== state.number) {
            throw new FakeApiError("Your draft changed since you last read it.", 409, { error: "Your draft changed since you last read it.", current: { stamp: stampOf(state.number), markdown: state.markdown } });
          }
          state.number += 1;
          state.markdown = options.json.markdown;
          return { stamp: stampOf(state.number) };
        case "GET collaboration/reveal":
          return state.reveal;
        case "GET collaboration/reflection":
          return { structure: state.structure ?? null, participants: [{ id: "p1", displayName: "Ann" }, { id: "p2", displayName: "Bo" }], layouts: [], canArrange: state.canArrange === true };
        case "PUT collaboration/reflection":
          if (options.json.expectedRevision !== (state.structure?.revision ?? 0)) throw new FakeApiError("changed", 409, { error: "The arrangement changed." });
          state.structure = options.json.structure;
          return { structure: state.structure };
        case "GET collaboration/preview":
          if (state.previewFails) throw new FakeApiError("not found", 404, null);
          return { preview: state.preview };
        case "PUT collaboration/reveal/ready":
          state.reveal = { ...state.reveal, ready: options.json.revision !== null };
          return { ready: state.reveal.ready, revealed: false };
        case "PUT collaboration/reveal/policy":
          state.reveal = { ...state.reveal, policy: options.json.policy, ready: false };
          return { policy: options.json.policy };
        default:
          throw new FakeApiError(`unexpected ${key}`, 500, null);
      }
    },
  };
}

async function openDraft(api, roles = ["contributor"]) {
  const app = new ObAdmin();
  app.api = api;
  const panel = app.draftPanel({ publicationId: PUBLICATION, roles }, 0);
  if (!panel) return { panel };
  document.body.append(panel);
  panel.open = true;
  await panel.dispatch("toggle");
  await settle();
  return { panel };
}

const button = (root, label) => root.querySelectorAll("button").find((node) => node.attributes["aria-label"] === label || node.textContent === label);
const textarea = (root) => root.querySelector("textarea");
const textOf = (root) => root.textContent.replace(/\s+/g, " ");
const save = (panel) => panel.querySelector("form").dispatch("submit");
const typeInto = async (panel, value) => {
  textarea(panel).value = value;
  await textarea(panel).dispatch("input");
};
const alertOf = (root) => root.querySelectorAll("p").find((node) => node.attributes.role === "alert");

// ---------------------------------------------------------------- pure helpers

test("prompts are plain optional quotes, inserted where the caret is and owned by the writer", () => {
  assert.ok(REFLECTION_PROMPTS.length >= 3);
  assert.equal(promptInsertion("  What   stood\nout? "), "> What stood out?\n\n");
  assert.deepEqual(insertAtSelection("ab", 1, 1, "X"), { text: "aXb", caret: 2 });
  assert.deepEqual(insertAtSelection("ab", 0, 2, "X"), { text: "X", caret: 1 });
  assert.deepEqual(insertAtSelection("ab", undefined, undefined, "X"), { text: "abX", caret: 3 });
  assert.deepEqual(insertAtSelection("ab", 9, 9, "X"), { text: "abX", caret: 3 });
});

test("the save state is always words", () => {
  assert.match(draftStateText({}), /Nothing saved yet/);
  assert.match(draftStateText({ number: 3 }), /Saved as revision 3/);
  assert.match(draftStateText({ number: 3, dirty: true }), /Unsaved changes.*revision 3/);
  assert.match(draftStateText({ dirty: true }), /Unsaved changes. Nothing saved/);
  assert.equal(draftStateText({ saving: true }), "Saving...");
});

test("failures tell the writer their text is safe and what kind of problem it was", () => {
  assert.equal(draftFailure(new TypeError("Failed to fetch")).kind, "offline");
  assert.match(draftFailure(new TypeError("x")).message, /offline.*still here/);
  const current = { stamp: stampOf(2), markdown: "theirs" };
  assert.deepEqual(draftFailure(new FakeApiError("m", 409, { error: "newer", current })), { kind: "conflict", message: "newer", current });
  assert.equal(draftFailure(new FakeApiError("m", 404, null)).kind, "denied");
  assert.equal(draftFailure(new FakeApiError("m", 422, { error: "too big" })).message, "too big");
  assert.match(draftFailure(new FakeApiError("", 500, null)).message, /still here/);
});

test("comparison slots say only what the reader may know", () => {
  assert.match(revealSlotText({ kind: "own", displayName: "Ada" }), /Ada \(you\)/);
  assert.match(revealSlotText({ kind: "revealed", displayName: "Grace", stamp: { number: 2 } }), /Grace: revealed to you, revision 2/);
  const offered = revealSlotText({ kind: "private", displayName: "Linus", ready: true });
  const quiet = revealSlotText({ kind: "private", displayName: "Linus", ready: false });
  assert.match(offered, /offered a revision/);
  assert.match(quiet, /not offered/);
  assert.doesNotMatch(offered + quiet, /revision \d/);
});

// ---------------------------------------------------------------- the panel

test("the draft panel is for writers and coordinators and loads only when opened", withDom(async () => {
  const app = new ObAdmin();
  assert.equal(app.draftPanel({ publicationId: PUBLICATION, roles: ["reader"] }, 0), null);
  const api = fakeApi({ number: 2, markdown: "mine" });
  app.api = api;
  const panel = app.draftPanel({ publicationId: PUBLICATION, roles: ["contributor"] }, 0);
  assert.equal(api.state.calls.length, 0, "nothing is requested until the panel opens");
  panel.open = true;
  await panel.dispatch("toggle");
  await settle();
  assert.equal(textarea(panel).value, "mine");
  assert.deepEqual(api.state.calls.map((call) => call.key), ["GET collaboration/draft", "GET collaboration/reveal", "GET collaboration/reflection"]);
}));

test("prompts can be added, edited, deleted, hidden, and are never required to save", withDom(async () => {
  const api = fakeApi();
  const { panel } = await openDraft(api);
  assert.match(textOf(panel), /Prompts are optional/);
  const prompt = REFLECTION_PROMPTS[0];
  await button(panel, `Add prompt to draft: ${prompt}`).click();
  assert.equal(textarea(panel).value, `> ${prompt}\n\n`);
  assert.match(textOf(panel), /Unsaved changes/);
  await typeInto(panel, "");
  await button(panel, "Hide prompts").click();
  assert.equal(panel.querySelector(".oba-draft-prompts").hidden, true);
  assert.equal(button(panel, "Show prompts").attributes["aria-pressed"], "true");
  await save(panel);
  await settle();
  assert.equal(api.state.number, 1, "an empty draft saves: no length or structure is enforced");
  assert.equal(api.state.markdown, "");
}));

test("saving shows an unsaved indicator, then the saved revision, and announces it politely", withDom(async () => {
  const api = fakeApi();
  const { panel } = await openDraft(api);
  assert.match(textOf(panel), /Nothing saved yet/);
  await typeInto(panel, "my words");
  assert.match(textOf(panel), /Unsaved changes. Nothing saved yet. 8 characters/);
  await save(panel);
  await settle();
  assert.match(textOf(panel), /Saved as revision 1/);
  const live = panel.querySelectorAll("p").find((node) => node.attributes.role === "status");
  assert.equal(live.attributes["aria-live"], "polite");
  assert.match(live.textContent, /Saved as revision 1/);
  assert.deepEqual(api.state.calls.find((call) => call.key === "PUT collaboration/draft").body, { publicationId: PUBLICATION, expectedRevision: 0, markdown: "my words" });
}));

test("a conflict keeps the original text, moves focus to the recovery heading, and offers every way out", withDom(async (dom) => {
  const api = fakeApi({ number: 1, markdown: "first" });
  const { panel } = await openDraft(api);
  api.state.number = 2;
  api.state.markdown = "from another tab";
  await typeInto(panel, "my unsaved text");
  await save(panel);
  await settle();
  const conflict = panel.querySelector(".oba-draft-conflict");
  assert.equal(conflict.hidden, false);
  assert.equal(textarea(panel).value, "my unsaved text", "the editor is untouched");
  assert.equal(api.state.markdown, "from another tab", "nothing was overwritten");
  assert.equal(dom.document.activeElement.id, "oba-draft-0-conflict-heading");
  assert.equal(conflict.attributes["aria-labelledby"], "oba-draft-0-conflict-heading");
  assert.equal(conflict.querySelector("#oba-draft-0-conflict-mine").value, "my unsaved text");
  assert.equal(conflict.querySelector("#oba-draft-0-conflict-newer").value, "from another tab");
  assert.match(textOf(conflict), /Newer saved copy \(revision 2\)/);
  for (const label of ["Save my text as a new revision", "Use the newer copy instead", "Decide later"]) assert.ok(button(conflict, label), label);
}));

test("keeping my text saves it on top of the newer revision, and focus returns to the editor", withDom(async (dom) => {
  const api = fakeApi({ number: 1, markdown: "first" });
  const { panel } = await openDraft(api);
  api.state.number = 2;
  await typeInto(panel, "mine");
  await save(panel);
  await settle();
  await button(panel, "Save my text as a new revision").click();
  await settle();
  assert.equal(api.state.number, 3);
  assert.equal(api.state.markdown, "mine");
  assert.equal(panel.querySelector(".oba-draft-conflict").hidden, true);
  assert.equal(dom.document.activeElement, textarea(panel));
  assert.match(textOf(panel), /Saved as revision 3/);
}));

test("using the newer copy can be undone: the earlier text comes back unsaved", withDom(async (dom) => {
  const api = fakeApi({ number: 1, markdown: "first" });
  const { panel } = await openDraft(api);
  api.state.number = 2;
  api.state.markdown = "theirs";
  await typeInto(panel, "mine");
  await save(panel);
  await settle();
  await button(panel, "Use the newer copy instead").click();
  assert.equal(textarea(panel).value, "theirs");
  assert.equal(dom.document.activeElement, textarea(panel));
  const restore = button(panel, "Restore my earlier text");
  assert.equal(restore.hidden, false);
  await restore.click();
  assert.equal(textarea(panel).value, "mine");
  assert.equal(restore.hidden, true);
  assert.match(textOf(panel), /Unsaved changes/);
  assert.equal(api.state.markdown, "theirs", "restoring never saves");
}));

test("deciding later leaves the text alone and returns focus to the editor", withDom(async (dom) => {
  const api = fakeApi({ number: 1, markdown: "first" });
  const { panel } = await openDraft(api);
  api.state.number = 2;
  await typeInto(panel, "mine");
  await save(panel);
  await settle();
  await button(panel, "Decide later").click();
  assert.equal(textarea(panel).value, "mine");
  assert.equal(dom.document.activeElement, textarea(panel));
  assert.equal(panel.querySelector(".oba-draft-conflict").hidden, true);
}));

test("a race without the newer copy fetches it instead of losing the text", withDom(async () => {
  const failures = { "PUT collaboration/draft": new FakeApiError("Your draft changed while you were saving.", 409, null) };
  const api = fakeApi({ number: 1, markdown: "first", failures });
  const { panel } = await openDraft(api);
  await typeInto(panel, "mine");
  await save(panel);
  await settle();
  assert.equal(panel.querySelector(".oba-draft-conflict").hidden, false);
  assert.equal(textarea(panel).value, "mine");
  assert.equal(panel.querySelector("#oba-draft-0-conflict-newer").value, "first");
}));

test("offline and oversized failures keep the text, say so, and put focus on the alert", withDom(async (dom) => {
  const failures = { "PUT collaboration/draft": new TypeError("Failed to fetch") };
  const api = fakeApi({ failures });
  const { panel } = await openDraft(api);
  await typeInto(panel, "keep me");
  await save(panel);
  await settle();
  const alert = alertOf(panel);
  assert.equal(alert.hidden, false);
  assert.match(alert.textContent, /offline.*still here/);
  assert.equal(dom.document.activeElement, alert);
  assert.equal(textarea(panel).value, "keep me");
  assert.match(textOf(panel), /Unsaved changes/);
  failures["PUT collaboration/draft"] = new FakeApiError("big", 422, { error: "This draft has reached its limit.", field: "markdown" });
  await save(panel);
  await settle();
  assert.match(alert.textContent, /reached its limit/);
  await save(panel);
  await settle();
  assert.equal(alert.hidden, true, "a later success clears the problem");
  assert.equal(api.state.markdown, "keep me");
}));

test("losing access shows a plain notice and no editor", withDom(async () => {
  const failures = { "GET collaboration/draft": new FakeApiError("nf", 404, null), "GET collaboration/reveal": new FakeApiError("nf", 404, null) };
  const { panel } = await openDraft(fakeApi({ failures }), ["coordinator"]);
  assert.equal(panel.querySelector(".oba-draft-editor").hidden, true);
  assert.match(textOf(panel), /You cannot write a draft/);
  assert.equal(panel.querySelector(".oba-draft-sharing").hidden, true);
}));

// ---------------------------------------------------------------- sharing

const SLOTS = [
  { participantId: "participant-1", displayName: "Ada", kind: "own", ready: false, stamp: stampOf(1), markdown: "my text" },
  { participantId: "participant-2", displayName: "Grace", kind: "private", ready: true, stamp: null, markdown: null },
  { participantId: "participant-3", displayName: "Linus", kind: "revealed", ready: false, stamp: { number: 4 }, markdown: "<img src=x onerror=alert(1)>" },
];

test("other writers appear only as the server revealed them, and revealed prose is text, never markup", withDom(async () => {
  const { panel } = await openDraft(fakeApi({ number: 1, markdown: "my text", reveal: { slots: SLOTS } }));
  const text = textOf(panel);
  assert.match(text, /Grace: private. They have offered a revision/);
  assert.match(text, /Linus: revealed to you, revision 4/);
  const revealed = panel.querySelectorAll("pre").find((node) => node.attributes["aria-label"] === "Text from Linus");
  assert.equal(revealed.textContent, "<img src=x onerror=alert(1)>");
  assert.equal(panel.querySelectorAll("img").length, 0);
  assert.equal(panel.querySelectorAll("pre").some((node) => node.attributes["aria-label"] === "Text from Grace"), false);
  assert.doesNotMatch(admin.slice(admin.indexOf("draftPanel(publication, index) {"), admin.indexOf("The page an invitation link opens")), /innerHTML/);
}));

test("offering a revision asks first, names the revision, and Escape or Cancel changes nothing", withDom(async (dom) => {
  const api = fakeApi({ number: 2, markdown: "mine", reveal: { slots: SLOTS.slice(0, 2).map((slot) => ({ ...slot, ready: false })) } });
  const { panel } = await openDraft(api);
  const offer = button(panel, "Offer revision 2 to the group");
  await offer.click();
  const box = panel.querySelector(".oba-confirm");
  assert.equal(dom.document.activeElement, box);
  assert.match(textOf(box), /cannot be taken back/);
  await box.dispatch("keydown", { key: "Escape" });
  assert.equal(panel.querySelector(".oba-confirm"), null);
  assert.equal(dom.document.activeElement, offer);
  assert.equal(api.state.calls.some((call) => call.key === "PUT collaboration/reveal/ready"), false);
  await offer.click();
  await button(panel.querySelector(".oba-confirm"), "Share revision 2").click();
  await settle();
  assert.deepEqual(api.state.calls.find((call) => call.key === "PUT collaboration/reveal/ready").body, { publicationId: PUBLICATION, revision: 2 });
  await button(panel, "Take back my offer").click();
  await settle();
  assert.equal(api.state.reveal.ready, false);
}));

test("the offer box can never send a revision the writer did not confirm", withDom(async () => {
  const api = fakeApi({ number: 3, markdown: "mine", reveal: { slots: SLOTS.slice(0, 2).map((slot) => ({ ...slot, ready: false })) } });
  const { panel } = await openDraft(api);
  await button(panel, "Offer revision 3 to the group").click();
  const stale = button(panel.querySelector(".oba-confirm"), "Share revision 3");
  assert.ok(stale);
  api.state.number = 4;
  api.state.markdown = "from another tab";
  await typeInto(panel, "my unsaved text");
  await save(panel);
  await settle();
  await button(panel.querySelector(".oba-draft-conflict"), "Use the newer copy instead").click();
  await settle();
  // A detached button cannot be clicked in a browser; if it were, it still carries revision 3.
  await stale.click();
  await settle();
  const sent = api.state.calls.filter((call) => call.key === "PUT collaboration/reveal/ready");
  assert.ok(sent.every((call) => call.body.revision === 3), "only the confirmed revision may be sent");
  api.state.reveal = { ...api.state.reveal, ready: false };
  await button(panel, "Take back my offer")?.click();
  await settle();
  assert.equal(panel.querySelector(".oba-confirm"), null, "the stale box is gone once the draft changes");
  assert.ok(button(panel, "Offer revision 4 to the group"));
}));

test("after offering, taking back or changing the rule, focus stays inside the sharing section", withDom(async (dom) => {
  const api = fakeApi({ number: 2, markdown: "mine", reveal: { canSetPolicy: true, slots: SLOTS.slice(0, 2).map((slot) => ({ ...slot, ready: false })) } });
  const { panel } = await openDraft(api, ["coordinator"]);
  const sharing = panel.querySelector(".oba-draft-sharing");
  const inSharing = () => sharing.contains(dom.document.activeElement) && dom.document.activeElement.attributes.tabindex === "-1";
  await button(panel, "Offer revision 2 to the group").click();
  await button(panel.querySelector(".oba-confirm"), "Share revision 2").click();
  await settle();
  assert.ok(inSharing(), "after offering");
  await button(panel, "Take back my offer").click();
  await settle();
  assert.ok(inSharing(), "after taking back");
  dom.document.activeElement = null;
  await button(panel, "Change sharing rule").click();
  await settle();
  assert.ok(inSharing(), "after changing the rule");
}));

test("with sharing off or nothing saved there is nothing to offer, and coordinators can change the rule", withDom(async () => {
  const off = await openDraft(fakeApi({ number: 1, markdown: "x", reveal: { policy: "independent", slots: SLOTS.slice(0, 1) } }));
  assert.equal(button(off.panel, "Offer revision 1 to the group"), undefined);
  assert.match(textOf(off.panel), /Independent. Nobody sees/);
  const unsaved = await openDraft(fakeApi({ reveal: { slots: SLOTS.slice(0, 1) } }));
  assert.match(textOf(unsaved.panel), /Save a draft before you can offer it/);
  const api = fakeApi({ number: 1, markdown: "x", reveal: { policy: "independent", canSetPolicy: true, slots: SLOTS.slice(0, 1) } });
  const { panel } = await openDraft(api, ["coordinator"]);
  panel.querySelector("#oba-draft-0-policy").value = "allReady";
  await button(panel, "Change sharing rule").click();
  await settle();
  assert.deepEqual(api.state.calls.find((call) => call.key === "PUT collaboration/reveal/policy").body, { publicationId: PUBLICATION, policy: "allReady" });
  assert.match(textOf(panel), /sharing rule changed.*nothing was shared/);
}));

// ---------------------------------------------------------------- combined preview

const PREVIEW = {
  complete: false,
  ready: false,
  previewUrl: "/admin/api/preview/" + "a".repeat(64),
  sections: [
    { participantId: "a", displayName: "Ada", shown: true, revision: 2, approval: "approved", required: true },
    { participantId: "b", displayName: "Grace", shown: false, revision: null, approval: "stale", required: true },
  ],
};

test("preview lines say what is shown and where each approval stands, without leaking hidden revisions", () => {
  assert.equal(previewSectionText(PREVIEW.sections[0]), "Ada: revision 2; approved.");
  const hidden = previewSectionText(PREVIEW.sections[1]);
  assert.match(hidden, /Grace: not shared with you at its current revision; approval out of date/);
  assert.doesNotMatch(hidden, /revision \d/);
  assert.match(previewSectionText({ displayName: "Linus", shown: true, revision: 1, approval: "awaiting", required: false }), /awaiting approval \(approval not required\)/);
  assert.match(previewStateText({ ready: true }), /Every required author has approved/);
  assert.match(previewStateText({ complete: true }), /Not ready to publish/);
  assert.match(previewStateText({}), /Incomplete/);
});

test("the combined preview opens on request in a frame with no sandbox allowances, labelled as unpublished", withDom(async () => {
  const api = fakeApi({ number: 1, markdown: "x", reveal: { slots: SLOTS.slice(0, 1) } });
  api.state.preview = PREVIEW;
  const { panel } = await openDraft(api);
  assert.equal(api.state.calls.some((call) => call.key === "GET collaboration/preview"), false, "nothing is built until asked");
  assert.equal(panel.querySelector("iframe"), null);
  await button(panel, "Review the combined piece").click();
  await settle();
  const frame = panel.querySelector("iframe");
  assert.equal(frame.attributes.sandbox, "", "an empty sandbox allows no scripts, forms, popups or same-origin access");
  assert.equal(frame.attributes.src, PREVIEW.previewUrl);
  assert.match(frame.attributes.title, /not published/);
  assert.equal(frame.attributes.srcdoc, undefined, "prose never travels through the Admin page");
  assert.match(textOf(panel), /Preview, not published. Incomplete/);
  assert.match(textOf(panel), /Ada: revision 2; approved\./);
  assert.match(textOf(panel), /Grace: not shared with you.*approval out of date/);
}));

test("a failed preview shows a calm message, keeps nothing stale, and changes nothing", withDom(async () => {
  const api = fakeApi({ number: 1, markdown: "x", reveal: { slots: SLOTS.slice(0, 1) } });
  api.state.preview = PREVIEW;
  const { panel } = await openDraft(api);
  await button(panel, "Review the combined piece").click();
  await settle();
  assert.ok(panel.querySelector("iframe"));
  api.state.previewFails = true;
  await button(panel, "Review the combined piece").click();
  await settle();
  assert.equal(panel.querySelector("iframe"), null);
  assert.match(textOf(panel), /could not be loaded.*Nothing was changed/);
  assert.equal(api.state.calls.filter((call) => call.key.startsWith("PUT")).length, 0);
}));

// ---------------------------------------------------------------- layout and arrangement (ADR 0032)

test("the part break is the marker alone on its own line, and the starting arrangement reads no draft", () => {
  assert.equal(partBreakInsertion(), "\n<!-- openblog:part -->\n");
  assert.deepEqual(insertAtSelection("ab", 1, 1, partBreakInsertion()).text, "a\n<!-- openblog:part -->\nb");
  const people = [{ id: "p1", displayName: "Ann" }, { id: "p2", displayName: "Bo" }];
  const start = arrangementDraft(null, people);
  assert.equal(start.revision, 0);
  assert.equal(start.layout, "sequential");
  assert.deepEqual(start.rounds[0].turns, [{ draft: "p1", part: 0, label: "" }, { draft: "p2", part: 0, label: "" }]);
  const payload = arrangementPayload(start);
  assert.equal(payload.revision, 1);
  assert.equal(payload.rounds[0].roundPrompt, undefined, "an empty prompt is omitted");
  assert.deepEqual(Object.keys(payload).sort(), ["layout", "revision", "rounds", "version"]);
  assert.deepEqual(Object.keys(payload.rounds[0].turns[0]).sort(), ["draft", "part"], "a turn names a draft and a part, never a side or a person");
  assert.deepEqual(ARRANGEMENT_LAYOUTS.map((item) => item.value), ["sequential", "sideBySide", "pointCounterpoint", "alternatingDialogue", "roundtable"]);
});

test("moving and validating an arrangement never loses or repeats a turn", () => {
  assert.deepEqual(moveItem([1, 2, 3], 0, 1), [2, 1, 3]);
  assert.deepEqual(moveItem([1, 2, 3], 0, -1), [1, 2, 3]);
  assert.deepEqual(moveItem([1, 2, 3], 2, 1), [1, 2, 3]);
  assert.equal(nextRoundId([{ id: "round-1" }, { id: "round-3" }]), "round-4");
  const draft = arrangementDraft({ revision: 2, layout: "sideBySide", rounds: [{ id: "round-1", roundPrompt: "Why?", turns: [{ draft: "p1", part: 0 }, { draft: "p2", part: 0 }] }] }, []);
  assert.equal(validateArrangement(draft), "");
  assert.equal(arrangementPayload(draft).revision, 3);
  draft.rounds[0].turns.push({ draft: "p1", part: 0 });
  assert.match(validateArrangement(draft), /only once/);
  assert.match(validateArrangement({ rounds: [] }), /at least one round/);
  assert.match(validateArrangement({ rounds: [{ prompt: "", turns: [] }] }), /no turns/);
  assert.match(validateArrangement({ rounds: [{ prompt: "a\nb", turns: [{ draft: "p1", part: 0 }] }] }), /one line/);
  assert.equal(arrangementFailure({ status: 409 }).kind, "conflict");
  assert.equal(arrangementFailure({ status: 404 }).kind, "denied");
  assert.equal(arrangementFailure({}).kind, "offline");
});

test("a coordinator sets the layout and order with labelled, keyboard operable controls", withDom(async () => {
  const api = fakeApi({ number: 1, markdown: "x", reveal: { canSetPolicy: true, slots: SLOTS.slice(0, 1) } });
  api.state.canArrange = true;
  const { panel } = await openDraft(api, ["coordinator"]);
  assert.match(textOf(panel), /Layout and arrangement/);
  const radios = panel.querySelectorAll("input").filter((node) => node.attributes.type === "radio");
  assert.equal(radios.length, 5);
  for (const radio of radios) assert.ok(panel.querySelectorAll("label").some((label) => label.attributes.for === radio.attributes.id), "every layout has a label");
  await radios.find((radio) => radio.value === "sideBySide").dispatch("change");
  await button(panel, "Move round 1, turn 1 down").click();
  await button(panel, "Save layout and arrangement").click();
  await settle();
  const put = api.state.calls.find((call) => call.key === "PUT collaboration/reflection");
  assert.equal(put.body.expectedRevision, 0);
  assert.equal(put.body.structure.revision, 1);
  assert.equal(put.body.structure.layout, "sideBySide");
  assert.deepEqual(put.body.structure.rounds[0].turns.map((turn) => turn.draft), ["p2", "p1"]);
  assert.match(textOf(panel), /Approvals that no longer matched were cleared/);
}));

test("someone without the grant reads the arrangement and has no way to change it", withDom(async () => {
  const api = fakeApi({ number: 1, markdown: "x", reveal: { slots: SLOTS.slice(0, 1) } });
  api.state.canArrange = false;
  api.state.structure = { version: 1, revision: 1, layout: "sideBySide", rounds: [{ id: "round-1", roundPrompt: "Why?", turns: [{ draft: "p2", part: 0 }, { draft: "p1", part: 1 }] }] };
  const { panel } = await openDraft(api);
  assert.match(textOf(panel), /Layout: Side by side. Only a coordinator can change it./);
  assert.match(textOf(panel), /Round 1: Why\?. Bo, part 1; Ann, part 2\./);
  assert.equal(button(panel, "Save layout and arrangement"), undefined);
}));

test("a conflicting save shows the server words and reloads the current arrangement", withDom(async () => {
  const api = fakeApi({ number: 1, markdown: "x", reveal: { canSetPolicy: true, slots: SLOTS.slice(0, 1) } });
  api.state.canArrange = true;
  const { panel } = await openDraft(api, ["coordinator"]);
  api.state.structure = { version: 1, revision: 4, layout: "sequential", rounds: [{ id: "round-1", turns: [{ draft: "p1", part: 0 }] }] };
  await button(panel, "Save layout and arrangement").click();
  await settle();
  assert.match(panel.querySelectorAll("p").filter((node) => node.attributes.role === "alert").map((node) => node.textContent).join(" "), /arrangement changed/);
  assert.equal(api.state.structure.revision, 4, "nothing was overwritten");
}));

test("a writer can start a new part from the editor and the page documents the layout styles", withDom(async () => {
  const api = fakeApi({ number: 1, markdown: "first" });
  const { panel } = await openDraft(api);
  await button(panel, "Start a new part").click();
  assert.match(textarea(panel).value, /<!-- openblog:part -->/);
  assert.match(textOf(panel), /marker line is never published/);
  assert.match(styles, /\.oba-arrangement-turn/);
}));

test("a sharing refresh keeps unsaved arrangement edits, and each part input names its round and turn", withDom(async () => {
  const api = fakeApi({ number: 1, markdown: "x", reveal: { canSetPolicy: true, slots: SLOTS.slice(0, 1) } });
  api.state.canArrange = true;
  const { panel } = await openDraft(api, ["coordinator"]);
  const labels = panel.querySelectorAll("label").map((node) => node.textContent);
  assert.ok(labels.includes("Round 1, turn 1: part"));
  assert.ok(labels.includes("Round 1, turn 2: part"));
  await panel.querySelectorAll("input").find((node) => node.attributes.type === "radio" && node.value === "sideBySide").dispatch("change");
  await button(panel, "Move round 1, turn 1 down").click();
  // A readiness action refreshes the sharing panel; the local edits must survive it.
  await button(panel, "Change sharing rule").click();
  await settle();
  assert.equal(api.state.calls.filter((call) => call.key === "GET collaboration/reflection").length, 1);
  await button(panel, "Save layout and arrangement").click();
  await settle();
  const put = api.state.calls.find((call) => call.key === "PUT collaboration/reflection");
  assert.equal(put.body.structure.layout, "sideBySide");
  assert.deepEqual(put.body.structure.rounds[0].turns.map((turn) => turn.draft), ["p2", "p1"]);
  // Its own save reloads once more.
  assert.equal(api.state.calls.filter((call) => call.key === "GET collaboration/reflection").length, 2);
}));

test("turn labels are optional, short, one line, and sent only when written", withDom(async () => {
  const people = [{ id: "p1", displayName: "Ann" }, { id: "p2", displayName: "Bo" }];
  const draft = arrangementDraft(null, people);
  assert.equal(draft.rounds[0].turns[0].label, "");
  assert.equal(arrangementPayload(draft).rounds[0].turns[0].label, undefined, "no label is invented");
  draft.rounds[0].turns[0].label = "  Point <b>one</b>  ";
  assert.equal(arrangementPayload(draft).rounds[0].turns[0].label, "Point <b>one</b>");
  assert.equal(validateArrangement(draft), "");
  draft.rounds[0].turns[1].label = "two\nlines";
  assert.match(validateArrangement(draft), /one line/);
  draft.rounds[0].turns[1].label = "x".repeat(TURN_LABEL_MAX_BYTES + 1);
  assert.match(validateArrangement(draft), /at most 80 bytes/);
  const stored = arrangementDraft({ revision: 1, layout: "pointCounterpoint", rounds: [{ id: "round-1", turns: [{ draft: "p1", part: 0, label: "Point" }, { draft: "p2", part: 0 }] }] }, people);
  assert.deepEqual(stored.rounds[0].turns.map((turn) => turn.label), ["Point", ""]);

  const api = fakeApi({ number: 1, markdown: "x", reveal: { canSetPolicy: true, slots: SLOTS.slice(0, 1) } });
  api.state.canArrange = true;
  const { panel } = await openDraft(api, ["coordinator"]);
  const labelInputs = panel.querySelectorAll("input").filter((node) => /-label$/.test(node.attributes.id || ""));
  assert.equal(labelInputs.length, 2);
  for (const input of labelInputs) {
    assert.ok(panel.querySelectorAll("label").some((node) => node.attributes.for === input.attributes.id), "every label field is labelled");
  }
  assert.ok(panel.querySelectorAll("label").some((node) => node.textContent === "Round 1, turn 2: label (optional)"));
  labelInputs[0].value = "Counterpoint";
  await labelInputs[0].dispatch("input");
  await panel.querySelectorAll("input").find((node) => node.attributes.type === "radio" && node.value === "pointCounterpoint").dispatch("change");
  await button(panel, "Save layout and arrangement").click();
  await settle();
  const put = api.state.calls.find((call) => call.key === "PUT collaboration/reflection");
  assert.equal(put.body.structure.layout, "pointCounterpoint");
  assert.equal(put.body.structure.rounds[0].turns[0].label, "Counterpoint");
  assert.equal(put.body.structure.rounds[0].turns[1].label, undefined);
}));

// ---------------------------------------------------------------- source checks

test("the draft panel is wired into the shared reflections view, with labels and small-screen styles", () => {
  assert.match(admin, /this\.draftPanel\(publication, index\)/);
  assert.match(admin, /for: `\$\{prefix\}-text`/);
  assert.match(styles, /\.oba-draft-conflict/);
  assert.match(styles, /@media \(max-width: 44rem\)\s*\{\s*\.oba-draft/);
});
