// A question for readers (a `quiz` fence, Studio R6): written the way the old Admin's knowledge
// check wrote it and the way POST pieces (G45) writes it, read back only when the form would write
// it exactly, and checked like the build checks it. Pure, DOM-free.
import { markdownHeadingStarts } from "./helper-rules.js";

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

// ---- Write questions for me (Studio R8)

/** The most words a helper writes a question or a code example from (the server's limit, in letters). */
export const MAX_INTERACTION_LETTERS = 50_000;

/**
 * The words a question (or a code example) is written from, and nothing else: what she selected;
 * else the part from the heading before where it will go to the next heading; else all her words.
 * `target` is `{ selection (text), caret (offset in the post's words, or null) }`.
 * `{ kind: "selected" | "part" | "all", text, heading, words, error: "" | "empty" | "too-long" }`.
 */
export function interactionSource(target = {}, form = {}) {
  const body = String(form.body ?? "");
  const count = (text) => text.trim().split(/\s+/).filter(Boolean).length;
  const done = (kind, text, heading = "") => {
    const trimmed = text.trim();
    return { kind, text: trimmed, heading, words: count(trimmed), error: !trimmed ? "empty" : Array.from(trimmed).length > MAX_INTERACTION_LETTERS ? "too-long" : "" };
  };
  const selected = String(target.selection ?? "").trim();
  if (selected) return done("selected", selected);
  const headings = markdownHeadingStarts(body);
  const caret = Number.isInteger(target.caret) ? Math.max(0, Math.min(target.caret, body.length)) : null;
  const start = caret === null ? undefined : headings.filter((at) => at <= caret).pop();
  if (start !== undefined) {
    const end = headings.find((at) => at > start) ?? body.length;
    const part = body.slice(start, end);
    const heading = part.split("\n")[0].replace(/^ {0,3}#{1,6}[ \t]+/, "").replace(/[ \t]+#+[ \t]*$/, "").trim();
    if (part.replace(/^.*\n?/, "").trim()) return done("part", part, heading);
  }
  return done("all", body);
}

const plainLine = (value, max) => Array.from(oneLine((typeof value === "string" ? value : "").replace(/[\u0000-\u001f\u007f​‪-‮⁦-⁩﻿]/g, " "))).slice(0, max).join("");

/**
 * What a helper wrote, made into what the form holds: up to three questions, each with its
 * question, two to four answers, which one is right, and what to tell them after. Everything is
 * untrusted text: made one line, bounded, never trusted to be the right shape. The result still
 * goes through `quizProblems` on Add it, like one she typed. `[]` when nothing usable came back.
 */
export function quizFromGenerated(result) {
  const questions = Array.isArray(result?.questions) ? result.questions : [];
  const out = [];
  for (const one of questions.slice(0, 3)) {
    if (!one || typeof one !== "object") continue;
    const question = plainLine(one.prompt, 500);
    const answers = (Array.isArray(one.choices) ? one.choices : []).filter((choice) => typeof choice === "string").map((choice) => plainLine(choice, 300)).filter(Boolean).slice(0, 4);
    if (!question || answers.length < 2) continue;
    const right = Number.isInteger(one.correctIndex) && one.correctIndex >= 0 && one.correctIndex < answers.length ? one.correctIndex : -1;
    out.push({ question, answers, right, explanation: plainLine(one.explanation, 1000) });
  }
  return out;
}
