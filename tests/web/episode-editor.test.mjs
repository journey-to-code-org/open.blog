import assert from "node:assert/strict";
import test from "node:test";
import { chapterFields } from "../../web/admin/episode-editor.js";
import { transcribeNote } from "../../web/admin/capture-assistant.js";

test("chapter form creates bounded structured fields", () => {
  assert.deepEqual(chapterFields("0 | Intro\n15 | Middle | https://example.test/"), {
    "audio.chapters.1.timeSeconds": "0",
    "audio.chapters.1.title": "Intro",
    "audio.chapters.2.timeSeconds": "15",
    "audio.chapters.2.title": "Middle",
    "audio.chapters.2.link": "https://example.test/",
  });
  assert.throws(() => chapterFields("wrong | Chapter"), /seconds/);
  assert.throws(() => chapterFields(Array(11).fill("1 | Chapter").join("\n")), /ten/);
});

test("an existing private note is transcribed only after confirmation without re-uploading", async () => {
  const calls = [];
  const api = { call: async (...args) => { calls.push(args); return { transcript: "Words" }; } };
  await transcribeNote({ api, captureId: "0123456789abcdef0123456789abcdef", blob: null });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1], "assistant/transcribe");
  assert.equal(calls[0][2].json.confirmed, true);
});
