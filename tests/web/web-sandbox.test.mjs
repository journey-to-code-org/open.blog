import test from "node:test";
import assert from "node:assert/strict";

globalThis.HTMLElement = class {};
globalThis.customElements = { get: () => null, define: () => {} };
const { parseWebSandbox, webSandboxDocument, WEB_SANDBOX_PERMISSIONS, WEB_SANDBOX_WARNING } = await import("../../web/components/ob-web-sandbox.js");

test("web sandbox parses bounded HTML CSS and JavaScript sections", () => {
  assert.deepEqual(parseWebSandbox("---html\n<button>Go</button>\n---css\nbutton { color: red; }\n---js\nconsole.log('go')"), {
    html: "<button>Go</button>", css: "button { color: red; }", js: "console.log('go')",
  });
  assert.equal(parseWebSandbox("plain source"), null);
  assert.equal(parseWebSandbox(`---html\n${"x".repeat(100001)}`), null);
});

test("web sandbox preview is opaque-origin ready and blocks external resource APIs", () => {
  assert.equal(WEB_SANDBOX_PERMISSIONS, "allow-scripts");
  assert.match(WEB_SANDBOX_WARNING, /Do not enter secrets/);
  assert.match(WEB_SANDBOX_WARNING, /navigate its own preview/);
  const output = webSandboxDocument({ html: "<h1>Hi</h1>", css: "body{} </style><img>", js: "console.log(1); </script><p>" });
  assert.match(output, /default-src 'none'/);
  assert.match(output, /connect-src 'none'/);
  assert.match(output, /form-action 'none'/);
  assert.doesNotMatch(output, /<\/style><img>/i);
  assert.doesNotMatch(output, /<\/script><p>/i);
});
