// A research post's Abstract and References (Studio R6), ported from the research-section cases of
// admin-behavior and admin-markdown-edit (the old Admin's admin-draft-research area).
import assert from "node:assert/strict";
import test from "node:test";
import { insertAbstract, insertResearchSection, researchSectionIsPresent, sectionHeadingIn } from "../../web/studio/parts/research-sections.js";

test("research section presence comes from the publishing-engine evidence result", () => {
  const research = { referenceCount: 0 };
  assert.equal(researchSectionIsPresent([], research, "abstract"), true);
  assert.equal(researchSectionIsPresent([{ code: "abstract-missing" }], research, "abstract"), false);
  assert.equal(researchSectionIsPresent([{ code: "references-missing" }], research, "references"), false);
  assert.equal(researchSectionIsPresent([], null, "abstract"), null);
});

test("a section goes in once, with the caret under it", () => {
  assert.deepEqual(insertResearchSection("Opening.", "abstract"), { value: "Opening.\n\n## Abstract\n\n", start: 23, end: 23, inserted: true });
  assert.equal(insertResearchSection("## **Abstract**\nWritten summary.", "abstract", true).inserted, false);
  assert.equal(insertResearchSection("<!--\n## Abstract\n-->", "abstract", false).inserted, true);
  assert.equal(insertResearchSection("## Abstract\nSummary.\n", "references").value, "## Abstract\nSummary.\n\n## References\n\n");
});

test("Studio puts the Abstract at the start, and checks by heading line when there is no signal", () => {
  assert.deepEqual(insertAbstract("Opening."), { value: "## Abstract\n\n\n\nOpening.", start: 13, end: 13, inserted: true });
  assert.equal(insertAbstract("").value, "## Abstract\n\n");
  assert.equal(insertAbstract("x", true).inserted, false);
  assert.equal(sectionHeadingIn("Intro\n\n## Abstract\n\nText", "abstract"), true);
  assert.equal(sectionHeadingIn("```md\n## Abstract\n```", "abstract"), false);
  assert.equal(sectionHeadingIn("### references", "references"), true);
  assert.equal(sectionHeadingIn("Abstract thoughts", "abstract"), false);
});
