import test from "node:test";
import assert from "node:assert/strict";

test("the saved theme choice also switches mode-specific cover pictures", async () => {
  const sources = [{ media: "(prefers-color-scheme: dark)" }];
  let click;
  const button = {
    addEventListener(_name, listener) { click = listener; },
    removeEventListener() {},
    setAttribute() {},
  };

  globalThis.HTMLElement = class {};
  globalThis.document = {
    documentElement: { dataset: { theme: "dark" } },
    querySelectorAll(selector) {
      assert.equal(selector, "source[data-ob-cover-dark]");
      return sources;
    },
  };
  globalThis.matchMedia = () => ({ matches: false });
  globalThis.localStorage = { setItem() {} };
  let ThemeToggle;
  globalThis.customElements = {
    get() { return undefined; },
    define(_name, constructor) { ThemeToggle = constructor; },
  };

  await import(`../../web/components/ob-theme-toggle.js?test=${Date.now()}`);
  const toggle = new ThemeToggle();
  toggle.querySelector = () => button;
  toggle.dispatchEvent = () => {};
  toggle.connectedCallback();
  assert.equal(sources[0].media, "all");

  click();
  assert.equal(document.documentElement.dataset.theme, "light");
  assert.equal(sources[0].media, "not all");
});
