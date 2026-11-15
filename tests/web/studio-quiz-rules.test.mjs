// Write questions for me and Draft it for me (Studio R8): what goes (her selection, else the part,
// else all her words, and nothing else), and what a helper wrote made into what R6's forms hold.
// Ports the generate cases of the old Admin's admin-assistant-interactions: the context sent, a
// count of one to three, and a result that still has to pass the same checks as what she types.
import assert from "node:assert/strict";
import test from "node:test";

import { MAX_INTERACTION_LETTERS, interactionSource, quizFromGenerated, quizMarkdown, quizProblems } from "../../web/studio/parts/quiz-rules.js";
import { codeInteractionMarkdown, codeInteractionProblems, interactionFromGenerated } from "../../web/studio/parts/code-rules.js";

const BODY = "Opening words.\n\n## Making the crust\n\nKeep the butter cold.\n\n```sh\n# not a heading\n```\n\n## Filling\n\nSugar and spice.";

test("what a question is written from: her selection, else the part she's in, else all her words", () => {
  assert.deepEqual(interactionSource({ selection: "  butter cold  ", caret: 40 }, { body: BODY }), { kind: "selected", text: "butter cold", heading: "", words: 2, error: "" });
  const part = interactionSource({ selection: "", caret: BODY.indexOf("Keep") }, { body: BODY });
  assert.equal(part.kind, "part");
  assert.equal(part.heading, "Making the crust");
  assert.equal(part.text.startsWith("## Making the crust"), true);
  assert.equal(part.text.includes("## Filling"), false, "to the next heading");
  assert.equal(part.text.includes("# not a heading"), true, "a # line in code is code");
  // Before any heading, or with no caret: all her words.
  assert.equal(interactionSource({ selection: "", caret: 3 }, { body: BODY }).kind, "all");
  assert.equal(interactionSource({}, { body: BODY }).text, BODY);
  // A heading with nothing under it yet: all her words, not an empty part.
  assert.equal(interactionSource({ caret: 20 }, { body: "Words.\n\n## Empty\n" }).kind, "all");
  assert.equal(interactionSource({}, { body: "   " }).error, "empty");
  assert.equal(interactionSource({ selection: "x".repeat(MAX_INTERACTION_LETTERS + 1) }, { body: "y" }).error, "too-long");
  assert.equal(interactionSource({ selection: "🏮".repeat(MAX_INTERACTION_LETTERS) }, { body: "y" }).error, "", "counted in letters, as the server counts");
  // Nothing but those words: no title, no details, no notes.
  assert.deepEqual(Object.keys(interactionSource({ caret: 0 }, { body: BODY, title: "Secret title", fields: { tags: ["x"] } })).sort(), ["error", "heading", "kind", "text", "words"]);
});

test("what a helper wrote becomes what the form holds, as bounded plain text", () => {
  const reply = { questions: [
    { prompt: "  What keeps a crust\nflaky? ", choices: ["Cold butter", " Warm butter ", 7, ""], correctIndex: 0, explanation: "Cold fat\u0000 makes layers.", extra: "ignored" },
    { prompt: "Second?", choices: ["A", "B", "C", "D", "E"], correctIndex: 9, explanation: 5 },
    { prompt: "One answer only", choices: ["A"], correctIndex: 0 },
    "not a question", null,
    { prompt: "Third?", choices: ["A", "B"], correctIndex: 1, explanation: "" },
    { prompt: "Fourth is over the limit of three", choices: ["A", "B"], correctIndex: 0 },
  ] };
  assert.deepEqual(quizFromGenerated(reply), [
    { question: "What keeps a crust flaky?", answers: ["Cold butter", "Warm butter"], right: 0, explanation: "Cold fat makes layers." },
    { question: "Second?", answers: ["A", "B", "C", "D"], right: -1, explanation: "" },
  ], "the first three it sent, the unusable ones dropped; a right answer that isn't there is none");
  assert.deepEqual(quizFromGenerated({ questions: [reply.questions[5], reply.questions[1], reply.questions[0], reply.questions[6]] }).length, 3);
  for (const nothing of [null, {}, { questions: "x" }, { questions: [] }, "text"]) assert.deepEqual(quizFromGenerated(nothing), []);
  assert.equal(quizFromGenerated({ questions: [{ prompt: "p".repeat(900), choices: ["a".repeat(900), "b"], correctIndex: 0 }] })[0].question.length, 500);
});

test("a written question goes through the same checks as one she typed", () => {
  const [good] = quizFromGenerated({ questions: [{ prompt: "What keeps a crust flaky?", choices: ["Cold butter", "Warm butter"], correctIndex: 0, explanation: "Cold fat makes layers." }] });
  assert.deepEqual(quizProblems(good), []);
  assert.equal(quizMarkdown(good), "```quiz\nWhat keeps a crust flaky?\n- [x] Cold butter\n- [ ] Warm butter\n> Cold fat makes layers.\n```");
  // A link, a photo, markup or a fence in what came back is refused on Add it, never put in.
  const hostile = quizFromGenerated({ questions: [
    { prompt: "See https://evil.example/now", choices: ["[click](https://evil.example)", "B"], correctIndex: 0, explanation: "![x](https://evil.example/p.png)" },
    { prompt: "Ends the fence ``` and <script>alert(1)</script>", choices: ["A", "B"], correctIndex: 0, explanation: "" },
  ] });
  assert.deepEqual(quizProblems(hostile[0]).map((p) => [p.field, p.code]), [["question", "links"], ["answer", "links"], ["explanation", "links"]]);
  assert.deepEqual(quizProblems(hostile[1]).map((p) => p.code), ["backticks"]);
  // No right answer marked: she has to choose one.
  assert.deepEqual(quizProblems(quizFromGenerated({ questions: [{ prompt: "Q", choices: ["A", "B"], correctIndex: 5 }] })[0]).map((p) => p.code), ["bad-choice"]);
});

test("drafted code fills the form with the kind and language she asked for, never the reply's", () => {
  const reply = { kind: "example", language: "bash", title: 'Move the "lantern"\n', instructions: "Complete the transfer.\r\n", code: "fn main() {\n    // TODO: move the lantern\n}\n", expectedOutput: "moved", hint: "Pass it by value.", explanation: "It takes ownership.\u0000", run: "rm -rf /" };
  const draft = interactionFromGenerated(reply, { kind: "challenge", language: "rust" });
  assert.deepEqual(draft, { kind: "challenge", language: "rust", title: "Move the lantern", instructions: "Complete the transfer.", code: "fn main() {\n    // TODO: move the lantern\n}", expectedOutput: "moved", hint: "Pass it by value.", explanation: "It takes ownership." });
  assert.deepEqual(codeInteractionProblems(draft), []);
  assert.match(codeInteractionMarkdown(draft), /^\*\*Coding challenge: Move the lantern\*\*/);
  assert.equal(interactionFromGenerated({ title: "", code: "x" }), null);
  assert.equal(interactionFromGenerated({ title: "T", code: "" }), null);
  assert.equal(interactionFromGenerated("text"), null);
  assert.equal(interactionFromGenerated({ title: "T", code: "c" }, { language: "not a language!" }).language, "rust");
  // A fence inside what came back is refused on Add it.
  const fenced = interactionFromGenerated({ title: "T", instructions: "Try it.", code: "```\nfn main() {}\n```" }, { kind: "example", language: "rust" });
  assert.deepEqual(codeInteractionProblems(fenced).map((p) => p.code), ["backticks"]);
  assert.equal(interactionFromGenerated({ title: "T", code: "c".repeat(30000) }).code.length, 20000);
});
