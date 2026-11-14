// A question for readers (a `quiz` fence, Studio R6): written the way the old Admin's knowledge
// check wrote it and the way POST pieces (G45) writes it, read back only when the form would write
// it exactly, and checked like the build checks it. Pure, DOM-free.

const oneLine = (value) => String(value ?? "").trim().replace(/\s+/g, " ");

/**
 * `{ question, answers: [..], right (index from 0), explanation }` as a `quiz` fence (no newline at
 * the end). Each value is put on one line.
 */
export function quizMarkdown({ question, answers = [], right = 0, explanation = "" }) {
  const lines = ["```quiz", oneLine(question), ...answers.map((answer, index) => `- [${index === right ? "x" : " "}] ${oneLine(answer)}`)];
  const after = oneLine(explanation);
  if (after) lines.push(`> ${after}`);
  lines.push("```");
  return lines.join("\n");
}

/** A `quiz` fence as the form holds it, or null when the form couldn't write it back exactly. */
export function parseQuiz(source) {
  const lines = String(source ?? "").replace(/\n+$/, "").split("\n");
  if (lines[0] !== "```quiz" || lines[lines.length - 1] !== "```" || lines.length < 4) return null;
  const inner = lines.slice(1, -1);
  const question = inner.shift();
  const answers = [];
  let right = -1;
  let explanation = "";
  for (const line of inner) {
    const answer = /^- \[([ x])\] (.*)$/.exec(line);
    if (answer && !explanation) {
      if (answer[1] === "x") right = answers.length;
      answers.push(answer[2]);
    } else if (line.startsWith("> ") && !explanation) {
      explanation = line.slice(2);
    } else {
      return null;
    }
  }
  const quiz = { question, answers, right, explanation };
  return right >= 0 && quizMarkdown(quiz) === lines.join("\n") ? quiz : null;
}

/**
 * What stops a question going in, as `[{ field, item?, code }]` (codes match POST pieces):
 * `required` (question, an answer), `bad-choice` (no right answer), `links` (a link or photo),
 * `backticks` (three in a row). Empty when it can go in.
 */
export function quizProblems({ question, answers = [], right = -1, explanation = "" }) {
  const problems = [];
  if (!oneLine(question)) problems.push({ field: "question", code: "required" });
  answers.forEach((answer, item) => { if (!oneLine(answer)) problems.push({ field: "answer", item, code: "required" }); });
  if (answers.length < 2) problems.push({ field: "answer", code: "required" });
  if (!(right >= 0 && right < answers.length)) problems.push({ field: "right", code: "bad-choice" });
  const all = [["question", question], ...answers.map((a, item) => ["answer", a, item]), ["explanation", explanation]];
  for (const [field, value, item] of all) {
    const text = String(value ?? "");
    if (text.includes("```")) problems.push({ field, ...(item !== undefined ? { item } : {}), code: "backticks" });
    else if (/!?\[[^\]]*\]\([^)]*\)|<https?:|https?:\/\/\S/i.test(text) || /<[A-Za-z/!?]/.test(text)) problems.push({ field, ...(item !== undefined ? { item } : {}), code: "links" });
  }
  return problems;
}
