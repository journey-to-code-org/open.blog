import test from "node:test";
import assert from "node:assert/strict";

import {
  pageCount,
  pageFromSearch,
  pageHref,
  pageRange,
} from "../../web/components/list-pagination.js";

test("six series make one page and the seventh starts a second", () => {
  assert.equal(pageCount(0, 6), 1);
  assert.equal(pageCount(6, 6), 1);
  assert.equal(pageCount(7, 6), 2);
  assert.deepEqual(pageRange(7, 6, 1), [0, 6]);
  assert.deepEqual(pageRange(7, 6, 2), [6, 7]);
});

test("the URL parameter selects a bounded page", () => {
  assert.equal(pageFromSearch("?series-page=2", 3, "series-page"), 2);
  assert.equal(pageFromSearch("?series-page=99", 3, "series-page"), 3);
  assert.equal(pageFromSearch("?latest-page=2&series-page=3", 3, "latest-page"), 2);
  for (const search of ["", "?series-page=0", "?series-page=-1", "?series-page=nope"]) {
    assert.equal(pageFromSearch(search, 3, "series-page"), 1, search);
  }
});

test("page links preserve unrelated query parameters and omit page one", () => {
  const href = "https://blog.test/series/?view=cards&series-page=2#all";
  assert.equal(pageHref(href, 3, "series-page"), "/series/?view=cards&series-page=3#all");
  assert.equal(pageHref(href, 1, "series-page"), "/series/?view=cards#all");
  assert.equal(
    pageHref("https://blog.test/?latest-page=2&series-page=2", 3, "latest-page"),
    "/?latest-page=3&series-page=2",
  );
});
