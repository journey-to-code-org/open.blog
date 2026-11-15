// Notes the writing helper knows (Studio R8): About you, About your blog, and what she tells it
// about one post. Each saves by itself a moment after she stops typing, with the version it was
// read with, so a change made somewhere else is shown instead of overwritten. New notes are
// private. Saving a note sends nothing to any company. A note being typed is never kept on the
// phone: it is saved to her blog or it is still in the box.
import { fill as fillNode, h, toast } from "./dom.js";
import { say } from "./words.js";
import { keptWords, noteOf, noteProblem, noteSaveRequest, postContextFields } from "./helper-context-rules.js";

const SAVE_MS = 1500;

/**
 * One note with its words: the light catalog says which note there is (G58: no post's or note's
 * text comes with it), then only that note's words are asked for.
 */
export async function loadNote(api, type, path = "") {
  const catalog = await api.get(`assistant/context?content=none${path ? `&path=${encodeURIComponent(path)}` : ""}`);
  const { doc, both } = noteOf(catalog, type);
  let content = "";
  if (doc.exists && doc.valid) content = String((await api.get(`assistant/context/item?id=${encodeURIComponent(doc.id)}`))?.content ?? "");
  return { doc: { ...doc, content }, both, catalog };
}

/**
 * One note's saving, shared by every note box. `read()` gives its words (a string, or a post
 * note's five parts); `fill(doc, content)` shows a note as the server has it; `doc` is its
 * descriptor. Returns `{ changed(), flush(), dirty(), set(doc) }`.
 */
function createSaver({ api, status, read, fill, path = () => "", onSaved = null }) {
  let doc = null;
  let saved = "";
  let timer = 0;
  let saving = null;
  const key = () => JSON.stringify(read());

  async function reload() {
    const next = (await loadNote(api, doc.contextType, path())).doc;
    doc = next;
    fill(next, String(next.content || ""));
    saved = key();
  }

  async function save() {
    clearTimeout(timer);
    timer = 0;
    if (saving) await saving.catch(() => {});
    if (!doc || key() === saved) return true;
    const sending = key();
    const before = { exists: doc.exists, content: String(doc.content ?? ""), value: read() };
    const request = noteSaveRequest(doc, read(), { path: path() });
    if (request.none) { saved = sending; status.textContent = ""; return true; }
    if (request.problem) { status.textContent = say("hnote.tooLong"); return false; }
    status.textContent = say("hnote.saving");
    saving = api.call(request.method, "assistant/context", { json: request.body });
    try {
      const reply = await saving;
      if (request.method === "DELETE") {
        const was = doc;
        doc = { ...doc, exists: false, etag: null, content: "" };
        status.textContent = "";
        toast(say("hnote.removed"));
        // Undo: the note put back as it was, by the same route, as a new file.
        const undo = h("action-button", { variant: "secondary", size: "sm", onClick: async () => {
          try {
            const put = await api.call("PUT", "assistant/context", { json: { contextType: was.contextType, visibility: was.visibility, ...(was.contextType === "post" ? { documentPath: path(), fields: postContextFields(before.content) } : { content: before.content }), etag: null } });
            doc = put.document;
            fill(doc, String(doc.content || ""));
            saved = key();
            fillNode(status, say("hnote.backAgain"));
            onSaved?.(doc);
          } catch (error) {
            status.textContent = noteProblem(error).words;
          }
        } }, say("found.undo"));
        fillNode(status, say("hnote.removed"), " ", undo);
      } else {
        doc = reply.document;
        status.textContent = say("hnote.saved");
      }
      saved = sending;
      onSaved?.(doc);
      if (key() !== saved) changed();
      return true;
    } catch (error) {
      const problem = noteProblem(error);
      status.textContent = problem.words;
      if (problem.conflict) {
        // Changed somewhere else: show it as it is now, and lose nothing of the server's.
        try { await reload(); } catch { /* the words above still say what happened */ }
      } else if (problem.signal) {
        timer = setTimeout(save, 8000);
      }
      return false;
    } finally {
      saving = null;
    }
  }

  function changed() {
    clearTimeout(timer);
    timer = setTimeout(save, SAVE_MS);
  }

  return {
    changed,
    flush: save,
    dirty: () => Boolean(doc) && key() !== saved,
    set(next) { doc = next; saved = key(); },
    doc: () => doc,
    stop() { clearTimeout(timer); timer = 0; },
  };
}

/**
 * About you or About your blog on the Writing helper screen: one box that saves by itself.
 * `{ element, load(catalog), flush(), dirty(), stop(), kept() }`.
 */
export function createNoteField({ api, type, label, help, onSaved = null }) {
  const field = h("text-field", { label, description: help, rows: 4, class: "studio-writing", "data-note": type });
  const status = h("p", { class: "studio-help studio-note-status", role: "status", "aria-live": "polite" });
  const invalid = h("p", { class: "studio-help", hidden: true });
  const saver = createSaver({
    api, status, onSaved,
    read: () => String(field.value ?? ""),
    fill: (doc, content) => { field.value = content.replace(/\n+$/, ""); },
  });
  field.addEventListener("valuechange", () => saver.changed());
  field.addEventListener("focusout", () => { if (saver.dirty()) saver.flush(); });
  return {
    element: h("div", { class: "studio-note" }, field, status, invalid),
    /** Read the note and show it. */
    async load() {
      const { doc } = await loadNote(api, type);
      field.value = String(doc.content || "").replace(/\n+$/, "");
      saver.set(doc);
      field.disabled = doc.exists === true && doc.valid === false;
      invalid.hidden = !field.disabled;
      invalid.textContent = field.disabled ? say("hnote.cantRead", { why: String(doc.guidance || "").slice(0, 160) }) : "";
    },
    flush: () => saver.flush(),
    dirty: () => saver.dirty(),
    stop: () => saver.stop(),
    /** Where it's kept, for {helper}. */
    kept: () => (saver.doc() ? keptWords(saver.doc()) : ""),
    doc: () => saver.doc(),
  };
}

/**
 * Tell your helper about this post: Who it's for and What you want it to do, with the other three
 * parts under For {helper}. Only for a saved post. `{ element, load(), flush(), dirty(), stop() }`.
 */
export function createPostNote({ api, path, onSaved = null }) {
  const row = (label, help, name, rows = 3) => h("text-field", { label, description: help, rows, "data-post-note": name });
  const fields = {
    audience: row(say("hnote.who"), say("hnote.whoHelp"), "audience"),
    goal: row(say("hnote.goal"), say("hnote.goalHelp"), "goal"),
    learningOutcomes: row(say("hnote.outcomes"), "", "learningOutcomes"),
    sources: row(say("hnote.sources"), "", "sources"),
    constraints: row(say("hnote.constraints"), "", "constraints"),
  };
  const status = h("p", { class: "studio-help studio-note-status", role: "status", "aria-live": "polite" });
  const kept = h("p", { class: "studio-help studio-mono" });
  const first = h("p", { class: "studio-help", text: say("hnote.saveFirst") });
  // Shown only once the note has been read: words typed before that would be overwritten by it.
  const form = h("div", { class: "studio-form-fields", hidden: true }, fields.audience, fields.goal, status,
    h("details", { class: "studio-form-details" }, h("summary", { text: say("common.forHelper") }), fields.learningOutcomes, fields.sources, fields.constraints, kept));
  const element = h("details", { class: "studio-form-details studio-post-note" }, h("summary", { text: say("hnote.tell") }), first, form);
  const read = () => Object.fromEntries(Object.entries(fields).map(([name, control]) => [name, String(control.value ?? "")]));
  const fill = (doc, content) => {
    const values = postContextFields(content);
    for (const [name, control] of Object.entries(fields)) control.value = values[name] || "";
    kept.textContent = keptWords(doc);
  };
  const saver = createSaver({ api, status, read, fill, path, onSaved: (doc) => { kept.textContent = keptWords(doc); onSaved?.(doc); } });
  for (const control of Object.values(fields)) {
    control.addEventListener("valuechange", () => saver.changed());
    control.addEventListener("focusout", () => { if (saver.dirty()) saver.flush(); });
  }
  let loaded = "";
  async function load() {
    const saved = Boolean(path());
    first.hidden = saved;
    if (!saved) { form.hidden = true; return; }
    if (loaded === path()) { form.hidden = false; return; }
    try {
      const { doc } = await loadNote(api, "post", path());
      fill(doc, String(doc.content || ""));
      saver.set(doc);
      loaded = path();
      form.hidden = false;
    } catch (error) {
      first.hidden = false;
      first.textContent = noteProblem(error).words;
    }
  }
  element.addEventListener("toggle", () => { if (element.open) load(); });
  return {
    element, load, flush: () => saver.flush(), dirty: () => saver.dirty(), stop: () => saver.stop(),
    async open() { element.open = true; await load(); requestAnimationFrame(() => fields.audience.querySelector("textarea")?.focus()); },
  };
}
