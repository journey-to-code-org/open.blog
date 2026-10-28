// <ob-reflection-history> lets a reader keep private snapshots of how they read this post and compare an
// earlier one with a later one, entirely in their own browser (ADR 0500, docs/specs/reader-annotations.md).
// The page is complete without it: the region's static text says what it needs. Nothing is sent anywhere,
// nothing is scored or summarised, and nothing is stored until the reader saves a reading.
//
// Every snapshot is a list item, in the order the reader made them, so a keyboard or screen reader reads the
// history as a plain sequence. Choosing two of them shows them side by side where there is room and one after
// the other where there is not (the same markup, laid out by CSS). Whether the article has changed since a
// snapshot was written is told beside it; the snapshot itself is never rewritten. Every reader-facing string
// is set as text, never as markup.

import { workKey, MAX_NOTE_CHARS, MAX_TITLE_CHARS } from "./reader-annotations.js";
import { DATA_ELEMENT_ID, readPassages } from "./passage-selection.js";
import { CHANGED_EVENT, DISABLED_KEY, STORAGE_KEY, isDisabled, readStore, writeStore } from "./reader-annotations-store.js";
import { addReflection, assessReflections, relabelReflection, reflectionHistories, reflectionsOf, reviseReflection } from "./reader-reflections.js";

const STATE_WORDS = Object.freeze({
  current: "The part of the post it was about is where it was.",
  reanchored: "The part of the post it was about has moved, and the same words were found again.",
  stale: "The part of the post it was about can no longer be found.",
});
const ARTICLE_WORDS = Object.freeze({
  true: "The post has changed since you wrote this.",
  false: "The post is as you read it.",
  null: "This post's text could not be read, so it cannot be compared with what you read.",
});
const STORAGE_NOTES = Object.freeze({
  blocked: "This browser does not allow saving here, so readings are kept only until you leave this page.",
  full: "This browser has no room to save more, so your latest changes are kept only until you leave this page. Delete something to make room.",
  unreadable: "Readings saved earlier in this browser could not be read. They have been left untouched, and anything you add now is kept only until you leave this page.",
  off: "Highlights, notes and readings are turned off in this browser. Nothing new is saved. Anything saved earlier is kept until you erase it; you can turn this back on in the reading trails panel below.",
});
const PROBLEM_WORDS = Object.freeze({
  tooMany: "There is no room for another reading. Delete one first.",
  tooLarge: "This is too large to keep. Delete something first.",
  emptyText: "Write your reading first.",
  textTooLong: `A reading can hold at most ${MAX_NOTE_CHARS.toLocaleString("en-US")} characters.`,
  forbiddenCharacter: "A reading cannot hold control or text-direction characters.",
  titleTooLong: `A label can hold at most ${MAX_TITLE_CHARS} characters.`,
  alreadyRevised: "A later reading already follows that one.",
  missing: "That reading is no longer saved.",
});

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const storage = () => window.localStorage;
let instances = 0;

const when = (iso) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
};

export class ObReflectionHistory extends HTMLElement {
  #passages = null;
  #work = null;
  #document = null;
  #persistence = "saved";
  #listeners = null;
  #ui = null;
  #labelling = null;
  #focusAfter = null;
  #compare = { earlier: "", later: "" };

  connectedCallback() {
    if (this.#listeners) return;
    const passages = readPassages(document.getElementById(DATA_ELEMENT_ID)?.textContent);
    // Without the page's passage text the static text stays, as without JavaScript.
    if (!passages) return;
    this.#passages = passages;
    this.#work = { site: location.origin, path: passages.work };
    if (!this.#ui) {
      instances += 1;
      this.#ui = this.#build(`ob-reflection-history-${instances}`);
      this.querySelector(".ob-reflection-history-static")?.remove();
      this.append(this.#ui.status, this.#ui.notice, this.#ui.make, this.#ui.body);
    }
    this.#listeners = new AbortController();
    const { signal } = this.#listeners;
    window.addEventListener("storage", (event) => {
      if (event.key === null || event.key === STORAGE_KEY || event.key === DISABLED_KEY) this.#reload();
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
    if (this.#persistence === "full" && (read.status === "ok" || read.status === "empty")) {
      this.#render();
      return;
    }
    if (read.status === "unreadable") this.#persistence = "unreadable";
    else if (read.status === "blocked") this.#persistence = "blocked";
    else this.#persistence = "saved";
    if (!this.#document || read.status === "ok" || read.status === "empty") this.#document = read.document;
    this.#render();
  }

  #build(id) {
    const status = el("p", "ob-reflection-history-status");
    status.setAttribute("role", "status");
    const notice = el("p", "ob-reflection-history-notice");
    notice.hidden = true;

    const make = el("form", "ob-reflection-history-make");
    make.noValidate = true;
    const lead = el("p", "ob-reflection-history-lead", "Write how you read this post now. Each reading is saved as it is, in this browser only, and is never sent anywhere or judged. Later you can put an earlier reading beside a later one.");

    const where = el("fieldset", "ob-reflection-history-where");
    where.append(el("legend", undefined, "My reading is about"));
    const radio = (value, label, checked) => {
      const input = el("input");
      input.type = "radio";
      input.name = `${id}-where`;
      input.value = value;
      input.id = `${id}-where-${value}`;
      input.checked = Boolean(checked);
      const wrapper = el("div", "ob-reflection-history-choice");
      const text = el("label", undefined, label);
      text.htmlFor = input.id;
      wrapper.append(input, text);
      return { input, wrapper };
    };
    const work = radio("work", "The whole post", true);
    const section = radio("section", "A section");
    const sectionSelect = el("select");
    sectionSelect.id = `${id}-section-select`;
    sectionSelect.setAttribute("aria-label", "Section for the reading");
    for (const item of this.#passages.sections) {
      const option = el("option", undefined, item.title || (item.anchor === undefined ? "The opening, before the first heading" : `#${item.anchor}`));
      option.value = String(item.index);
      sectionSelect.append(option);
    }
    if (this.#passages.sections.length === 0) {
      section.input.disabled = true;
      sectionSelect.disabled = true;
    }
    where.append(work.wrapper, section.wrapper, sectionSelect);

    const labelField = el("div", "ob-reflection-history-field");
    const labelInput = el("input");
    labelInput.type = "text";
    labelInput.id = `${id}-label`;
    labelInput.maxLength = MAX_TITLE_CHARS;
    const labelLabel = el("label", undefined, "Label (optional, for you)");
    labelLabel.htmlFor = labelInput.id;
    labelField.append(labelLabel, labelInput);

    const follows = el("div", "ob-reflection-history-field");
    const followsSelect = el("select");
    followsSelect.id = `${id}-follows`;
    const followsLabel = el("label", undefined, "This reading follows");
    followsLabel.htmlFor = followsSelect.id;
    follows.append(followsLabel, followsSelect);

    const field = el("div", "ob-reflection-history-field");
    const text = el("textarea");
    text.id = `${id}-text`;
    text.rows = 5;
    text.maxLength = MAX_NOTE_CHARS;
    text.setAttribute("dir", "auto");
    const textLabel = el("label", undefined, "Your reading (private)");
    textLabel.htmlFor = text.id;
    const error = el("p", "ob-reflection-history-error");
    error.id = `${id}-error`;
    error.hidden = true;
    field.append(textLabel, text, error);

    const save = el("button", undefined, "Save this reading");
    save.type = "submit";
    make.append(lead, where, labelField, follows, field, save);

    const body = el("div", "ob-reflection-history-body");
    make.addEventListener("submit", (event) => {
      event.preventDefault();
      this.#addReading();
    });
    sectionSelect.addEventListener("focus", () => (section.input.checked = true));
    sectionSelect.addEventListener("change", () => (section.input.checked = true));
    return { id, status, notice, make, body, work, section, sectionSelect, labelInput, followsSelect, text, error };
  }

  #say(message) {
    const { status } = this.#ui;
    status.textContent = "";
    setTimeout(() => {
      status.textContent = message;
    }, 30);
  }

  #commit(change) {
    let base = this.#document;
    if (this.#persistence === "saved") {
      const read = readStore(storage);
      if (read.status === "ok" || read.status === "empty") base = read.document;
      else if (read.status === "unreadable") this.#persistence = "unreadable";
      else if (read.status === "blocked") this.#persistence = "blocked";
    }
    const result = change(base);
    if (!result.ok) return result;
    this.#document = result.document;
    if (this.#persistence === "saved" || this.#persistence === "full") {
      const written = writeStore(storage, result.document);
      this.#persistence = written.ok ? "saved" : written.reason;
      if (written.ok) window.dispatchEvent(new CustomEvent(CHANGED_EVENT, { detail: { from: this } }));
    }
    return result;
  }

  #savedWords() {
    return this.#persistence === "saved" ? "Saved in this browser." : "Kept until you leave this page.";
  }

  #addReading() {
    const ui = this.#ui;
    ui.error.hidden = true;
    ui.text.removeAttribute("aria-invalid");
    ui.text.removeAttribute("aria-describedby");
    const refuse = (message) => {
      ui.error.textContent = message;
      ui.error.hidden = false;
      ui.text.setAttribute("aria-invalid", "true");
      ui.text.setAttribute("aria-describedby", ui.error.id);
      ui.text.focus();
    };
    const text = ui.text.value;
    if (text.trim() === "") return refuse("Write your reading first.");
    let target = { version: 1, kind: "work" };
    if (ui.section.input.checked) {
      const section = this.#passages.sections[Number(ui.sectionSelect.value)];
      if (!section) return refuse("Choose a section.");
      target = { version: 1, kind: "section", digest: section.digest };
      if (section.anchor !== undefined) target = { version: 1, kind: "section", section: section.anchor, digest: section.digest };
    }
    const label = ui.labelInput.value.trim();
    const common = { revision: this.#passages.revision, target, text };
    if (label !== "") common.label = label;
    const earlier = ui.followsSelect.value;
    const result = this.#commit((document) =>
      earlier === ""
        ? addReflection(document, { work: this.#work, ...common })
        : reviseReflection(document, earlier, common));
    if (!result.ok) return refuse(PROBLEM_WORDS[result.problem.code] ?? "That reading could not be saved.");
    ui.text.value = "";
    ui.labelInput.value = "";
    this.#compare = { earlier: "", later: "" };
    this.#focusAfter = { id: result.id, control: "item" };
    this.#render();
    this.#say(`Reading saved. ${this.#savedWords()}`);
  }

  #relabel(id, value, input, error) {
    error.hidden = true;
    input.removeAttribute("aria-invalid");
    const label = value.trim();
    const result = this.#commit((document) => relabelReflection(document, id, label === "" ? undefined : label));
    if (!result.ok) {
      error.textContent = PROBLEM_WORDS[result.problem.code] ?? "That label could not be saved.";
      error.hidden = false;
      input.setAttribute("aria-invalid", "true");
      input.setAttribute("aria-describedby", error.id);
      input.focus();
      return;
    }
    this.#labelling = null;
    this.#focusAfter = { id, control: "label" };
    this.#render();
    this.#say(`Label saved. ${this.#savedWords()}`);
  }

  #title(record, number) {
    return record.label ? record.label : `Reading ${number}`;
  }

  #scope(target) {
    if (target.kind === "work") return "About the whole post";
    if (target.kind === "section") {
      const section = this.#passages.sections.find((each) => each.anchor === target.section) ?? this.#passages.sections.find((each) => each.digest === target.digest);
      return section?.title ? `About the section ${section.title}` : target.section ? `About the section #${target.section}` : "About the opening of the post";
    }
    return "About some words in the post";
  }

  #render() {
    const ui = this.#ui;
    if (isDisabled(storage)) {
      ui.notice.textContent = STORAGE_NOTES.off;
      ui.notice.hidden = false;
      ui.make.hidden = true;
      ui.body.hidden = true;
      ui.body.replaceChildren();
      return;
    }
    ui.make.hidden = false;
    ui.body.hidden = false;
    const note = STORAGE_NOTES[this.#persistence];
    ui.notice.textContent = note ?? "";
    ui.notice.hidden = !note;

    const mine = reflectionsOf(this.#document, this.#work);
    const works = { [workKey(this.#work)]: { revision: this.#passages.revision, sections: this.#passages.sections } };
    const assessed = new Map(assessReflections({ ...this.#document, reflections: mine }, works).map((each, index) => [mine[index].id, each]));
    const numbers = new Map(mine.map((record, index) => [record.id, index + 1]));

    // The reading a new one may follow: only the end of a line, since a reading is followed at most once.
    const ends = mine.filter((record) => !mine.some((each) => each.revises === record.id));
    const chosen = ui.followsSelect.value;
    ui.followsSelect.replaceChildren();
    const none = el("option", undefined, "Nothing: a new line of thought");
    none.value = "";
    ui.followsSelect.append(none);
    for (const record of ends) {
      const option = el("option", undefined, this.#title(record, numbers.get(record.id)));
      option.value = record.id;
      ui.followsSelect.append(option);
    }
    ui.followsSelect.value = ends.some((record) => record.id === chosen) ? chosen : ends.length > 0 ? ends.at(-1).id : "";

    ui.body.replaceChildren();
    if (mine.length === 0) {
      ui.body.append(el("p", "ob-reflection-history-empty", "No readings saved for this post yet."));
      this.#restoreFocus();
      return;
    }

    const histories = reflectionHistories(this.#document, this.#work);
    ui.body.append(el("h3", "ob-reflection-history-heading", "Your readings of this post"));
    histories.forEach((line, lineIndex) => {
      const group = el("div", "ob-reflection-history-line");
      if (histories.length > 1) group.append(el("h4", undefined, `Line of thought ${lineIndex + 1}`));
      const list = el("ol", "ob-reflection-history-list");
      list.setAttribute("aria-label", histories.length > 1 ? `Line of thought ${lineIndex + 1}, earliest first` : "Your readings, earliest first");
      for (const record of line) list.append(this.#item(record, assessed.get(record.id), numbers.get(record.id)));
      group.append(list);
      ui.body.append(group);
    });
    ui.body.append(this.#comparison(mine, numbers, assessed));
    this.#restoreFocus();
  }

  #item(record, state, number) {
    const ui = this.#ui;
    const item = el("li", "ob-reflection-history-item");
    item.dataset.reflection = record.id;
    item.tabIndex = -1;
    item.append(this.#summary(record, state, number, "h4"));
    const actions = el("div", "ob-reflection-history-actions");
    if (this.#labelling === record.id) {
      const input = el("input");
      input.type = "text";
      input.id = `${ui.id}-label-${record.id}`;
      input.maxLength = MAX_TITLE_CHARS;
      input.value = record.label ?? "";
      input.dataset.control = "label-input";
      const label = el("label", undefined, `Label for ${this.#title(record, number)}`);
      label.htmlFor = input.id;
      const error = el("p", "ob-reflection-history-error");
      error.id = `${input.id}-error`;
      error.hidden = true;
      const save = el("button", undefined, "Save label");
      save.type = "button";
      const cancel = el("button", undefined, "Cancel");
      cancel.type = "button";
      save.addEventListener("click", () => this.#relabel(record.id, input.value, input, error));
      cancel.addEventListener("click", () => {
        this.#labelling = null;
        this.#focusAfter = { id: record.id, control: "label" };
        this.#render();
        this.#say("Editing cancelled. Nothing changed.");
      });
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          this.#relabel(record.id, input.value, input, error);
        } else if (event.key === "Escape") cancel.click();
      });
      actions.append(label, input, error, save, cancel);
    } else {
      const edit = el("button", undefined, record.label ? "Change label" : "Add a label");
      edit.type = "button";
      edit.dataset.control = "label";
      edit.setAttribute("aria-label", `${record.label ? "Change the label of" : "Add a label to"}: ${this.#title(record, number)}`);
      edit.addEventListener("click", () => {
        this.#labelling = record.id;
        this.#focusAfter = { id: record.id, control: "label-input" };
        this.#render();
      });
      actions.append(edit);
    }
    item.append(actions);
    return item;
  }

  /** What one reading says, and where it stands against the post now. Shared by the list and the comparison. */
  #summary(record, state, number, level) {
    const box = el("div", "ob-reflection-history-reading");
    box.append(el(level, "ob-reflection-history-title", this.#title(record, number)));
    const text = el("p", "ob-reflection-history-text", record.text);
    text.setAttribute("dir", "auto");
    box.append(el("p", "ob-reflection-history-meta", `${this.#scope(record.target)}. Written ${when(record.createdAt)}.`), text);
    box.append(el("p", "ob-reflection-history-state", ARTICLE_WORDS[String(state.articleChanged)]));
    if (state.state !== "current") box.append(el("p", "ob-reflection-history-state", STATE_WORDS[state.state] ?? ""));
    return box;
  }

  #comparison(mine, numbers, assessed) {
    const ui = this.#ui;
    const section = el("section", "ob-reflection-history-compare");
    const id = `${ui.id}-compare`;
    section.setAttribute("aria-labelledby", `${id}-title`);
    const title = el("h3", undefined, "Compare two readings");
    title.id = `${id}-title`;
    section.append(title);
    if (mine.length < 2) {
      section.append(el("p", "ob-reflection-history-hint", "Save a second reading to put it beside the first."));
      return section;
    }
    const picks = el("div", "ob-reflection-history-picks");
    const select = (name, label, value) => {
      const field = el("div", "ob-reflection-history-field");
      const control = el("select");
      control.id = `${id}-${name}`;
      control.dataset.control = name;
      const empty = el("option", undefined, "Choose a reading");
      empty.value = "";
      control.append(empty);
      for (const record of mine) {
        const option = el("option", undefined, `${this.#title(record, numbers.get(record.id))} (${when(record.createdAt)})`);
        option.value = record.id;
        control.append(option);
      }
      control.value = mine.some((record) => record.id === value) ? value : "";
      const text = el("label", undefined, label);
      text.htmlFor = control.id;
      field.append(text, control);
      return { field, control };
    };
    const earlier = select("earlier", "One reading", this.#compare.earlier);
    const later = select("later", "Another reading", this.#compare.later);
    picks.append(earlier.field, later.field);
    const result = el("div", "ob-reflection-history-pair");
    result.setAttribute("role", "group");
    result.setAttribute("aria-label", "The two readings you chose");
    const draw = () => {
      this.#compare = { earlier: earlier.control.value, later: later.control.value };
      result.replaceChildren();
      const a = mine.find((record) => record.id === this.#compare.earlier);
      const b = mine.find((record) => record.id === this.#compare.later);
      if (!a || !b) {
        result.append(el("p", "ob-reflection-history-hint", "Choose two readings to see them together. Neither is marked right or wrong."));
        return;
      }
      if (a.id === b.id) {
        result.append(el("p", "ob-reflection-history-hint", "Choose two different readings."));
        return;
      }
      // Whichever was written first is shown first.
      const [first, second] = a.createdAt <= b.createdAt ? [a, b] : [b, a];
      for (const [position, record] of [["Written first", first], ["Written later", second]]) {
        const column = el("article", "ob-reflection-history-column");
        column.append(el("p", "ob-reflection-history-position", position));
        column.append(this.#summary(record, assessed.get(record.id), numbers.get(record.id), "h5"));
        result.append(column);
      }
    };
    earlier.control.addEventListener("change", draw);
    later.control.addEventListener("change", draw);
    section.append(picks, result);
    draw();
    return section;
  }

  #restoreFocus() {
    const want = this.#focusAfter;
    this.#focusAfter = null;
    if (!want) return;
    const item = Array.from(this.#ui.body.querySelectorAll("[data-reflection]")).find((each) => each.dataset.reflection === want.id);
    if (!item) return;
    const control = want.control === "item" ? item : item.querySelector(`[data-control="${want.control}"]`) ?? item.querySelector("button");
    control?.focus();
  }
}

if (typeof customElements !== "undefined" && !customElements.get("ob-reflection-history")) {
  customElements.define("ob-reflection-history", ObReflectionHistory);
}
