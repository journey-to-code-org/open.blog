import assert from "node:assert/strict";
import test from "node:test";

import { countByStatus, matchPosts, summary } from "../../web/studio/parts/search.js";

const items = [
  { path: "posts/a.md", title: "Pumpkin bread", status: "draft" },
  { path: "posts/b.md", title: "Cranberry relish", status: "scheduled" },
  { path: "posts/c.md", title: "Crème Brûlée for Jayanti", status: "published" },
  { path: "posts/d.md", title: "Sweet potato pie", status: "published" },
  { path: "posts/e.md", title: "Pumpkin pie, the real one", status: "draft" },
  { path: "posts/broken.md", title: "posts/broken.md", status: "error", error: "bad front matter" },
];
const paths = (list) => list.map((item) => item.path);

test("matchPosts: every word of the query, any order, case-insensitive, order kept", () => {
  assert.deepEqual(paths(matchPosts(items, { query: "pump" })), ["posts/a.md", "posts/e.md"]);
  assert.deepEqual(paths(matchPosts(items, { query: "PIE pumpkin" })), ["posts/e.md"]);
  assert.deepEqual(paths(matchPosts(items, { query: "  pie  " })), ["posts/d.md", "posts/e.md"]);
  assert.deepEqual(paths(matchPosts(items, { query: "pumpkin cake" })), []);
});

test("matchPosts is accent-insensitive both ways", () => {
  assert.deepEqual(paths(matchPosts(items, { query: "creme brulee" })), ["posts/c.md"]);
  assert.deepEqual(paths(matchPosts(items, { query: "BRÛLÉE" })), ["posts/c.md"]);
  assert.deepEqual(paths(matchPosts([{ path: "x", title: "Jalapeno poppers", status: "draft" }], { query: "jalapeño" })), ["x"]);
});

test("matchPosts filters by status; an empty query matches all", () => {
  assert.equal(matchPosts(items).length, items.length);
  assert.deepEqual(paths(matchPosts(items, { status: "draft" })), ["posts/a.md", "posts/e.md"]);
  assert.deepEqual(paths(matchPosts(items, { status: "scheduled" })), ["posts/b.md"]);
  assert.deepEqual(paths(matchPosts(items, { query: "pie", status: "published" })), ["posts/d.md"]);
  assert.deepEqual(matchPosts([], { query: "pie" }), []);
  assert.deepEqual(matchPosts([{ path: "z", status: "draft" }], { query: "" }).length, 1);
});

test("countByStatus counts each status; all includes unreadable posts", () => {
  assert.deepEqual(countByStatus(items), { all: 6, draft: 2, scheduled: 1, published: 2 });
  assert.deepEqual(countByStatus([]), { all: 0, draft: 0, scheduled: 0, published: 0 });
});

test("summary words", () => {
  assert.equal(summary({ all: 0, draft: 0, scheduled: 0, published: 0 }), "No posts yet");
  assert.equal(summary({ all: 1, draft: 0, scheduled: 0, published: 1 }), "1 post");
  assert.equal(summary({ all: 24, draft: 2, scheduled: 0, published: 22 }), "24 posts, 2 waiting as drafts");
  assert.equal(summary({ all: 3, draft: 1, scheduled: 0, published: 2 }), "3 posts, 1 waiting as a draft");
  assert.equal(summary({ all: 1, draft: 1, scheduled: 0, published: 0 }), "1 post, 1 waiting as a draft");
  assert.equal(summary(countByStatus(items)), "6 posts, 2 waiting as drafts, 1 scheduled");
});
