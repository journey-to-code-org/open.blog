// Studio R4: New job, the waiting cards and About this job in her words. Nothing on her layer says
// upload, sync, offline, queue, storage, capture, device, permission or a code.
import assert from "node:assert/strict";
import test from "node:test";

import * as words from "../../web/studio/parts/job-words.js";

const BANNED = /\b(upload|sync|offline|queue|storage|capture|device|permission|IndexedDB|idempotent|slot|ledger|status code|AI provider|model)\b/i;
const record = (extra = {}) => ({ photos: [{}, {}, {}, {}], audio: { size: 1 }, createdAt: new Date(2026, 10, 13, 11, 40).toISOString(), lastError: "", ...extra });
const NOW = new Date(2026, 10, 13, 12, 0);

test("each reason a job couldn't be kept says what to do, and the job stays", () => {
  assert.equal(words.ROOM_WORDS("maxQueued", { limits: { maxQueued: 5 }, noun: "iPhone" }), "This iPhone is already holding 5 jobs that haven't sent. This one stays here until they go.");
  assert.equal(words.ROOM_WORDS("maxCaptureBytes", { remove: 3 }), "This job has too many large photos to keep. Take out about 3.");
  assert.match(words.ROOM_WORDS("maxQueueBytes"), /Send them first\. This one stays here\./);
  assert.match(words.ROOM_WORDS("write", { noun: "phone" }), /^This phone is out of room to keep it\./);
});

test("each photo problem names the photo", () => {
  assert.equal(words.PHOTO_WORDS("not-photo", { name: "Invoice.pdf" }), "“Invoice.pdf” isn't a photo.");
  assert.equal(words.PHOTO_WORDS("heic", { name: "IMG_0042.HEIC" }), "", "never refused for its format: kept as it was");
  assert.equal(words.PHOTO_WORDS("too-big", { name: "IMG_0042.jpg", limits: { maxPhotoBytes: 40 * 1024 * 1024 } }), "“IMG_0042” is too big to use. The limit is 40 MB a photo.");
  assert.equal(words.tooManyWords(["IMG_0050.jpg", "IMG_0051.jpg"], 12), "A job holds up to 12 photos, so these 2 weren't added: IMG_0050, IMG_0051.");
  assert.equal(words.tooManyWords(["IMG_0050.jpg"], 12), "A job holds up to 12 photos, so this one wasn't added: IMG_0050.");
});

test("microphone and camera help is only this phone's steps", () => {
  assert.equal(words.micSteps({ apple: true }).length, 4);
  assert.match(words.micSteps({ apple: true })[1], /Safari/);
  assert.match(words.micSteps({ android: true })[0], /address bar/);
  assert.match(words.micSteps({ android: true, standalone: true })[0], /Touch and hold your blog's icon/);
  assert.match(words.micSteps({})[0], /^Click/);
  assert.match(words.cameraHelp({ apple: true }), /Take Photo/);
  assert.match(words.cameraHelp({ android: true }), /Chrome/);
  assert.match(words.cameraHelp({}), /already taken/);
});

test("a waiting card says where it stands, never a size or a code", () => {
  assert.equal(words.savedWords(record(), NOW), "4 photos, voice note. Saved today at 11:40 AM.");
  assert.equal(words.savedWords(record({ photos: [], audio: null }), NOW), "Words only. Saved today at 11:40 AM.");
  const cases = {
    waiting: ["Waiting", "It sends by itself when there's a signal."],
    tried: ["Waiting", "No signal when it last tried, at 11:52 AM. It tries again by itself."],
    signin: ["Needs you", "Sign in again to send it."],
    removed: ["Needs you", "This job went to your blog before, and was deleted there since."],
    newer: ["Needs you", "This job was saved by a newer version of your blog's pages. Reload to send it. If it still says this, tell the person who set up your site."],
    unreadable: ["Can't read", "Part of this job can't be read on this phone, so it can't be sent."],
  };
  for (const [state, [badge, said]] of Object.entries(cases)) {
    const out = words.waitingWords(state, { record: record(), live: { triedAt: new Date(2026, 10, 13, 11, 52) } });
    assert.deepEqual([out.badge, out.words], [badge, said], state);
  }
  assert.equal(words.waitingWords("tried", { record: record({ lastError: "[server] x" }) }).words, "Your blog didn't answer when it last tried. It tries again by itself.");
  assert.equal(words.waitingWords("refused", { record: record({ lastError: "[capture-id] bad" }) }).words, "This job's label got damaged on this phone, so it can't be sent. Save its photos, then throw it away. Nothing is lost: it's still on this phone.");
  assert.equal(words.waitingWords("sent", { record: record({ sent: { path: "p", skipped: ["IMG_0042.HEIC"] } }) }).words, "It's a draft on your blog, but 1 photo couldn't go: “IMG_0042” is in a format websites can't show.");
  assert.equal(words.waitingWords("sent", { record: record({ sent: { path: "p", skipped: [], audio: "refused" } }) }).words, "It's a draft on your blog, but the voice note couldn't be kept.");
  assert.equal(words.waitingWords("someone-else", { record: record({ by: "Sam" }) }).words, "Saved while Sam was signed in on this phone.");
  for (const state of ["waiting", "tried", "sending", "signin", "refused", "removed", "sent", "someone-else", "newer", "unreadable"]) {
    assert.doesNotMatch(words.waitingWords(state, { record: record({ sent: { skipped: ["a"] } }) }).words, BANNED, state);
  }
});

test("the status line, the sent toast and the counts", () => {
  assert.equal(words.flushWords({ total: 2, done: 0 }), "Sending 1 of 2 jobs…");
  assert.equal(words.flushWords({ sent: 2 }), "Sent.");
  assert.equal(words.flushWords({ waiting: 1 }), "1 job is still waiting for a signal.");
  assert.equal(words.sentWords("Roof repair in Elkins"), "Sent. Roof repair in Elkins is a draft on your blog.");
  assert.equal(words.waitingCount(2, "iPhone"), "2 jobs waiting on this iPhone");
});

test("turning the voice note into words names where it goes, never the model", () => {
  assert.equal(words.transcribeDisclosure({ engine: "local" }), "Your blog turns it into words on its own computer. Nothing leaves it.");
  const provider = words.transcribeDisclosure({ engine: "provider", destination: "OpenAI", model: "whisper-1", leavesServer: true });
  assert.equal(provider, "Your voice note goes to OpenAI to be turned into words. Only the recording goes: not your photos or your notes. OpenAI's own rules cover what it keeps.");
  assert.doesNotMatch(provider, /whisper/);
  assert.equal(words.transcribeTrouble({ status: 404, data: { code: "not-configured" } }), "");
  assert.match(words.transcribeTrouble({ data: { code: "empty-transcript" } }), /No words were heard/);
  assert.match(words.transcribeTrouble({ status: 429 }), /busy with another one/);
  assert.match(words.transcribeTrouble({ status: 500 }), /still here/);
  assert.match(words.writeUpTrouble({ data: { code: "notes-too-long" } }), /Shorten them/);
  assert.match(words.writeUpTrouble({ status: 429 }), /helper is busy/);
  assert.match(words.writeUpDisclosure({ words: 240, destination: "Anthropic" }), /about 240\), its service and town go to Anthropic/);
});

test("each job check problem is said for her field", () => {
  const say = (field, code, extra) => words.jobProblemWords({ field, code }, extra);
  assert.equal(say("job.trade", "missing"), "Choose your trade.");
  assert.equal(say("job.service", "missing"), "Choose the service this job was.");
  assert.equal(say("job.service", "unknown-service", { service: "Gutter guards" }), "“Gutter guards” isn't one of your services yet. Choose one, or add it under Services first.");
  assert.equal(say("job.place.town", "missing"), "Add the town.");
  assert.equal(say("job.place.town", "address"), "Just the town's name, not a street address or zip code.");
  assert.equal(say("job.place.region", "missing"), "Add the state.");
  assert.equal(say("job.place.region", "address"), "Just the state's name or its two letters.");
  assert.equal(say("job.started", "missing"), "Add the day you started.");
  assert.equal(say("job.finished", "missing"), "Add the day you finished.");
  assert.equal(say("job.finished", "order"), "Finished can't be before Started.");
  assert.equal(say("job.costBand", "bad-cost-band"), "Choose a price range from the list.");
  assert.equal(say("job.media.after", "bad-media"), "A photo marked Before or After isn't on your site any more. Mark another.");
  assert.equal(say("job.review", "unknown-review"), "That review isn't saved any more. Choose another.");
  assert.equal(say("job", "invalid"), "Something about this job needs fixing. Tell the person who set up your site.");
  assert.equal(words.checkHeading(2), "Before this job goes on your site (2)");
});

test("the company is named, never its address or model", () => {
  assert.equal(words.companyName({ provider: "open-ai", destination: "https://api.openai.com" }), "OpenAI");
  assert.equal(words.companyName({ destination: "https://api.openai.com" }), "OpenAI");
  assert.equal(words.companyName({ destination: "https://api.anthropic.com/v1" }), "Anthropic");
  assert.equal(words.companyName({ destination: "Acme" }), "Acme");
  assert.match(words.transcribeDisclosure({ engine: "provider", provider: "open-ai", destination: "https://api.openai.com", leavesServer: true }), /^Your voice note goes to OpenAI /);
});

test("a list closed by another window's update: reload, then save again, and the job stays", () => {
  assert.equal(words.ROOM_WORDS("closed"), "Another window updated your blog's pages. Reload, then save again. This job stays here.");
});

test("a refused job's words name the phone in her hand", () => {
  assert.equal(words.refusedWords("capture-id", "iPhone"), "This job's label got damaged on this iPhone, so it can't be sent. Save its photos, then throw it away.");
  assert.equal(words.waitingWords("refused", { record: { lastError: "[capture-id] x" }, noun: "computer" }).words, "This job's label got damaged on this computer, so it can't be sent. Save its photos, then throw it away. Nothing is lost: it's still on this computer.");
});

test("jobs that can't be read get names of their own", () => {
  assert.equal(words.keptTitle(0, "iPhone"), "A job kept on this iPhone");
  assert.equal(words.keptTitle(1, "iPhone"), "A job kept on this iPhone (2)");
  assert.equal(words.keptTitle(2), "A job kept on this phone (3)");
});

test("Safari may clear it: send it, or save its photos to the phone in her hand", () => {
  assert.equal(words.safariClearWords("iPhone"), "Safari may clear jobs kept here if your blog isn't opened for a week. Send it, or save its photos to this iPhone.");
  assert.doesNotMatch(words.safariClearWords("iPhone"), BANNED);
});
