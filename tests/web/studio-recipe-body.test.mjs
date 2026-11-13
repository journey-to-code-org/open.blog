import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { classifyHeading, parseRecipeBody, splitPasted, writeRecipeBody } from "../../web/studio/parts/recipe-body.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// Grammi's starter, as in grammis-house/content/posts/2026-11-01-pumpkin-pie.md (two blank lines
// after the front matter, a "- " list in her notes).
const PUMPKIN_STARTER = `

TODO(Grammi): the story. Who taught you this, the year it went wrong, who always asks for seconds.

## Ingredients

- 1 TODO ingredient (start each line with the amount so readers can scale it)

## Steps

1. TODO: first step. Write times like "bake for 45 minutes" and readers get a timer button.

## Grammi's notes

- TODO: make-ahead tips, substitutions, what not to do.
`;

// The same post filled in the way the finish line asks: a story, 6 ingredients, 4 steps, a note.
const PUMPKIN = `Mama taught me this pie the year we had the ice storm. Ricky always asks for seconds.

![Pie cooling on the windowsill](/images/uploads/2026/pie.jpg)

## Ingredients

- 1 can (15 oz) pumpkin puree
- 3/4 cup sugar
- 1 tsp cinnamon
- 1/2 tsp ginger
- 2 large eggs
- 1 can (12 oz) evaporated milk

## Steps

1. Heat the oven to 425.
2. Mix everything in the big yellow bowl until smooth.
3. Pour it into the crust.
4. Bake for 15 minutes, then turn it down to 350 and
   bake for 45 minutes more.

## Grammi's notes

Use the deep dish. Don't let anyone open the oven.
`;

// Pappy's meatloaf: no blank line after the front matter, and a part Studio doesn't edit.
const MEATLOAF = `Pappy's birthday supper, April 9.

## Ingredients

- 2 lb ground beef
- 1 cup cracker crumbs
- Salt, to taste

## Steps

1. Mix it all with your hands.
2. Bake for 1 hour.

## Grammi's notes

Ketchup on top, always.

## What to serve with it

> Mashed potatoes, said Pappy, every time.

| Side | Who likes it |
| --- | --- |
| Green beans | Jimmy |
`;

const lines = (text) => text.split("\n");

/** The line numbers (1-based) where two texts differ, comparing line by line. */
function changedLines(a, b) {
  const x = lines(a);
  const y = lines(b);
  const out = [];
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) if (x[i] !== y[i]) out.push(i + 1);
  return out;
}

function parsed(body) {
  const p = parseRecipeBody(body);
  assert.equal(p.ok, true, p.reason);
  return p;
}

test("classifyHeading mirrors the engine's classify_heading", () => {
  for (const words of ["Ingredients", "Ingredient", "Ingredients for the sauce", "ingredients:", "What you need", "You’ll need", "You'll need", "You will need", "Zutaten", "Ingrédients", "Ingredienti"]) {
    assert.equal(classifyHeading(words), "ingredients", words);
  }
  for (const words of ["Steps", "Step", "Method:", "Methods", "Instructions", "Directions", "Preparation", "How to make it", "Étapes", "Pasos", "Zubereitung", "Bereiding"]) {
    assert.equal(classifyHeading(words), "steps", words);
  }
  for (const words of ["Stephanie's story", "Methodology", "Grammi's notes", "Notes", "Directional", "Stepping out", ""]) {
    assert.equal(classifyHeading(words), null, words);
  }
});

test("Grammi's starter opens in the boxes with every part", () => {
  const p = parsed(PUMPKIN_STARTER);
  assert.equal(p.story, "TODO(Grammi): the story. Who taught you this, the year it went wrong, who always asks for seconds.");
  assert.deepEqual(p.ingredients, ["1 TODO ingredient (start each line with the amount so readers can scale it)"]);
  assert.deepEqual(p.steps, ["TODO: first step. Write times like \"bake for 45 minutes\" and readers get a timer button."]);
  assert.deepEqual(p.notes, { heading: "Grammi's notes", text: "- TODO: make-ahead tips, substitutions, what not to do." });
  assert.deepEqual(p.others, []);
  assert.deepEqual(p.order, ["story", "ingredients", "steps", "notes"]);
});

test("a filled-in recipe reads its rows, and a wrapped step is one row", () => {
  const p = parsed(PUMPKIN);
  assert.equal(p.ingredients.length, 6);
  assert.equal(p.steps.length, 4);
  assert.equal(p.steps[3], "Bake for 15 minutes, then turn it down to 350 and\nbake for 45 minutes more.");
  assert.match(p.story, /\n\n!\[Pie cooling on the windowsill\]/);
  assert.equal(p.notes.text, "Use the deep dish. Don't let anyone open the oven.");
});

test("other parts are kept as written, heading line included, with their line", () => {
  const p = parsed(MEATLOAF);
  assert.equal(p.others.length, 1);
  assert.equal(p.others[0].heading, "What to serve with it");
  assert.equal(p.others[0].line, 18);
  assert.equal(p.others[0].text, MEATLOAF.slice(MEATLOAF.indexOf("## What to serve")).replace(/\n$/, ""));
  assert.deepEqual(p.order, ["story", "ingredients", "steps", "notes", "other:0"]);
});

test("the iron rule: every fixture writes back byte for byte", () => {
  const fixtures = [
    PUMPKIN_STARTER, PUMPKIN, MEATLOAF, "", "\n\n", "Just a story.\n", "No newline at the end",
    PUMPKIN.replace(/\n$/, ""), PUMPKIN.replace(/\n$/, "\n\n\n"), `\n  \n${PUMPKIN}`,
    PUMPKIN.replace("## Ingredients\n\n", "## Ingredients\n"),
    PUMPKIN.replace("## Steps\n\n", "## Steps\n   \n\n"),
    PUMPKIN.replace("## Ingredients", "## What you need"),
    PUMPKIN.replace("## Steps", "## Method:"),
    PUMPKIN.replace("## Grammi's notes", "## Grammi's notes ##"),
    PUMPKIN.replace(/\n/g, "\r\n"),
    MEATLOAF.replace(/\n/g, "\r\n"),
    "## Ingredients\n\n- 1 egg\n\n## Steps\n\n1. Crack it.\n",
    "Story\n\n## Ingredients\n\n## Steps\n",
    "Story\n\n## Ingredients\n\n- 1 egg\n",
    "Story\n\n## Ingredients\n\n- 1 egg\n\n## Equipment\n\nA pie plate.\n\n## Steps\n\n1. Bake.\n",
    "Story\n\n```md\n## Ingredients\n```\n\n## Ingredients\n\n- 1 egg\n\n## Steps\n\n1. Bake.\n",
    "Story\n\n<!--\n## Steps\n-->\n\n## Ingredients\n\n- 1 egg\n\n## Steps\n\n1. Bake.\n",
    "# A big heading\n\n## Ingredients\n\n- 1 egg\n\n## Steps\n\n1. Bake.\n\n# Appendix\n\nMore.\n",
  ];
  for (const body of fixtures) {
    const p = parsed(body);
    assert.equal(writeRecipeBody(p), body, JSON.stringify(body));
    assert.equal(writeRecipeBody(structuredClone(p)), body, "a copy writes the same");
  }
});

test("ten or more steps line their wrapped lines up under the text", () => {
  const steps = Array.from({ length: 10 }, (_, i) => `${i + 1}. Step ${i + 1}.`);
  steps[9] = "10. The last step,\n    on two lines.";
  const body = `## Ingredients\n\n- 1 egg\n\n## Steps\n\n${steps.join("\n")}\n`;
  const p = parsed(body);
  assert.equal(p.steps[9], "The last step,\non two lines.");
  assert.equal(writeRecipeBody(p), body);
});

test("every post in content/posts with an Ingredients heading falls back with a reason or round-trips exactly", () => {
  const dir = join(root, "content", "posts");
  let checked = 0;
  for (const name of readdirSync(dir).filter((n) => n.endsWith(".md"))) {
    const source = readFileSync(join(dir, name), "utf8");
    const front = source.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
    const body = front ? source.slice(front[0].length) : source;
    const hasIngredients = body.split(/\r?\n/).some((line) => {
      const m = line.match(/^ {0,3}#{1,6}[ \t]+(.*?)[ \t#]*$/);
      return m && classifyHeading(m[1]) === "ingredients";
    });
    if (!hasIngredients) continue;
    checked += 1;
    const p = parseRecipeBody(body);
    if (p.ok) {
      assert.equal(writeRecipeBody(p), body, name);
      assert.ok(p.ingredients.length > 0, `${name} has ingredient rows`);
    } else {
      assert.match(p.reason, /\S/, name);
      assert.ok(Number.isInteger(p.line) && p.line >= 1 && p.line <= body.split("\n").length, `${name} line ${p.line}`);
    }
  }
  assert.ok(checked >= 3, `found ${checked} recipe posts`);
});

test("the grouped cookie recipe in content/posts falls back, naming the group's line", () => {
  const source = readFileSync(join(root, "content/posts/2026-02-23-brown-butter-chocolate-chip-cookies.md"), "utf8");
  const body = source.slice(source.indexOf("\n---\n", 4) + 5);
  const p = parseRecipeBody(body);
  assert.equal(p.ok, false);
  assert.match(p.reason, /groups/);
  assert.equal(body.split("\n")[p.line - 1], "### For the dough");
});

test("changing one ingredient changes only that line", () => {
  for (const body of [PUMPKIN, MEATLOAF, PUMPKIN.replace(/\n/g, "\r\n")]) {
    const p = parsed(body);
    const ingredients = [...p.ingredients];
    ingredients[1] = "1 cup sugar";
    const out = writeRecipeBody({ ...p, ingredients });
    const crlf = body.includes("\r\n");
    const a = crlf ? body.replace(/\r\n/g, "\n") : body;
    const b = crlf ? out.replace(/\r\n/g, "\n") : out;
    const changed = changedLines(a, b);
    assert.equal(changed.length, 1);
    assert.equal(lines(b)[changed[0] - 1], "- 1 cup sugar");
    if (crlf) assert.equal(out.replace(/\r\n/g, "").includes("\n"), false, "line endings kept");
  }
});

test("changing the notes leaves every other byte alone, other parts included", () => {
  const p = parsed(MEATLOAF);
  const out = writeRecipeBody({ ...p, notes: { ...p.notes, text: "Ketchup on top.\n\nBrown sugar in the ketchup." } });
  assert.equal(out, MEATLOAF.replace("Ketchup on top, always.", "Ketchup on top.\n\nBrown sugar in the ketchup."));
});

test("changing the story keeps the blank lines around it", () => {
  const p = parsed(PUMPKIN_STARTER);
  const out = writeRecipeBody({ ...p, story: "Mama's pie.\n" });
  assert.equal(out, PUMPKIN_STARTER.replace(/TODO\(Grammi\)[^\n]*/, "Mama's pie."));
});

test("empty rows are dropped, steps are renumbered, and moving a step moves its lines", () => {
  const p = parsed(PUMPKIN);
  const steps = [p.steps[1], "  ", p.steps[0], p.steps[3], "", p.steps[2]];
  const out = writeRecipeBody({ ...p, ingredients: ["", ...p.ingredients, " "], steps });
  assert.equal(out, PUMPKIN.replace(
    /1\. Heat[\s\S]*?more\.\n/,
    "1. Mix everything in the big yellow bowl until smooth.\n2. Heat the oven to 425.\n3. Bake for 15 minutes, then turn it down to 350 and\n   bake for 45 minutes more.\n4. Pour it into the crust.\n",
  ));
  assert.deepEqual(parsed(out).steps.length, 4);
});

test("a step typed on several lines is written as one step, its lines lined up", () => {
  const p = parsed(MEATLOAF);
  const out = writeRecipeBody({ ...p, steps: [...p.steps, "Let it rest.\n\n  Then slice it.\n"] });
  assert.match(out, /\n3\. Let it rest\.\n {3}Then slice it\.\n\n## Grammi's notes/);
  assert.deepEqual(parsed(out).steps[2], "Let it rest.\nThen slice it.");
});

test("an ingredient typed with a line break stays one line", () => {
  const p = parsed(MEATLOAF);
  const out = writeRecipeBody({ ...p, ingredients: ["2 lb ground\nchuck", ...p.ingredients.slice(1)] });
  assert.equal(changedLines(MEATLOAF, out).length, 1);
  assert.match(out, /\n- 2 lb ground chuck\n/);
});

test("all rows removed keeps the Ingredients and Steps headings", () => {
  const p = parsed(PUMPKIN_STARTER);
  const out = writeRecipeBody({ ...p, ingredients: [""], steps: [] });
  assert.equal(out, "\n\nTODO(Grammi): the story. Who taught you this, the year it went wrong, who always asks for seconds.\n\n## Ingredients\n\n## Steps\n\n## Grammi's notes\n\n- TODO: make-ahead tips, substitutions, what not to do.\n");
  assert.equal(writeRecipeBody(parsed(out)), out);
});

test("a new recipe writes story, Ingredients, Steps and notes, leaving out empty parts", () => {
  const notes = { heading: "Grammi's notes", text: "Use the deep dish." };
  assert.equal(
    writeRecipeBody({ story: "Mama's pie.", ingredients: ["1 can pumpkin", ""], steps: ["Heat the oven.", "Bake for 45 minutes."], notes }),
    "Mama's pie.\n\n## Ingredients\n\n- 1 can pumpkin\n\n## Steps\n\n1. Heat the oven.\n2. Bake for 45 minutes.\n\n## Grammi's notes\n\nUse the deep dish.\n",
  );
  assert.equal(writeRecipeBody({ story: "", ingredients: [""], steps: [""], notes: null }), "## Ingredients\n\n## Steps\n");
  assert.equal(writeRecipeBody({ story: "Hi", ingredients: [], steps: [], notes: { heading: "", text: "A note." } }), "Hi\n\n## Ingredients\n\n## Steps\n\n## Notes\n\nA note.\n");
  assert.equal(writeRecipeBody({ story: "Hi", ingredients: [], steps: [], notes: { heading: "Grammi's notes", text: "  " } }), "Hi\n\n## Ingredients\n\n## Steps\n");
});

test("a body that was all story gets the recipe parts once something is filled in", () => {
  const p = parsed("Mama's pie.\n");
  assert.deepEqual(p.order, ["story"]);
  assert.equal(writeRecipeBody({ ...p, ingredients: [""], steps: [""] }), "Mama's pie.\n");
  assert.equal(writeRecipeBody({ ...p, ingredients: ["1 egg"] }), "Mama's pie.\n\n## Ingredients\n\n- 1 egg\n\n## Steps\n");
  const blank = parsed("\n\n");
  assert.equal(writeRecipeBody({ ...blank, steps: ["Bake."] }), "## Ingredients\n\n## Steps\n\n1. Bake.\n");
});

test("adding steps or notes where there were none puts them in the right place", () => {
  const p = parsed("Story\n\n## Ingredients\n\n- 1 egg\n\n## Wine\n\nRed.\n");
  assert.equal(
    writeRecipeBody({ ...p, steps: ["Bake."], notes: { heading: "Grammi's notes", text: "Easy." } }),
    "Story\n\n## Ingredients\n\n- 1 egg\n\n## Steps\n\n1. Bake.\n\n## Grammi's notes\n\nEasy.\n\n## Wine\n\nRed.\n",
  );
});

test("the notes heading is kept exactly, or written fresh when she renames it", () => {
  const body = PUMPKIN.replace("## Grammi's notes", "##   Grammi's notes  ##");
  const p = parsed(body);
  assert.equal(p.notes.heading, "Grammi's notes");
  assert.equal(writeRecipeBody(p), body);
  assert.match(writeRecipeBody({ ...p, notes: { heading: "Tips", text: p.notes.text } }), /\n## Tips\n\nUse the deep dish/);
  assert.doesNotMatch(writeRecipeBody({ ...p, notes: null }), /notes/);
});

test("only the first ## heading after the steps that mentions notes is the notes", () => {
  const p = parsed("## Ingredients\n\n- 1 egg\n\n## Steps\n\n1. Bake.\n\n## Wine\n\nRed.\n\n## Footnotes\n\nOne.\n\n## More notes\n\nTwo.\n");
  assert.equal(p.notes.heading, "Footnotes");
  assert.deepEqual(p.others.map((o) => o.heading), ["Wine", "More notes"]);
  const before = parsed("## Ingredients\n\n- 1 egg\n\n## Notes\n\nOne.\n\n## Steps\n\n1. Bake.\n");
  assert.equal(before.notes, null, "notes between Ingredients and Steps stay another part");
  assert.equal(before.others[0].heading, "Notes");
});

function fallsBack(body, pattern, line) {
  const p = parseRecipeBody(body);
  assert.equal(p.ok, false, `expected a fallback for ${JSON.stringify(body)}`);
  assert.match(p.reason, pattern);
  assert.equal(p.line, line, p.reason);
  assert.match(p.reason, /^[A-Z].*\.$/, "a plain sentence");
}

const ING = "## Ingredients\n\n";
const STEPS = "\n\n## Steps\n\n1. Bake.\n";

test("falls back: * and + bullets", () => {
  fallsBack(`${ING}- 1 egg\n* 1 cup milk${STEPS}`, /\* or \+/, 4);
  fallsBack(`${ING}+ 1 egg${STEPS}`, /\* or \+/, 3);
});

test("falls back: loose lists", () => {
  fallsBack(`${ING}- 1 egg\n\n- 1 cup milk${STEPS}`, /empty line between/, 4);
  fallsBack(`${ING}- 1 egg${"\n\n## Steps\n\n1. Mix.\n\n2. Bake.\n"}`, /empty line between/, 8);
});

test("falls back: a step of more than one paragraph", () => {
  fallsBack(`${ING}- 1 egg${"\n\n## Steps\n\n1. Mix.\n\n   Then rest it.\n2. Bake.\n"}`, /Step 1 has more than one paragraph/, 9);
});

test("falls back: 1) numbering, and steps not numbered in order", () => {
  fallsBack(`${ING}- 1 egg${"\n\n## Steps\n\n1) Bake.\n"}`, /1\)/, 7);
  fallsBack(`${ING}- 1 egg${"\n\n## Steps\n\n1. Mix.\n1. Bake.\n"}`, /1, 2, 3/, 8);
  fallsBack(`${ING}- 1 egg${"\n\n## Steps\n\n2. Bake.\n"}`, /1, 2, 3/, 7);
});

test("falls back: Steps before Ingredients, or Steps with no Ingredients", () => {
  fallsBack("Story\n\n## Steps\n\n1. Bake.\n\n## Ingredients\n\n- 1 egg\n", /Steps come before Ingredients/, 3);
  fallsBack("Story\n\n## Steps\n\n1. Bake.\n", /Steps come before Ingredients/, 3);
});

test("falls back: a ### heading in the story", () => {
  fallsBack(`Story\n\n### Mama's kitchen\n\nMore.\n\n${ING}- 1 egg${STEPS}`, /small heading/, 3);
  fallsBack("Story\n\n### A memory\n", /small heading/, 3);
});

test("falls back: Ingredients or Steps twice", () => {
  fallsBack(`${ING}- 1 egg${STEPS}\n${ING}- 1 more egg\n`, /Ingredients appears twice \(lines 1 and 9\)/, 9);
  fallsBack(`${ING}- 1 egg${STEPS}\n## Method\n\n1. Again.\n`, /Steps appears twice \(lines 5 and 9\)/, 9);
  fallsBack(`${ING}- 1 egg${STEPS}\n## Wine\n\n### Steps for the sauce\n\n1. Stir.\n`, /Steps appears twice/, 11);
});

test("falls back: ### groups inside Ingredients, and headings inside Steps", () => {
  fallsBack(`${ING}### For the crust\n\n- 1 cup flour${STEPS}`, /split into groups/, 3);
  fallsBack(`${ING}- 1 egg\n\n## Steps\n\n### First\n\n1. Bake.\n`, /heading inside/, 7);
});

test("falls back: other shapes that wouldn't come back the same", () => {
  fallsBack(`### Ingredients\n\n- 1 egg${STEPS}`, /isn't a ## heading/, 1);
  fallsBack(`${ING}1. 1 egg${STEPS}`, /numbered list/, 3);
  fallsBack(`${ING}- 1 egg${"\n\n## Steps\n\n- Bake.\n"}`, /bulleted list/, 7);
  fallsBack(`${ING}- 1 egg\n  beaten${STEPS}`, /second line/, 4);
  fallsBack(`${ING}- 1 egg\n-${STEPS}`, /Ingredient 2 is empty/, 4);
  fallsBack(`${ING}- 1 egg\n-  1 cup milk${STEPS}`, /extra spaces/, 4);
  fallsBack(`${ING}- 1 egg${"\n\n## Steps\n\n1. Mix.\n2.\n"}`, /Step 2 is empty/, 8);
  fallsBack(`${ING}Some words first.\n- 1 egg${STEPS}`, /aren't in the list/, 3);
  fallsBack(`${ING}- 1 egg\n\nServe warm.${STEPS}`, /aren't in the list \(line 5\)/, 5);
  fallsBack(`${ING}- 1 egg${"\n\n## Steps\n\n1. Mix\nlazily.\n"}`, /doesn't line up/, 8);
  fallsBack(`${ING}- 1 egg${"\n\n## Steps\n\n1. Mix\n   - a list\n"}`, /list, heading, quote or code/, 8);
  fallsBack(`${ING}- 1 egg${"\n\n## Steps\n\n1. Bake.\n\nWords\n---\n"}`, /underlined/, 9);
  fallsBack(`Story\nIngredients\n===========\n\n- 1 egg\n`, /underlined/, 2);
  fallsBack("Story\r\n\n## Ingredients\r\n", /two different ways/, 2);
});

test("splitPasted makes one row per line, dropping the list marks", () => {
  assert.deepEqual(splitPasted("- 2 cups flour\n- 1 tsp salt\n\n  -  3 eggs  \r\n1.5 cups milk\n", "ingredients"),
    ["2 cups flour", "1 tsp salt", "3 eggs", "1.5 cups milk"]);
  assert.deepEqual(splitPasted("1. Heat the oven.\n2.  Mix.\n10. Bake.\n1.5 hours of rest\n- Serve.", "steps"),
    ["Heat the oven.", "Mix.", "Bake.", "1.5 hours of rest", "- Serve."]);
  assert.deepEqual(splitPasted("", "steps"), []);
  assert.deepEqual(splitPasted("1. 1 egg", "ingredients"), ["1. 1 egg"]);
});
