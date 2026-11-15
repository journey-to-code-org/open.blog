// Ported from admin-job-form.test.mjs (Studio R4), with the four parts and trade names.
import assert from "node:assert/strict";
import test from "node:test";

import { applyJobDraft, bodyTakesScaffold, COST_BAND_LABELS, dayValue, localDay, readJobDraft } from "../../web/studio/parts/job-rules.js";

test("the form reads the flattened job keys and trims them", () => {
  const draft = readJobDraft({
    "job.trade": " Flooring ",
    "job.service": "hardwood-install",
    "job.place.town": "Maple Falls",
    "job.place.region": "WA",
    "job.started": "2026-10-14",
    "job.finished": "2026-10-16",
    "job.costBand": "2k-10k",
    "job.media.before": ["/images/a.jpg", " "],
    "job.media.after": "/images/b.jpg",
  });
  assert.deepEqual(draft, {
    trade: "flooring",
    service: "hardwood-install",
    town: "Maple Falls",
    region: "WA",
    started: "2026-10-14",
    finished: "2026-10-16",
    costBand: "2k-10k",
    before: ["/images/a.jpg"],
    after: ["/images/b.jpg"],
    review: "",
  });
  assert.deepEqual(readJobDraft({}).before, []);
  assert.equal(readJobDraft({ "job.review": " rev_01 " }).review, "rev_01");
});

test("the review is written or cleared only when the draft names it", () => {
  const fields = { "job.review": "rev_01" };
  assert.equal(applyJobDraft(fields, {})["job.review"], "rev_01");
  assert.equal(applyJobDraft(fields, { review: "dana-oak" })["job.review"], "dana-oak");
  assert.ok(!("job.review" in applyJobDraft(fields, { review: "" })));
});

test("applying the form writes its keys, drops cleared ones and leaves every other key alone", () => {
  const fields = {
    title: "Oak floor",
    "job.durationHours": "22.5",
    "job.materials": ["Red oak"],
    "job.review": "rev_01",
    "job.future": "kept",
    "job.costBand": "ask",
  };
  const next = applyJobDraft(fields, { trade: "flooring", service: "x", town: "Maple Falls", region: "WA", started: "2026-10-14", finished: "", costBand: "", before: ["/a.jpg"], after: [] });
  assert.equal(next["job.trade"], "flooring");
  assert.equal(next["job.place.town"], "Maple Falls");
  assert.deepEqual(next["job.media.before"], ["/a.jpg"]);
  for (const gone of ["job.finished", "job.costBand", "job.media.after"]) assert.ok(!(gone in next), gone);
  assert.equal(next["job.durationHours"], "22.5");
  assert.deepEqual(next["job.materials"], ["Red oak"]);
  assert.equal(next["job.review"], "rev_01");
  assert.equal(next["job.future"], "kept");
  assert.equal(fields["job.costBand"], "ask", "the input is not changed");
});

test("a round trip through the form changes nothing", () => {
  const fields = { "job.trade": "roofing", "job.service": "re-roof", "job.place.town": "Bend", "job.place.region": "OR", "job.started": "2026-01-02", "job.finished": "2026-01-03", "job.media.before": ["/b.jpg"] };
  assert.deepEqual(applyJobDraft(fields, readJobDraft(fields)), fields);
});

test("only a body with nothing in it takes the scaffold", () => {
  assert.ok(bodyTakesScaffold(""));
  assert.ok(bodyTakesScaffold(" \n\n "));
  assert.ok(!bodyTakesScaffold("Already writing."));
  assert.ok(!bodyTakesScaffold("## Problem\n"));
});

test("dates are plain days in the writer's own calendar", () => {
  assert.equal(localDay(new Date(2026, 9, 5, 23, 59)), "2026-10-05");
  assert.equal(dayValue("2026-10-14"), "2026-10-14");
  assert.equal(dayValue("2026-10-14T10:00:00Z"), "");
});

test("every cost band the engine knows has a plain label", () => {
  assert.deepEqual(Object.keys(COST_BAND_LABELS), ["under-500", "500-2k", "2k-10k", "10k-50k", "over-50k", "ask"]);
});

import { isJob, jobBoxes, joinJobBoxes, scaffoldHeadings, tradeLabel } from "../../web/studio/parts/job-rules.js";

const SCAFFOLD = "## Problem\n\n## What we found\n\n## What we did\n\n## Result\n\n";

test("a trade id reads as words, and a job is a post whose profile says so", () => {
  assert.equal(tradeLabel("general-contractor"), "General contractor");
  assert.equal(tradeLabel(""), "");
  assert.equal(isJob({ profile: "job" }), true);
  assert.equal(isJob({ profile: "recipe" }), false);
  assert.deepEqual(scaffoldHeadings(SCAFFOLD), ["Problem", "What we found", "What we did", "Result"]);
});

test("a body that is exactly the four headings becomes four boxes and comes back byte for byte", () => {
  for (const body of [
    SCAFFOLD,
    "## Problem\n\nLeak by the chimney.\n\n## What we found\n\nRotten decking.\n\n## What we did\n\nNew boards.\nNew shingles.\n\n## Result\n\nDry.\n",
    "## Problem\nx\n## What we found\n## What we did\n\n\n## Result",
    "## Problem\n\n![Photo 1 from the job](/images/a.jpg)\n\n## What we found\n\n## What we did\n\n## Result\n",
  ]) {
    const boxes = jobBoxes(body, SCAFFOLD);
    assert.ok(boxes, body);
    assert.deepEqual(boxes.map((box) => box.heading), ["Problem", "What we found", "What we did", "Result"]);
    assert.equal(joinJobBoxes(boxes), body);
  }
  const boxes = jobBoxes(SCAFFOLD, SCAFFOLD);
  boxes[0].words = "Leak";
  boxes[3].words = "Dry";
  assert.equal(joinJobBoxes(boxes), "## Problem\n\nLeak\n\n## What we found\n\n## What we did\n\n## Result\n\nDry\n");
});

test("any other shape stays one box", () => {
  for (const body of [
    "",
    "Intro\n" + SCAFFOLD,
    "## Problem\n\n## Other\n\n## What we did\n\n## Result\n",
    "## Problem\n\n## What we found\n\n## What we did\n\n## Result\n\n## Extra\n",
    "## Problem\n\n## What we found\n\n## What we did\n",
  ]) assert.equal(jobBoxes(body, SCAFFOLD), null, body);
  assert.equal(jobBoxes(SCAFFOLD, "## One\n"), null, "a scaffold that isn't four parts");
});
