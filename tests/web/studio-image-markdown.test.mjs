import assert from "node:assert/strict";
import test from "node:test";

import { imageMarkdown, insertParagraph } from "../../web/studio/parts/image-markdown.js";

const PIE = "/images/uploads/2026/pie.jpg";

test("imageMarkdown writes the picture with its description", () => {
  assert.equal(imageMarkdown(PIE, "Pie cooling on the windowsill"), `![Pie cooling on the windowsill](${PIE})`);
  assert.equal(imageMarkdown(PIE, "  Pie  "), `![Pie](${PIE})`);
  assert.equal(imageMarkdown(PIE, "Grammi's \"best\" pie"), `![Grammi's "best" pie](${PIE})`);
});

test("imageMarkdown escapes \\, [ and ] and turns line breaks into spaces", () => {
  assert.equal(imageMarkdown(PIE, "Pie [the big one]"), `![Pie \\[the big one\\]](${PIE})`);
  assert.equal(imageMarkdown(PIE, "back\\slash"), `![back\\\\slash](${PIE})`);
  assert.equal(imageMarkdown(PIE, "a]](javascript:alert(1))"), `![a\\]\\](javascript:alert(1))](${PIE})`);
  assert.equal(imageMarkdown(PIE, "Two\nlines\r\nand\rthree"), `![Two lines and three](${PIE})`);
  assert.doesNotMatch(imageMarkdown(PIE, "Line one\n\n## Ingredients"), /\n/);
});

test("imageMarkdown refuses addresses outside uploads, or with spaces, parentheses or control characters", () => {
  for (const url of [
    "https://example.com/pie.jpg", "/images/pie.jpg", "images/uploads/pie.jpg", "", undefined,
    "/images/uploads/my pie.jpg", "/images/uploads/pie(1).jpg", "/images/uploads/pie).jpg",
    "/images/uploads/pie.jpg\n", "/images/uploads/pie\u0000.jpg", "/images/uploads/pie\u007f.jpg", "/images/uploads/pie\t.jpg",
    "javascript:alert(1)//images/uploads/",
  ]) {
    assert.throws(() => imageMarkdown(url, "Pie"), TypeError, String(url));
  }
  assert.equal(imageMarkdown("/images/uploads/2026/pie-1_a.webp", "Pie"), "![Pie](/images/uploads/2026/pie-1_a.webp)");
});

const MD = `![Pie](${PIE})`;

test("insertParagraph puts the picture after the paragraph holding the cursor, never mid-sentence", () => {
  const story = "Mama taught me this pie.\nThe year of the ice storm.\n\nRicky asks for seconds.";
  const mid = story.indexOf("pie.");
  const { text, cursor } = insertParagraph(story, mid, MD);
  assert.equal(text, `Mama taught me this pie.\nThe year of the ice storm.\n\n${MD}\n\nRicky asks for seconds.`);
  assert.equal(text.slice(0, cursor), `Mama taught me this pie.\nThe year of the ice storm.\n\n${MD}`);
});

test("insertParagraph at the end, in the last paragraph, or with no cursor", () => {
  assert.deepEqual(insertParagraph("One.\n\nTwo.", 9, MD), { text: `One.\n\nTwo.\n\n${MD}`, cursor: `One.\n\nTwo.\n\n${MD}`.length });
  assert.equal(insertParagraph("One.\n\nTwo.\n", null, MD).text, `One.\n\nTwo.\n\n${MD}\n`);
  assert.equal(insertParagraph("One.\n\nTwo.", undefined, MD).text, `One.\n\nTwo.\n\n${MD}`);
  assert.equal(insertParagraph("One.", 999, MD).text, `One.\n\n${MD}`);
});

test("insertParagraph on an empty line goes after the paragraph before it; before everything, at the start", () => {
  const text = "One.\n\n\nTwo.";
  assert.equal(insertParagraph(text, 6, MD).text, `One.\n\n${MD}\n\n\nTwo.`);
  assert.equal(insertParagraph("\nOne.", 0, MD).text, `\n${MD}\n\nOne.`);
  assert.equal(insertParagraph("One.", -5, MD).text, `One.\n\n${MD}`);
});

test("insertParagraph into an empty box is just the picture", () => {
  assert.deepEqual(insertParagraph("", 0, MD), { text: MD, cursor: MD.length });
  assert.deepEqual(insertParagraph("\n  \n", 2, MD), { text: MD, cursor: MD.length });
});

test("insertParagraph keeps every other character", () => {
  const notes = "Use the deep dish.\n\n- Don't open the oven.\n- Cool it overnight.\n";
  const { text } = insertParagraph(notes, notes.indexOf("open"), MD);
  assert.equal(text.replace(`\n\n${MD}`, ""), notes);
});
