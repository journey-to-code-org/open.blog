// People: who can be named on her posts (the old Admin's Contributors). Her layer: the blog's own
// name, then each person with their website, Change and Remove. Adding or changing someone is a
// sheet (name, website; their id, other pages and ORCID iD under Details). Removing asks once,
// says what the server refused in her words (with the posts that still name someone), and can be
// undone. From a post (`?from=<path>`), Back returns to it; with `&add=1`, Save returns with the
// new person on the list. Every name and address is text. Studio R5.
import { h, toast } from "../parts/dom.js";
import { use } from "../zubra.js";
import { ask } from "../parts/dialogs.js";
import { createSheet, guardedLeave } from "../parts/sheet.js";
import { newId, peopleProblem, personProblem, siteWords } from "../parts/people-rules.js";

export async function createPeople(context, route = {}) {
  const { api } = context;
  await use("action-button", "alert-banner", "breadcrumb-trail", "dropdown-menu", "empty-state", "skeleton-block", "status-badge", "text-field", "content-card");
  const from = route.query?.from || "";
  const adding = route.query?.add === "1";
  let data = null; // { etag, contributors, author }
  let fromTitle = "";
  const sheet = await createSheet({ label: "Add someone", wide: false });

  const heading = h("h2", { id: "studio-people-h", class: "studio-question", tabindex: "-1", text: "People" });
  const back = h("div");
  const add = h("action-button", { onClick: (e) => edit(null, e.currentTarget) }, "Add someone");
  const status = h("div", { class: "studio-banner", role: "status", "aria-live": "polite" });
  const list = h("div", { class: "studio-people", "aria-busy": "true" }, h("skeleton-block", { shape: "card" }));
  const details = h("details", { class: "studio-help studio-people-details" });
  const element = h("section", { class: "studio-page studio-people-page", "aria-labelledby": "studio-people-h" },
    h("breadcrumb-trail", { items: [{ label: "Home", href: "#/" }, { label: "People", href: "" }] }),
    back, heading,
    h("p", { class: "studio-lede", text: "The people who write, cook or take photos for your blog. Choose them under Who wrote it on any post." }),
    h("div", {}, add), status, list, details);

  const people = () => Object.entries(data?.contributors || {});
  const backHref = (extra = "") => `#/write/${encodeURIComponent(from)}?sheet=about&group=credits${extra}`;

  async function load() {
    list.setAttribute("aria-busy", "true");
    if (from && !fromTitle) {
      fromTitle = await api.get(`document?path=${encodeURIComponent(from)}`).then((d) => String(d?.fields?.title || ""), () => "");
      back.replaceChildren(h("action-button", { variant: "link", href: backHref(), class: "studio-back" }, `Back to “${fromTitle || "your post"}”`));
    }
    try {
      data = await api.get("contributors");
      draw();
      if (adding && !sheet.isOpen) edit(null, add);
    } catch (error) {
      if (error.status === 401) throw error;
      list.removeAttribute("aria-busy");
      list.replaceChildren(h("alert-banner", { variant: "danger", heading: "People didn't load" }, "Check your connection and try again. ",
        h("action-button", { variant: "secondary", size: "sm", onClick: () => load() }, "Try again")));
    }
  }

  function draw() {
    list.removeAttribute("aria-busy");
    const author = data.author || {};
    const own = author.name
      ? h("li", { class: "studio-person" }, h("div", { class: "studio-comment-head" },
        h("strong", { class: "studio-person-name", text: author.name }), h("status-badge", { variant: "outline" }, "Your blog's name")),
        h("p", { class: "studio-help", text: "Your blog's usual name." }))
      : h("li", { class: "studio-person" }, h("p", { class: "studio-help", text: "Your blog doesn't have your name yet. Tell the person who set up your site." }));
    const rows = people().map(([id, person]) => {
      const more = h("dropdown-menu", { class: "studio-row-menu", items: [{ value: "remove", label: "Remove…" }], onItemselect: () => remove(id, more) },
        h("span", { slot: "label" }, "More", h("span", { class: "studio-visually-hidden", text: ` for ${person.name || id}` })));
      return h("li", { class: "studio-person", "data-person": id },
        h("strong", { class: "studio-person-name", text: person.name || id }),
        person.url ? h("p", { class: "studio-help", text: siteWords(person.url) }) : null,
        h("div", { class: "studio-row" },
          h("action-button", { variant: "secondary", label: `Change ${person.name || id}`, onClick: (e) => edit(id, e.currentTarget) }, "Change"), more));
    });
    list.replaceChildren(h("ul", { class: "studio-comment-list" }, own, ...rows),
      rows.length ? null : h("empty-state", { heading: "No one else yet" }, "Add the people who write with you, so you can name them on a post.",
        h("action-button", { slot: "actions", onClick: (e) => edit(null, e.currentTarget) }, "Add someone")));
    details.replaceChildren(h("summary", { text: "Details for the person who set up your site" }),
      h("p", { text: "Saved in openblog.json, under contributors. The blog's own name is author there." }),
      h("p", { class: "studio-detail", text: `Version ${data.etag || "unknown"}` }),
      h("pre", { class: "studio-mono studio-people-raw", tabindex: "0", "aria-label": "The registry as saved", text: JSON.stringify(data.contributors || {}, null, 2) }));
  }

  // ---- add or change someone
  function edit(id, opener) {
    const person = id ? data.contributors[id] : {};
    const name = h("text-field", { label: "Name", value: person.name || "", required: true, maxlength: 120 });
    const url = h("text-field", { label: "Their website", type: "url", value: person.url || "", description: "Optional. A full web address, like https://ruthbakes.com." });
    const sameAs = h("text-field", { label: "Also at", rows: 3, value: (person.sameAs || []).join("\n"), description: "Other pages about them, one web address on each line." });
    const orcid = h("text-field", { label: "ORCID iD", value: person.orcid || "", description: "16 digits, like 0000-0002-1825-0097." });
    const idLine = h("p", { class: "studio-help studio-mono", text: id ? `Id: ${id}` : "Id: made from the name when you save." });
    const fields = { name, url, sameAs, orcid };
    const said = h("div", { "aria-live": "polite" });
    const start = JSON.stringify([person.name || "", person.url || "", (person.sameAs || []).join("\n"), person.orcid || ""]);
    const current = () => JSON.stringify([name.value || "", url.value || "", sameAs.value || "", orcid.value || ""].map(String));
    const save = h("action-button", { slot: "actions", onClick: () => submit() }, "Save");
    const cancel = h("action-button", { slot: "actions", variant: "secondary", onClick: () => sheet.cancel() }, "Cancel");

    async function submit() {
      for (const field of Object.values(fields)) field.error = "";
      said.replaceChildren();
      const draft = { name: String(name.value || "").trim(), url: String(url.value || "").trim(), sameAs: String(sameAs.value || ""), orcid: String(orcid.value || "").trim() };
      const problem = personProblem(draft);
      if (problem) {
        fields[problem.field].error = problem.words;
        if (problem.field !== "name" && problem.field !== "url") sheet.element.querySelector("details")?.setAttribute("open", "");
        fields[problem.field].querySelector("input, textarea")?.focus();
        return false;
      }
      const key = id || newId(draft.name, Object.keys(data.contributors || {}));
      const entry = { name: draft.name, ...(draft.url ? { url: draft.url } : {}),
        ...(draft.sameAs.trim() ? { sameAs: draft.sameAs.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) } : {}), ...(draft.orcid ? { orcid: draft.orcid } : {}) };
      save.loading = true;
      try {
        data = await api.put("contributors", { etag: data.etag, contributors: { ...data.contributors, [key]: entry } });
        sheet.close();
        draw();
        toast(`Saved. ${draft.name} can be chosen on any post.`);
        if (adding && from && !id) context.go(backHref(`&add=${encodeURIComponent(key)}`));
        return true;
      } catch (error) {
        const answer = peopleProblem(error, draft.name);
        if (answer.field && fields[answer.field]) { fields[answer.field].error = answer.words; fields[answer.field].querySelector("input, textarea")?.focus(); }
        else said.replaceChildren(h("alert-banner", { variant: "danger", heading: "Not saved" }, answer.words, h("span", { class: "studio-detail", text: ` ${error.message || ""}` })));
        if (answer.reload) { await reloadAfterChange(); }
        return false;
      } finally {
        save.loading = false;
      }
    }

    sheet.show({
      heading: id ? `Change ${person.name || id}` : "Add someone",
      children: [said, name, url,
        h("details", { class: "studio-help" }, h("summary", { text: "Details for the person who set up your site" }),
          idLine, h("p", { class: "studio-help", text: "Posts name them by this, so it doesn't change." }), sameAs, orcid),
        cancel, save],
      dirty: () => current() !== start,
      save: submit,
      question: { heading: id ? "Save your changes to this person?" : "Save this person?", save: "Save", leave: "Leave without saving" },
      opener,
      focus: () => name.querySelector("input")?.focus(),
    });
  }

  async function reloadAfterChange() {
    try { data = await api.get("contributors"); draw(); } catch { /* the next load says so */ }
  }

  // ---- remove, and undo
  async function remove(id, opener) {
    const person = data.contributors[id];
    const name = person?.name || id;
    const choice = await ask({ heading: `Remove ${name}?`, text: `${name} won't be offered on posts any more.`, choices: [{ label: `Keep ${name}`, value: "keep", variant: "secondary" }, { label: "Remove", value: "remove", variant: "destructive" }] });
    if (choice !== "remove") { opener?.querySelector("button")?.focus(); return; }
    const rest = Object.fromEntries(people().filter(([key]) => key !== id));
    try {
      data = await api.put("contributors", { etag: data.etag, contributors: rest });
      draw();
      toast("Removed.");
      status.replaceChildren(h("alert-banner", { variant: "info", heading: `${name} was removed` },
        h("action-button", { variant: "secondary", size: "sm", onClick: () => undo(id, person) }, "Undo")));
      heading.focus();
    } catch (error) {
      const answer = peopleProblem(error, name);
      status.replaceChildren(h("alert-banner", { variant: "warning", heading: "Not removed" }, answer.words,
        answer.posts?.length ? h("ul", { class: "studio-checks" }, answer.posts.map((p) => h("li", {}, h("a", { href: `#/write/${encodeURIComponent(p.path)}?sheet=about&group=credits`, text: p.title || p.path })))) : null));
      if (answer.reload) await reloadAfterChange();
      status.querySelector("alert-banner")?.scrollIntoView?.({ block: "nearest" });
    }
  }

  /** Undo puts back only the person removed, against the registry as it is now. */
  async function undo(id, person) {
    try {
      const now = await api.get("contributors");
      if (now.contributors?.[id]) { data = now; draw(); status.replaceChildren(); return; }
      data = await api.put("contributors", { etag: now.etag, contributors: { ...now.contributors, [id]: person } });
      draw();
      status.replaceChildren();
      toast(`${person.name || id} is back.`);
    } catch (error) {
      status.replaceChildren(h("alert-banner", { variant: "danger", heading: "Not put back" }, peopleProblem(error, person.name || id).words));
    }
  }

  return {
    title: "People",
    element,
    load,
    reload: load,
    leave: () => guardedLeave(sheet),
    isDirty: () => sheet.isDirty(),
    focus: () => heading.focus(),
    get palette() {
      return [
        { id: "add", label: "Add someone", group: "People" },
        ...people().map(([id, person]) => ({ id: `change:${id}`, label: `Change ${person.name || id}`, group: "People" })),
      ];
    },
    command(id) {
      if (id === "add") edit(null, add);
      if (id.startsWith("change:") && data?.contributors?.[id.slice(7)]) edit(id.slice(7), add);
    },
  };
}
