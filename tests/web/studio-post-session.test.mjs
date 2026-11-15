import { test } from "node:test";
import assert from "node:assert/strict";
import { afterSave, fieldsForSave, layoutOf, nothingToSave, sendPost } from "../../web/studio/parts/post-session.js";

test("nothing to save unless something changed, but publishing a draft is a change", () => {
  assert.equal(nothingToSave({ dirty: false, path: "posts/a.md", state: "draft", intent: "draft" }), true);
  assert.equal(nothingToSave({ dirty: false, path: "posts/a.md", state: "draft", intent: "publish" }), false);
  assert.equal(nothingToSave({ dirty: false, path: "posts/a.md", state: "scheduled", intent: "draft" }), false);
  assert.equal(nothingToSave({ dirty: false, path: "", state: "new", intent: "draft" }), false);
  assert.equal(nothingToSave({ dirty: true, path: "posts/a.md", state: "draft", intent: "draft" }), false);
  assert.equal(nothingToSave({ dirty: false, path: "posts/a.md", state: "draft", intent: "draft", force: true }), false);
});

test("a recipe's numbers keep their own names and form", () => {
  const received = { title: "Pie", prep: "15 min", course: ["Dessert", "Pie"] };
  const fields = fieldsForSave(received, { cover: "", coverAlt: "" }, { title: "Pie", tags: [], date: "", extra: { prep: "20 min", course: "Dessert, Pie", servings: "" } }, "draft", { now: new Date("2026-11-13T12:00:00Z") });
  assert.equal(fields.prep, "20 min");
  assert.deepEqual(fields.course, ["Dessert", "Pie"], "unchanged list stays a list");
  assert.equal("servings" in fields, false, "an empty new number isn't sent");
});

test("sending: a new post is created, an existing one sends only changes, kept as written", async () => {
  const calls = [];
  const api = { call: async (method, path, { json }) => { calls.push({ method, path, json }); return { path: "posts/a.md", etag: "e2", status: "draft" }; } };
  await sendPost(api, { path: "", fields: {} }, { title: "A" }, "Words");
  await sendPost(api, { path: "posts/a.md", etag: "e1", fields: { title: "A", draft: "true" } }, { title: "A", draft: true, tags: ["x"] }, "Words");
  assert.deepEqual(calls[0], { method: "POST", path: "document", json: { kind: "posts", fields: { title: "A" }, body: "Words" } });
  assert.deepEqual(calls[1], { method: "PUT", path: "document?path=posts%2Fa.md", json: { fields: { tags: ["x"] }, body: "Words", etag: "e1", frontMatter: "keep" } });
});

test("credits ride beside the fields only when they changed, always with their etag", async () => {
  const calls = [];
  const api = { call: async (method, path, { json }) => { calls.push(json); return {}; } };
  const doc = { path: "posts/a.md", etag: "e1", fields: { title: "A" }, creditEtag: "c1" };
  await sendPost(api, doc, { title: "B" }, "Words", { credits: undefined });
  assert.equal("credits" in calls[0], false, "a title change never touches the credit file");
  assert.equal("creditEtag" in calls[0], false);
  await sendPost(api, doc, { title: "A" }, "Words", { credits: [{ contributor: "ruth", roles: [] }] });
  assert.deepEqual(calls[1].credits, [{ contributor: "ruth", roles: [] }]);
  assert.equal(calls[1].creditEtag, "c1");
  await sendPost(api, { ...doc, creditEtag: undefined }, { title: "A" }, "Words", { credits: null });
  assert.equal(calls[2].credits, null);
  assert.equal(calls[2].creditEtag, null, "no file yet: the etag is null");
});

test("after a save the post takes the server's path, version and state; removed fields go", () => {
  const doc = afterSave({ path: "", etag: "", fields: {}, url: "/old/", state: "new" }, { path: "posts/a.md", etag: "e", status: "scheduled" }, { title: "A", draft: null });
  assert.deepEqual(doc, { path: "posts/a.md", etag: "e", fields: { title: "A" }, url: "/old/", state: "scheduled", creditEtag: undefined });
  assert.equal(afterSave({ creditEtag: "c1" }, { path: "p", creditEtag: "c2" }, {}).creditEtag, "c2");
  assert.equal(afterSave({ creditEtag: "c1" }, { path: "p" }, {}).creditEtag, "c1");
  assert.deepEqual(layoutOf({ layout: "rewritten", layoutReason: "why" }), { kept: false, reason: "why" });
  assert.equal(layoutOf({}), null);
});
