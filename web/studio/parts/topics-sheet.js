// Reminders' "Change topics and dates" sheet (R1): every topic, by start date, with its dates in
// words and a switch to stop suggesting it; one topic at a time opens as a form (name, what to
// write about, start and end picked from lists), and she can add her own. Every save is one
// `PUT seasonal` with the whole entry list, and the sheet redraws from the reply. Topic names and
// prompts are only ever text. docs/specs/studio/r1/ux.md.
import { h } from "./dom.js";
import { use } from "../zubra.js";
import { ask } from "./dialogs.js";
import { MONTHS, daysIn, monthDay, sayMonthDay } from "./season-windows.js";
import * as M from "./seasonal-rules.js";

const split = (mmdd) => {
  const [month, day] = String(mmdd || "").split("-").map(Number);
  return { month: month || 1, day: day || 1 };
};
const join = (part) => monthDay(part.month, part.day);
const sayWindow = (start, end) => `${sayMonthDay(start)} to ${sayMonthDay(end)}`;

/** Today's month-day, and the same day a month on, for a new topic. */
function defaultWindow(today) {
  const [, m, d] = String(today || new Date().toISOString().slice(0, 10)).split("-").map(Number);
  const next = (m % 12) + 1;
  return { start: { month: m, day: d }, end: { month: next, day: Math.min(d, daysIn(next)) } };
}

/**
 * `sheet` is a parts/sheet.js controller; `getData()`/`setData(reply)` are the screen's seasonal
 * reply; `focusId` opens that topic's form. Resolves once the sheet shows.
 */
export async function openTopics({ sheet, api, getData, setData, focusId = null, opener }) {
  await use("action-button", "alert-banner", "dropdown-menu", "select-field", "status-badge", "text-field", "toggle-switch", "cluster-layout");
  let open = focusId; // the topic whose form shows: an id, "new", or null
  let form = null; // { id, topic, prompt, start, end, baseline }
  const status = h("p", { class: "studio-help", role: "status", "aria-live": "polite" });
  const undoSlot = h("div", { class: "studio-banner" });
  const list = h("ul", { class: "studio-comment-list", "aria-label": "Topics" });
  const add = h("action-button", { variant: "secondary", onClick: () => openForm("new") }, "Add your own topic");
  const details = h("details", { class: "studio-help" });
  const data = () => getData();
  const heading = () => (data().trade ? `Topics for ${data().trade}` : "Your topics");

  const formDirty = () => Boolean(form) && ["topic", "prompt", "start", "end"].some((k) => form[k] !== form.baseline[k]);
  const formOf = (topic) => {
    const value = topic
      ? { id: topic.id, topic: topic.topic, prompt: topic.prompt, start: topic.start, end: topic.end }
      : (() => { const w = defaultWindow(data().today); return { id: null, topic: "", prompt: "", start: join(w.start), end: join(w.end) }; })();
    return { ...value, baseline: { ...value } };
  };

  function openForm(id, { keep = false } = {}) {
    open = id;
    if (!keep) form = id === "new" ? formOf(null) : id ? formOf(data().topics.find((t) => t.id === id)) : null;
    draw();
    requestAnimationFrame(() => list.querySelector(".studio-topic-form text-field")?.querySelector("input")?.focus());
  }

  function closeForm(focusTopic = null) {
    const was = open;
    open = null;
    form = null;
    draw();
    const target = focusTopic || was;
    requestAnimationFrame(() => (target && target !== "new" ? list.querySelector(`[data-topic="${CSS.escape(target)}"] h3`) : add)?.focus?.());
  }

  /** Every save: one PUT of the whole list. Resolves to the reply, or null after saying why. */
  async function put(entries) {
    try {
      const reply = await api.put("seasonal", { etag: data().etag, seasonalPrompts: { enabled: data().enabled, topics: entries } });
      setData(reply);
      return reply;
    } catch (error) {
      if (error.status === 401) throw error;
      if (error.status === 409 && error.data?.etag) {
        try { setData(await api.get("seasonal")); } catch { /* the reply's own copy will do */ }
        draw(); // her open form keeps its values
        say("These changed on another device. Here they are now; press Save again.");
        return null;
      }
      if (error.status === 422) {
        say("That didn't save. Tell the person who set up your site.");
        drawDetails(error.data?.problems || [error.message]);
        return null;
      }
      say(M.seasonalErrorText(error));
      return null;
    }
  }

  function say(words) {
    status.textContent = words;
  }

  function offerUndo(words, entries, after) {
    const button = h("action-button", { size: "sm", onClick: async () => {
      undoSlot.replaceChildren();
      if (await put(entries)) { draw(); say(after); }
    } }, "Undo");
    undoSlot.replaceChildren(h("alert-banner", { variant: "info", dismissible: true, heading: words }, button));
  }

  async function toggle(topic, on) {
    const before = data().entries;
    if (!(await put(M.withDisabled(before, topic.id, !on)))) { draw(); return; }
    draw();
    const words = on ? `“${topic.topic}” is back.` : `Studio won't suggest “${topic.topic}” any more.`;
    say(words);
    if (!on) offerUndo(words, M.withDisabled(data().entries, topic.id, false), `“${topic.topic}” is back.`);
  }

  async function save() {
    const problems = M.topicProblems(form);
    const isNew = !form.id;
    if (isNew && M.tooManyTopics(data().entries)) problems.general = M.TOO_MANY_TOPICS;
    if (!isNew && M.tooManyTopics(data().entries, form.id)) problems.general = M.TOO_MANY_TOPICS;
    if (M.windowProblems(form.start, form.end).length) problems.general = "Pick the days again.";
    showProblems(problems);
    if (Object.keys(problems).length) return false;
    let entries = data().entries;
    const name = form.topic.trim();
    const id = isNew ? M.ownTopicId(name, entries) : form.id;
    if (isNew) {
      entries = M.withTopic(entries, form);
    } else {
      if (form.topic !== form.baseline.topic || form.prompt !== form.baseline.prompt) entries = M.withWords(entries, form.id, form);
      if (form.start !== form.baseline.start || form.end !== form.baseline.end) entries = M.withWindow(entries, form.id, form.start, form.end);
    }
    const reply = await put(entries);
    if (!reply) return false;
    const words = `${isNew ? "Added" : "Saved"}. Studio suggests “${name}” from ${sayWindow(form.start, form.end)}.`;
    closeForm(id);
    say(words);
    requestAnimationFrame(() => list.querySelector(`[data-topic="${CSS.escape(id)}"]`)?.scrollIntoView?.({ block: "nearest" }));
    return true;
  }

  function showProblems(problems) {
    const box = list.querySelector(".studio-topic-form");
    if (!box) return;
    const fields = { topic: box.querySelector(".studio-topic-name"), prompt: box.querySelector(".studio-topic-prompt") };
    for (const [key, field] of Object.entries(fields)) if (field) field.error = problems[key] || "";
    const general = box.querySelector(".studio-topic-problem");
    general.textContent = problems.general || "";
    general.hidden = !problems.general;
    const first = problems.topic ? fields.topic : problems.prompt ? fields.prompt : null;
    if (first) first.querySelector("input, textarea")?.focus();
    else if (problems.general) general.focus();
  }

  async function putBack(topic) {
    const before = data().entries;
    if (!(await put(M.withoutTopic(before, topic.id)))) return;
    closeForm(topic.id);
    const words = `“${topic.topic}” is back to how it came.`;
    say(words);
    offerUndo(words, before, `“${topic.topic}” is changed again.`);
  }

  async function remove(topic) {
    const choice = await ask({
      heading: `Remove “${topic.topic}”?`,
      text: "Studio stops suggesting it. A draft you started from it stays.",
      choices: [{ label: "Keep it", value: "keep" }, { label: "Remove", value: "remove", variant: "destructive" }],
    });
    if (choice !== "remove") return;
    const before = data().entries;
    if (!(await put(M.withoutTopic(before, topic.id)))) return;
    form = null;
    open = null;
    draw();
    add.focus();
    const words = `Removed “${topic.topic}”.`;
    say(words);
    offerUndo(words, before, `“${topic.topic}” is back.`);
  }

  function dayPicker(which, legend) {
    const part = split(form[which]);
    const days = () => Array.from({ length: daysIn(part.month) }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }));
    const set = () => { form[which] = join(part); crossing(); refreshSave(); };
    const day = h("select-field", { label: `${legend}, day`, options: days(), value: String(part.day), onValuechange: (e) => { part.day = Number(e.detail); set(); } });
    const month = h("select-field", { label: `${legend}, month`, options: MONTHS.map((name, i) => ({ value: String(i + 1), label: name })), value: String(part.month),
      onValuechange: (e) => {
        part.month = Number(e.detail);
        part.day = Math.min(part.day, daysIn(part.month));
        day.options = days();
        day.value = String(part.day);
        set();
      } });
    return h("fieldset", { class: "studio-when", "data-which": which }, h("legend", { text: legend }), h("cluster-layout", { gap: "0.75rem" }, month, day));
  }

  let crossingNote = null;
  let saveButton = null;
  // A topic that came with Studio saves only once something changed; a new one can always try.
  const refreshSave = () => { if (saveButton) saveButton.disabled = Boolean(form?.id) && !formDirty(); };
  function crossing() {
    if (!crossingNote) return;
    crossingNote.textContent = form && form.end < form.start ? "Runs across the new year." : "";
    crossingNote.hidden = !crossingNote.textContent;
  }

  function formBox(topic) {
    const isNew = !form.id;
    const name = h("text-field", { class: "studio-topic-name", label: "Topic", value: form.topic, maxlength: M.MAX_TOPIC_WORDS, onValuechange: (e) => { form.topic = e.detail; name.error = ""; refreshSave(); } });
    const count = h("p", { class: "studio-help", "aria-live": "polite", hidden: true });
    const recount = () => {
      const n = Array.from(form.prompt).length;
      count.hidden = n < 500;
      count.textContent = `${n} of ${M.MAX_PROMPT_WORDS}`;
    };
    const prompt = h("text-field", { class: "studio-topic-prompt", label: "What to write about", rows: 3, value: form.prompt, maxlength: M.MAX_PROMPT_WORDS,
      onValuechange: (e) => { form.prompt = e.detail; prompt.error = ""; recount(); refreshSave(); } });
    recount();
    const crossId = `studio-topic-cross-${(form.id || "new").replace(/[^a-z0-9-]/g, "")}`;
    crossingNote = h("p", { class: "studio-help", id: crossId, hidden: true });
    const ends = dayPicker("end", "Ends");
    ends.setAttribute("aria-describedby", crossId);
    crossing();
    const problem = h("p", { class: "studio-comment-trouble studio-topic-problem", role: "alert", tabindex: "-1", hidden: true });
    const more = topic && (topic.custom || M.changedFromBundled(data().entries, topic.id))
      ? h("dropdown-menu", { class: "studio-row-menu",
        items: topic.custom ? [{ value: "remove", label: "Remove this topic…" }] : [{ value: "original", label: "Put back the original" }],
        onItemselect: (e) => (e.detail === "remove" ? remove(topic) : putBack(topic)) },
      h("span", { slot: "label" }, "More", h("span", { class: "studio-visually-hidden", text: ` for ${topic.topic}` })))
      : null;
    const button = h("action-button", { onClick: async () => { if (button.loading) return; button.loading = true; try { await save(); } finally { button.loading = false; } } }, isNew ? "Add it" : "Save");
    saveButton = button;
    refreshSave();
    return h("div", { class: "studio-topic-form" }, name, prompt, count, dayPicker("start", "Starts"), ends, crossingNote, problem,
      h("div", { class: "studio-sheet-actions" }, button,
        h("action-button", { variant: "secondary", onClick: () => cancelForm() }, "Cancel"), more));
  }

  async function cancelForm() {
    if (formDirty()) {
      const choice = await ask({ heading: "Save this topic?", text: "You changed it and didn't save.", choices: [{ label: "Save", value: "save" }, { label: "Leave without saving", value: "go", variant: "secondary" }] });
      if (choice === "save") { await save(); return; }
      if (choice !== "go") return;
    }
    closeForm();
  }

  function card(topic) {
    const switchOn = h("toggle-switch", { label: "Suggest this", checked: !topic.disabled, onCheckedchange: (e) => toggle(topic, e.detail) });
    const editing = open === topic.id && form;
    return h("li", { class: "studio-comment", "data-topic": topic.id },
      h("div", { class: "studio-comment-head" },
        h("h3", { class: "studio-comment-who", tabindex: "-1", text: topic.topic }),
        topic.custom ? h("status-badge", { variant: "neutral" }, "Your own") : null),
      h("p", { class: "studio-help", text: sayWindow(topic.start, topic.end) }),
      editing ? formBox(topic) : h("div", { class: "studio-comment-actions" }, switchOn,
        h("action-button", { variant: "secondary", label: `Change “${topic.topic}”`, onClick: () => openFormGuarded(topic.id) }, "Change")));
  }

  async function openFormGuarded(id) {
    if (formDirty()) {
      const choice = await ask({ heading: "Save this topic?", text: "You changed another topic and didn't save it.", choices: [{ label: "Save", value: "save" }, { label: "Leave without saving", value: "go", variant: "secondary" }] });
      if (choice === "save" && !(await save())) return;
      if (choice === null) return;
    }
    openForm(id);
  }

  function draw() {
    const topics = [...(data().topics || [])].sort((a, b) => String(a.start).localeCompare(String(b.start)) || String(a.topic).localeCompare(String(b.topic)));
    list.replaceChildren(...topics.map(card),
      ...(open === "new" && form ? [h("li", { class: "studio-comment", "data-topic": "new" }, h("h3", { class: "studio-comment-who", text: "Your own topic" }), formBox(null))] : []));
    add.hidden = open === "new";
    drawDetails();
  }

  function drawDetails(problems = []) {
    const entries = data().entries || [];
    details.replaceChildren(h("summary", { text: "For the person who set up your site" }),
      h("ul", { class: "studio-mono" }, ...[
        ...problems.map((p) => `problem: ${p}`),
        ...(data().topics || []).map((t) => `${t.id}${t.custom ? " (custom)" : ""} ${t.start}–${t.end}${t.disabled ? " off" : ""}${entries.some((e) => e.id === t.id) ? ` entry ${JSON.stringify(entries.find((e) => e.id === t.id))}` : ""}`),
      ].map((t) => h("li", { text: t }))));
  }

  if (focusId) form = formOf(data().topics.find((t) => t.id === focusId));
  draw();
  sheet.show({
    heading: heading(),
    opener,
    children: [h("p", { class: "studio-help", text: "Turn one off, or move when Studio suggests it." }), undoSlot, status, list, add, details],
    dirty: formDirty,
    save,
    question: { heading: "Save this topic?", text: "You changed it and didn't save.", save: "Save", leave: "Leave without saving" },
    focus: () => (focusId ? list.querySelector(".studio-topic-form text-field")?.querySelector("input")?.focus() : list.querySelector("h3")?.focus()),
  });
  return { redraw: draw };
}
