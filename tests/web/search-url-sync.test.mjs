import test from "node:test";
import assert from "node:assert/strict";

// A just-enough DOM for <ob-search>: it only needs the four children it queries and a few
// attribute helpers. The WebAssembly module is pointed at a data: URL that throws, so the
// element takes its JavaScript fallback and the test needs no build output.
const BROKEN_WASM = 'data:text/javascript,throw new Error("no wasm in tests")';

class FakeElement {
  constructor(attributes = {}) {
    this.attributes = { index: "/search.json", wasm: BROKEN_WASM, ...attributes };
    this.input = { value: "", listeners: {}, addEventListener(name, listener) { this.listeners[name] = listener; } };
    this.status = { textContent: "" };
    this.results = { innerHTML: "", replaceChildren() { this.innerHTML = ""; } };
    this.form = { addEventListener() {} };
  }
  getAttribute(name) { return this.attributes[name] ?? null; }
  hasAttribute(name) { return Object.hasOwn(this.attributes, name); }
  querySelector(selector) {
    if (selector === "input[type=search]") return this.input;
    if (selector === ".ob-search-status") return this.status;
    if (selector === ".ob-search-results") return this.results;
    if (selector === "form") return this.form;
    return null;
  }
}

async function mount(attributes, address) {
  const saved = {};
  for (const key of ["HTMLElement", "customElements", "location", "history", "fetch", "console"]) saved[key] = globalThis[key];
  const registry = new Map();
  const replaced = [];
  globalThis.HTMLElement = FakeElement;
  globalThis.customElements = { get: (name) => registry.get(name), define: (name, value) => registry.set(name, value) };
  const url = new URL(address);
  Object.defineProperty(globalThis, "location", { value: { href: url.href, search: url.search }, configurable: true, writable: true });
  Object.defineProperty(globalThis, "history", { value: { replaceState: (_state, _title, next) => replaced.push(String(next)) }, configurable: true, writable: true });
  globalThis.fetch = async () => ({ ok: true, text: async () => '{"entries":[]}' });
  globalThis.console = { ...console, info() {}, warn() {} };
  const restore = () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete globalThis[key];
      else Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    }
  };
  try {
    await import(`../../web/components/ob-search.js?test=${Math.random()}`);
    const element = new (registry.get("ob-search"))();
    Object.assign(element.attributes, attributes);
    await element.connectedCallback();
    return { element, replaced, restore, type: (text) => { element.input.value = text; element.input.listeners.input(); } };
  } catch (error) {
    restore();
    throw error;
  }
}

test("by default the search box reads ?q= and keeps the address in step with what is typed", async (t) => {
  const { element, replaced, restore, type } = await mount({}, "https://site.test/search/?q=hello");
  t.after(restore);
  assert.equal(element.input.value, "hello");
  assert.ok(replaced.at(-1).includes("q=hello"), replaced.join(" | "));
  type("git rebase");
  assert.ok(replaced.at(-1).includes("q=git+rebase") || replaced.at(-1).includes("q=git%20rebase"), replaced.join(" | "));
  type("");
  assert.equal(new URL(replaced.at(-1)).searchParams.has("q"), false);
});

test("no-history ignores ?q= and never rewrites the address, so a search inside a dialog leaves the page alone", async (t) => {
  const { element, replaced, restore, type } = await mount({ "no-history": "" }, "https://site.test/some-post/?q=hello");
  t.after(restore);
  assert.equal(element.input.value, "", "the host page's own ?q= must not leak into the dialog");
  type("git rebase");
  assert.equal(element.status.textContent.length > 0, true, "it still searches");
  assert.deepEqual(replaced, [], "history.replaceState is never called");
});
