// A recording to listen to with a post (#645): what Studio reads from and writes to `audio:`, times
// as people say them, the parts of a recording, and the words said.
import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_PARTS, hasTranscript, parseParts, parseTime, partLines, recordingFrom, recordingValues, sendProblem, timeWords, withTranscript,
} from "../../web/studio/parts/recording-rules.js";
import { say } from "../../web/studio/parts/words.js";

const FIELDS = {
  title: "Episode one",
  "audio.version": "1",
  "audio.durationSeconds": "754",
  "audio.sources.1.url": "/audio/uploads/abc.mp3",
  "audio.sources.1.type": "audio/mpeg",
  "audio.sources.1.sizeBytes": "12345",
  "audio.chapters.1.timeSeconds": "0",
  "audio.chapters.1.title": "Hello",
  "audio.chapters.2.timeSeconds": "65",
  "audio.chapters.2.title": "The dough",
  "audio.chapters.2.link": "/posts/dough/",
};

test("times are said as minutes and seconds, and read back however she writes them", () => {
  assert.equal(timeWords(754), "12:34");
  assert.equal(timeWords(3723), "1:02:03");
  assert.equal(timeWords(5), "0:05");
  assert.equal(timeWords(null), "");
  for (const [text, seconds] of [["75", 75], ["1:15", 75], ["12:34", 754], ["1:02:03", 3723], ["0:00", 0]]) assert.equal(parseTime(text), seconds, text);
  for (const bad of ["", "1:5", "1:60", "1:61:00", "abc", "-3", "1.5"]) assert.equal(parseTime(bad), null, bad);
});

test("the recording is read from the post's fields, parts in order", () => {
  const found = recordingFrom(FIELDS);
  assert.equal(found.url, "/audio/uploads/abc.mp3");
  assert.equal(found.duration, 754);
  assert.deepEqual(found.parts, [{ time: 0, title: "Hello", link: "" }, { time: 65, title: "The dough", link: "/posts/dough/" }]);
  assert.equal(recordingFrom({ title: "No sound" }), null);
  assert.equal(partLines(found.parts), "0:00 Hello\n1:05 The dough | /posts/dough/");
});

test("parts are checked against each other and the recording's length, by line", () => {
  assert.deepEqual(parseParts("0:00 Hello\n1:05 The dough | /posts/dough/", 754).parts, [{ time: 0, title: "Hello", link: "" }, { time: 65, title: "The dough", link: "/posts/dough/" }]);
  assert.deepEqual(parseParts("  \n", 754), { parts: [] });
  assert.deepEqual(parseParts("Hello", 754), { error: say("recording.partBad", { line: 1 }), line: 1 });
  assert.deepEqual(parseParts("1:00 B\n0:30 A", 754), { error: say("recording.partOrder", { line: 2 }), line: 2 });
  assert.deepEqual(parseParts("13:00 Late", 754), { error: say("recording.partPastEnd", { line: 1 }), line: 1 });
  assert.deepEqual(parseParts("0:10 Odd | javascript:alert(1)", 754), { error: say("recording.partLink", { line: 1 }), line: 1 });
  assert.equal(parseParts(Array.from({ length: MAX_PARTS + 1 }, (_, i) => `${i}:00 P${i}`).join("\n")).error, say("recording.tooManyParts"));
});

test("saving writes the recording and removes only what it no longer needs", () => {
  const found = recordingFrom(FIELDS);
  const one = recordingValues({ ...found, parts: [found.parts[0]] }, FIELDS);
  assert.equal(one["audio.sources.1.url"], "/audio/uploads/abc.mp3");
  assert.equal(one["audio.durationSeconds"], "754");
  assert.equal(one["audio.chapters.1.title"], "Hello");
  assert.equal(one["audio.chapters.2.title"], "");
  assert.equal(one["audio.chapters.2.link"], "");
  assert.equal(one["audio.version"], "1");
  // Taken off: every audio key goes.
  const off = recordingValues(null, { ...FIELDS, "audio.transcript": "/audio/t.txt" });
  assert.ok(Object.keys(off).every((key) => key.startsWith("audio.") && off[key] === ""));
  assert.equal(off["audio.transcript"], "");
  // A new recording on a post with none: version 1, no stray removals.
  const fresh = recordingValues({ url: "/audio/uploads/x.ogg", type: "audio/ogg", sizeBytes: 9, duration: null, parts: [] }, {});
  assert.deepEqual(fresh, { "audio.version": "1", "audio.sources.1.url": "/audio/uploads/x.ogg", "audio.sources.1.type": "audio/ogg", "audio.sources.1.sizeBytes": "9", "audio.durationSeconds": "" });
});

test("the words said go at the end under Transcript, and an existing transcript is found", () => {
  assert.equal(withTranscript("My words.\n\n", " Hello there.\r\nBye. "), "My words.\n\n## Transcript\n\nHello there.\nBye.\n");
  assert.equal(withTranscript("", "Hi."), "## Transcript\n\nHi.\n");
  assert.ok(hasTranscript("Intro\n\n## Transcript\n\nWords"));
  assert.ok(hasTranscript("### transcript ###\n"));
  assert.ok(hasTranscript("", { "audio.transcript": "/audio/t.vtt" }));
  assert.ok(!hasTranscript("The transcript is below."));
});

test("a recording that didn't go on the blog says why in her words", () => {
  assert.equal(sendProblem(413), say("recording.tooBig"));
  assert.equal(sendProblem(415), say("recording.notSound"));
  assert.equal(sendProblem(0), say("recording.needsSignal"));
  assert.equal(sendProblem(500), say("recording.notSent"));
});
