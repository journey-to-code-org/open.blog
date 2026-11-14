// Who wrote it, in About this post: the names on the post in order, and an editor for the list
// (people from People, Move up, Move down, Remove, Add someone, Just me). For the person who set up
// the site: each person's roles, "Name no one on this post", and repairing a credit file that
// can't be read. The list is sent only when it changed, always with its `creditEtag` (the save
// does that; this keeps the draft). Every name is text. Studio R5.
import { h } from "./dom.js";
import { ask } from "./dialogs.js";
import {
  AUTHOR_ROLE, creditLineProblems, creditNames, creditState, creditsToSend, moveCredit, nextCredit, normalizeCreditDraft,
  toggleCreditRole, unknownRoles,
} from "./credit-rules.js";

let uid = 0;

/**
 * `people()` resolves to `{ author, contributors }` (GET contributors, asked once on open).
 * `onChange()` after every edit; `goPeople()` opens People to add someone.
 */
export function createCredits({ meta, people, onChange, goPeople }) {
  const id = `studio-credits-${++uid}`;
  const say = h("p", { class: "studio-visually-hidden", "aria-live": "polite" });
  const element = h("div", { class: "studio-about-credits" });
  const rolesHost = h("div", { class: "studio-about-roles" });
  let before = null; // what the post had: null (no file) or the list
  let draft; // undefined until she edits; then null (the blog's usual name) or a list
  let error = "";
  let editing = false;
  let registry = null; // { author, contributors }
  let problemWords = "";

  const current = () => (draft === undefined ? before : draft);
  const state = () => (error && draft === undefined ? "broken" : creditState({ credits: current() }));
  const names = () => creditNames(current(), registry?.contributors || meta.contributors || {}, registry?.author || {});
  const changed = () => { problemWords = ""; draw(); onChange?.(); };
  const nameOf = (contributor) => registry?.contributors?.[contributor]?.name || contributor;

  function draw() {
    const list = normalizeCreditDraft(current());
    const s = state();
    const author = registry?.author?.name || "";
    const pool = Object.keys(registry?.contributors || {});
    if (!registry) {
      element.replaceChildren(h("skeleton-block", { lines: 2 }));
      return drawRoles();
    }
    if (s === "broken") {
      element.replaceChildren(h("alert-banner", { variant: "warning", heading: "Who wrote this post can't be read right now" },
        "Everything else saves as usual. Tell the person who set up your site."));
      return drawRoles();
    }
    if (!editing) {
      const shown = s === "inherited"
        ? (author ? [h("p", { class: "studio-about-name", text: author }), h("p", { class: "studio-help", text: "The name your blog uses on every post." })]
          : [h("p", { class: "studio-help", text: "Your blog doesn't have your name yet. Tell the person who set up your site." })])
        : s === "empty" ? [h("p", { text: "No one is named on this post." })]
          : [h("ol", { class: "studio-about-names" }, list.map((credit) => h("li", { text: nameOf(credit.contributor) })))];
      const canEdit = s !== "inherited" || author || pool.length;
      element.replaceChildren(...shown, problem(),
        canEdit ? h("action-button", { variant: "secondary", class: "studio-about-change-credits", onClick: () => { editing = true; draw(); element.querySelector("select")?.focus(); } }, "Change who wrote it") : null);
      return drawRoles();
    }
    // The editor.
    if (!pool.length) {
      element.replaceChildren(h("p", { text: "Add the people who write with you first." }),
        h("action-button", { variant: "secondary", onClick: () => goPeople?.() }, "Open People"), problem());
      return drawRoles();
    }
    const lines = s === "inherited" ? [] : list;
    const lineProblems = creditLineProblems(lines);
    const rows = lines.map((credit, index) => {
      const listedElsewhere = new Set(lines.filter((_, i) => i !== index).map((c) => c.contributor));
      const options = [
        ...(credit.contributor ? [] : [{ value: "", label: "Choose who" }]),
        ...pool.filter((p) => !listedElsewhere.has(p)).map((p) => ({ value: p, label: nameOf(p) })),
      ];
      const name = nameOf(credit.contributor) || `Person ${index + 1}`;
      const select = h("select-field", { label: `Person ${index + 1}`, options, value: credit.contributor, "data-credit": String(index),
        onValuechange: (e) => { const next = [...lines]; next[index] = { ...next[index], contributor: e.detail }; draft = next; changed(); } });
      const tools = h("div", { class: "studio-row" },
        h("action-button", { variant: "ghost", size: "sm", disabled: index === 0, label: `Move ${name} up`, class: "studio-move-up", onClick: () => move(lines, index, -1) }, "Move up"),
        h("action-button", { variant: "ghost", size: "sm", disabled: index === lines.length - 1, label: `Move ${name} down`, class: "studio-move-down", onClick: () => move(lines, index, 1) }, "Move down"),
        h("action-button", { variant: "ghost", size: "sm", label: `Remove ${name}`, onClick: () => remove(lines, index) }, "Remove"));
      const words = lineProblems.get(index);
      if (words) select.setAttribute("aria-invalid", "true");
      return h("li", { class: "studio-about-credit" }, select, words ? h("p", { class: "studio-field-error", role: "alert", text: words }) : null, tools);
    });
    const next = nextCredit(lines, pool);
    element.replaceChildren(
      h("p", { class: "studio-help", id: `${id}-help`, text: "The first name shows first. Everyone listed is shown as having written it." }),
      h("ol", { class: "studio-about-credit-list", "aria-describedby": `${id}-help` }, rows),
      h("div", { class: "studio-row" },
        next ? h("action-button", { variant: "secondary", onClick: () => { draft = [...lines, next]; changed(); element.querySelectorAll("select-field")[lines.length]?.querySelector("select")?.focus(); } }, "Add someone") : null,
        h("action-button", { variant: "secondary", onClick: () => goPeople?.({ add: true }) }, "Add someone who isn't listed")),
      author ? h("action-button", { variant: "link", class: "studio-about-just-me", onClick: justMe }, "Just me") : null,
      problem(), say);
    drawRoles();
  }

  const problem = () => (problemWords ? h("p", { class: "studio-field-error", role: "alert", tabindex: "-1", text: problemWords }) : null);

  function move(lines, index, by) {
    const name = nameOf(lines[index].contributor);
    draft = moveCredit(lines, index, index + by);
    changed();
    say.textContent = `${name} is now number ${index + by + 1} of ${lines.length}.`;
    requestAnimationFrame(() => {
      const row = element.querySelectorAll(".studio-about-credit")[index + by];
      (row?.querySelector(by < 0 ? ".studio-move-up button" : ".studio-move-down button:not([disabled])") || row?.querySelector("select"))?.focus();
    });
  }

  function remove(lines, index) {
    const name = nameOf(lines[index].contributor);
    draft = lines.filter((_, i) => i !== index);
    changed();
    say.textContent = `${name} removed. ${draft.length} left.`;
    requestAnimationFrame(() => (element.querySelectorAll(".studio-about-credit select")[Math.min(index, draft.length - 1)] || element.querySelector("action-button button"))?.focus());
  }

  async function justMe() {
    const author = registry?.author?.name || "you";
    const choice = await ask({ heading: `Name only ${author}, as on your other posts?`, text: "The list on this post goes, and your blog's usual name shows.", choices: [{ label: "Yes", value: "yes" }, { label: "Keep the list", value: "no", variant: "secondary" }] });
    if (choice !== "yes") return;
    draft = null;
    editing = false;
    changed();
    element.querySelector(".studio-about-change-credits button")?.focus();
  }

  // ---- Details: roles, name no one, repair
  function drawRoles() {
    const catalog = meta.creditRoles || [];
    const s = state();
    const parts = [];
    if (s === "broken") {
      parts.push(h("p", { class: "studio-detail", text: error }),
        h("p", { class: "studio-help", text: "Choose one before changing who wrote it. Everything else saves meanwhile." }),
        h("div", { class: "studio-row" },
          h("action-button", { variant: "secondary", onClick: () => { draft = null; error = ""; changed(); } }, "Use the blog's usual name"),
          h("action-button", { variant: "secondary", onClick: () => { draft = []; error = ""; editing = true; changed(); } }, "Start a new list")));
      rolesHost.replaceChildren(...parts);
      return;
    }
    const none = h("toggle-switch", { label: "Name no one on this post", checked: s === "empty",
      onCheckedchange: (e) => { draft = e.detail ? [] : (Array.isArray(before) && before.length ? before : null); changed(); } });
    parts.push(none);
    const list = s === "explicit" ? normalizeCreditDraft(current()) : [];
    list.forEach((credit, index) => {
      if (!credit.contributor) return;
      const name = nameOf(credit.contributor);
      const has = (role) => credit.roles.some((r) => r.vocabulary === role.vocabulary && r.role === role.role);
      const group = (vocabulary, legend) => {
        const roles = catalog.filter((r) => r.vocabulary === vocabulary);
        if (!roles.length) return null;
        return h("fieldset", { class: "studio-field-group studio-about-role-group" }, h("legend", { text: legend }),
          roles.map((role) => h("toggle-switch", { label: role.label || role.role, checked: has(role),
            onCheckedchange: (e) => { const next = [...list]; next[index] = toggleCreditRole(credit, role, e.detail); draft = next; changed(); } })));
      };
      const unknown = unknownRoles(credit, catalog);
      parts.push(h("details", { class: "studio-about-person-roles" },
        h("summary", { text: `Roles for ${name} (${credit.roles.length})` }),
        credit.roles.length ? null : h("p", { class: "studio-field-error", text: `Give ${name} at least one role.` }),
        unknown.length ? h("p", { class: "studio-field-error", text: `Not recognised: ${unknown.join(", ")}. Remove roles your blog doesn't know before saving.` }) : null,
        group("crossref", "Publishing roles"), group("credit", "CRediT roles")));
    });
    rolesHost.replaceChildren(...parts);
  }

  return {
    element,
    rolesElement: rolesHost,
    /** From `GET document` (or a new post): the list, its error. */
    reset(reply = {}) {
      before = Array.isArray(reply.credits) ? normalizeCreditDraft(reply.credits) : null;
      error = reply.creditError ? String(reply.creditError) : "";
      draft = undefined;
      editing = false;
      problemWords = "";
      draw();
    },
    /** Ask People once the sheet opens. */
    async ready() {
      if (registry) return;
      try { registry = await people(); } catch { registry = { author: { name: meta.author?.name || "" }, contributors: meta.contributors || {} }; }
      draw();
    },
    /** Forget People so the next open asks again (someone was added). */
    refresh() { registry = null; },
    /** For kept copies: the draft, or undefined when she hasn't changed who wrote it. */
    draft: () => (draft === undefined ? undefined : draft === null ? null : normalizeCreditDraft(draft)),
    /** Put a kept draft back. */
    restore(kept) {
      if (kept === undefined) return;
      draft = kept === null ? null : normalizeCreditDraft(kept);
      editing = Array.isArray(draft) && draft.length > 0;
      draw();
    },
    /** Add a person (back from People) as the next author. */
    add(contributor) {
      const lines = state() === "explicit" || state() === "empty" ? normalizeCreditDraft(current()) : [];
      if (lines.some((c) => c.contributor === contributor)) return;
      draft = [...lines, { contributor, roles: [{ ...AUTHOR_ROLE }] }];
      editing = true;
      changed();
    },
    /** What a save sends as `credits`: undefined when nothing changed. */
    toSend: () => (state() === "broken" ? undefined : creditsToSend(before, draft)),
    names,
    /** Her checks: the first line with no one, or a person with no roles. */
    problems() {
      if (draft === undefined || draft === null) return [];
      const out = [...creditLineProblems(draft).values()].map((words) => ({ name: "credits", words }));
      for (const credit of normalizeCreditDraft(draft)) if (credit.contributor && !credit.roles.length) out.push({ name: "roles", words: `Give ${nameOf(credit.contributor)} at least one role.` });
      return out;
    },
    /** The server's answer beside the list. */
    showProblem(words) { problemWords = words; draw(); element.querySelector(".studio-field-error")?.focus?.(); },
    /** After a save: what was sent is what the post has now. */
    saved(sent) { if (sent !== undefined) { before = sent === null ? null : normalizeCreditDraft(sent); draft = undefined; error = ""; } problemWords = ""; editing = false; draw(); },
    /** The other computer's list, taken in place of hers (409 credits-changed: Use that list). */
    takeTheirs(reply) { this.reset(reply); onChange?.(); },
    focus: () => (element.querySelector("select, button") || element).focus?.(),
  };
}
