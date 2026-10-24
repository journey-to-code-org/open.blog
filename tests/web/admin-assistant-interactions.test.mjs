import test from "node:test";
import assert from "node:assert/strict";

import { Editor, bindAssistantInteractionControl } from "../../web/admin/admin.js";

class DomNode {
  constructor(tag = "") {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.attributes = {};
    this.listeners = {};
    this._text = "";
  }
  append(...children) {
    for (const child of children.flat()) {
      if (child !== null && child !== undefined && child !== false) {
        this.children.push(child instanceof DomNode ? child : Object.assign(new DomNode("#text"), { textContent: String(child) }));
      }
    }
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }
  addEventListener(name, listener) {
    this.listeners[name] = listener;
  }
  click() {
    this.listeners.click?.({ type: "click", currentTarget: this });
  }
  focus() {
    this.focused = true;
  }
  close() {
    this.open = false;
  }
  remove() {
    this.removed = true;
  }
  showModal() {
    this.open = true;
  }
  set textContent(value) {
    this._text = String(value);
  }
  get textContent() {
    return this._text + this.children.map((child) => child.textContent).join("");
  }
}

test("Assistant Interactions click opens the existing knowledge-check proposal dialog", () => {
  const previousNode = globalThis.Node;
  const previousElement = globalThis.HTMLElement;
  const previousDocument = globalThis.document;
  globalThis.Node = DomNode;
  globalThis.HTMLElement = DomNode;
  const body = new DomNode("body");
  globalThis.document = {
    activeElement: null,
    body,
    createElement: (tag) => new DomNode(tag),
    createTextNode: (text) => Object.assign(new DomNode("#text"), { textContent: text }),
  };
  try {
    const editor = new Editor({ meta: { quizGeneration: false } }, { kind: "posts", fields: {}, body: "Draft body" });
    editor.ui = { body: Object.assign(new DomNode("textarea"), { value: "Draft body", selectionStart: 10, selectionEnd: 10 }) };
    editor.editorMode = "markdown";
    let captured = 0;
    editor.captureVisualSelection = () => { captured += 1; };
    const button = new DomNode("button");
    bindAssistantInteractionControl(editor, button);

    button.click();

    const dialog = body.children.find((child) => child.tagName === "DIALOG");
    assert.ok(dialog);
    assert.equal(dialog.open, true);
    assert.equal(captured, 1);
    assert.match(dialog.textContent, /Add a knowledge check/);
    assert.match(dialog.textContent, /Insert/);
  } finally {
    if (previousNode === undefined) delete globalThis.Node;
    else globalThis.Node = previousNode;
    if (previousElement === undefined) delete globalThis.HTMLElement;
    else globalThis.HTMLElement = previousElement;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test("Visual knowledge-check targets preserve selection and insertion returns to the visible editor", () => {
  const previousDocument = globalThis.document;
  const previousAnimationFrame = globalThis.requestAnimationFrame;
  let markerNode;
  globalThis.document = {
    createTextNode: (text) => {
      markerNode = {
        textContent: text,
        parentNode: { normalize() {} },
        remove() {},
      };
      return markerNode;
    },
  };
  globalThis.requestAnimationFrame = (callback) => callback();
  try {
    const editor = new Editor({ meta: {} }, { kind: "posts", fields: {}, body: "Before after\n" });
    const body = {
      value: "Before after\n",
      dispatchEvent() {
        this.inputEvents = (this.inputEvents || 0) + 1;
      },
    };
    const richBody = { contains: () => true, focus() { this.focused = true; } };
    editor.ui = { body, richBody };
    editor.editorMode = "visual";
    editor.visualDirty = false;
    const range = {
      commonAncestorContainer: {},
      cloneRange() { return this; },
      toString: () => "selected words",
      collapse() {},
      insertNode() {},
    };
    editor.visualSelection = range;
    editor.richEditorMarkdown = () => `Before ${markerNode.textContent}after\n`;
    const target = editor.knowledgeCheckTarget();
    assert.deepEqual(target, { markdown: "Before after\n", at: 7, selected: "selected words" });

    let rendered = 0;
    let pane = "";
    editor.renderRichEditor = () => { rendered += 1; };
    editor.activatePane = (value) => { pane = value; };
    editor.insertKnowledgeCheckBlocks(["```quiz\nQuestion?\n- [x] Yes\n- [ ] No\n```"], target);
    assert.match(body.value, /```quiz/);
    assert.equal(body.inputEvents, 1);
    assert.equal(rendered, 1);
    assert.equal(pane, "write");
    assert.equal(richBody.focused, true);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousAnimationFrame === undefined) delete globalThis.requestAnimationFrame;
    else globalThis.requestAnimationFrame = previousAnimationFrame;
  }
});
