import assert from "node:assert/strict";
import test from "node:test";

import {
  STUDIO_KEYS,
  fieldsToSend,
  formFromDocument,
  postState,
  primaryAction,
  statusLine,
} from "../../web/studio/parts/post-fields.js";

const timeZone = "America/New_York";
// Thursday, November 12, 2026, 3 PM in New York.
const now = new Date("2026-11-12T20:00:00Z");
const opts = { now, timeZone };

// A recipe post as `GET document` returns it: Studio's keys plus ones it never shows.
function meatloaf() {
  return {
    path: "posts/2026-04-09-pappys-meatloaf.md",
    etag: "abc123",
    fields: {
      title: "Pappy's Meatloaf",
      date: "2026-04-09",
      tags: ["Supper", "Pappy"],
      cover: "/images/uploads/2026/meatloaf.jpg",
      coverAlt: "Meatloaf on the blue plate",
      profile: "recipe",
      series: "Sunday Suppers",
      servings: "6",
      course: ["main", "comfort"],
      subtitle: "  With the ketchup glaze — just like 1974  ",
      "x-weird key": "keep: me \"exactly\"",
      credits: "should never go back",
      creditEtag: "e1",
      captureId: "c1",
      trackToken: "t1",
    },
    body: "Mix it all with your hands.\n",
  };
}

test("STUDIO_KEYS lists exactly the keys Studio edits", () => {
  assert.deepEqual([...STUDIO_KEYS], ["title", "date", "tags", "cover", "coverAlt", "draft"]);
});

test("formFromDocument reads the fields, with draft as a boolean", () => {
  const doc = meatloaf();
  doc.fields.draft = "true";
  assert.deepEqual(formFromDocument(doc), {
    title: "Pappy's Meatloaf",
    date: "2026-04-09",
    tags: ["Supper", "Pappy"],
    cover: "/images/uploads/2026/meatloaf.jpg",
    coverAlt: "Meatloaf on the blue plate",
    draft: true,
    body: "Mix it all with your hands.\n",
  });
  assert.deepEqual(formFromDocument({ fields: { title: "Rolls", tags: "Bread" } }), {
    title: "Rolls", date: "", tags: ["Bread"], cover: "", coverAlt: "", draft: false, body: "",
  });
  assert.deepEqual(formFromDocument({}), {
    title: "", date: "", tags: [], cover: "", coverAlt: "", draft: false, body: "",
  });
});

test("fieldsToSend keeps every unknown key exactly and returns a new object", () => {
  const doc = meatloaf();
  const before = structuredClone(doc.fields);
  const sent = fieldsToSend(doc.fields, formFromDocument(doc), "draft", opts);
  assert.notEqual(sent, doc.fields);
  assert.deepEqual(doc.fields, before, "received fields are not changed");
  for (const key of ["profile", "series", "servings", "course", "subtitle", "x-weird key"]) {
    assert.deepEqual(sent[key], before[key], key);
  }
  assert.equal(sent.subtitle, "  With the ketchup glaze — just like 1974  ");
  assert.equal(sent["x-weird key"], "keep: me \"exactly\"");
  assert.notEqual(sent.course, doc.fields.course, "lists are copied, not shared");
});

test("fieldsToSend never sends credits, creditEtag, captureId or trackToken", () => {
  const doc = meatloaf();
  for (const intent of ["draft", "publish"]) {
    const sent = fieldsToSend(doc.fields, formFromDocument(doc), intent, opts);
    for (const key of ["credits", "creditEtag", "captureId", "trackToken"]) {
      assert.equal(Object.hasOwn(sent, key), false, `${intent}: ${key}`);
    }
  }
});

test("fieldsToSend: empty Studio fields become null so the server removes them", () => {
  const doc = meatloaf();
  const form = { ...formFromDocument(doc), title: "  ", cover: "", coverAlt: " ", tags: [" ", ""], date: "" };
  const sent = fieldsToSend(doc.fields, form, "draft", opts);
  assert.equal(sent.title, null);
  assert.equal(sent.cover, doc.fields.cover === "" ? "" : null);
  assert.equal(sent.coverAlt, doc.fields.coverAlt === "" ? "" : null);
  assert.equal(sent.tags, null);
  assert.equal(sent.date, null);
  assert.equal(sent.draft, true);
});

test("fieldsToSend: an empty cover keeps the shape it arrived in", () => {
  assert.equal(fieldsToSend({ title: "A", cover: "" }, { title: "A", cover: "" }, "draft", opts).cover, "");
  assert.equal(fieldsToSend({ title: "A" }, { title: "A", cover: "" }, "draft", opts).cover, null);
  assert.equal(fieldsToSend({ title: "A", cover: "x.jpg" }, { title: "A", cover: "" }, "draft", opts).cover, null);
});

test("formFromDocument drops blank lines at the top of the words", () => {
  assert.equal(formFromDocument({ fields: { title: "A" }, body: "\n\n  \nHello\n" }).body, "Hello\n");
});

test("fieldsToSend trims tags and drops empties and case-insensitive duplicates, in order", () => {
  const form = { title: " Pumpkin bread ", tags: [" Thanksgiving", "bread", "", "thanksgiving ", "Bread", "Fall"] };
  const sent = fieldsToSend({}, form, "draft", opts);
  assert.deepEqual(sent.tags, ["Thanksgiving", "bread", "Fall"]);
  assert.equal(sent.title, "Pumpkin bread");
});

test("fieldsToSend: draft sets draft true, publish sets null", () => {
  const doc = meatloaf();
  assert.equal(fieldsToSend(doc.fields, formFromDocument(doc), "draft", opts).draft, true);
  const published = fieldsToSend({ ...doc.fields, draft: "true" }, formFromDocument(doc), "publish", opts);
  assert.equal(published.draft, null);
  assert.throws(() => fieldsToSend({}, {}, "schedule", opts), TypeError);
});

test("fieldsToSend: an untouched date goes back exactly as received", () => {
  const doc = meatloaf();
  // A plain date stays a plain date, not a UTC instant.
  assert.equal(fieldsToSend(doc.fields, formFromDocument(doc), "publish", opts).date, "2026-04-09");
  // An instant the form re-spelled with the zone's offset is still the same instant: sent as received.
  const received = { title: "Rolls", date: "2026-10-28T12:00:00Z" };
  const form = { title: "Rolls", date: "2026-10-28T08:00:00-04:00" };
  assert.equal(fieldsToSend(received, form, "publish", opts).date, "2026-10-28T12:00:00Z");
  assert.equal(fieldsToSend(received, form, "draft", opts).date, "2026-10-28T12:00:00Z");
});

test("fieldsToSend: a changed date sends the form's value", () => {
  const doc = meatloaf();
  const form = { ...formFromDocument(doc), date: "2026-11-27T08:00:00-05:00" };
  assert.equal(fieldsToSend(doc.fields, form, "publish", opts).date, "2026-11-27T08:00:00-05:00");
  assert.equal(fieldsToSend(doc.fields, form, "draft", opts).date, "2026-11-27T08:00:00-05:00");
});

test("fieldsToSend: publishing with no date uses a past received date, else now", () => {
  // New post: now, as an instant with the zone's offset.
  assert.equal(fieldsToSend({}, { title: "Rolls" }, "publish", opts).date, "2026-11-12T15:00:00-05:00");
  // Date cleared on a post with a past date: the past date is kept as it came.
  const past = { title: "Pie", date: "2025-11-03" };
  assert.equal(fieldsToSend(past, { title: "Pie", date: "" }, "publish", opts).date, "2025-11-03");
  // Date cleared on a draft whose date was in the future: publish now.
  const future = { title: "Relish", date: "2026-11-27T13:00:00Z", draft: "true" };
  assert.equal(fieldsToSend(future, { title: "Relish", date: "" }, "publish", opts).date, "2026-11-12T15:00:00-05:00");
  // A draft with no date keeps no date.
  assert.equal(fieldsToSend({}, { title: "Rolls" }, "draft", opts).date, null);
});

test("postState reads list items and documents", () => {
  assert.equal(postState({ path: "posts/a.md", status: "scheduled" }, now), "scheduled");
  assert.equal(postState({ path: "posts/a.md", status: "error" }, now), "error");
  assert.equal(postState({ fields: { title: "A", draft: "true", date: "2026-11-27T13:00:00Z" } }, now, timeZone), "draft");
  assert.equal(postState({ fields: { title: "A", date: "2026-11-27T13:00:00Z" } }, now, timeZone), "scheduled");
  assert.equal(postState({ fields: { title: "A", date: "2026-04-09" } }, now, timeZone), "published");
  assert.equal(postState({ fields: { title: "A", date: "2026-11-13" } }, now, timeZone), "scheduled");
  assert.equal(postState({ fields: { title: "A" } }, now, timeZone), "published");
});

test("primaryAction: Update for published, Schedule for a future date, else Publish", () => {
  assert.equal(primaryAction("published", "2026-11-27T08:00:00-05:00", now, timeZone), "Update");
  assert.equal(primaryAction("draft", "2026-11-27T08:00:00-05:00", now, timeZone), "Schedule");
  assert.equal(primaryAction("scheduled", "2026-11-27T08:00:00-05:00", now, timeZone), "Schedule");
  assert.equal(primaryAction("scheduled", "", now, timeZone), "Publish");
  assert.equal(primaryAction("draft", "2026-04-09", now, timeZone), "Publish");
  assert.equal(primaryAction("new", "", now, timeZone), "Publish");
});

test("statusLine words", () => {
  const line = (info) => statusLine(info, now, timeZone);
  assert.equal(line({ state: "new" }), "Add a title and your draft will save itself.");
  assert.equal(line({ state: "draft", savedAt: "2026-11-12T19:59:40Z" }), "Draft · saved just now");
  assert.equal(line({ state: "draft", savedAt: "2026-11-12T19:59:00Z" }), "Draft · saved 1 minute ago");
  assert.equal(line({ state: "draft", savedAt: "2026-11-12T19:58:00Z" }), "Draft · saved 2 minutes ago");
  assert.equal(line({ state: "draft", savedAt: "2026-11-12T14:00:00Z" }), "Draft · saved today at 9 AM");
  assert.equal(line({ state: "draft", savedAt: new Date("2026-11-11T14:00:00Z") }), "Draft · saved yesterday at 9 AM");
  assert.equal(line({ state: "draft" }), "Draft");
  assert.equal(
    line({ state: "published", dirtyPublished: true, date: "2026-11-03T13:00:00Z" }),
    "Published Nov 3 · changes not on your site yet",
  );
  assert.equal(
    line({ state: "published", dirtyPublished: true, date: "2025-11-03" }),
    "Published Nov 3, 2025 · changes not on your site yet",
  );
  assert.equal(line({ state: "scheduled", date: "2026-11-27T13:00:00Z" }), "Scheduled for Friday, November 27 at 8 AM");
  assert.equal(line({ state: "published", date: "2026-11-12T21:00:00Z" }), "Published today at 4 PM");
  assert.equal(line({ state: "published", date: "2026-04-09" }), "Published Thursday, April 9");
});
