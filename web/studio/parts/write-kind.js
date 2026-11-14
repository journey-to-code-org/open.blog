// The parts of Write that belong to one kind of post: a recipe's numbers under the title, a job's
// About this job (R4). Each is made the first time the post is that kind and kept, so changing the
// kind and back (or Undo) loses nothing she typed. Changing the kind keeps her words (kindChange
// says what happens) and puts the boxes that fit the new kind in place. Studio R5.
import { recipeNumbers } from "./recipe-numbers.js";
import { createWriteJob } from "./write-job.js";
import { kindChange, withRecipeParts } from "./about-rules.js";

export function createKindParts({ api, meta, doc, host, body, banner, title, say, changed, capture, onWriteUp }) {
  let numbers = null;
  let job = null;
  let jobSummary;
  let current = "article";
  const starter = () => meta.profiles?.find((p) => p.id === "recipe")?.starter || "";

  /** Put the kind's own part under the title (made once). */
  async function ensure(kind) {
    current = kind;
    if (kind === "recipe") {
      if (!numbers) {
        const recipeFields = meta.profiles?.find((profile) => profile.id === "recipe")?.fields || [];
        numbers = await recipeNumbers(doc.fields, { onChange: changed, suggestions: Object.fromEntries(recipeFields.map((field) => [field.key, field.suggestions])) });
      }
      host.replaceChildren(numbers.element);
    } else if (kind === "job") {
      if (!job) {
        job = await createWriteJob({ api, meta, fields: doc.fields, capture: doc.path ? capture() : null, body, banner, title, say, changed: () => changed() });
        jobSummary = job.values().description;
        job.canWriteUp().then((ready) => onWriteUp?.(ready));
      }
      host.replaceChildren(job.element);
    } else {
      host.replaceChildren();
    }
  }

  const bodyOptions = () => ({ boxes: current === "recipe", job: job && current === "job" ? job.bodyOptions() : null });

  return {
    ensure,
    bodyOptions,
    numbers: () => (current === "recipe" ? numbers : null),
    job: () => (current === "job" ? job : null),
    /**
     * The kind's values for a save. A job's write-up may set the summary: `summary(text)` hands it
     * to About this post, which writes it under the post's own key.
     */
    values(summary) {
      if (current === "recipe" && numbers) return numbers.values();
      if (current !== "job" || !job) return {};
      const { description, ...rest } = job.values();
      if (description !== undefined && description !== jobSummary) { jobSummary = description; summary?.(description); }
      return rest;
    },
    /** Fill the kind's part from a post's fields (a restored copy, the other computer's version). */
    set(extra) {
      if (numbers && extra) numbers.set(extra);
      if (job && extra && Object.keys(extra).some((key) => key.startsWith("job."))) job.set(extra);
    },
    /** What kind of post changed (or was undone): the boxes follow, and her words stay hers. */
    async switch(from, to, text, { body: restore } = {}) {
      const said = restore !== undefined ? {} : kindChange(from, to, text, { starter: starter(), scaffold: meta.job?.scaffold || "" });
      await ensure(to);
      await body.set(restore ?? said.body ?? text, bodyOptions());
      return said;
    },
    /** "Add the recipe parts": Ingredients and Steps at the end of her words. */
    async addRecipeParts(text) {
      await body.set(withRecipeParts(text, starter()), bodyOptions());
    },
  };
}
