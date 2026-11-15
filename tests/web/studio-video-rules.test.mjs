// Words for YouTube (Studio R7): the page's mirror of `openblog video`, held to the engine on every
// video post by a fixture the engine writes (crates/openblog-cli/src/video_release.rs). Ports the
// old Admin's "video release kits…" test (admin-behavior.test.mjs) with the two changes the engine
// makes: the description gains "Read the article: <address>", and no chapters is fine.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  METADATA_CODES, chapterCountWords, chapterProblems, durationSeconds, kitFromServer, releaseKit, releaseRow, releaseWords, timestampSeconds,
  videoChapters, videoDescription, youtubeTagsChars,
} from "../../web/studio/parts/video-rules.js";
import { HER_BANNED } from "../../web/studio/parts/plain-words.js";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/video-release.json", import.meta.url), "utf8"));

test("the page's words for YouTube equal the engine's on every video post", () => {
  assert.ok(fixture.cases.some((c) => c.name.includes("zhalendor")), "the repository's own video post is in the fixture");
  for (const c of fixture.cases) {
    const kit = releaseKit(c.fields, c.body, { url: c.url, tags: c.tags, excerpt: c.excerpt });
    assert.equal(kit.title, c.expected.title, `${c.name} title`);
    assert.equal(kit.description, c.expected.description, `${c.name} description`);
    assert.deepEqual(kit.tags, c.expected.tags, `${c.name} tags`);
    assert.deepEqual(kit.problems.map((p) => p.code), c.expected.codes, `${c.name} problems`);
  }
});

test("video release kits compose copy and enforce YouTube chapter rules", () => {
  const kit = releaseKit(
    { description: "Seven adventurers enter a forbidden ruin.", title: "The gate", duration: "1 min 20 sec", aiDisclosure: "AI-assisted animation with human direction and editing." },
    "## Chapters\n\n00:00 The gate opens\n00:14 A warning\n01:02 Into the ruin\n\n```text\n00:01 ignored code\n```",
    { url: "https://blog.example.org/the-gate/" },
  );
  assert.deepEqual(kit.chapters.map(({ label, seconds, line }) => ({ label, seconds, line })), [
    { label: "The gate opens", seconds: 0, line: 2 },
    { label: "A warning", seconds: 14, line: 3 },
    { label: "Into the ruin", seconds: 62, line: 4 },
  ]);
  assert.deepEqual(kit.problems, []);
  assert.equal(
    kit.description,
    "Seven adventurers enter a forbidden ruin.\n\nRead the article: https://blog.example.org/the-gate/\n\nChapters\n00:00 The gate opens\n00:14 A warning\n01:02 Into the ruin\n\nAI assistance: AI-assisted animation with human direction and editing.",
    "the description gains the article line, as the engine writes it",
  );
  const late = releaseKit({ title: "x", duration: "1:15" }, "00:05 Late start\n00:10 Too close");
  assert.deepEqual(late.problems.map((p) => p.code), ["chapters-first-not-zero", "chapters-too-few", "chapters-too-short"]);
  assert.equal(late.problems[0].line, 0, "Show me goes to the chapter's line");
  assert.deepEqual(releaseKit({ title: "x", duration: "1:05" }, "00:00 Intro\n00:20 Story\n01:00 Credits").problems.map((p) => p.code), ["chapters-too-short"]);
  assert.deepEqual(releaseKit({ title: "x" }, "No times at all.").problems, [], "a video with no chapters is fine");
});

test("before its first save the article line is left out", () => {
  const kit = releaseKit({ title: "x", description: "Opening." }, "", {});
  assert.equal(kit.description, "Opening.");
  assert.equal(kit.hasAddress, false);
  assert.deepEqual(kit.notes, [{ code: "article-not-public" }]);
  assert.deepEqual(releaseKit({ title: "x" }, "", { url: "https://a.example/x/", live: true }).notes, []);
});

test("the engine's rules, one by one", () => {
  assert.equal(timestampSeconds("1:02:03"), 3723);
  assert.equal(timestampSeconds("123:59"), 7439);
  assert.equal(timestampSeconds("1:60"), null);
  assert.equal(timestampSeconds("1:2"), null);
  assert.equal(durationSeconds("PT12M"), 720);
  assert.equal(durationSeconds("2 hr 15 min"), 8100);
  assert.equal(durationSeconds("12:34"), 754);
  assert.equal(durationSeconds("soon"), null);
  assert.equal(youtubeTagsChars(["a", "b c"]), 1 + 5 + 1);
  assert.deepEqual(videoChapters("- 0:00 One\n* 0:10 Two\n+ 0:20 Three\n0:30\n~~~\n0:40 Code\n~~~").map((c) => c.label), ["One", "Two", "Three"]);
  assert.deepEqual(chapterProblems([], null), []);
  assert.equal(videoDescription({ summary: "", url: "", chapters: [], ai: "" }), "");
  const long = releaseKit({ title: "T".repeat(101) }, "");
  assert.deepEqual(long.problems, [{ code: "title-too-long", field: "title", count: 101 }]);
  const brackets = releaseKit({ title: "ok", videoDescription: "a < b" }, "");
  assert.deepEqual(brackets.problems, [{ code: "description-angle-brackets", field: "videoDescription" }]);
  const tags = releaseKit({ title: "ok" }, "", { tags: Array.from({ length: 60 }, (_, i) => `tag number ${i}`) });
  assert.equal(tags.problems[0].code, "tags-too-long");
  assert.ok(tags.problems[0].count > 500);
  const bytes = releaseKit({ title: "ok", description: "é".repeat(2600) }, "");
  assert.equal(bytes.problems[0].code, "description-too-long", "YouTube counts bytes");
});

test("every problem says what to do in her words", () => {
  for (const code of [...METADATA_CODES, "article-not-public", "source-missing"]) {
    const words = releaseWords(code, { count: 112 });
    assert.ok(words.length > 10, code);
    assert.doesNotMatch(words, HER_BANNED, code);
  }
  assert.equal(releaseWords("title-too-long", { count: 112 }), "YouTube takes titles of up to 100 letters; this one has 112. Shorten the title.");
  assert.equal(releaseWords("source-missing"), "YouTube may not take these words as they are.");
});

test("the server's preview keeps her problems and puts the rest in details", () => {
  const local = releaseKit({ title: "x", duration: "1:15" }, "00:05 Late\n00:30 Next\n00:50 Last");
  const server = kitFromServer({
    title: "x", description: "d", tags: [], articlePublic: false, status: "blocked", digest: "abc", steps: ["Upload"],
    problems: [{ code: "chapters-first-not-zero", message: "The first chapter must start at 00:00." }, { code: "consent-rights-missing", message: "Say who owns it." }],
    manual: [], notes: [{ code: "article-not-public", message: "x" }, { code: "captions-by-hand", message: "y" }],
  }, local);
  assert.deepEqual(server.problems.map((p) => [p.code, p.line]), [["chapters-first-not-zero", 0]]);
  assert.deepEqual(server.other.map((p) => p.code), ["consent-rights-missing", "captions-by-hand"]);
  assert.deepEqual(server.notes, [{ code: "article-not-public" }]);
  assert.equal(releaseRow(server), "Words for YouTube: 1 thing YouTube won't take");
  assert.equal(releaseRow({ problems: [], chapters: [1, 2, 3, 4, 5] }), "Words for YouTube: ready to copy · 5 chapters");
  assert.equal(releaseRow({ problems: [1, 2], chapters: [] }), "Words for YouTube: 2 things YouTube won't take");
  assert.equal(chapterCountWords(0), "no chapters");
});
