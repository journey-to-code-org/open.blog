// Ported from admin-job-capture.test.mjs (Studio R4): New job's rules in Studio's words.
import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_LIMITS, MAX_RECENT_TOWNS, PREFS_KEY, captureBody, captureFields, captureLimits, captureProblem, captureSlug,
  captureTitle, isPermanentPhotoError, newCaptureId, photoProblem, photosToRemove, readPrefs, rememberPicks, serviceTitle, writePrefs,
} from "../../web/studio/parts/new-job-rules.js";

const NOW = new Date("2026-10-29T14:05:09.123Z");
const SCAFFOLD = "## Problem\n\n## What we found\n\n## What we did\n\n## Result\n\n";
const SERVICES = [{ id: "roof-repair", title: "Roof repair" }];
const memory = (initial) => {
  const map = new Map(initial ? [[PREFS_KEY, initial]] : []);
  return { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), map };
};

test("a job id is 32 lowercase hex digits and never repeats", () => {
  const ids = new Set(Array.from({ length: 50 }, () => newCaptureId()));
  assert.equal(ids.size, 50);
  for (const id of ids) assert.match(id, /^[0-9a-f]{32}$/);
});

test("the limits come from the server's meta and fall back to the defaults", () => {
  assert.deepEqual(captureLimits({}), DEFAULT_LIMITS);
  assert.equal(captureLimits({ capture: { maxPhotos: 3, maxPhotoBytes: -1 } }).maxPhotos, 3);
  assert.equal(captureLimits({ capture: { maxPhotoBytes: -1 } }).maxPhotoBytes, DEFAULT_LIMITS.maxPhotoBytes);
});

test("remembered picks keep the old Admin's key, a short unique town list, and ignore anything unreadable", () => {
  assert.equal(PREFS_KEY, "openblog.capture.prefs.v1");
  const storage = memory();
  let prefs = readPrefs(storage);
  for (let n = 0; n < 10; n += 1) prefs = rememberPicks(prefs, { trade: "Roofing", service: "roof-repair", town: `Town ${n}` });
  prefs = rememberPicks(prefs, { trade: "", service: "", town: "town 3" });
  writePrefs(storage, prefs);
  const stored = readPrefs(storage);
  assert.equal(stored.trade, "roofing");
  assert.equal(stored.towns.length, MAX_RECENT_TOWNS);
  assert.equal(stored.towns[0], "town 3");
  assert.equal(stored.towns.filter((town) => town.toLowerCase() === "town 3").length, 1);
  for (const bad of ["{", JSON.stringify({ v: 2, trade: "x" }), JSON.stringify({ v: 1, towns: "nope" })]) assert.deepEqual(readPrefs(memory(bad)).towns, []);
  assert.doesNotThrow(() => writePrefs({ setItem() { throw new Error("full"); } }, prefs));
});

test("a job's name is in her words: the service and town, the trade, or the day", () => {
  assert.equal(captureTitle({ trade: "roofing", service: "roof-repair", town: "Elkins" }, NOW, SERVICES), "Roof repair in Elkins");
  assert.equal(captureTitle({ trade: "roofing", service: "", town: "Elkins" }, NOW), "Roofing in Elkins");
  assert.equal(captureTitle({ trade: "roofing", service: "", town: "" }), "Roofing job");
  assert.equal(captureTitle({ trade: "", service: "gutter-guards", town: "" }), "Gutter guards");
  assert.equal(captureTitle({ trade: "", service: "", town: "" }, new Date(2026, 10, 13, 12)), "Job notes, November 13");
  assert.equal(serviceTitle("roof-repair", SERVICES), "Roof repair");
  assert.equal(serviceTitle("gutter-guards", SERVICES), "Gutter guards");
});

test("a draft's slug carries the id, and its fields are only the job's own keys", () => {
  const id = "ab12cd34ef56".padEnd(32, "0");
  assert.equal(captureSlug("Flooring in São Paulo!", id), "flooring-in-s-o-paulo-ab12cd");
  assert.equal(captureSlug("!!!", id), "job-ab12cd");
  const fields = captureFields({ id, fields: { trade: "Roofing", service: " roof-repair ", town: "Elkins", notes: "x" } }, NOW, SERVICES);
  assert.deepEqual(fields, {
    title: "Roof repair in Elkins", slug: "roof-repair-in-elkins-ab12cd", date: "2026-10-29T14:05:09Z", draft: "true", profile: "job",
    "job.started": fields["job.started"], "job.finished": fields["job.finished"], "job.trade": "roofing", "job.service": "roof-repair", "job.place.town": "Elkins",
  });
  const drafted = captureFields({ id, fields: { trade: "", service: "", town: "", notes: "", draft: { title: "New roof", description: "Done in a day." } } }, NOW);
  assert.equal(drafted.title, "New roof");
  assert.equal(drafted.description, "Done in a day.");
});

test("the body puts her words under the first heading and the photos after the scaffold", () => {
  assert.equal(captureBody({ scaffold: SCAFFOLD }), SCAFFOLD);
  const body = captureBody({ scaffold: SCAFFOLD, notes: " Leak by the chimney. ", photoUrls: ["/images/a.jpg", "/images/b.jpg"] });
  assert.ok(body.startsWith("## Problem\n\nLeak by the chimney.\n\n## What we found"), body);
  assert.ok(body.endsWith("![Photo 1 from the job](/images/a.jpg)\n\n![Photo 2 from the job](/images/b.jpg)\n"), body);
  assert.equal(captureBody({ scaffold: "", notes: "Just words" }), "Just words\n\n");
  const old = captureBody({ scaffold: SCAFFOLD, notes: "ignored", draft: { sections: { problem: "Leak", found: "", did: "Fixed", result: "" } } });
  assert.equal(old, "## Problem\n\nLeak\n\n## What we found\n\n## What we did\n\nFixed\n\n## Result\n\n", "an old record's write-up still sends as before");
});

test("a job needs something in it, and each photo problem has a code", () => {
  const empty = { id: "x", fields: { notes: "  " }, photos: [], audio: null };
  assert.equal(captureProblem(empty), "empty");
  assert.equal(captureProblem({ ...empty, fields: { notes: "hello" } }), "");
  assert.equal(captureProblem({ ...empty, audio: { size: 1 } }), "", "a voice note alone is a job");
  const photo = { name: "a.jpg", type: "image/jpeg", size: 10 };
  assert.equal(captureProblem({ ...empty, photos: [photo, photo, photo] }, { ...DEFAULT_LIMITS, maxPhotos: 2 }), "photos");
  assert.equal(captureProblem({ ...empty, fields: { notes: "x".repeat(11) } }, { ...DEFAULT_LIMITS, maxNotesChars: 10 }), "notes");
  assert.equal(photoProblem(photo), "");
  assert.equal(photoProblem({ name: "Invoice.pdf", type: "application/pdf", size: 5 }), "not-photo");
  assert.equal(photoProblem({ name: "IMG_0042.HEIC", type: "image/heic", size: 5 }), "heic");
  assert.equal(photoProblem({ name: "IMG_0042.heic", type: "", size: 5 }), "heic");
  assert.equal(photoProblem({ name: "big.jpg", type: "image/jpeg", size: 41 * 1024 * 1024 }), "too-big");
  for (const status of [400, 413, 415, 422]) assert.equal(isPermanentPhotoError({ status }), true);
  for (const status of [0, 401, 500]) assert.equal(isPermanentPhotoError({ status }), false);
});

test("too many large photos says how many to take out, largest first", () => {
  const photos = [10, 50, 30, 20].map((size) => ({ size }));
  assert.equal(photosToRemove(photos, 0, 200), 0);
  assert.equal(photosToRemove(photos, 0, 60), 1);
  assert.equal(photosToRemove(photos, 0, 30), 2);
  assert.equal(photosToRemove(photos, 0, 25), 3);
  assert.equal(photosToRemove(photos, 15, 20), 4);
});
