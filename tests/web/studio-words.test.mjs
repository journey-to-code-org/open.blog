// Studio's words (docs/specs/studio/words/spec.md): say() and its catalog, a site's changes, and the
// checks that keep every shipped string right for any owner.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import {
  catalog, configureWords, DEFAULT_VARS, wordsInEffect, ID_PATTERN, maxFor, overrideProblem, say, varProblem, varsIn, wordVars,
} from "../../web/studio/parts/words.js";
import { HER_BANNED, HER_BANNED_WORDS, bannedIn } from "../../web/studio/parts/plain-words.js";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const studio = join(repository, "web", "studio");

test("say() gives the built-in words, with the three variables filled in", () => {
  configureWords();
  assert.equal(say("common.tell"), "Tell the person who set up your site.");
  assert.equal(say("common.forHelper"), "For the person who set up your site");
  // A sentence that starts with a variable starts with a capital.
  assert.equal(say("common.canTurnOn"), "The person who set up your site can turn it on.");
  assert.equal(say("decorations.decorated", { theme: "Christmas" }), "Your blog is decorated for Christmas.");
  assert.deepEqual(wordVars(), DEFAULT_VARS);
});

test("a site's variables and per-call values fill every sentence", () => {
  configureWords({ vars: { helper: "Mikey", owner: "Grammi" } });
  assert.equal(say("common.tell"), "Tell Mikey.");
  assert.equal(say("common.detailsFor"), "Details for Mikey");
  assert.equal(say("common.canTurnOn"), "Mikey can turn it on.");
  assert.equal(say("cards.signOff"), "Grammi");
  configureWords({ vars: { helper: "your son" } });
  assert.equal(say("common.canTurnOn"), "Your son can turn it on.", "first letter capital when the text starts with a variable");
  assert.equal(say("common.tell"), "Tell your son.", "not mid-sentence");
  // A variable at the start of a sentence (after . ! or ?) starts with a capital too.
  assert.equal(say("card.cantChange"), "This one can't be changed here. Your son can.");
  assert.equal(say("form.cantAddYet"), "Your blog can't add this yet. Your son can update it.");
  assert.equal(say("about.aliasFix"), "An old address in this post can't be used. Your son can fix it in the file.");
  assert.equal(say("undo.mayFind", { title: "Pie" }), "“Pie” can't come back from here. Your son may still find it.");
  configureWords();
  assert.equal(say("card.cantChange"), "This one can't be changed here. The person who set up your site can.");
  configureWords({ vars: { product: "your website" } });
  assert.equal(say("decorations.everyDay", { theme: "Autumn" }), "Your website wears Autumn every day.");
  configureWords();
});

test("with no name for her, words that need one use their bare form", () => {
  configureWords();
  assert.equal(say("cards.signOff"), "", "bare");
  configureWords({ vars: { helper: "Mikey" }, text: { "cards.signOff": "Love, {owner}", "recipe.notesHeading": "{owner}'s notes" } });
  assert.equal(say("cards.signOff"), "", "a change that needs her name falls back to bare");
  assert.equal(say("recipe.notesHeading"), "Notes", "or to the built-in words when those don't need it");
  configureWords({ vars: { owner: "Grammi" }, text: { "cards.signOff": "Love, {owner}", "recipe.notesHeading": "{owner}'s notes" } });
  assert.equal(say("cards.signOff"), "Love, Grammi");
  assert.equal(say("recipe.notesHeading"), "Grammi's notes");
  configureWords();
});

test("a site's changes apply; ones that fail the checks are ignored and the built-in words show", () => {
  configureWords({
    vars: { helper: "Hillside <b>Web</b>", product: "x".repeat(61), owner: "{owner}" },
    text: {
      "common.tell": "Ask {helper} at once.",
      "common.ask": "<img src=x onerror=alert(1)>",
      "common.letKnow": "Tell {helper} and {nobody}.",
      "common.forHelper": "x".repeat(maxFor(catalog()["common.forHelper"]) + 1),
      "common.chose": "{helper} had to deploy this.",
      "card.signoff": "Love",
      "common.canChange": 42,
    },
  });
  assert.equal(say("common.tell"), "Ask the person who set up your site at once.", "a good change applies; a bad helper is ignored");
  assert.equal(say("common.ask"), "Ask the person who set up your site.", "no < >");
  assert.equal(say("common.letKnow"), "Let the person who set up your site know.", "an unknown variable");
  assert.equal(say("common.forHelper"), "For the person who set up your site", "too long");
  assert.equal(say("common.chose"), "The person who set up your site chose this.", "a banned word on her layer");
  assert.equal(say("common.canChange"), "The person who set up your site can change that.", "not text");
  assert.deepEqual(wordVars(), DEFAULT_VARS);
  configureWords();
});

test("the checks say why", () => {
  assert.equal(overrideProblem("nope.id", "x"), "not a word id");
  assert.equal(overrideProblem("common.tell", "<b>"), "has < or >");
  assert.equal(overrideProblem("common.tell", "Sync with {helper}."), "a word she never sees");
  assert.equal(overrideProblem("cards.signOff", ""), "", "an empty sign-off is the one empty text");
  assert.equal(overrideProblem("common.tell", " "), "empty");
  assert.equal(varProblem("helper", "Mikey"), "");
  assert.equal(varProblem("helper", "a {b}"), "has a brace or < >");
  assert.equal(varProblem("owner", ""), "", "her name may be empty");
  assert.equal(varProblem("site", "x"), "not a variable");
  assert.equal(varProblem("helper", "the push team"), "a word she never sees");
});

test("an unknown id throws: a programming error the tests catch", () => {
  assert.throws(() => say("common.nope"), /isn't a word id/);
});

test("say() returns text only: markup in a value is never interpreted, and changes can't carry it", () => {
  configureWords({ vars: { helper: "Mikey" } });
  // Per-call values are text the caller places with textContent; say() never builds markup.
  assert.equal(say("undo.mayFind", { title: "<b>Pie</b>" }), "“<b>Pie</b>” can't come back from here. Mikey may still find it.");
  configureWords({ text: { "common.tell": "Tell <a href=x>them</a>." } });
  assert.equal(say("common.tell"), "Tell the person who set up your site.");
  configureWords();
});

test("Home's details list the words in effect and every problem, and hide when there are none", () => {
  assert.equal(wordsInEffect(undefined), null);
  assert.equal(wordsInEffect({ vars: DEFAULT_VARS, text: {}, from: {}, problems: [] }), null);
  const words = wordsInEffect({
    vars: { helper: "Mikey", product: "your blog", owner: "Grammi" },
    text: { "cards.signOff": "Love, {owner}", "common.ask": "Ask {helper} today." },
    from: { helper: "site", "cards.signOff": "site", "common.ask": "server" },
    problems: [{ where: "site", key: "card.signoff", words: "card.signoff isn't a word id. Did you mean cards.signOff?" }],
  });
  assert.equal(words.summary, "2 changed by this site, 1 by the server's file.");
  assert.deepEqual(words.changes, ["cards.signOff: Love, {owner} (site)", "common.ask: Ask {helper} today. (server's file)", "helper: Mikey (site)"]);
  assert.deepEqual(words.problems, ["card.signoff isn't a word id. Did you mean cards.signOff?"]);
  assert.equal(wordsInEffect({ from: {}, problems: [{ words: "x" }] }).summary, "Nothing changed.");
});

// ---- the catalog

const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
const sources = [...walk(join(studio, "screens")), ...walk(join(studio, "parts")), join(studio, "studio.js"), join(studio, "shell.js")].filter((f) => f.endsWith(".js"));

/** Each file's word calls: the name it imports `say` under, and every call of it. */
function calls(file) {
  const text = readFileSync(file, "utf8");
  const imported = /import \{([^}]*)\} from "[./]+(?:parts\/)?words\.js";/.exec(text);
  const binding = imported && /(?:^|,)\s*say(?:\s+as\s+(\w+))?\s*(?:,|$)/.exec(imported[1]);
  if (!binding) return { name: "", ids: [], nonLiteral: [] };
  const name = binding[1] || "say";
  const ids = [];
  const nonLiteral = [];
  for (const m of text.matchAll(new RegExp(`(?<![\\w.])${name}\\(\\s*([^\\s)])`, "g"))) {
    const rest = text.slice(m.index + m[0].length - 1);
    const literal = /^"([^"]+)"/.exec(rest);
    if (literal) ids.push(literal[1]); else nonLiteral.push(`${file}: ${rest.slice(0, 40)}`);
  }
  return { name, ids, nonLiteral };
}

test("ids are unique, well formed, and each has a layer; {owner} ids have bare words", () => {
  const all = catalog();
  for (const [id, entry] of Object.entries(all)) {
    assert.match(id, ID_PATTERN, id);
    assert.ok(entry.layer === "her" || entry.layer === "details", `${id} layer`);
    assert.equal(typeof entry.text, "string", id);
    if (varsIn(entry.text).includes("owner")) assert.equal(typeof entry.bare, "string", `${id} uses {owner}, so it needs bare words`);
    assert.ok(entry.text.length <= entry.max, `${id} fits its own limit`);
  }
});

test("her-layer defaults never use a banned word", () => {
  for (const [id, entry] of Object.entries(catalog())) {
    if (entry.layer !== "her") continue;
    assert.doesNotMatch(entry.text, HER_BANNED, id);
    assert.doesNotMatch(say(id), HER_BANNED, `${id} filled in`);
  }
  for (const [name, value] of Object.entries(DEFAULT_VARS)) assert.equal(bannedIn(value), "", name);
  assert.equal(bannedIn("Your phone will sync"), "sync");
  assert.equal(bannedIn("Front  matter"), "front matter");
  assert.ok(HER_BANNED_WORDS.includes("deploy"));
});

test("every say() id exists, every id is used, and no say() call builds its id", () => {
  const used = new Set();
  const nonLiteral = [];
  for (const file of sources) {
    const found = calls(file);
    found.ids.forEach((id) => used.add(id));
    nonLiteral.push(...found.nonLiteral);
  }
  assert.deepEqual(nonLiteral, [], "say() takes a literal id");
  const known = new Set(Object.keys(catalog()));
  assert.deepEqual([...used].filter((id) => !known.has(id)), [], "ids used but not in the catalog");
  assert.deepEqual([...known].filter((id) => !used.has(id)), [], "ids in the catalog nobody says");
});

// ---- shipped strings

/** A file's code with its comments taken out: block comments, comment lines, and a trailing ` // ...`. */
const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").split("\n")
  .filter((line) => !/^\s*(\/\/|\*)/.test(line)).map((line) => line.replace(/\s\/\/\s.*$/, "")).join("\n");

test("no shipped string names one owner, her family, her site or her food", () => {
  const PERSONA = /Grammi|Mikey|grammishouse|Family Wall|Kitchen iPad|Thanksgiving recipes|windowsill/i;
  const found = sources.filter((file) => PERSONA.test(code(readFileSync(file, "utf8")))).map((file) => file.slice(studio.length + 1));
  assert.deepEqual(found, []);
});

test("W-a: no literal \"person who set up your site\" left in Studio's code", () => {
  const found = sources
    .filter((file) => !file.endsWith("/parts/words.js"))
    .filter((file) => /person who set up (your|the) site/.test(code(readFileSync(file, "utf8"))))
    .map((file) => file.slice(studio.length + 1));
  assert.deepEqual(found, []);
});

test("words.json and the docs table are up to date", () => {
  execFileSync(process.execPath, [join(repository, "scripts", "studio-words.mjs"), "--check"], { stdio: "pipe" });
  const json = JSON.parse(readFileSync(join(studio, "words.json"), "utf8"));
  assert.deepEqual(json.vars, DEFAULT_VARS);
  assert.deepEqual(json.banned, [...HER_BANNED_WORDS]);
  assert.equal(json.words["common.tell"].layer, "her");
  assert.deepEqual(json.words["cards.signOff"], { text: "{owner}", layer: "her", max: 80, vars: ["owner"], bare: "" });
});
