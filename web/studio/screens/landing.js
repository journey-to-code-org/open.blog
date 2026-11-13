// Front page: the sections of her home page in order, each said in a line. Change one (its fields
// in a side sheet, drawn from the same section catalog the old Admin uses), move it, hide it,
// remove it (Undo puts it back where it was), add one (built-in sections and her theme's own
// things, like the Christmas tree), see it, save it. Earlier versions can be brought back.
// Studio slice 6. The rules are the old Admin's landing model (/admin/landing.js, pure data and
// functions); the server owns every rule and the saved form.
import { h, toast } from "../parts/dom.js";
import { use } from "../zubra.js";
import { ask } from "../parts/dialogs.js";
import { form } from "../parts/field-form.js";
import { showPreview } from "../parts/preview.js";
import { sendOut, wentOutWords } from "../parts/publish.js";
import { choosePicture } from "../parts/picture-picker.js";
import { landingVersions } from "../parts/landing-versions.js";

// Served by the old Admin at /admin/landing.js; Studio lives at /admin/studio/.
const MODEL = "/admin/landing.js";

export async function createLanding(context) {
  const { api, meta, posts } = context;
  await use("action-button", "dropdown-menu", "side-sheet", "alert-banner", "status-badge", "empty-state", "skeleton-block", "content-card", "auto-grid", "text-field", "select-field", "toggle-switch", "date-field");
  const L = await import(MODEL);
  let revision = null;
  let saved = null; // the page as on the server
  let draft = null; // what she's changing
  let removed = null; // the last section taken out, for Undo
  let postList = [];

  const heading = h("h2", { id: "studio-landing-h", class: "studio-question", tabindex: "-1", text: "Your front page" });
  const lede = h("p", { class: "studio-lede", role: "status" });
  const banner = h("div", { class: "studio-banner", "aria-live": "polite" });
  const list = h("ol", { class: "studio-landing-list", "aria-labelledby": "studio-landing-h", "aria-busy": "true" }, h("li", {}, h("skeleton-block", { lines: 4 })));
  const say = h("div", { class: "studio-deco-status", role: "status", "aria-live": "polite" });
  const add = h("action-button", { variant: "secondary", onClick: () => pick() }, "Add a section");
  const saveButton = h("action-button", { onClick: () => save() }, "Save");
  const see = h("action-button", { variant: "secondary", onClick: (e) => preview(e.currentTarget) }, "See how it looks");
  const bar = h("div", { class: "studio-write-bar" }, see, saveButton);
  const sheet = h("side-sheet", { label: "Section", side: "right" });
  const versions = landingVersions({ api, getRevision: () => revision, onRestored: (reply) => adopt(reply, { quiet: true }) });
  const element = h("section", { class: "studio-page studio-landing", "aria-labelledby": "studio-landing-h" },
    heading, lede, banner, list, say, add, versions.element, bar, sheet);

  // Her words: what the engine calls a series section lists her collections.
  const titleOf = (section) => (section?.type === "series" ? "Collections" : L.sectionTitle(section));
  const labelOf = (info) => (info.type === "series" ? { ...info, label: "Collections", description: "Your collections, each with a link." } : info);
  const dirty = () => Boolean(draft && saved) && !L.pageSame(draft, saved);

  function paint() {
    const n = draft.sections.length;
    const hidden = draft.sections.filter((s) => s.hidden).length;
    lede.textContent = `${n === 1 ? "1 section" : `${n} sections`}${hidden ? `, ${hidden} hidden` : ""}, top to bottom.${dirty() ? " Changes not saved yet." : ""}`;
    const problems = L.pageProblems(draft);
    list.removeAttribute("aria-busy");
    if (!n) {
      list.replaceChildren(h("li", {}, h("empty-state", { heading: "No sections yet" }, "Add a section, or start from a ready-made layout.",
        h("div", { slot: "actions" }, ...L.STARTERS.map((s) => h("action-button", { variant: "secondary", onClick: () => start(s.id) }, s.label))))));
    } else {
      list.replaceChildren(...draft.sections.map((section, index) => sectionRow(section, index, problems.get(section.id))));
    }
    add.hidden = n >= L.LIMITS.sections;
  }

  function sectionRow(section, index, problems) {
    const title = titleOf(section);
    const menu = h("dropdown-menu", {
      class: "studio-row-menu",
      items: [
        ...(index > 0 ? [{ value: "up", label: "Move up" }] : []),
        ...(index < draft.sections.length - 1 ? [{ value: "down", label: "Move down" }] : []),
        { value: "hide", label: section.hidden ? "Show it again" : "Hide it for now" },
        { value: "remove", label: "Remove" },
      ],
      onItemselect: (e) => act(section, e.detail),
    }, h("span", { slot: "label" }, "More", h("span", { class: "studio-visually-hidden", text: ` for ${title}` })));
    return h("li", { class: "studio-landing-row", "data-id": section.id },
      h("div", { class: "studio-landing-text" },
        h("strong", { class: "studio-landing-title", tabindex: "-1", text: `${index + 1}. ${title}` }),
        h("span", { class: "studio-help", text: L.sectionSummary(section) }),
        section.hidden ? h("status-badge", { variant: "neutral" }, "Hidden") : null,
        problems ? h("status-badge", { variant: "warning" }, "Needs a look") : null),
      h("action-button", { variant: "secondary", size: "sm", onClick: () => edit(section) }, h("span", {}, "Change", h("span", { class: "studio-visually-hidden", text: ` ${title}` }))),
      menu);
  }

  const focusRow = (id, what = ".studio-landing-title") => requestAnimationFrame(() => list.querySelector(`[data-id="${CSS.escape(id)}"] ${what}`)?.focus());

  function act(section, what) {
    const title = titleOf(section);
    if (what === "up" || what === "down") {
      const moved = L.moveSection(draft.sections, section.id, what === "up" ? -1 : 1);
      draft.sections = moved.sections;
      say.replaceChildren(`${title} is number ${moved.to + 1} of ${draft.sections.length} now. Not saved yet.`);
    }
    if (what === "hide") {
      const hide = !section.hidden;
      draft.sections = L.setHidden(draft.sections, section.id, hide);
      say.replaceChildren(hide ? `${title} is hidden. Visitors won't see it; it's kept here.` : `${title} shows again.`, " Not saved yet.");
    }
    if (what === "remove") {
      const out = L.removeSection(draft.sections, section.id);
      draft.sections = out.sections;
      removed = out.removed;
      const undo = h("action-button", { variant: "secondary", size: "sm", onClick: () => { draft.sections = L.restoreSection(draft.sections, removed); const id = removed.section.id; removed = null; say.replaceChildren(`${title} is back.`); paint(); focusRow(id); } }, "Undo");
      say.replaceChildren(h("span", { text: `Removed ${title}. Not saved yet. ` }), undo);
      paint();
      undo.querySelector("button")?.focus();
      return;
    }
    paint();
    focusRow(section.id);
  }

  // Change one section: its fields in the side sheet. Done puts them in the page (not saved yet).
  function edit(section, { isNew = false } = {}) {
    const info = L.sectionInfo(section.type, section);
    const f = form(info.fields || [], section, {
      posts: postList,
      pickPicture: async () => (await choosePicture(api, { heading: "Choose a photo", describe: false, maxBytes: meta.capture?.maxPhotoBytes || 0 }))?.url || "",
    });
    const problems = h("div", { "aria-live": "polite" });
    const done = () => {
      const next = { ...f.value(), id: section.id, type: section.type, ...(section.tag ? { tag: section.tag } : {}) };
      const found = L.sectionProblems(next);
      if (found.length) {
        problems.replaceChildren(h("alert-banner", { variant: "warning", heading: "Almost" }, h("ul", {}, found.map((p) => h("li", { text: p.message })))));
        return;
      }
      draft.sections = draft.sections.map((s) => (s.id === section.id ? next : s));
      sheet.open = false;
      say.replaceChildren(`${titleOf(next)} ${isNew ? "added" : "changed"}. Press Save to put it on your site.`);
      paint();
      focusRow(section.id);
    };
    sheet.replaceChildren(
      h("span", { slot: "heading", text: info.label }),
      info.description ? h("p", { class: "studio-help", text: info.description }) : null,
      f.element, problems,
      h("div", { class: "studio-sheet-actions" },
        h("action-button", { onClick: done }, "Keep this change"),
        h("action-button", { variant: "secondary", onClick: () => { sheet.open = false; if (isNew) { draft.sections = draft.sections.filter((s) => s.id !== section.id); paint(); } } }, "Cancel")));
    sheet.open = true;
    requestAnimationFrame(() => f.focus());
  }

  // Add a section: the built-in kinds, then her theme's own things.
  function pick() {
    const choose = (type, tag) => {
      const out = L.addSection(draft.sections, type, draft.sections.length, tag);
      if (out.full) { toast("That's as many sections as a page holds.", { variant: "warning" }); return; }
      draft.sections = out.sections;
      paint();
      edit(out.added, { isNew: true });
    };
    const card = (info, onClick) => h("li", {}, h("button", { type: "button", class: "studio-pick", onClick },
      h("strong", { text: info.label }), h("span", { class: "studio-help", text: info.description })));
    const business = meta.siteUses?.business || meta.siteUses?.services || meta.siteUses?.reviews;
    const builtIn = L.SECTION_CATALOG.filter((i) => business || !["business-facts", "quote-form", "services", "recent-jobs", "reviews"].includes(i.type));
    sheet.replaceChildren(
      h("span", { slot: "heading", text: "Add a section" }),
      ...(L.componentEntries().length ? [h("h3", { text: "From your theme" }), h("ul", { class: "studio-pick-list" }, L.componentEntries().map((info) => card(info, () => choose("component", info.tag))))] : []),
      h("h3", { text: "Sections" }),
      h("ul", { class: "studio-pick-list" }, builtIn.map((info) => card(labelOf(info), () => choose(info.type)))));
    sheet.open = true;
  }

  async function start(id) {
    draft = { ...draft, sections: L.starterSections(id, { posts: postList }) };
    say.replaceChildren("Here's a layout to start from. Change the sample words to your own, then Save.");
    paint();
  }

  function preview(opener) {
    return showPreview(api, {
      opener, request: () => api.post("landing/preview", { page: L.pagePayload(draft, { leaveOut: true }) }),
      heading: "How your front page looks", backLabel: "Back to your front page",
      note: "Only you can see this. Sections that still need a look are left out.", frameTitle: "Your front page",
    });
  }

  async function save() {
    const problems = L.pageProblems(draft);
    if (problems.size) {
      const first = draft.sections.find((s) => problems.has(s.id));
      banner.replaceChildren(h("alert-banner", { variant: "warning", heading: "Not saved yet" }, `${problems.size === 1 ? "One section needs" : `${problems.size} sections need`} a look first: ${titleOf(first)}.`,
        h("action-button", { variant: "secondary", onClick: () => edit(first) }, `Change ${titleOf(first)}`)));
      return false;
    }
    if (!dirty()) { toast("Nothing's changed. Your site already has this."); return true; }
    saveButton.loading = true;
    try {
      const sent = structuredClone(draft);
      const reply = await api.call("PUT", "landing", { json: { revision, page: L.pagePayload(sent) } });
      adopt(reply, { keep: !L.pageSame(draft, sent) ? draft : null });
      if (reply.build && reply.build.ok === false) {
        toast("Saved, but your site couldn't be updated yet. Nothing is lost. Let the person who set up your site know.", { variant: "warning", duration: 0 });
        return true;
      }
      const result = await sendOut(api, "Change the front page");
      const said = wentOutWords(result, { meta, action: "saved" });
      toast(said.words, { variant: said.variant, duration: result.sent === "failed" ? 0 : undefined });
      versions.refresh();
      return true;
    } catch (error) {
      if (error.status === 409 && !error.data?.newerVersion) return conflict(error.data?.current);
      banner.replaceChildren(h("alert-banner", { variant: "danger", heading: "Not saved" }, L.landingErrorText(error)));
      return false;
    } finally {
      saveButton.loading = false;
    }
  }

  async function conflict(current) {
    const choice = await ask({
      heading: "Changed somewhere else",
      text: ["Your front page was changed on another device while you had it open.", "Your changes are still here. Which do you want to keep?"],
      choices: [{ label: "Use my changes", value: "mine" }, { label: "Show the other version", value: "theirs", variant: "secondary" }],
    });
    const fresh = current || await api.get("landing").catch(() => null);
    if (!fresh) return false;
    if (choice === "mine") { revision = fresh.revision; return save(); }
    if (choice === "theirs") { adopt(fresh); toast("Here's the version from the other device."); }
    return false;
  }

  function adopt(reply, { keep = null, quiet = false } = {}) {
    revision = reply.revision ?? null;
    if (reply.components) L.setComponents(reply.components);
    saved = L.pageFrom(reply.page || reply.legacy);
    if (!reply.exists && !reply.page) saved = { ...saved, unsaved: true };
    draft = keep || structuredClone(saved);
    if (!quiet) banner.replaceChildren();
    if (reply.valid === false) {
      banner.replaceChildren(h("alert-banner", { variant: "warning", heading: "Your front page needs fixing first" }, "Something in it can't be read here. Open it in the old Admin.",
        h("a", { href: "/admin/#/landing", target: "_blank", rel: "noopener", text: "Open the old Admin" })));
    }
    delete saved.unsaved;
    paint();
  }

  async function load() {
    try {
      const [reply, all] = await Promise.all([api.get("landing"), posts.list().catch(() => [])]);
      postList = all.filter((p) => p.status === "published");
      adopt(reply);
      versions.refresh();
    } catch (error) {
      list.removeAttribute("aria-busy");
      list.replaceChildren();
      banner.replaceChildren(h("alert-banner", { variant: "danger", heading: "Your front page didn't load" }, L.landingErrorText(error), h("action-button", { variant: "secondary", onClick: load }, "Try again")));
    }
  }

  async function leave() {
    if (!dirty()) return true;
    const choice = await ask({ heading: "Save your front page?", text: "You changed it and didn't save.", choices: [{ label: "Save", value: "save" }, { label: "Leave without saving", value: "go", variant: "secondary" }] });
    if (choice === "save") return save();
    return choice === "go";
  }

  return {
    title: "Front page",
    element,
    load,
    leave,
    isDirty: dirty,
    focus: () => heading.focus(),
    get palette() {
      if (!draft) return [];
      return [
        { id: "add", label: "Add a section to my front page", group: "Front page" },
        { id: "save", label: "Save my front page", group: "Front page", hint: "Ctrl S" },
        ...draft.sections.map((s) => ({ id: `edit:${s.id}`, label: `Change ${titleOf(s)}`, group: "Front page" })),
      ];
    },
    keys: ["save", "publish"],
    command(id) {
      if (id === "add") pick();
      if (id === "save" || id === "publish") save();
      const section = id.startsWith("edit:") && draft.sections.find((s) => s.id === id.slice(5));
      if (section) edit(section);
    },
  };
}
