// A job post in Write (Studio R4): About this job, Before and After on each photo, the voice note
// it was made from, "Write it up for me", and the job check that runs before Publish. Write keeps the
// title, the words and the saving; this part is everything that only a job has.
import { h } from "./dom.js";
import { use } from "../zubra.js";
import { createSheet } from "./sheet.js";
import { createJobAbout, addedWords } from "./job-about.js";
import { appendTranscript, draftBody } from "./capture-assistant-rules.js";
import { photosIn } from "./photo-strip.js";
import { jobProblemWords } from "./job-words.js";
import { askToWriteUp, writeUpSetup } from "./job-writeup.js";
import { say as word } from "./words.js";

const MARKS = [{ value: "before", label: "Before" }, { value: "after", label: "After" }, { value: "neither", label: "Neither" }];
const AUTO_TITLE = /^(Job notes, .+|.+ job|.+ in .+)$/;
const MAX_WORDS = 8000;

/**
 * `{ api, meta, fields, capture, body, banner, say, title, changed }`. Returns `{ element, values(),
 * set(fields), bodyOptions(), check(fields), canWriteUp(), writeUp(opener), focusProblem(field) }`.
 */
export async function createWriteJob({ api, meta, fields, capture, body, banner, say, title, changed }) {
  await use("segmented-control", "toggle-switch", "side-sheet", "date-field", "select-field", "text-field", "alert-banner", "action-button");
  const sheet = await createSheet({ label: "This job", wide: false });
  let setup = null;
  const about = createJobAbout({
    meta, fields, capture, api, sheet,
    onChange: () => changed(),
    addWords: (transcript, trouble, truncated) => {
      if (trouble) return say(trouble);
      addTranscript(transcript, truncated);
      return undefined;
    },
  });
  const scaffold = meta.job?.scaffold || "";
  let description = typeof fields.description === "string" ? fields.description : "";
  let linked = []; // the controls a check put an error on

  // Each photo card: "Photo 2 shows" Before, After or Neither. The number is the photo's place in
  // the whole post, so moving a card renumbers it (and job.media follows the cards' order).
  function photoMark(block) {
    const url = /\]\((\/images\/uploads\/[^)\s]+)\)/.exec(block.source)?.[1];
    if (!url || block.kind !== "photo") return null;
    const index = photosIn(body.text()).findIndex((photo) => photo.url === url);
    return h("segmented-control", {
      label: `Photo ${index + 1} shows`, options: MARKS, value: about.markOf(url), class: "studio-photo-mark",
      onValuechange: (event) => { about.mark(url, event.detail); changed(); },
    });
  }
  const bodyOptions = () => ({
    scaffold,
    help: "Mark at least one After photo. It's the one people see when you share the job.",
    removed: (url) => about.mark(url, "neither"),
  });

  /** Keep About this job's photo order with the words. */
  const syncPhotos = () => about.photos(photosIn(body.text()).map((photo) => photo.url));

  function offerUndo(words, undo) {
    say(words);
    const button = h("action-button", { variant: "secondary", size: "sm", onClick: () => { banner.replaceChildren(); undo(); } }, "Undo");
    banner.replaceChildren(h("p", { class: "studio-row studio-undo-row" }, h("span", { text: "Undo that?" }), button));
  }

  // The transcript goes under Problem (or the one box), as plain words, with Undo.
  async function addTranscript(transcript, truncated) {
    const parts = body.jobParts();
    const before = body.text();
    if (parts) {
      const next = appendTranscript(parts.get(0), transcript, MAX_WORDS);
      parts.set(0, next.notes);
      truncated ||= next.clipped;
    } else {
      const next = appendTranscript(before, transcript, MAX_WORDS);
      await body.set(next.notes, { job: bodyOptions() });
      truncated ||= next.clipped;
    }
    changed();
    offerUndo(addedWords(truncated), async () => {
      await body.set(before, { job: bodyOptions() });
      changed();
      say("Taken out. Your words are as they were.");
    });
  }

  // ---- Write it up for me
  async function writeUp(opener) {
    setup ||= await writeUpSetup(api);
    if (!setup.ready) {
      say(`Writing it up isn't set up for your blog. ${word("common.tell")}`);
      return;
    }
    const text = body.text();
    const words = text.split("\n").filter((line) => !/^## |^!\[/.test(line.trim())).join("\n").trim();
    if (!words) {
      say("Write a few words about the job first.");
      return;
    }
    const facts = about.describe();
    const result = await askToWriteUp({ api, sheet, setup, opener, request: { notes: words.slice(0, MAX_WORDS), photoAlts: photosIn(text).map((p) => p.alt).filter(Boolean).slice(0, 12), ...facts } });
    if (!result) return;
    if (result.error) {
      say(result.error);
      return;
    }
    const { draft } = result;
    const was = { title: String(title.value || ""), body: text, description };
    if (!was.title.trim() || AUTO_TITLE.test(was.title)) title.value = draft.title || was.title;
    if (draft.description) description = draft.description;
    const photoLines = (part) => part.split("\n").filter((line) => /^!\[/.test(line.trim()));
    const parts = body.jobParts();
    const sections = [draft.sections.problem, draft.sections.found, draft.sections.did, draft.sections.result];
    if (parts) {
      sections.forEach((words_, index) => {
        const kept = photoLines(parts.get(index));
        parts.set(index, [words_, ...(kept.length ? [kept.join("\n\n")] : [])].filter(Boolean).join("\n\n"));
      });
    } else {
      const kept = photoLines(text);
      await body.set(`${draftBody({ scaffold, sections: draft.sections })}${kept.length ? `${kept.join("\n\n")}\n` : ""}`, { job: bodyOptions() });
    }
    changed();
    offerUndo("Written up. Read it through, then save.", async () => {
      title.value = was.title;
      description = was.description;
      await body.set(was.body, { job: bodyOptions() });
      changed();
      say("Taken back. Your words are as they were.");
    });
  }

  // ---- the check before Publish (R7: its problems are listed under Needs fixing first in
  // Before you publish, each with Go to it, and each field says which problem is about it)
  /** The job check's problems, `[{ field, code, words, message }]`, or null when it couldn't run. */
  async function checkProblems(saving) {
    const job = Object.fromEntries(Object.entries(saving).filter(([key, value]) => key.startsWith("job.") && value !== null && value !== ""));
    let reply;
    try {
      reply = await api.post("job/check", { fields: job });
    } catch (error) {
      if (error?.status === 401) throw error;
      // The check couldn't run (no signal): the build checks again when it publishes.
      return null;
    }
    const problems = Array.isArray(reply?.problems) ? reply.problems.filter((p) => p && typeof p === "object") : [];
    unlink();
    if (reply?.ok !== false || !problems.length) return [];
    return problems.map((problem) => {
      const words = jobProblemWords(problem, { service: about.serviceName() });
      // The field says which problem is about it, as its own error.
      const control = about.field(problem.field);
      if (control && "error" in control) { control.error = words; linked.push(control); }
      return { field: String(problem.field || ""), code: String(problem.code || ""), words, message: String(problem.message || "") };
    });
  }

  function unlink() {
    for (const control of linked) control.error = "";
    linked = [];
  }

  function focusProblem(field) {
    if (field.startsWith("job.media")) {
      body.element.querySelector(".studio-photo-mark")?.querySelector("button, input")?.focus();
      return;
    }
    about.focus(field);
  }

  return {
    element: about.element,
    values: () => {
      syncPhotos();
      return { ...about.values(), description };
    },
    set: (next) => about.set(next),
    bodyOptions,
    photoMark,
    checkProblems,
    writeUp,
    /** "Write it up for me" is offered once it's known to be set up. */
    async canWriteUp() {
      setup ||= await writeUpSetup(api);
      return setup.ready;
    },
    focusProblem,
    close: () => sheet.close(),
  };
}
