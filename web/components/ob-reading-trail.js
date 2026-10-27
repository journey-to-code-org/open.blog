// <ob-reading-trail> lets a reader keep saved sources and reading trails in their own browser
// (ADRs 0450 and 0455, docs/specs/reader-annotations.md). The page is complete without it: the
// region's static text says what it needs.
//
// Nothing is recorded as the reader reads. A trail is a list the reader builds by hand: sources
// they choose to save (this post, or a reference it cites) and highlights or notes they chose to
// add. Nothing is stored until the reader acts, nothing is sent anywhere, and the list says so.
//
// It reads and writes the same document as <ob-annotations> through reader-annotations-store.js, so
// every change is checked by the contract. Unlike the highlights, this panel keeps nothing in
// memory only: a change that cannot be saved is refused with the reason and nothing is altered.
// Saved data this version cannot read is never written over. Every reader-facing string is set as
// text; every link comes from validated data.

import { MAX_TITLE_CHARS } from "./reader-annotations.js";
import {
  CHANGED_EVENT,
  STORAGE_KEY,
  addTrailStep,
  annotatedWorks,
  clearStore,
  commitStore,
  createTrail,
  deleteTrail,
  deleteSource,
  deleteWorkAnnotations,
  fitTitle,
  moveTrailStep,
  readStore,
  recentTrails,
  recordById,
  removeTrailStep,
  saveSource,
} from "./reader-annotations-store.js";

const REFERENCES_ELEMENT_ID = "ob-references";
const MAX_REFERENCES_LENGTH = 1_000_000;

const NOTICES = Object.freeze({
  blocked: "This browser does not allow saving here, so sources and trails cannot be kept. Reading is not affected.",
  unreadable: "Highlights, notes or trails saved earlier in this browser could not be read. They have been left untouched and nothing here can change them, but you can clear them below.",
});
const FAILURES = Object.freeze({
  blocked: "This browser does not allow saving here, so nothing was changed.",
  full: "This browser has no room to save that, so nothing was changed. Remove something to make room.",
  unreadable: "What is saved in this browser could not be read, so nothing was changed and nothing was written over it.",
});
const PROBLEM_WORDS = Object.freeze({
  alreadySaved: "That source is already saved.",
  duplicateStep: "That is already in this trail.",
  tooMany: "There is no room for another one. Remove one first.",
  tooLarge: "That is too large to keep. Remove something first.",
  emptyText: "Write a name first.",
  textTooLong: `A name can hold at most ${MAX_TITLE_CHARS} characters.`,
  forbiddenCharacter: "A name cannot hold control or text-direction characters.",
  missing: "That is no longer saved.",
});

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const short = (text, max = 60) => {
  const chars = Array.from(text);
  return chars.length > max ? `${chars.slice(0, max).join("")}…` : text;
};

const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** A link as the contract keeps it (plain http or https, no credentials, canonical), else null. */
function canonicalLink(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password || !url.hostname) return null;
    return url.href === value ? value : url.href;
  } catch {
    return null;
  }
}

/**
 * What this page cites that a reader can save: [{ id, title, url }] from the page's own reference data. A
 * reference with an outside link is saved by that link; one without is saved as a pointer to its note in
 * this post. Anything unreadable is simply not offered.
 */
export function savableReferences(text, here) {
  if (typeof text !== "string" || text.length > MAX_REFERENCES_LENGTH) return [];
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  if (!data || typeof data !== "object" || data.version !== 1 || !Array.isArray(data.references) || !Array.isArray(data.citations)) return [];
  const notes = new Map();
  for (const citation of data.citations) {
    if (citation && typeof citation.reference === "string" && typeof citation.note === "string" && citation.note && !notes.has(citation.reference)) {
      notes.set(citation.reference, citation.note);
    }
  }
  const seen = new Set();
  const found = [];
  for (const reference of data.references) {
    if (!reference || typeof reference.id !== "string" || typeof reference.formatted !== "string") continue;
    const title = fitTitle(reference.formatted);
    if (!title) continue;
    let url = canonicalLink(reference.link);
    if (!url && notes.has(reference.id)) {
      try {
        const page = new URL(`${here.site}${here.path}`);
        page.hash = notes.get(reference.id);
        url = canonicalLink(page.href);
      } catch {
        url = null;
      }
    }
    if (!url || seen.has(url)) continue;
    seen.add(url);
    found.push({ id: reference.id, title, url });
  }
  return found;
}

const storage = () => window.localStorage;
let instances = 0;

export class ObReadingTrail extends HTMLElement {
  #listeners = null;
  #ui = null;
  #here = null;
  #document = null;
  #stored = "empty";
  #references = [];
  #confirm = null;
  #focus = null;
  #trailChoice = null;
  #fields = { trail: "", item: "" };

  connectedCallback() {
    if (this.#listeners) return;
    this.#here = { site: location.origin, path: location.pathname };
    this.#references = savableReferences(document.getElementById(REFERENCES_ELEMENT_ID)?.textContent, this.#here);
    if (!this.#ui) {
      instances += 1;
      this.#ui = { id: `ob-reading-trail-${instances}`, status: el("p", "ob-trail-status"), notice: el("p", "ob-trail-notice"), body: el("div", "ob-trail-body") };
      this.#ui.status.setAttribute("role", "status");
      this.#ui.notice.hidden = true;
      this.querySelector(".ob-reading-trail-static")?.remove();
      this.append(this.#ui.status, this.#ui.notice, this.#ui.body);
    }
    this.#listeners = new AbortController();
    const { signal } = this.#listeners;
    window.addEventListener("storage", (event) => {
      if (event.key === null || event.key === STORAGE_KEY) this.#reload();
    }, { signal });
    window.addEventListener(CHANGED_EVENT, (event) => {
      if (event.detail?.from !== this) this.#reload();
    }, { signal });
    this.#reload();
  }

  disconnectedCallback() {
    this.#listeners?.abort();
    this.#listeners = null;
  }

  #reload() {
    const read = readStore(storage);
    this.#document = read.document;
    this.#stored = read.status;
    this.#render();
  }

  #say(message) {
    const { status } = this.#ui;
    status.textContent = "";
    // A changed text is what a screen reader announces.
    setTimeout(() => {
      status.textContent = message;
    }, 30);
  }

  /**
   * Apply a change to the freshest saved document. On success the panel and the page's highlights are
   * refreshed; on failure nothing has changed and the reason is returned in the reader's words.
   */
  #apply(change, { done, focus } = {}) {
    const result = commitStore(storage, change);
    if (!result.ok) {
      const message = result.reason === "problem" ? PROBLEM_WORDS[result.problem.code] ?? "That could not be saved." : FAILURES[result.reason];
      return { ok: false, message };
    }
    this.#document = result.document;
    this.#stored = "ok";
    this.#confirm = null;
    this.#focus = focus ?? null;
    this.#render();
    window.dispatchEvent(new CustomEvent(CHANGED_EVENT, { detail: { from: this } }));
    if (done) this.#say(done);
    return result;
  }

  #fail(message) {
    this.#confirm = null;
    this.#render();
    this.#say(message);
  }

  #heading(text, id) {
    const heading = el("h3", "ob-trail-heading", text);
    heading.id = id;
    heading.tabIndex = -1;
    heading.dataset.focus = id;
    return heading;
  }

  #render() {
    const ui = this.#ui;
    const document_ = this.#document;
    const note = NOTICES[this.#stored];
    ui.notice.textContent = note ?? "";
    ui.notice.hidden = !note;
    const children = [
      el("p", "ob-trail-lead", "Nothing is recorded as you read. Saved sources and trails hold only what you choose to add, are kept in this browser and are never sent anywhere."),
      this.#sources(document_),
      this.#works(document_),
      this.#trails(document_),
      this.#clear(),
    ];
    ui.body.replaceChildren(...children);
    this.#restoreFocus();
  }

  #restoreFocus() {
    const want = this.#focus;
    this.#focus = null;
    if (!want) return;
    const candidates = Array.isArray(want) ? want : [want];
    for (const key of candidates) {
      const target = Array.from(this.#ui.body.querySelectorAll("[data-focus]")).find((node) => node.dataset.focus === key);
      if (target) {
        target.focus();
        return;
      }
    }
  }

  /** A button that asks first: the first press shows "Confirm" and "Keep it", the confirm does the work. */
  #danger({ key, label, name, confirmLabel, onConfirm }) {
    const actions = el("span", "ob-trail-actions");
    if (this.#confirm === key) {
      const yes = el("button", undefined, confirmLabel);
      yes.type = "button";
      yes.dataset.focus = `${key}:confirm`;
      yes.setAttribute("aria-label", `${confirmLabel}: ${name}`);
      const keep = el("button", undefined, "Keep it");
      keep.type = "button";
      yes.addEventListener("click", onConfirm);
      keep.addEventListener("click", () => {
        this.#confirm = null;
        this.#focus = `${key}:ask`;
        this.#render();
        this.#say("Nothing was changed.");
      });
      actions.append(yes, keep);
    } else {
      const ask = el("button", undefined, label);
      ask.type = "button";
      ask.dataset.focus = `${key}:ask`;
      ask.setAttribute("aria-label", `${label}: ${name}`);
      ask.addEventListener("click", () => {
        this.#confirm = key;
        this.#focus = `${key}:confirm`;
        this.#render();
      });
      actions.append(ask);
    }
    return actions;
  }

  #workLink(work, text) {
    const link = el("a", undefined, text ?? work.path);
    link.href = `${work.site}${work.path}`;
    return link;
  }

  #isHere(work) {
    return work.site === this.#here.site && work.path === this.#here.path;
  }

  #describe(record) {
    if (record.kind === "source") return `Source: ${short(record.title, 60)}`;
    const words = record.target.kind === "quote" ? record.target.exact : record.text ?? "the whole post";
    return `${record.kind === "note" ? "Note" : "Highlight"}: ${short(record.text !== undefined && record.target.kind === "quote" ? `${record.target.exact} (${record.text})` : words, 60)}`;
  }

  #sources(document_) {
    const section = el("section", "ob-trail-section");
    section.setAttribute("aria-labelledby", `${this.#ui.id}-sources`);
    section.append(this.#heading("Saved sources", `${this.#ui.id}-sources`));

    const pageTitle = fitTitle(this.closest("article")?.querySelector("h1")?.textContent || document.title);
    const form = el("form", "ob-trail-form");
    form.noValidate = true;
    const error = el("p", "ob-trail-error");
    error.id = `${this.#ui.id}-source-error`;
    error.hidden = true;
    const savePost = el("button", undefined, "Save this post as a source");
    savePost.type = "button";
    savePost.dataset.focus = "save-post";
    savePost.setAttribute("aria-describedby", error.id);
    const refuse = (message) => {
      error.textContent = message;
      error.hidden = false;
    };
    savePost.addEventListener("click", () => {
      const result = this.#apply((current) => saveSource(current, { title: pageTitle || this.#here.path, work: this.#here }), {
        done: "This post is saved as a source.",
        focus: "save-post",
      });
      if (!result.ok) {
        refuse(result.message);
        this.#say(result.message);
      }
    });
    form.append(savePost);

    if (this.#references.length > 0) {
      const field = el("div", "ob-trail-field");
      const select = el("select");
      select.id = `${this.#ui.id}-reference`;
      const label = el("label", undefined, "A reference this post cites");
      label.htmlFor = select.id;
      for (const reference of this.#references) {
        const option = el("option", undefined, short(reference.title, 110));
        option.value = reference.url;
        select.append(option);
      }
      select.setAttribute("aria-describedby", error.id);
      const save = el("button", undefined, "Save the reference");
      save.type = "button";
      save.dataset.focus = "save-reference";
      save.setAttribute("aria-describedby", error.id);
      save.addEventListener("click", () => {
        const reference = this.#references.find((each) => each.url === select.value);
        if (!reference) return;
        const result = this.#apply((current) => saveSource(current, { title: reference.title, url: reference.url, from: this.#here }), {
          done: `Saved the source: ${short(reference.title)}.`,
          focus: "save-reference",
        });
        if (!result.ok) {
          refuse(result.message);
          this.#say(result.message);
        }
      });
      field.append(label, select, save);
      form.append(field);
    }
    form.append(error);
    form.addEventListener("submit", (event) => event.preventDefault());
    section.append(form);

    const list = el("ul", "ob-trail-list");
    list.setAttribute("aria-label", "Your saved sources");
    for (const source of document_.sources) list.append(this.#sourceItem(source));
    if (document_.sources.length === 0) section.append(el("p", "ob-trail-empty", "No sources saved yet."));
    else section.append(list);
    return section;
  }

  #sourceItem(source) {
    const item = el("li", "ob-trail-item");
    item.dataset.record = source.id;
    const link = source.url !== undefined ? el("a", undefined, source.title) : this.#workLink(source.work, source.title);
    if (source.url !== undefined) {
      link.href = source.url;
      link.rel = "noopener noreferrer";
    }
    const title = el("p", "ob-trail-title");
    title.append(link);
    item.append(title);
    const where = el("p", "ob-trail-meta");
    if (source.url !== undefined) {
      let host = source.url;
      try {
        host = new URL(source.url).host;
      } catch {
        // The contract has checked the link; the host is only a courtesy.
      }
      where.append(`Link to ${host}`);
      if (source.from) {
        where.append(" · Found in ");
        where.append(this.#workLink(source.from, this.#isHere(source.from) ? "this post" : source.from.path));
      }
    } else {
      where.append("A post");
    }
    item.append(where);
    item.append(
      this.#danger({
        key: `source:${source.id}`,
        label: "Remove",
        name: short(source.title),
        confirmLabel: "Confirm remove",
        onConfirm: () => {
          const result = this.#apply((current) => deleteSource(current, source.id), { done: "The source was removed.", focus: ["save-post"] });
          if (!result.ok) this.#fail(result.message);
        },
      }),
    );
    return item;
  }

  #works(document_) {
    const section = el("section", "ob-trail-section");
    section.setAttribute("aria-labelledby", `${this.#ui.id}-works`);
    section.append(this.#heading("Posts you have marked", `${this.#ui.id}-works`));
    const works = annotatedWorks(document_);
    if (works.length === 0) {
      section.append(el("p", "ob-trail-empty", "You have not highlighted or noted anything yet."));
      return section;
    }
    const list = el("ul", "ob-trail-list");
    list.setAttribute("aria-label", "Posts you have highlighted or noted");
    for (const entry of works) {
      const item = el("li", "ob-trail-item");
      const title = el("p", "ob-trail-title");
      title.append(this.#workLink(entry.work, this.#isHere(entry.work) ? `${entry.work.path} (this post)` : `${entry.work.site}${entry.work.path}`));
      const counts = [];
      if (entry.highlights) counts.push(plural(entry.highlights, "highlight"));
      if (entry.notes) counts.push(plural(entry.notes, "note"));
      item.append(title, el("p", "ob-trail-meta", counts.join(", ")));
      const key = `work:${entry.work.site}${entry.work.path}`;
      item.append(
        this.#danger({
          key,
          label: "Remove these highlights and notes",
          name: entry.work.path,
          confirmLabel: "Confirm remove",
          onConfirm: () => {
            const result = this.#apply((current) => deleteWorkAnnotations(current, entry.work), {
              done: `Removed ${counts.join(" and ")} on ${entry.work.path}.`,
              focus: [`${this.#ui.id}-works`],
            });
            if (!result.ok) this.#fail(result.message);
          },
        }),
      );
      list.append(item);
    }
    section.append(list);
    return section;
  }

  #trails(document_) {
    const section = el("section", "ob-trail-section");
    const headingId = `${this.#ui.id}-trails`;
    section.setAttribute("aria-labelledby", headingId);
    section.append(this.#heading("Your reading trails", headingId));
    section.append(el("p", "ob-trail-hint", "A trail is an ordered list you build yourself from saved sources and your highlights and notes."));

    const make = el("form", "ob-trail-form");
    make.noValidate = true;
    const field = el("div", "ob-trail-field");
    const input = el("input");
    input.type = "text";
    input.id = `${this.#ui.id}-trail-name`;
    input.maxLength = MAX_TITLE_CHARS;
    input.autocomplete = "off";
    input.value = this.#fields.name ?? "";
    input.addEventListener("input", () => (this.#fields.name = input.value));
    const label = el("label", undefined, "Name a new trail");
    label.htmlFor = input.id;
    const error = el("p", "ob-trail-error");
    error.id = `${this.#ui.id}-trail-error`;
    error.hidden = true;
    const start = el("button", undefined, "Start the trail");
    start.type = "submit";
    field.append(label, input, start);
    make.append(field, error);
    make.addEventListener("submit", (event) => {
      event.preventDefault();
      error.hidden = true;
      input.removeAttribute("aria-invalid");
      input.removeAttribute("aria-describedby");
      const title = fitTitle(input.value);
      const refuse = (message) => {
        error.textContent = message;
        error.hidden = false;
        input.setAttribute("aria-invalid", "true");
        input.setAttribute("aria-describedby", error.id);
        input.focus();
      };
      if (title === "") return refuse("Write a name for the trail first.");
      const result = this.#apply((current) => createTrail(current, { title }), { done: `Started the trail: ${short(title)}.`, focus: "trail-name" });
      if (!result.ok) return refuse(result.message);
      this.#fields.name = "";
      this.#trailChoice = result.id;
      this.#focus = "trail-name";
      this.#render();
    });
    input.dataset.focus = "trail-name";
    section.append(make);

    if (document_.trails.length > 0 && document_.sources.length + document_.annotations.length > 0) section.append(this.#addForm(document_));

    const trails = recentTrails(document_);
    if (trails.length === 0) {
      section.append(el("p", "ob-trail-empty", "No trails yet."));
      return section;
    }
    const list = el("ul", "ob-trail-list");
    list.setAttribute("aria-label", "Your trails, most recently changed first");
    for (const trail of trails) list.append(this.#trailItem(document_, trail));
    section.append(list);
    return section;
  }

  #addForm(document_) {
    const form = el("form", "ob-trail-form");
    form.noValidate = true;
    const id = this.#ui.id;
    const trailField = el("div", "ob-trail-field");
    const trailSelect = el("select");
    trailSelect.id = `${id}-add-trail`;
    const trailLabel = el("label", undefined, "Add to the trail");
    trailLabel.htmlFor = trailSelect.id;
    const trails = recentTrails(document_);
    for (const trail of trails) {
      const option = el("option", undefined, trail.title);
      option.value = trail.id;
      trailSelect.append(option);
    }
    if (this.#trailChoice && trails.some((trail) => trail.id === this.#trailChoice)) trailSelect.value = this.#trailChoice;
    trailField.append(trailLabel, trailSelect);

    const itemField = el("div", "ob-trail-field");
    const itemSelect = el("select");
    itemSelect.id = `${id}-add-item`;
    const itemLabel = el("label", undefined, "This source, highlight or note");
    itemLabel.htmlFor = itemSelect.id;
    itemField.append(itemLabel, itemSelect);

    const error = el("p", "ob-trail-error");
    error.id = `${id}-add-error`;
    error.hidden = true;
    const add = el("button", undefined, "Add to the trail");
    add.type = "submit";
    add.setAttribute("aria-describedby", error.id);

    const fill = () => {
      this.#trailChoice = trailSelect.value;
      const trail = document_.trails.find((each) => each.id === trailSelect.value);
      const inTrail = new Set(trail ? trail.steps.map((step) => step.ref) : []);
      itemSelect.replaceChildren();
      const group = (labelText, records) => {
        const wanted = records.filter((record) => !inTrail.has(record.id));
        if (wanted.length === 0) return;
        const optgroup = el("optgroup");
        optgroup.label = labelText;
        for (const record of wanted) {
          const option = el("option", undefined, this.#describe(record));
          option.value = record.id;
          optgroup.append(option);
        }
        itemSelect.append(optgroup);
      };
      group("Saved sources", document_.sources);
      group("Highlights and notes", document_.annotations);
      add.disabled = itemSelect.options.length === 0;
      if (itemSelect.options.length === 0) {
        const none = el("option", undefined, "Everything saved is already in this trail");
        none.value = "";
        itemSelect.append(none);
      }
    };
    trailSelect.addEventListener("change", fill);
    fill();
    form.append(trailField, itemField, add, error);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      error.hidden = true;
      if (!itemSelect.value) return;
      const ref = itemSelect.value;
      const trailId = trailSelect.value;
      const record = recordById(document_, ref);
      const result = this.#apply((current) => addTrailStep(current, trailId, ref), {
        done: `Added to the trail: ${short(record ? this.#describe(record) : "")}.`,
        focus: ["add-item", "add-trail"],
      });
      if (!result.ok) {
        error.textContent = result.message;
        error.hidden = false;
        this.#say(result.message);
      } else {
        this.#trailChoice = trailId;
      }
    });
    itemSelect.dataset.focus = "add-item";
    trailSelect.dataset.focus = "add-trail";
    return form;
  }

  #stepLabel(record) {
    if (record.kind === "source") {
      const link = el("a", undefined, record.title);
      if (record.url !== undefined) {
        link.href = record.url;
        link.rel = "noopener noreferrer";
      } else {
        link.href = `${record.work.site}${record.work.path}`;
      }
      return { kind: "Source", node: link, plain: record.title };
    }
    const quoted = record.target.kind === "quote";
    const words = quoted ? record.target.exact : record.target.kind === "section" ? "A section" : "The whole post";
    const shown = short(record.text !== undefined && !quoted ? record.text : words, 100);
    const link = this.#workLink(record.work, shown);
    return { kind: record.kind === "note" ? "Note" : "Highlight", node: link, plain: shown, work: record.work };
  }

  #trailItem(document_, trail) {
    const item = el("li", "ob-trail-item");
    item.dataset.record = trail.id;
    const title = el("h4", "ob-trail-title", trail.title);
    item.append(title);
    item.append(el("p", "ob-trail-meta", plural(trail.steps.length, "step")));
    if (trail.steps.length === 0) {
      item.append(el("p", "ob-trail-empty", "Nothing in this trail yet."));
    } else {
      const steps = el("ol", "ob-trail-steps");
      steps.setAttribute("aria-label", `Steps of ${short(trail.title, 60)}`);
      trail.steps.forEach((step, position) => {
        const record = recordById(document_, step.ref);
        if (!record) return;
        const label = this.#stepLabel(record);
        const row = el("li", "ob-trail-step");
        const text = el("p", "ob-trail-title");
        text.append(`${label.kind}: `, label.node);
        row.append(text);
        if (label.work) row.append(el("p", "ob-trail-meta", this.#isHere(label.work) ? "In this post" : `In ${label.work.site}${label.work.path}`));
        const name = short(label.plain, 50);
        const actions = el("div", "ob-trail-actions");
        const key = `step:${trail.id}:${step.ref}`;
        const mover = (direction, text_, disabled) => {
          const button = el("button", undefined, text_);
          button.type = "button";
          button.dataset.focus = `${key}:${direction}`;
          button.setAttribute("aria-label", `${text_}: ${name}`);
          button.disabled = disabled;
          button.addEventListener("click", () => {
            const result = this.#apply((current) => moveTrailStep(current, trail.id, step.ref, direction === "up" ? -1 : 1), {
              done: `Moved ${direction === "up" ? "earlier" : "later"}, to step ${position + (direction === "up" ? 0 : 2)} of ${trail.steps.length}.`,
              focus: [`${key}:${direction}`, `${key}:${direction === "up" ? "down" : "up"}`],
            });
            if (!result.ok) this.#fail(result.message);
          });
          return button;
        };
        const remove = el("button", undefined, "Remove from the trail");
        remove.type = "button";
        remove.dataset.focus = `${key}:remove`;
        remove.setAttribute("aria-label", `Remove from the trail: ${name}`);
        remove.addEventListener("click", () => {
          const next = trail.steps[position + 1] ?? trail.steps[position - 1];
          const result = this.#apply((current) => removeTrailStep(current, trail.id, step.ref), {
            done: "Removed from the trail. The source, highlight or note itself is kept.",
            focus: [next ? `step:${trail.id}:${next.ref}:remove` : `trail:${trail.id}:ask`, `${this.#ui.id}-trails`],
          });
          if (!result.ok) this.#fail(result.message);
        });
        actions.append(mover("up", "Move earlier", position === 0), mover("down", "Move later", position === trail.steps.length - 1), remove);
        row.append(actions);
        steps.append(row);
      });
      item.append(steps);
    }
    item.append(
      this.#danger({
        key: `trail:${trail.id}`,
        label: "Delete the trail",
        name: short(trail.title, 50),
        confirmLabel: "Confirm delete",
        onConfirm: () => {
          const result = this.#apply((current) => deleteTrail(current, trail.id), {
            done: "The trail was deleted. Its sources, highlights and notes are kept.",
            focus: ["trail-name"],
          });
          if (!result.ok) this.#fail(result.message);
        },
      }),
    );
    return item;
  }

  #clear() {
    const section = el("section", "ob-trail-section");
    section.setAttribute("aria-labelledby", `${this.#ui.id}-clear`);
    section.append(this.#heading("Clear everything", `${this.#ui.id}-clear`));
    section.append(
      el("p", "ob-trail-hint", "This removes every highlight, note, saved source and trail kept by this site in this browser, including anything this page could not read. It cannot be undone; export first if you want a copy."),
    );
    section.append(
      this.#danger({
        key: "clear-all",
        label: "Clear all my local data",
        name: "highlights, notes, sources and trails in this browser",
        confirmLabel: "Confirm clear everything",
        onConfirm: () => {
          const result = clearStore(storage);
          if (!result.ok) return this.#fail("This browser would not let the saved data be cleared, so nothing was changed.");
          this.#confirm = null;
          this.#focus = [`${this.#ui.id}-clear`];
          this.#reload();
          window.dispatchEvent(new CustomEvent(CHANGED_EVENT, { detail: { from: this } }));
          this.#say("Everything was cleared from this browser.");
        },
      }),
    );
    return section;
  }
}

if (typeof customElements !== "undefined" && !customElements.get("ob-reading-trail")) {
  customElements.define("ob-reading-trail", ObReadingTrail);
}
