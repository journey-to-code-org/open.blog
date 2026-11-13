import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRoute, routeHash } from "../../web/studio/router.js";

test("routes read from the address", () => {
  assert.deepEqual(parseRoute(""), { name: "home", arg: "", query: {} });
  assert.deepEqual(parseRoute("#/"), { name: "home", arg: "", query: {} });
  assert.deepEqual(parseRoute("#/posts"), { name: "posts", arg: "", query: {} });
  assert.deepEqual(parseRoute("#/write"), { name: "write", arg: "", query: {} });
  assert.deepEqual(parseRoute("#/write/posts%2Fpumpkin-bread.md"), { name: "write", arg: "posts/pumpkin-bread.md", query: {} });
  assert.deepEqual(parseRoute("#/write/posts/pumpkin-bread.md"), { name: "write", arg: "posts/pumpkin-bread.md", query: {} });
  assert.deepEqual(parseRoute("#/posts?status=draft&q=pumpkin%20pie"), { name: "posts", arg: "", query: { status: "draft", q: "pumpkin pie" } });
});

test("a mangled address still opens", () => {
  assert.deepEqual(parseRoute("#/write/posts%2"), { name: "write", arg: "posts%2", query: {} });
});

test("routes round-trip, query included, empty values left out", () => {
  for (const [name, arg, query] of [["home", "", {}], ["posts", "", {}], ["write", "", {}], ["write", "posts/a b & c.md", {}], ["posts", "", { q: "Grammi's pie", status: "draft" }]]) {
    assert.deepEqual(parseRoute(routeHash(name, arg, query)), { name, arg, query });
  }
  assert.equal(routeHash("posts", "", { q: "", status: "" }), "#/posts");
});
