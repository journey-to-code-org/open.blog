import { test } from "node:test";
import assert from "node:assert/strict";
import { photosIn } from "../../web/studio/parts/photo-strip.js";

test("photosIn finds her photo lines, descriptions unescaped", () => {
  const text = "Mama taught me.\n\n![Pie \\[warm\\] on the sill](/images/uploads/2026/pie.jpg)\n\nMore words ![not alone](/images/uploads/x.png)\n![](/images/uploads/b.png)";
  assert.deepEqual(photosIn(text), [
    { alt: "Pie [warm] on the sill", url: "/images/uploads/2026/pie.jpg", line: 2 },
    { alt: "", url: "/images/uploads/b.png", line: 5 },
  ]);
  assert.deepEqual(photosIn("![x](https://elsewhere.example/a.png)"), []);
});
