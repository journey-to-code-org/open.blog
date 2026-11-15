// Start writing together (Studio R14a, #/together/new): what started it (one open, Add another up
// to 20), the question you each answer, a name for it, your name on it (from People), and when you
// read each other's parts ("When everyone's ready" first, ⚑ 5). Start makes it and opens it. The
// checks are the old Admin's, in her words; a refusal from the server lands on its field. Only
// one Start is ever in flight, so nothing is made twice. Owners only (the server refuses others).
import { h, toast } from "../parts/dom.js";
import { use } from "../zubra.js";
import { say } from "../parts/words.js";
import { ask } from "../parts/dialogs.js";
import { newId } from "../parts/people-rules.js";
import { lookupSourceDetails } from "../parts/moment-rules.js";
import {
  MAX_SHARED_SOURCES, REVEAL_POLICIES, SHARED_SOURCE_KINDS, emptySharedSource, sharedReflectionFieldId,
  sharedReflectionPayload, togetherProblem, validateSharedReflectionDraft,
} from "../parts/together-rules.js";

export async function createTogetherNew(context) {
  const { api } = context;
  if (context.meta?.account === "co-writer") return (await import("./together.js")).createTogetherList(context, {});
  await use("action-button", "alert-banner", "breadcrumb-trail", "choice-cards", "select-field", "text-field");
  const heading = h("h2", { id: "studio-together-new-h", class: "studio-question", tabindex: "-1", text: say("together.newTitle") });
  const problem = h("div", { class: "studio-banner", "aria-live": "assertive" });
  const sourcesHost = h("div", { class: "studio-together-sources" });
  const addAnother = h("action-button", { variant: "secondary", onClick: () => { sources.push(sourceRow(emptySharedSource("video"))); drawSources(); sources.at(-1).focus(); } }, say("together.addAnother"));
  const question = h("text-field", { label: say("together.question"), description: say("together.questionHelp"), maxlength: 1000, onValuechange: () => changed() });
  const name = h("text-field", { label: say("together.name"), description: say("together.nameHelp"), maxlength: 300, onValuechange: () => changed() });
  const yourName = h("select-field", { label: say("together.yourName"), description: say("together.yourNameHelp"), onValuechange: () => changed() });
  const yourNameNote = h("div");
  const policy = h("choice-cards", { label: say("together.whenRead"), class: "studio-together-policy",
    items: REVEAL_POLICIES.map((p) => ({ id: p.value, title: p.words(), detail: p.help() })), value: "allReady", onValuechange: () => changed() });
  const startButton = h("action-button", { "aria-keyshortcuts": "Control+Enter Meta+Enter", onClick: () => submit() }, say("together.start"));
  const cancel = h("action-button", { variant: "secondary", href: "#/together" }, say("together.cancel"));
  const element = h("section", { class: "studio-page studio-together-new", "aria-labelledby": "studio-together-new-h" },
    h("breadcrumb-trail", { items: [{ label: say("together.home"), href: "#/" }, { label: say("together.nav"), href: "#/together" }, { label: say("together.start"), href: "" }] }),
    heading, problem,
    h("h3", { class: "studio-together-h3", text: say("together.whatStarted") }), sourcesHost, h("div", {}, addAnother),
    h("h3", { class: "studio-together-h3", text: say("together.question") }), question, name,
    yourName, yourNameNote, policy,
    h("div", { class: "studio-write-bar studio-together-bar" }, h("p", { class: "studio-help", text: say("together.footer") }), cancel, startButton));

  let people = null; // { etag, contributors, author }
  let sending = false;
  let dirty = false;
  const sources = [sourceRow(emptySharedSource("video"))];
  const changed = () => { dirty = true; };

  function sourceRow(start) {
    const kind = h("choice-cards", { label: say("together.whatKind"), class: "studio-together-kinds",
      items: SHARED_SOURCE_KINDS.map((k) => ({ id: k.value, title: k.words() })), value: start.kind, onValuechange: () => { paintKind(); changed(); } });
    const title = h("text-field", { label: say("together.sourceTitle"), required: true, maxlength: 300, value: start.title, onValuechange: () => changed() });
    const url = h("text-field", { label: say("together.sourceLink"), type: "url", description: say("together.sourceLinkHelp"), value: start.url, onValuechange: () => changed() });
    const creator = h("text-field", { label: say("together.madeBy"), maxlength: 200, value: start.creator, onValuechange: () => changed() });
    const publisher = h("text-field", { label: say("together.publisher"), maxlength: 200, value: start.publisher, onValuechange: () => changed() });
    const published = h("text-field", { label: say("together.when"), maxlength: 40, value: start.published, onValuechange: () => changed() });
    const isbn = h("text-field", { label: say("together.isbn"), description: say("together.isbnHelp"), value: start.isbn, onValuechange: () => changed() });
    const more = h("details", { class: "studio-together-more" }, h("summary", { text: say("together.moreAbout") }), creator, publisher, published, isbn);
    // R14b: Fill in from the link asks the link's own site, says so first, and fills empty boxes only.
    const filled = h("p", { class: "studio-help", role: "status", "aria-live": "polite" });
    const fill = h("action-button", { variant: "secondary", size: "sm", "aria-describedby": "", onClick: async () => {
      const current = { title: String(title.value || ""), url: String(url.value || ""), creator: String(creator.value || ""), publisher: String(publisher.value || "") };
      fill.loading = true;
      const result = await lookupSourceDetails(current, (body) => api.post("collaboration/publications/source-metadata", body), () => String(url.value || "").trim() === current.url.trim());
      fill.loading = false;
      for (const key of result.applied) ({ title, creator, publisher })[key].value = current[key];
      if (result.applied.some((key) => key !== "title")) more.setAttribute("open", "");
      filled.textContent = result.message;
      if (result.applied.length) changed();
    } }, say("moments.fillIn"));
    const fillHelp = h("p", { class: "studio-help", text: say("moments.fillInHelp") });
    const number = h("h4", { class: "studio-together-h4" });
    const remove = h("action-button", { variant: "ghost", size: "sm", onClick: () => { sources.splice(sources.indexOf(row), 1); drawSources(); sources[0].focus(); changed(); } }, say("together.takeOutSource"));
    const element = h("fieldset", { class: "studio-together-source" }, h("legend", {}, number), kind, title, url, h("div", {}, fillHelp, fill, filled), more, remove);
    function paintKind() {
      const chosen = SHARED_SOURCE_KINDS.find((k) => k.value === kind.value) || SHARED_SOURCE_KINDS[0];
      title.placeholder = chosen.example();
      isbn.hidden = kind.value !== "book";
    }
    const row = {
      element, number, remove,
      fields: { title, url, creator, publisher, published, isbn },
      value: () => ({ kind: String(kind.value || "other"), title: String(title.value || ""), url: String(url.value || ""), creator: String(creator.value || ""),
        publisher: String(publisher.value || ""), published: String(published.value || ""), isbn: String(isbn.value || "") }),
      focus: () => requestAnimationFrame(() => title.querySelector("input")?.focus()),
      open: () => more.setAttribute("open", ""),
    };
    paintKind();
    return row;
  }

  function drawSources() {
    sources.forEach((row, index) => {
      row.number.textContent = sources.length > 1 ? say("together.sourceNumber", { n: index + 1 }) : say("together.whatStarted");
      row.remove.hidden = sources.length < 2;
    });
    sourcesHost.replaceChildren(...sources.map((row) => row.element));
    addAnother.hidden = sources.length >= MAX_SHARED_SOURCES;
  }
  drawSources();

  async function load() {
    try {
      people = await api.get("contributors");
    } catch (error) {
      if (error.status === 401) throw error;
      people = { contributors: {}, author: {} };
    }
    drawNames();
  }

  function drawNames(chosen = "") {
    const entries = Object.entries(people?.contributors || {});
    const authorName = String(people?.author?.name || "").trim();
    yourName.options = entries.map(([id, person]) => ({ value: id, label: person.name || id }));
    const match = entries.find(([, person]) => authorName && String(person.name || "").trim().toLowerCase() === authorName.toLowerCase());
    yourName.value = chosen || (match ? match[0] : entries[0]?.[0] || "");
    yourName.hidden = !entries.length;
    yourNameNote.replaceChildren();
    if (!match && !chosen) {
      yourNameNote.append(h("p", { class: "studio-help", text: say("together.addMyName") }),
        authorName ? h("action-button", { variant: "secondary", onClick: (e) => addMyName(e.currentTarget) }, say("together.addMyNameButton"))
          : h("a", { class: "studio-more-link", href: "#/people", text: say("people.someoneNew") }));
    }
  }

  async function addMyName(button) {
    const authorName = String(people?.author?.name || "").trim();
    const id = newId(authorName, Object.keys(people.contributors || {}));
    button.loading = true;
    try {
      people = await api.put("contributors", { etag: people.etag, contributors: { ...people.contributors, [id]: { name: authorName } } });
      drawNames(id);
    } catch (error) {
      if (error.status === 401) throw error;
      show(togetherProblem(error, "start").words);
    } finally {
      button.loading = false;
    }
  }

  function draft() {
    return { sources: sources.map((row) => row.value()), guidingQuestion: String(question.value || ""), title: String(name.value || ""),
      contributorId: String(yourName.value || ""), revealPolicy: String(policy.value || "allReady") };
  }

  function show(words, field = "") {
    problem.replaceChildren(h("alert-banner", { variant: "danger" }, words));
    for (const row of sources) for (const input of Object.values(row.fields)) input.error = "";
    question.error = ""; name.error = ""; yourName.error = "";
    const { field: which, index } = sharedReflectionFieldId(field);
    const target = index >= 0 ? sources[index]?.fields[which] : { title: name, question, yourName }[which];
    if (index >= 0 && ["creator", "publisher", "published", "isbn"].includes(which)) sources[index]?.open();
    if (target) {
      target.error = words;
      requestAnimationFrame(() => target.querySelector("input, select, textarea")?.focus());
    } else if (which === "addAnother") {
      requestAnimationFrame(() => addAnother.querySelector("button")?.focus());
    }
  }

  async function submit() {
    if (sending) return;
    const value = draft();
    const check = validateSharedReflectionDraft(value);
    if (check) { show(check.words, check.field); return; }
    sending = true;
    startButton.loading = true;
    try {
      const reply = await api.post("collaboration/publications", sharedReflectionPayload(value));
      dirty = false;
      toast(say("together.started"));
      context.go(`#/together/${encodeURIComponent(reply.publication.publicationId)}`);
    } catch (error) {
      if (error.status === 401) throw error;
      const said = togetherProblem(error, "start");
      show(said.words, said.field);
    } finally {
      sending = false;
      startButton.loading = false;
    }
  }

  return {
    title: say("together.newTitle"),
    element,
    load,
    keys: ["publish"],
    command: (id) => { if (id === "publish") submit(); },
    isDirty: () => dirty,
    async leave() {
      if (!dirty) return true;
      const choice = await ask({ heading: say("together.leaveAsk"), text: say("together.leaveText"),
        choices: [{ label: say("together.leaveStay"), value: "stay" }, { label: say("together.leaveGo"), value: "go", variant: "secondary" }] });
      return choice === "go";
    },
    focus: () => heading.focus(),
  };
}
