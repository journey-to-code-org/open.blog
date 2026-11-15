// What it can look for (Studio R8), under For {helper} on the Writing helper screen: every skill
// the helper has, built in or the site's own, and the editor for the site's own. A skill is
// instructions only; the server checks it and lists what needs fixing. Saving has Undo (the
// previous source put back). Every name and line is shown as text.
import { fill, h, toast } from "./dom.js";
import { say } from "./words.js";
import { skillPresentation } from "./helper-rules.js";

export function createSkills({ api }) {
  const list = h("ul", { class: "studio-ready-list studio-skill-list" });
  const status = h("div", { class: "studio-help studio-row-note studio-row", role: "status", "aria-live": "polite" });
  const source = h("text-field", { label: say("hsetup.skillSource"), rows: 16, class: "studio-mono-field", "data-skill": "source" });
  const errors = h("ul", { class: "studio-help studio-skill-errors" });
  const saveButton = h("action-button", { onClick: () => save() }, say("hsetup.saveSkill"));
  const cancel = h("action-button", { variant: "secondary", onClick: () => closeEditor() }, say("hsetup.cancelSkill"));
  const editor = h("div", { class: "studio-form-fields studio-skill-editor", hidden: true }, source, errors, h("cluster-layout", { gap: "0.5rem" }, saveButton, cancel));
  const add = h("action-button", { variant: "secondary", onClick: () => edit(null) }, say("hsetup.newSkill"));
  const element = h("section", { class: "studio-helper-section", "aria-labelledby": "studio-skills-h" },
    h("h3", { id: "studio-skills-h", text: say("hsetup.skills") }), h("p", { class: "studio-help", text: say("hsetup.skillsHelp") }), list, h("div", {}, add), editor, status);
  let skills = [];
  let editing = null; // { id, etag, before } for one of the site's own; null for a new one
  let opener = null;

  function draw() {
    fill(list, ...skills.map((skill) => {
      const shown = skillPresentation(skill);
      return h("li", { class: "studio-ready-item", "data-skill-id": String(skill.id || "") },
        h("strong", { text: shown.title }), h("span", { class: "studio-help", text: shown.line }),
        shown.note ? h("span", { class: "studio-help", text: shown.note }) : null,
        shown.errors.length ? h("ul", { class: "studio-help" }, shown.errors.map((text) => h("li", { text }))) : null,
        shown.editable ? h("div", {}, h("action-button", { variant: "secondary", size: "sm", label: say("hsetup.changeSkillName", { name: shown.title.slice(0, 80) }), onClick: (e) => edit(skill, e.currentTarget) }, say("hsetup.changeSkill"))) : null);
    }));
  }

  async function load() {
    try {
      skills = (await api.get("assistant/skills"))?.skills || [];
      draw();
    } catch {
      status.textContent = say("hsetup.cantLoad");
    }
  }

  function edit(skill, from = add) {
    opener = from;
    editing = skill ? { id: skill.fileId || skill.id, etag: skill.etag, before: String(skill.raw || "") } : null;
    source.value = skill ? String(skill.raw || "") : "";
    source.error = "";
    errors.replaceChildren();
    editor.hidden = false;
    requestAnimationFrame(() => source.querySelector("textarea")?.focus());
  }

  function closeEditor() {
    editor.hidden = true;
    (opener?.querySelector?.("button") || add.querySelector("button"))?.focus();
  }

  async function put(id, text, etag) {
    return api.call("PUT", `assistant/skill?id=${encodeURIComponent(id)}`, { json: { source: text, etag } });
  }

  async function save() {
    const text = String(source.value || "");
    errors.replaceChildren();
    if (!text.trim()) { source.error = say("hsetup.skillEmpty"); source.querySelector("textarea")?.focus(); return; }
    source.error = "";
    saveButton.loading = true;
    const was = editing;
    try {
      const saved = was ? await put(was.id, text, was.etag) : await api.call("POST", "assistant/skill", { json: { source: text } });
      editor.hidden = true;
      await load();
      // Undo: the source it had before, put back with the new version's tag. A new skill has none.
      const undo = was ? h("action-button", { variant: "secondary", size: "sm", onClick: async () => {
        try {
          await put(saved.id, was.before, saved.etag);
          await load();
          fill(status, say("hsetup.skillBack"));
        } catch (error) {
          fill(status, error?.status === 409 ? say("hsetup.skillConflict") : say("hsetup.skillNotSaved", { why: String(error?.message || "").slice(0, 160) }));
        }
      } }, say("found.undo")) : null;
      fill(status, h("span", { text: say("hsetup.skillSaved") }), undo);
      toast(say("hsetup.skillSaved"));
      (undo?.querySelector("button") || add.querySelector("button"))?.focus?.();
    } catch (error) {
      if (error?.status === 409 && was) { source.error = say("hsetup.skillConflict"); return; }
      source.error = say("hsetup.skillNotSaved", { why: String(error?.data?.error || error?.message || "").slice(0, 160) });
      fill(errors, ...(Array.isArray(error?.data?.errors) ? error.data.errors : []).filter((line) => typeof line === "string").map((line) => h("li", { text: line })));
      source.querySelector("textarea")?.focus();
    } finally {
      saveButton.loading = false;
    }
  }

  return { element, load, dirty: () => !editor.hidden && String(source.value || "") !== (editing?.before ?? "") };
}
