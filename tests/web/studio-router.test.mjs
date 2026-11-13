import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRoute, routeHash } from "../../web/studio/router.js";

test("routes read from the address", () => {
  assert.deepEqual(parseRoute(""), { name: "home", arg: "" });
  assert.deepEqual(parseRoute("#/"), { name: "home", arg: "" });
  assert.deepEqual(parseRoute("#/posts"), { name: "posts", arg: "" });
  assert.deepEqual(parseRoute("#/write"), { name: "write", arg: "" });
  assert.deepEqual(parseRoute("#/write/posts%2Fpumpkin-bread.md"), { name: "write", arg: "posts/pumpkin-bread.md" });
  assert.deepEqual(parseRoute("#/write/posts/pumpkin-bread.md"), { name: "write", arg: "posts/pumpkin-bread.md" });
  assert.deepEqual(parseRoute("#/posts?x=1"), { name: "posts", arg: "" });
});

test("a mangled address still opens", () => {
  assert.deepEqual(parseRoute("#/write/posts%2"), { name: "write", arg: "posts%2" });
});

test("routes round-trip", () => {
  for (const [name, arg] of [["home", ""], ["posts", ""], ["write", ""], ["write", "posts/a b & c.md"]]) {
    assert.deepEqual(parseRoute(routeHash(name, arg)), { name, arg });
  }
});
