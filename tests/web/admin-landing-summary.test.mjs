import { test } from "node:test";
import assert from "node:assert/strict";
import { sectionSummary, setComponents } from "../../web/admin/landing.js";

test("a text section's line is its words, not its markdown", () => {
  assert.equal(sectionSummary({ type: "rich-text", markdown: "## This season: *Thanksgiving*\n> [Grammi's pie](/posts/pie/)" }), "This season: Thanksgiving Grammi's pie");
});

test("a component's line skips post addresses and says dates as people do", () => {
  setComponents([{ tag: "family-birthday", label: "Birthday card", props: [
    { name: "person", type: "text", label: "Who" }, { name: "day", type: "date", label: "Birthday" }, { name: "recipe", type: "post", label: "Their recipe" },
  ] }]);
  const line = sectionSummary({ type: "component", tag: "family-birthday", props: { person: "Mikey", day: "1990-10-04", recipe: "grown-up-grilled-cheese" } });
  assert.equal(line, "Mikey, October 4, 1990");
});
