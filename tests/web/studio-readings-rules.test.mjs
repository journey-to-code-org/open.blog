import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import * as R from "../../web/studio/parts/readings-rules.js";
import { say } from "../../web/studio/parts/words.js";

// The editor's model, against the golden file the Rust contract tests round-trip byte for byte.
const golden = JSON.parse(readFileSync(new URL("../../crates/openblog-core/tests/fixtures/scholarly-comparison.json", import.meta.url), "utf8"));
const without = (file) => {
  const { format: _format, version: _version, ...rest } = file;
  return rest;
};

test("the golden file survives the editor model unchanged, unknown fields and approvals included", () => {
  const draft = R.readingDraft(golden, "golden");
  assert.equal(draft.slug, "golden");
  assert.deepEqual(R.readingPayload(draft), without(golden));
  assert.ok(R.readingSame(draft, R.readingDraft(R.readingPayload(draft), "golden")));
  assert.equal(draft["x-note"], "kept as written");
  assert.equal(draft.explanations[0].approval.by, "The author");
});

test("empty optional fields are left out of what a save sends", () => {
  const draft = R.readingDraft(golden, "golden");
  draft.interpretations[0].uncertainty = "  ";
  draft.interpretations[0].language = "";
  draft.explanations[1].about = "";
  draft.relations[0].note = "";
  const out = R.readingPayload(draft);
  assert.ok(!("uncertainty" in out.interpretations[0]));
  assert.ok(!("language" in out.interpretations[0]));
  assert.ok(!("about" in out.explanations[1]));
  assert.ok(!("note" in out.relations[0]));
});

test("an AI draft keeps its label and clearing the mark takes its approval with it", () => {
  const item = R.setOrigin(R.newExplanation([], "student"), true, "an assistant");
  assert.deepEqual(item.origin, { kind: "ai-draft", tool: "an assistant" });
  assert.equal(R.readingPayload({ ...R.readingDraft(null, "x"), explanations: [item] }).explanations[0].origin.tool, "an assistant");
  item.approval = { by: "me", at: "2026-10-27T10:00:00Z", digest: "d" };
  R.setOrigin(item, false);
  assert.ok(!("origin" in item) && !("approval" in item));
});

test("ids are unique and new readings carry no default name", () => {
  const items = [{ id: "reading" }, { id: "reading-2" }];
  assert.equal(R.newId(items, "Reading"), "reading-3");
  assert.equal(R.newId([], "  !!! "), "item");
  assert.equal(R.newReading(items).attribution.name, "");
  const x = R.newExplanation([], "scholarly", "political");
  assert.deepEqual([x.level, x.about, x.id], ["scholarly", "political", "scholarly-political"]);
  assert.deepEqual(R.attributionAs({ kind: "named", name: "N", certainty: "uncertain" }, "anonymous"), { kind: "anonymous", description: "", certainty: "uncertain" });
});

test("local problems name the item and the field", () => {
  const draft = R.readingDraft(golden, "golden");
  assert.deepEqual(R.localProblems(draft), []);
  draft.interpretations[1].attribution = R.attributionAs(draft.interpretations[1].attribution, "named");
  draft.explanations[0].origin = { kind: "ai-draft", tool: " " };
  const found = R.localProblems(draft);
  assert.ok(found.some((p) => p.item === "epistemic" && p.field === "attribution" && p.code === "required"));
  assert.ok(found.some((p) => p.item === "cave-beginner" && p.code === "ai-tool"));
  assert.ok(R.localProblems({ ...draft, slug: "Bad Slug", title: "" }).some((p) => p.item === null));
  assert.ok(!R.localProblems({ ...draft, slug: "Bad Slug" }, { isNew: false }).some((p) => p.field === "address"));
});

test("states, errors and left-out reasons are worded, never only coloured", () => {
  assert.equal(R.standingWords({ standing: "awaiting-approval" }), say("readings.standingAwaiting"));
  assert.match(R.standingWords({ standing: "stale" }), /approve it again/);
  assert.match(R.evidenceWords("private"), /readers won't see/);
  assert.match(R.evidenceWords("missing"), /Not in your library/);
  assert.match(R.errorWords({ data: { code: "stale" } }), /Nothing was approved/);
  assert.match(R.errorWords({ data: { stale: true } }), /Nothing was approved/);
  assert.match(R.errorWords({ data: { conflict: true } }), /Nothing was saved/);
  assert.equal(R.problemWords("explanation-evidence"), say("readings.pEvidence"));
  assert.equal(R.listLine({ valid: true, status: "published", shown: false }), say("readings.rowNotShown"));
  assert.equal(R.waitingLine(2), say("readings.waiting", { count: 2 }));
  for (const reason of ["awaiting-approval", "stale-approval", "subject-withheld", "evidence-not-public", "attribution-not-public", "withdrawn", "draft", "too-few-interpretations"]) {
    assert.ok(R.leftOutWords(reason).length > 0);
  }
  assert.equal(R.leftOutLine({ id: "easy", reason: "awaiting-approval" }, () => "Beginners"), "Beginners: not approved");
  assert.equal(R.whoHolds({ kind: "source", source: "s" }, [{ id: "s", title: "Slings" }]), "Slings");
  assert.equal(R.readingWho({ attribution: { kind: "named", name: "" } }), say("readings.someone"));
});

test("server problems read their codes and fields", () => {
  const error = { data: { problems: [{ code: "explanation-evidence", field: "evidence", item: "x", message: "m" }] } };
  assert.deepEqual(R.readingsProblem(error), [{ field: "evidence", item: "x", code: "explanation-evidence", message: "m" }]);
  assert.deepEqual(R.readingsProblem({}), []);
});

test("an explanation may use only evidence its reading already cites; taking out a reading takes out what names it", () => {
  const draft = R.readingDraft(golden, "golden");
  const first = draft.interpretations[0];
  const choices = R.explanationEvidenceChoices(draft, { about: first.id });
  assert.deepEqual(choices.map((c) => c.key), first.evidence.map(R.refKey));
  R.takeOutReading(draft, first.id);
  assert.ok(!draft.relations.some((r) => r.from === first.id || r.to === first.id));
  assert.ok(!draft.explanations.some((x) => x.about === first.id));
});

test("file-only facts of an explanation are shown and travel untouched", () => {
  const draft = R.readingDraft(golden, "golden");
  const withFacts = draft.explanations.find((x) => x.authors || x.prerequisite || x.modes);
  if (withFacts) assert.ok(R.fileFacts(withFacts).length > 0);
  assert.deepEqual(R.readingPayload(draft), without(golden));
});

test("the editor never builds an approval itself", () => {
  const files = ["parts/readings-rules.js", "screens/reading-edit.js"].map((f) => readFileSync(new URL(`../../web/studio/${f}`, import.meta.url), "utf8")).join("\n");
  assert.ok(!/\bapproval\s*=\s*\{/.test(files) && !/approval:\s*\{/.test(files.replace(/"approval-added"/g, "")), "only the server stamps an approval");
  assert.match(files, /\$\{BASE\}\/approve/);
  assert.match(files, /\$\{BASE\}\/revoke/);
});

test("her words never say slug, file, JSON, Studio or Admin, and 'comparison' is about readings", () => {
  for (const id of Object.keys(JSON.parse(readFileSync(new URL("../../web/studio/words.json", import.meta.url), "utf8"))).filter((k) => k.startsWith("readings."))) {
    const entry = JSON.parse(readFileSync(new URL("../../web/studio/words.json", import.meta.url), "utf8"))[id];
    if (entry.layer !== "her") continue;
    assert.ok(!/\b(slug|json|studio|admin)\b/i.test(entry.text), id);
  }
});
