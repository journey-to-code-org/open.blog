import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  SHARED_SOURCE_KINDS,
  emptySharedSource,
  sharedReflectionFieldId,
  sharedReflectionPayload,
  sharedSourceHref,
  validateSharedReflectionDraft,
} from "../../web/admin/admin.js";

const admin = readFileSync(new URL("../../web/admin/admin.js", import.meta.url), "utf8");

const draft = (overrides = {}) => ({
  title: "On attention",
  guidingQuestion: "",
  contributorId: "ada",
  sources: [{ ...emptySharedSource("video"), title: "The Art of Noticing", url: "https://www.youtube.com/watch?v=abc" }],
  ...overrides,
});

test("shared source kinds cover video, article, podcast, book, and other with examples", () => {
  assert.deepEqual(
    SHARED_SOURCE_KINDS.map((kind) => kind.value),
    ["video", "article", "podcast", "book", "other"],
  );
  for (const kind of SHARED_SOURCE_KINDS) {
    assert.ok(kind.label && kind.example, kind.value);
  }
  assert.deepEqual(emptySharedSource(), { kind: "video", title: "", url: "", creator: "", publisher: "", published: "", isbn: "" });
});

test("a draft needs a title or guiding question and a titled source", () => {
  assert.equal(validateSharedReflectionDraft(draft()), null);
  assert.equal(validateSharedReflectionDraft(draft({ title: "", guidingQuestion: "What changed?" })), null);
  assert.equal(validateSharedReflectionDraft(draft({ title: "  ", guidingQuestion: " " })).field, "title");
  assert.equal(validateSharedReflectionDraft(draft({ sources: [] })).field, "sources");
  assert.equal(
    validateSharedReflectionDraft(draft({ sources: [{ ...emptySharedSource("book"), title: " " }] })).field,
    "sources.0.title",
  );
  assert.equal(validateSharedReflectionDraft(draft({ contributorId: "" })).field, "contributorId");
  // Problems are reported in the order the form presents its fields: sources come first.
  assert.equal(
    validateSharedReflectionDraft({ title: "", guidingQuestion: "", contributorId: "", sources: [emptySharedSource()] }).field,
    "sources.0.title",
  );
});

test("a source without a link is valid and books keep their metadata", () => {
  const book = { ...emptySharedSource("book"), title: "Über das Zuhören — 聴く", creator: "Ada", publisher: "Press", published: "1843", isbn: "0-86547-454-X" };
  assert.equal(validateSharedReflectionDraft(draft({ sources: [book] })), null);
  const payload = sharedReflectionPayload(draft({ sources: [book] }));
  assert.deepEqual(payload.sources[0], {
    kind: "book",
    title: "Über das Zuhören — 聴く",
    url: "",
    creator: "Ada",
    publisher: "Press",
    published: "1843",
    isbn: "0-86547-454-X",
  });
});

test("links must be HTTP(S) without credentials, and unsafe schemes are refused", () => {
  for (const url of ["https://example.org/a", "http://example.com", "https://bücher.example/straße"]) {
    const sources = [{ ...emptySharedSource("article"), title: "Link", url }];
    assert.equal(validateSharedReflectionDraft(draft({ sources })), null, url);
  }
  for (const url of [
    "javascript:alert(1)",
    " JavaScript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "file:///etc/passwd",
    "mailto:ada@example.org",
    "//example.org",
    "example.org",
    "https://ada:secret@example.org/",
  ]) {
    const sources = [video(), { ...emptySharedSource("article"), title: "Link", url }];
    const problem = validateSharedReflectionDraft(draft({ sources }));
    assert.equal(problem?.field, "sources.1.url", url);
    assert.doesNotMatch(problem.message, /secret|alert|passwd/);
  }
});

function video() {
  return { ...emptySharedSource("video"), title: "Talk" };
}

test("an ISBN is checked for shape and only sent for books", () => {
  for (const isbn of ["12345", "ISBN 0-86547-454-X", "X865474549"]) {
    const sources = [{ ...emptySharedSource("book"), title: "Book", isbn }];
    assert.equal(validateSharedReflectionDraft(draft({ sources })).field, "sources.0.isbn", isbn);
  }
  const switched = { ...emptySharedSource("video"), title: "Talk", isbn: "not used" };
  assert.equal(validateSharedReflectionDraft(draft({ sources: [switched] })), null);
  assert.equal(sharedReflectionPayload(draft({ sources: [switched] })).sources[0].isbn, "");
});

test("the payload keeps authored order and carries no identity claims", () => {
  const payload = sharedReflectionPayload(
    draft({
      title: "  Working title ",
      guidingQuestion: " What changed? ",
      sources: [
        { ...emptySharedSource("podcast"), title: " Second ", url: " https://example.org/2 " },
        { ...emptySharedSource("other"), title: "Third" },
      ],
    }),
  );
  assert.deepEqual(Object.keys(payload).sort(), ["contributorId", "guidingQuestion", "sources", "title"]);
  assert.equal(payload.title, "Working title");
  assert.equal(payload.guidingQuestion, "What changed?");
  assert.deepEqual(payload.sources.map((source) => source.title), ["Second", "Third"]);
  assert.equal(payload.sources[0].url, "https://example.org/2");
  assert.doesNotMatch(JSON.stringify(payload), /adminUser|participant|roles|binding/);
});

test("server field names map to focusable control ids", () => {
  assert.equal(sharedReflectionFieldId("title"), "oba-shared-title");
  assert.equal(sharedReflectionFieldId("guidingQuestion"), "oba-shared-question");
  assert.equal(sharedReflectionFieldId("contributorId"), "oba-shared-contributor");
  assert.equal(sharedReflectionFieldId("sources"), "oba-shared-add-source");
  assert.equal(sharedReflectionFieldId("sources.2.url"), "oba-shared-source-2-url");
  assert.equal(sharedReflectionFieldId("sources.0.isbn"), "oba-shared-source-0-isbn");
  assert.equal(sharedReflectionFieldId("sources.x.url"), "");
  assert.equal(sharedReflectionFieldId('"><img src=x>'), "");
  assert.equal(sharedReflectionFieldId(""), "");
});

test("stored source links render only as HTTP(S) hrefs", () => {
  assert.equal(sharedSourceHref("https://example.org/a"), "https://example.org/a");
  assert.equal(sharedSourceHref("javascript:alert(1)"), "");
  assert.equal(sharedSourceHref(undefined), "");
  assert.equal(sharedSourceHref("https://user:pass@example.org/"), "");
});

test("the shared reflection flow is labelled, announced, and reachable from navigation", () => {
  assert.match(admin, /href: "#\/shared"/);
  assert.match(admin, /"#\/shared\/new"/);
  assert.match(admin, /api\.call\("GET", "collaboration\/publications"\)/);
  assert.match(admin, /api\.call\("POST", "collaboration\/publications"/);
  assert.match(admin, /Start a shared reflection/);
  assert.match(admin, /Original link \(optional\)/);
  assert.match(admin, /You don’t need Markdown/);
  assert.match(admin, /Nothing is published/);
  assert.match(admin, /h\("legend"/);
  assert.match(admin, /"aria-invalid"/);
  assert.match(admin, /setAttribute\("aria-describedby", `\$\{id\}-help`\)/);
  assert.match(admin, /class: "oba-error", role: "alert", tabindex: "-1"/);
  assert.match(admin, /category: "Create", keywords: "shared reflection collaborate source video book"/);
});
