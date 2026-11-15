// Write questions for me, and Draft it for me (Studio R8): the step of Add something that asks the
// writing helper to fill in R6's form for A question for readers, or for Code readers can run.
// It says what goes to which company before anything is sent: the words she selected, else the
// part she's in, else all her words, and nothing else. What comes back fills the form (never the
// post), is made plain first, and goes through the same checks as what she types on Add it.
import { fill, glyph, h } from "./dom.js";
import { say } from "./words.js";
import { createGoesBox } from "./helper-goes.js";
import { helperProblem, wordsAbout } from "./helper-rules.js";
import { quizFromGenerated } from "./quiz-rules.js";
import { interactionFromGenerated } from "./code-rules.js";

/**
 * The step's content for the sheet. `kind` is "quiz" or "runnable"; `source` is `interactionSource`'s
 * answer; `asked` for code is `{ kind, language }` from the form; `hasTyping` says the form holds
 * something already. `onWritten(values)` gets what fills the form; `onBack()` returns to it.
 * Returns `{ heading, children, focus }`.
 */
export function generateView({ api, kind, company, source, asked = {}, hasTyping = false, backLabel, onWritten, onBack }) {
  const quiz = kind === "quiz";
  const back = h("action-button", { variant: "link", class: "studio-add-back", onClick: () => onBack() }, glyph("‹ "), backLabel);
  const count = quiz ? h("select-field", { label: say("hgen.howMany"), value: "2", options: ["1", "2", "3"].map((value) => ({ value, label: value })) }) : null;
  const asking = quiz ? null : h("p", { class: "studio-help", text: say("hgen.codeKind", { kind: asked.kind === "challenge" ? say("form.runChallenge") : say("form.runExample"), language: asked.language === "web" ? say("form.runWeb") : String(asked.language || "rust") }) });
  const goes = createGoesBox();
  const words = wordsAbout(source.words);
  const line = source.kind === "selected" ? say("hgen.goesSelected", { count: words }) : source.kind === "part" ? say("hgen.goesPart", { count: words, heading: source.heading.slice(0, 60) }) : say("hgen.goesAll", { count: words });
  goes.set({ heading: say("helper.goesTo", { company }), lines: [line], never: quiz ? say("hgen.nothingElse") : say("hgen.nothingElseCode") });
  goes.words(() => source.text);
  const status = h("p", { class: "studio-help studio-row-note", role: "status", "aria-live": "polite" });
  const details = h("details", { class: "studio-help", hidden: true }, h("summary", { text: say("common.forHelper") }));
  const replaces = hasTyping ? h("p", { class: "studio-help", text: quiz ? say("hgen.replaces") : say("hgen.replacesCode") }) : null;
  const never = h("action-button", { variant: "secondary", onClick: () => onBack() }, say("hgen.never"));
  const go = h("action-button", { class: "studio-generate-go", onClick: () => run() }, quiz ? say("hgen.write") : say("hgen.codeWrite"));
  const blocked = source.error === "too-long" ? say("hgen.tooMuch") : source.error === "empty" ? say("hgen.empty") : "";
  if (blocked) { status.textContent = blocked; go.disabled = true; }
  let busy = false;

  async function run() {
    if (busy || blocked) return;
    busy = true;
    go.loading = true;
    details.hidden = true;
    status.textContent = quiz ? say("hgen.writing") : say("hgen.codeWriting");
    try {
      // `confirmed`: this runs only from her press of the button under the list of what goes.
      const reply = quiz
        ? await api.call("POST", "quiz/generate", { json: { context: source.text, count: Number(count.value) || 2, confirmed: true } })
        : await api.call("POST", "assistant/code-interaction", { json: { context: source.text, kind: asked.kind, language: asked.language, confirmed: true } });
      const values = quiz ? quizFromGenerated(reply) : interactionFromGenerated(reply, asked);
      if (!values || (Array.isArray(values) && !values.length)) {
        status.textContent = helperProblem({ status: 502, data: { code: "invalid-result" } }, { company }).words;
        return;
      }
      onWritten(values);
    } catch (error) {
      const problem = helperProblem(error, { company });
      status.textContent = error?.data?.code === "bad-language" ? say("hgen.badLanguage", { language: String(asked.language || "").slice(0, 32) })
        : problem.code === "too-long" ? say("hgen.tooMuch") : error?.data?.code === "no-text" ? say("hgen.empty") : problem.words;
      fill(details, h("summary", { text: say("common.forHelper") }), ...problem.details.map((text) => h("p", { text })));
      details.hidden = !problem.details.length;
    } finally {
      busy = false;
      go.loading = false;
    }
  }

  return {
    heading: quiz ? say("hgen.quizButton") : say("hgen.codeButton"),
    children: [back, count, asking, goes.element, replaces, status, details, h("div", { class: "studio-sheet-footer" }, h("cluster-layout", { gap: "0.5rem" }, never, go))],
    focus: () => (count?.querySelector("select, button") || go.querySelector("button"))?.focus(),
    run,
  };
}
