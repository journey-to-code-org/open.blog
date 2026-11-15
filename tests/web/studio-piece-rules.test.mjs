// The rules behind Add something's forms (Studio R6): what a piece form sends, a map link's place,
// where a button goes, a refusal's codes, and a question for readers.
import assert from "node:assert/strict";
import test from "node:test";
import { BANNER_CODES, coordsFromMapLink, formValues, hrefFor, hrefKind, pieceProblem, pieceProblems, pieceValues, placeWords, videoLink, videoProvider } from "../../web/studio/parts/piece-rules.js";
import { parseQuiz, quizMarkdown, quizProblems } from "../../web/studio/parts/quiz-rules.js";

const hours = { kind: "hours", fields: [{ name: "note", required: false }], list: { max: 14, fields: [{ name: "days", required: true }, { name: "hours", required: true }] } };
const PIECES = ["button", "image", "video", "map", "hours", "contact", "social", "faq", "callout"].map((kind) => (kind === "hours" ? hours : { kind, fields: [] }));

test("a form sends required fields always and leaves empty optional ones out; values come back as rows", () => {
  assert.deepEqual(pieceValues(hours, { note: " " }, [{ days: "Mon", hours: "9-5" }, { days: "", hours: "" }]), [["days", "Mon"], ["hours", "9-5"], ["days", ""], ["hours", ""]]);
  assert.deepEqual(formValues(hours, [["note", "Hi"], ["days", "Mon"], ["hours", "9"], ["days", "Tue"], ["hours", "5"]]), { top: { note: "Hi" }, rows: [{ days: "Mon", hours: "9" }, { days: "Tue", hours: "5" }] });
});

test("a video's link from its id, and which service a link is from", () => {
  assert.equal(videoLink("youtube", "dQw4w9WgXcQ"), "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  assert.equal(videoLink("vimeo", "76979871"), "https://vimeo.com/76979871");
  assert.equal(videoProvider("https://youtu.be/dQw4w9WgXcQ"), "youtube");
  assert.equal(videoProvider("https://vimeo.com/76979871"), "vimeo");
  assert.equal(videoProvider("https://example.com/video"), "");
});

test("a map link says where, a short one doesn't", () => {
  assert.deepEqual(coordsFromMapLink("https://www.openstreetmap.org/#map=15/38.9262/-79.8467"), { lat: 38.9262, lon: -79.8467 });
  assert.deepEqual(coordsFromMapLink("https://www.openstreetmap.org/?mlat=38.93&mlon=-79.85#map=12/38.9/-79.8"), { lat: 38.93, lon: -79.85 });
  assert.deepEqual(coordsFromMapLink("https://www.google.com/maps/place/Elkins/@38.9262,-79.8467,14z"), { lat: 38.9262, lon: -79.8467 });
  assert.deepEqual(coordsFromMapLink("https://www.google.com/maps/place/x/data=!3d38.92!4d-79.84"), { lat: 38.92, lon: -79.84 });
  assert.deepEqual(coordsFromMapLink("https://maps.google.com/?q=38.9,-79.8"), { lat: 38.9, lon: -79.8 });
  assert.deepEqual(coordsFromMapLink("https://maps.app.goo.gl/abc"), { problem: "short" });
  assert.deepEqual(coordsFromMapLink("https://example.com/"), { problem: "none" });
  assert.deepEqual(coordsFromMapLink("https://www.openstreetmap.org/#map=4/95/10"), { problem: "range" });
  assert.equal(placeWords({ lat: 38.9262, lon: -79.8467 }), "38.93, −79.85");
});

test("where a button or link goes: a post, a website, an email or a phone", () => {
  assert.deepEqual(hrefFor("email", "orders@example.com"), { href: "mailto:orders@example.com" });
  assert.deepEqual(hrefFor("email", "nope"), { problem: "email" });
  assert.deepEqual(hrefFor("phone", "+1 (304) 555-0100"), { href: "tel:+1(304)555-0100" });
  assert.deepEqual(hrefFor("phone", "call me"), { problem: "phone" });
  assert.deepEqual(hrefFor("post", "/pumpkin-pie/"), { href: "/pumpkin-pie/" });
  assert.deepEqual(hrefFor("website", "http://example.com"), { problem: "address" });
  assert.deepEqual(hrefFor("website", "https://example.com/x"), { href: "https://example.com/x" });
  assert.deepEqual(hrefFor("any", "/about/"), { href: "/about/" });
  assert.deepEqual(hrefFor("any", "javascript:alert(1)"), { problem: "address" });
  assert.deepEqual(hrefKind("mailto:a@b.c"), { kind: "email", value: "a@b.c" });
  assert.deepEqual(hrefKind("/x/"), { kind: "post", value: "/x/" });
});

test("a refusal's codes: coded issues (G44), or an older server's sentences matched as well as they can be", () => {
  assert.deepEqual(pieceProblems({ issues: [{ field: "question", item: 1, code: "required", message: "question is required" }] }), [{ field: "question", item: 1, code: "required", max: null, message: "question is required" }]);
  assert.deepEqual(pieceProblem("button label is 90 characters; the most is 60"), { field: "label", item: null, code: "too-long", max: 60, message: "button label is 90 characters; the most is 60" });
  assert.equal(pieceProblem("the video id is not a YouTube video id").code, "bad-video");
  assert.equal(pieceProblem("`colour` is not a field of this piece").code, "unknown-field");
  assert.equal(pieceProblem("something new").code, "invalid");
  assert.ok(BANNER_CODES.has("unknown-kind"));
});

test("a question for readers is the old Admin's quiz, read back only when it would be written the same", () => {
  const quiz = { question: "What goes in  first?", answers: ["Flour", "Butter"], right: 0, explanation: "Flour, then *butter*." };
  // The same bytes POST pieces writes (crates/openblog-cli/src/admin/pieces.rs tests), whitespace on one line.
  assert.equal(`${quizMarkdown(quiz)}\n`, "```quiz\nWhat goes in first?\n- [x] Flour\n- [ ] Butter\n> Flour, then *butter*.\n```\n");
  assert.deepEqual(parseQuiz(quizMarkdown(quiz)), { ...quiz, question: "What goes in first?" });
  assert.equal(parseQuiz("```quiz\nQ\n- [X] a\n- [ ] b\n```"), null);
  assert.equal(parseQuiz("```quiz\nQ\n- [ ] a\n- [ ] b\n```"), null);
  assert.deepEqual(quizProblems({ question: "", answers: ["a", ""], right: -1 }).map((p) => `${p.field}:${p.code}`), ["question:required", "answer:required", "right:bad-choice"]);
  assert.deepEqual(quizProblems({ question: "See https://x.example", answers: ["a", "![p](/a.png)"], right: 0 }).map((p) => p.code), ["links", "links"]);
  assert.deepEqual(quizProblems({ question: "Q ```", answers: ["a", "b"], right: 1 }).map((p) => p.code), ["backticks"]);
});
