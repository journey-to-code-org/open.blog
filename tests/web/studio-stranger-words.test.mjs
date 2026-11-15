// Someone else's words inside Studio's sentences (Studio R10): every rule that puts a reader's, a
// co-writer's, a customer's or another company's name or title into a sentence can give it apart
// (`isolating`), so the page places it in its own <bdi dir=auto> and a right-to-left mark in it
// can't reorder Studio's own words. With `say` (the default) the sentence is the same text.
import assert from "node:assert/strict";
import test from "node:test";

import { configureWords, isolating, partsPlain, partsText } from "../../web/studio/parts/words.js";
import { previewWords, readerLine } from "../../web/studio/parts/reader-rules.js";
import {
  invitationStatusText, joinNames, memberWarnings, peopleWords, previewItemText, previewSectionText, previewStateText, revealSlotText, roleChangeImpact, sourceWords, togetherPeopleRows,
} from "../../web/studio/parts/together-rules.js";
import { synthesisItemText } from "../../web/studio/parts/conversation-rules.js";
import { momentText } from "../../web/studio/parts/moment-rules.js";
import { seriesPartText } from "../../web/studio/parts/arrange-rules.js";
import { statusWords } from "../../web/studio/parts/quote-words.js";
import { connectedWords, disconnectedWords } from "../../web/studio/parts/social-rules.js";

const RLO = "‮";
const EVIL = `${RLO}Eve`;
const isolated = (parts) => [].concat(parts).filter((p) => typeof p !== "string").map((p) => p.isolate);
const outside = (parts) => [].concat(parts).filter((p) => typeof p === "string").join("");

test("each rule gives the stranger's words apart, and the same sentence as before", () => {
  configureWords();
  const cases = [
    [(s) => readerLine({ name: EVIL, publishName: true }, "feedback", "", s)],
    [(s) => previewWords({ name: EVIL, quote: `${RLO}q` }, s), [`${RLO}q`, EVIL]],
    [(s) => memberWarnings({ bindingCurrent: false, displayName: EVIL }, s)[0]],
    [(s) => roleChangeImpact({ roles: ["contributor"], displayName: EVIL }, [], s)[0]],
    [(s) => invitationStatusText({ state: "accepted" }, EVIL, {}, s)],
    [(s) => revealSlotText({ kind: "revealed", displayName: EVIL }, s)],
    [(s) => revealSlotText({ kind: "private", displayName: EVIL }, s)],
    [(s) => previewSectionText({ shown: true, approval: "approved", displayName: EVIL }, s)],
    [(s) => previewItemText({ awaiting: [EVIL, "Sam"] }, s), [EVIL, "Sam"]],
    [(s) => previewStateText({ complete: true, sections: [{ displayName: EVIL }] }, s)],
    [(s) => peopleWords({ people: [{ displayName: EVIL, where: "writing" }] }, s)],
    [(s) => sourceWords({ kind: "video", title: EVIL }, s)],
    [(s) => togetherPeopleRows({ people: [{ displayName: EVIL, where: "writing" }] }, {}, s)[0].text],
    [(s) => synthesisItemText({ kind: "agreement", contributors: [{ displayName: EVIL }] }, s)],
    [(s) => momentText({ source: "a", location: "x" }, [{ id: "a", title: EVIL }], s), [EVIL, "x"]],
    [(s) => seriesPartText({ title: EVIL, order: 1 }, 0, s)],
    [(s) => statusWords({ name: EVIL }, "handled", 0, s)],
    [(s) => statusWords({ name: EVIL }, "new", 0, s)],
    [(s) => connectedWords({ provider: "bluesky", displayName: EVIL }, s)],
    [(s) => connectedWords({ provider: "facebook", displayName: EVIL }, s)],
    [(s) => disconnectedWords(EVIL, 2, s)],
  ];
  for (const [run, want = [EVIL]] of cases) {
    const text = run(undefined);
    const parts = run(isolating);
    assert.equal(typeof text, "string", String(run));
    assert.deepEqual(isolated(parts), want, String(run));
    assert.ok(!outside(parts).includes(RLO), `${run}: no direction mark outside the isolate`);
    assert.equal(partsPlain(parts), text, `${run}: the same sentence`);
  }
  assert.deepEqual(joinNames([EVIL, "Sam", "Lee"], isolating), [{ isolate: EVIL }, ", ", { isolate: "Sam" }, " and ", { isolate: "Lee" }]);
  assert.deepEqual(joinNames([], isolating), []);
});

test("as text only (a toast, a label), the words are wrapped in FSI…PDI with their own marks taken out", () => {
  const text = partsText(statusWords({ name: `${EVIL}⁩‫` }, "handled", 0, isolating));
  assert.equal(text, "⁨Eve⁩: handled.");
});
