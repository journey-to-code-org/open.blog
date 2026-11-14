import assert from "node:assert/strict";
import test from "node:test";

import { imageMarkdown } from "../../web/studio/parts/image-markdown.js";

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
