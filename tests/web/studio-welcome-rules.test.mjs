// Studio ONB1: About your blog's rules. What each answer does to the areas (only an explicit answer
// hides; what the site uses always shows), the address that carries the answers, and the order.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { AREA_IDS } from "../../web/studio/parts/area-rules.js";
import {
  QUESTIONS, QUESTION_IDS, answersFrom, answersQuery, areasFor, asksFirst, cleanAnswers, questionNumber, savePatch, startingAnswers,
  stepAfter, stepBefore, welcomeHash, welcomeStep,
} from "../../web/studio/parts/welcome-rules.js";
import { choiceText, questionText, reasonText } from "../../web/studio/parts/welcome-text.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("the questions match the server's", () => {
  const rust = readFileSync(join(root, "crates/openblog-cli/src/admin_preferences.rs"), "utf8");
  const block = /pub const QUESTIONS[^=]*= &\[([\s\S]*?)\n\];/.exec(rust)[1];
  const server = [...block.matchAll(/\("(\w+)", (KIND_IDS|&\[[^\]]*\])\)/g)].map((m) => [m[1], m[2] === "KIND_IDS" ? "kinds" : [...m[2].matchAll(/"([^"]+)"/g)].map((c) => c[1])]);
  assert.deepEqual(server.map(([id]) => id), [...QUESTION_IDS]);
  for (const [id, choices] of server) if (choices !== "kinds") assert.deepEqual(choices, QUESTIONS.find((q) => q.id === id).choices, id);
  for (const q of QUESTIONS) {
    assert.ok(questionText(q.id), q.id);
    for (const choice of q.choices) assert.ok(choiceText(q.id, choice), `${q.id}.${choice}`);
  }
});

test("technical with no seasons hides seasons, recipes and business", () => {
  const { shown, hidden, reasons } = areasFor({ kind: "technical", seasons: "no" }, []);
  for (const id of ["seasonal", "recipes", "trade", "research", "teaching"]) assert.ok(hidden.includes(id), id);
  for (const id of ["code", "pages", "collections", "sharing", "readers", "together"]) assert.ok(shown.includes(id), id);
  assert.equal(reasons.code.why, "kind");
  assert.equal(reasons.sharing.why, "unasked", "a question left unanswered hides nothing");
  assert.equal(reasons.seasonal.why, "hidden.seasons");
});

test("recipes with seasons shows recipes and seasons; sharing later and no research", () => {
  const { shown, hidden, reasons } = areasFor({ kind: "recipes", seasons: "yes", sharing: "later", readers: "yes", together: "solo" }, []);
  for (const id of ["recipes", "seasonal", "collections", "readers"]) assert.ok(shown.includes(id), id);
  for (const id of ["sharing", "research", "code", "trade", "together"]) assert.ok(hidden.includes(id), id);
  assert.equal(reasons.seasonal.why, "seasons");
  assert.equal(reasons.sharing.why, "hidden.sharing");
  assert.equal(reasonText(reasons.sharing, { sharing: "later" }), "You said maybe later.");
  assert.equal(reasonText(reasons.recipes, { kind: "recipes" }), "Because you write recipes and family stories.");
});

test("every kind and every answer has a predictable effect", () => {
  for (const kind of QUESTIONS[0].choices) {
    const result = areasFor({ kind }, []);
    assert.deepEqual([...result.shown, ...result.hidden].sort(), [...AREA_IDS].sort(), kind);
    for (const id of ["seasonal", "sharing", "readers", "together"]) assert.ok(result.shown.includes(id), `${kind} hides nothing it wasn't asked about: ${id}`);
  }
  const effects = { together: { solo: ["together", false], few: ["together", true] }, seasons: { yes: ["seasonal", true], no: ["seasonal", false] },
    sharing: { yes: ["sharing", true], later: ["sharing", false], no: ["sharing", false] }, readers: { yes: ["readers", true], no: ["readers", false] } };
  for (const [question, choices] of Object.entries(effects)) {
    for (const [choice, [area, on]] of Object.entries(choices)) {
      const result = areasFor({ [question]: choice }, []);
      assert.equal(result.shown.includes(area), on, `${question}.${choice}`);
      assert.equal(result.hidden.length, on ? 0 : 1, `${question}.${choice} touches one area`);
    }
  }
  assert.equal(areasFor({ amount: "everything" }, []).showEverything, true);
  assert.equal(areasFor({ amount: "essentials" }, []).showEverything, false);
  assert.deepEqual(areasFor({}, []).hidden, [], "skipping everything hides nothing");
});

test("an area in use is shown whatever the answers, and says why", () => {
  const { shown, hidden, reasons } = areasFor({ kind: "technical", seasons: "no" }, ["recipes", "seasonal"]);
  assert.ok(shown.includes("recipes") && shown.includes("seasonal"));
  assert.ok(!hidden.includes("recipes"));
  assert.equal(reasons.recipes.why, "inUse");
  assert.equal(reasonText(reasons.recipes, {}), "Already on your blog.");
});

test("savePatch is what PUT areas takes", () => {
  const patch = savePatch({ kind: "recipes", seasons: "yes", sharing: "no", colour: "red" }, []);
  assert.deepEqual(patch.onboarding, { state: "done" });
  assert.equal(patch.kind, "recipes");
  assert.deepEqual(patch.answers, { kind: "recipes", seasons: "yes", sharing: "no" });
  assert.ok(patch.hidden.includes("sharing") && !patch.hidden.includes("seasonal"));
  assert.equal(patch.showEverything, false);
  assert.equal(savePatch({}, []).kind, null);
});

test("answers ride in the address, and come back exactly", () => {
  const answers = { kind: "recipes", together: "solo", seasons: "yes" };
  assert.equal(answersQuery(answers), "kind.recipes~together.solo~seasons.yes");
  assert.deepEqual(answersFrom(answersQuery(answers)), answers);
  assert.deepEqual(answersFrom("kind.astrology~seasons.yes~x.y~garbage"), { seasons: "yes" });
  assert.equal(welcomeHash("kind", {}), "#/welcome");
  assert.equal(welcomeHash("seasons", answers), "#/welcome/seasons?a=kind.recipes~together.solo~seasons.yes");
  assert.deepEqual(cleanAnswers({ kind: "docs", amount: "lots" }), { kind: "docs" });
  // What URLSearchParams gives back is what was put in.
  const query = Object.fromEntries(new URLSearchParams(welcomeHash("summary", answers).split("?")[1]));
  assert.deepEqual(answersFrom(query.a), answers);
});

test("the order of screens, and where they start", () => {
  assert.deepEqual(QUESTION_IDS, ["kind", "together", "seasons", "sharing", "readers", "amount"]);
  assert.equal(stepAfter("kind"), "together");
  assert.equal(stepAfter("amount"), "summary");
  assert.equal(stepAfter("summary"), "suggestions");
  assert.equal(stepAfter("suggestions"), "voice");
  assert.equal(stepAfter("voice"), null);
  assert.equal(stepBefore("kind"), null);
  assert.equal(stepBefore("together"), "kind");
  assert.equal(stepBefore("summary"), "amount");
  assert.equal(stepBefore("voice"), "suggestions");
  assert.equal(questionNumber("seasons"), 3);
  assert.equal(questionNumber("summary"), 0);
  assert.equal(welcomeStep(""), "kind");
  assert.equal(welcomeStep("nonsense"), "kind");
  assert.equal(welcomeStep("summary"), "summary");
  assert.deepEqual(startingAnswers({}, {}, "technical"), { kind: "technical" }, "init's kind");
  assert.deepEqual(startingAnswers({}, { kind: "recipes" }, "technical"), { kind: "recipes" }, "her own answers before init's");
  assert.deepEqual(startingAnswers({ seasons: "no" }, { kind: "recipes" }, "technical"), { seasons: "no" }, "the address first");
  assert.deepEqual(startingAnswers({}, {}, "astrology"), {});
  assert.equal(asksFirst({ onboarding: { state: "pending" } }), true);
  assert.equal(asksFirst({}), true);
  assert.equal(asksFirst({ onboarding: { state: "done" } }), false);
  assert.equal(asksFirst({ onboarding: { state: "skipped" } }), false);
  assert.equal(asksFirst({ onboarding: { state: "done" } }), false, "a practice run asks only while hers are unanswered");
});
