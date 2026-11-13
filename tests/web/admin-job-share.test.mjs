// The Share this job screen (story #488, ADR 0396): every place's words, photo and standing, a
// Facebook Page posted to through the announcements, by-hand places marked as posted, and a photo
// that may hold where it was taken never offered. Run against a fake server; nothing is sent.
import assert from "node:assert/strict";
import test from "node:test";

import { createJobShare, dayText, facebookAnnouncement, pageOpen, soon, standingText, wayFor } from "../../web/admin/job-share.js";
import { tick, withDom } from "./dom-shim.mjs";

const text = (node) => node.textContent.replace(/\s+/g, " ").trim();
const card = (root, destination) => root.querySelectorAll("li").find((li) => li.dataset.destination === destination);
const action = (node, name) => [...node.querySelectorAll("button"), ...node.querySelectorAll("a")].find((b) => b.dataset.action === name);

const PHOTO = { sitePath: "/images/floor-after.png", url: "https://floors.example.org/images/floor-after.png", fileName: "floor-after.png", mediaType: "image/png", width: 1200, height: 900, bytes: 20000 };

function place(destination, overrides = {}) {
  return {
    version: 1,
    destination,
    label: { "google-business-profile": "Google Business Profile", facebook: "Facebook", nextdoor: "Nextdoor" }[destination],
    route: destination === "nextdoor" ? "by-hand" : "adapter",
    text: `Sanded and sealed.\n\nHardwood install in Maple Falls, WA.${destination === "google-business-profile" ? "" : "\n\nhttps://floors.example.org/posts/floor/"}`,
    link: "https://floors.example.org/posts/floor/",
    photo: null,
    openUrl: destination === "nextdoor" ? "https://nextdoor.com/sharekit/?source=openblog&body=x" : "https://www.facebook.com/",
    problems: [],
    ready: true,
    digest: `digest-${destination}`,
    record: null,
    changedSince: false,
    ...overrides,
  };
}

function server({ destinations, announcements = true, pages = [{ id: "acct-1", provider: "facebook", displayName: "Oak Floors" }], queue = [] } = {}) {
  return {
    calls: [],
    async call(method, path, options = {}) {
      this.calls.push({ method, path, body: options.json });
      if (path.startsWith("job-share?")) return { title: "New oak floor", path: "posts/floor.md", work: "/posts/floor/", googleSending: false, announcements, destinations: structuredClone(destinations) };
      if (path === "social/destinations") return { destinations: pages };
      if (path.startsWith("social/announcements?")) return { announcements: queue };
      if (path === "social/job-photo-preview") return { approvalDigest: "approved-photo", imageDataUrl: "data:image/png;base64,abc", description: options.json.description };
      if (path === "social/announcements" || path === "social/job-photo-schedule") {
        queue = [{ id: "a1", work: "/posts/floor/", destination: { provider: "facebook" }, status: "scheduled", delivery: "pending", createdAt: "2026-11-08T12:00:00Z" }];
        return { announcement: queue[0], replayed: false };
      }
      if (path === "job-share/by-hand") return { destination: options.json.destination, record: { status: "posted-by-hand", at: "2026-11-08T12:00:00Z", digest: options.json.digest } };
      throw new Error(`unexpected ${method} ${path}`);
    },
  };
}

async function mount(api) {
  const view = createJobShare({ api, path: "posts/floor.md", clipboard: { writeText: async () => {} }, now: () => Date.parse("2026-11-08T12:00:00Z"), random: () => "key-1" });
  document.body.append(view.element);
  await view.load();
  await tick();
  return view.element;
}

test("where a place stands is said in words", () => {
  assert.equal(dayText("2026-11-08T12:00:00Z"), "Nov 8, 2026");
  assert.equal(standingText(place("nextdoor")), "Not shared yet.");
  assert.equal(standingText(place("nextdoor", { record: { status: "posted-by-hand", at: "2026-11-08T12:00:00Z" } })), "You posted it by hand on Nov 8, 2026.");
  assert.match(standingText(place("google-business-profile", { record: { status: "posted", at: "2026-11-08T12:00:00Z" }, changedSince: true })), /^Posted on Nov 8, 2026\. The job has changed since\.$/);
  assert.equal(standingText(place("facebook"), { delivery: "published" }), "On your Facebook Page: Published.");
  const older = { work: "/posts/floor/", destination: { provider: "facebook" }, createdAt: "2026-11-01T00:00:00Z", delivery: "failed" };
  const newer = { ...older, createdAt: "2026-11-08T00:00:00Z", delivery: "published" };
  const other = { ...newer, work: "/posts/other/" };
  assert.equal(facebookAnnouncement([older, newer, other], "/posts/floor/"), newer);
  assert.equal(facebookAnnouncement([], "/posts/floor/"), null);
  assert.equal(soon(Date.parse("2026-11-08T12:00:00Z")), "2026-11-08T12:05:00Z");
});

test("a Facebook Page is posted to through the announcements only when it can be", () => {
  const pages = [{ id: "acct-1" }];
  assert.equal(wayFor(place("facebook"), { pages, announcements: true }), "facebook-page");
  assert.equal(wayFor(place("facebook"), { pages: [], announcements: true }), "by-hand");
  assert.equal(wayFor(place("facebook"), { pages, announcements: false }), "by-hand");
  assert.equal(wayFor(place("facebook", { route: "by-hand" }), { pages, announcements: true }), "by-hand");
  assert.equal(wayFor(place("google-business-profile"), { pages, announcements: true }), "by-hand");
  assert.equal(wayFor(place("nextdoor"), { pages, announcements: true }), "by-hand");
});

test("the screen schedules the job on the connected Facebook Page as previewed and shows its delivery", withDom(async () => {
  const api = server({ destinations: [place("google-business-profile"), place("facebook"), place("nextdoor")] });
  const root = await mount(api);
  const facebook = card(root, "facebook");
  assert.match(text(facebook), /Not shared yet/);
  await action(facebook, "job-share-facebook").click();
  await tick();
  const scheduled = api.calls.find((call) => call.method === "POST" && call.path === "social/announcements");
  assert.deepEqual(scheduled.body, { accountId: "acct-1", work: "/posts/floor/", caption: place("facebook").text, scheduledFor: "2026-11-08T12:05:00Z", idempotencyKey: "key-1" });
  assert.match(text(card(root, "facebook")), /On your Facebook Page: Scheduled\./);
  // Google is never sent from this screen.
  assert.equal(action(card(root, "google-business-profile"), "job-share-facebook"), undefined);
  assert.ok(!api.calls.some((call) => call.path.includes("google")));
}));

test("a Facebook job photo needs a description, exact preview and explicit approval", withDom(async () => {
  const api = server({ destinations: [place("facebook", { photo: PHOTO })] });
  const root = await mount(api);
  const facebook = card(root, "facebook");
  const post = action(facebook, "job-share-facebook");
  const input = facebook.querySelector("[data-job-photo-alt]");
  const checkbox = facebook.querySelectorAll("input").find((item) => item.getAttribute("type") === "checkbox");
  const preview = facebook.querySelectorAll("button").find((item) => text(item) === "Preview photo for Facebook");
  assert.equal(post.disabled, true);
  input.value = "A refinished floor";
  await input.dispatch("input");
  await preview.click();
  await tick();
  assert.equal(post.disabled, true);
  assert.equal(checkbox.disabled, false);
  checkbox.checked = true;
  await checkbox.dispatch("change");
  assert.equal(post.disabled, false);
  await post.click();
  await tick();
  const sent = api.calls.find((call) => call.path === "social/job-photo-schedule");
  assert.equal(sent.body.description, "A refinished floor");
  assert.equal(sent.body.approvalDigest, "approved-photo");
  assert.equal(sent.body.digest, "digest-facebook");
}));

test("a job already on its way to the Facebook Page is not offered again from a reopened screen", withDom(async () => {
  for (const delivery of ["pending", "processing", "retrying", "published", "unknown"]) {
    assert.equal(pageOpen({ delivery }), false, delivery);
    const queue = [{ id: "a0", work: "/posts/floor/", destination: { provider: "facebook" }, delivery, createdAt: "2026-11-08T11:00:00Z" }];
    const api = server({ destinations: [place("facebook")], queue });
    const root = await mount(api);
    assert.equal(action(card(root, "facebook"), "job-share-facebook"), undefined, delivery);
    assert.ok(!api.calls.some((call) => call.method === "POST"), delivery);
    root.remove();
  }
  for (const delivery of ["failed", "canceled"]) {
    assert.equal(pageOpen({ delivery }), true, delivery);
    const queue = [{ id: "a0", work: "/posts/floor/", destination: { provider: "facebook" }, delivery, createdAt: "2026-11-08T11:00:00Z" }];
    const root = await mount(server({ destinations: [place("facebook")], queue }));
    assert.ok(action(card(root, "facebook"), "job-share-facebook"), delivery);
    root.remove();
  }
  assert.equal(pageOpen(null), true);
  const byHand = await mount(server({ destinations: [place("facebook", { record: { status: "posted-by-hand", at: "2026-11-08T12:00:00Z" } })] }));
  assert.equal(action(card(byHand, "facebook"), "job-share-facebook"), undefined);
}));

test("a Facebook card she marked as posted by hand says so, not the failed Page post it hides", withDom(async () => {
  const marked = { status: "posted-by-hand", at: "2026-11-08T12:00:00Z" };
  for (const delivery of ["failed", "canceled"]) {
    const queue = [{ id: "a0", work: "/posts/floor/", destination: { provider: "facebook" }, delivery, createdAt: "2026-11-08T11:00:00Z" }];
    assert.equal(standingText(place("facebook", { record: marked }), queue[0]), "You posted it by hand on Nov 8, 2026.", delivery);
    const root = await mount(server({ destinations: [place("facebook", { record: marked })], queue }));
    const facebook = card(root, "facebook");
    assert.match(text(facebook), /You posted it by hand on Nov 8, 2026\./, delivery);
    assert.doesNotMatch(text(facebook), /On your Facebook Page/, delivery);
    assert.equal(action(facebook, "job-share-facebook"), undefined, delivery);
    root.remove();
  }
  // Pressing I posted it on a card whose Page post failed hides the Post button and says why.
  const queue = [{ id: "a0", work: "/posts/floor/", destination: { provider: "facebook" }, delivery: "failed", createdAt: "2026-11-08T11:00:00Z" }];
  const root = await mount(server({ destinations: [place("facebook")], queue }));
  assert.match(text(card(root, "facebook")), /On your Facebook Page: Failed\./);
  await action(card(root, "facebook"), "job-share-done").click();
  await tick();
  assert.match(text(card(root, "facebook")), /You posted it by hand on Nov 8, 2026\./);
  assert.equal(action(card(root, "facebook"), "job-share-facebook"), undefined);
  // A Page post still on its way, or published, is still shown as it stands.
  assert.equal(standingText(place("facebook", { record: marked }), { delivery: "published" }), "On your Facebook Page: Published.");
}));

test("a by-hand place is marked as posted for exactly what was shown", withDom(async () => {
  const api = server({ destinations: [place("nextdoor")], announcements: false });
  const root = await mount(api);
  const nextdoor = card(root, "nextdoor");
  assert.equal(action(nextdoor, "job-share-open").attributes.href, "https://nextdoor.com/sharekit/?source=openblog&body=x");
  await action(nextdoor, "job-share-done").click();
  await tick();
  assert.deepEqual(api.calls.at(-1), { method: "POST", path: "job-share/by-hand", body: { path: "posts/floor.md", destination: "nextdoor", digest: "digest-nextdoor" } });
  assert.match(text(card(root, "nextdoor")), /You posted it by hand on Nov 8, 2026\./);
}));

test("a place with something to fix offers no way to post it, and a located photo is never offered", withDom(async () => {
  const located = { code: "photo-location", message: "The first after photo may hold the place it was taken.", blocking: true };
  const api = server({ destinations: [place("nextdoor", { ready: false, problems: [located] }), place("facebook", { route: "by-hand", photo: PHOTO })] });
  const root = await mount(api);
  const nextdoor = card(root, "nextdoor");
  assert.match(text(nextdoor), /Fix this first/);
  assert.match(text(nextdoor), /left out until it is replaced/);
  assert.equal(nextdoor.querySelectorAll("img").length, 0);
  for (const name of ["job-share-open", "job-share-done", "job-share-photo", "job-share-copy"]) assert.equal(action(nextdoor, name), undefined, name);
  const facebook = card(root, "facebook");
  assert.equal(action(facebook, "job-share-photo").attributes.href, "/images/floor-after.png");
  assert.match(text(facebook), /without a photo, so a job with one is posted by hand/);
  assert.equal(action(facebook, "job-share-facebook"), undefined);
}));
