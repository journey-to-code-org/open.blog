// <ob-passage-feedback> turns a post's feedback region into a form for a
// question, a suggested source, a suggested correction or another
// interpretation of a passage (ADR 0082). The page is complete without it:
// the region's static text tells a reader how to send a note to the author.
//
// The passage is the whole post, a section, or words the reader selected in
// the post. A selection is mapped onto the passage text the build published
// in <script type="application/json" id="ob-passages"> (ADR 0076): the
// selected string is normalized and found in that section's build text, and
// the page's DOM is used only to tell which section the selection is in and,
// when the words occur more than once, which occurrence. The article itself is
// never changed, marked or hidden.
//
// A submission is checked by the shared validator (passage-feedback.js) and
// sent to the hosted function's /feedback route. When it cannot be sent
// (offline, the service off or failing), the reader gets the same note as
// plain text to copy and send to the author, and nothing they wrote is lost.
// Nothing is stored in the browser.
//
// Every piece of state is a private field, so nothing here can shadow one of
// HTMLElement's own properties.

import { MAX_QUOTE_CHARS, createQuoteTarget, normalizePassageText, readTarget } from "./passage-target.js";
import {
  FEEDBACK_KINDS,
  canonicalTime,
  feedbackCopyText,
  isCanonicalTime,
  isPassageRevision,
  isWorkPath,
  readFeedbackSubmissionJson,
  submissionValue,
} from "./passage-feedback.js";

export const DATA_ELEMENT_ID = "ob-passages";
export const SUPPORTED_VERSION = 1;
// Far beyond any post's passage text; anything larger is not read at all.
const MAX_DATA_LENGTH = 8_000_000;
const SEND_TIMEOUT = 20_000;
// Mail programs refuse long links; a longer note is pasted instead.
const MAX_MAIL_LINK = 1800;
// Kept clear of the viewport's edges, in CSS pixels.
const GUTTER = 8;
const GAP = 8;

const isText = (value) => typeof value === "string";
const isDigest = (value) => isText(value) && /^[0-9a-f]{32}$/.test(value);

/**
 * The page's passage data as { work, revision, sections: [{ index, anchor?,
 * title?, text, digest }] }, or null when there is none, it cannot be read,
 * or its version is newer than this component knows. Sections are named by
 * their index, so one malformed section makes the whole document unusable
 * rather than shifting the others.
 */
export function readPassages(text) {
  if (!isText(text) || text.length > MAX_DATA_LENGTH) return null;
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object" || data.version !== SUPPORTED_VERSION) return null;
  if (!isWorkPath(data.work) || !isPassageRevision(data.revision) || !Array.isArray(data.sections)) return null;
  const sections = [];
  for (const [position, section] of data.sections.entries()) {
    if (!section || typeof section !== "object" || section.index !== position) return null;
    if (!isText(section.text) || !isDigest(section.digest)) return null;
    const anchor = section.anchor ?? undefined;
    const title = section.title ?? undefined;
    if ((anchor !== undefined && (!isText(anchor) || anchor === "")) || (title !== undefined && !isText(title))) return null;
    sections.push(Object.freeze({ index: position, anchor, title, text: normalizePassageText(section.text), digest: section.digest }));
  }
  return Object.freeze({ work: data.work, revision: data.revision, sections: Object.freeze(sections) });
}

const SELECTION_PROBLEMS = Object.freeze({
  outside: "Select words inside the post’s text.",
  tooLong: `Select at most ${MAX_QUOTE_CHARS} characters, or choose the whole section instead.`,
  notFound:
    "That selection holds text the form cannot quote, such as a note marker, code, embedded content or more than one section. Select words from one paragraph, or choose the section instead.",
  ambiguous: "Those words appear more than once in this section. Select a few more words around them.",
  splitCharacter: "The selection starts or ends inside a character. Select whole words.",
});

const problem = (code) => ({ ok: false, code, message: SELECTION_PROBLEMS[code] });

/**
 * A quotation target for `selected` (the selection's text) in section
 * `index` of the build's passage text. `hint` is roughly where the selection
 * starts in that section, in characters, and only decides between equal
 * quotations; without it, a quotation found more than once is refused rather
 * than guessed. Returns { ok: true, target } or { ok: false, code, message }.
 */
export function quoteFromSelection(passages, index, selected, hint) {
  const section = passages.sections[index];
  if (!section) return problem("notFound");
  const wanted = Array.from(normalizePassageText(selected));
  if (wanted.length === 0) return problem("notFound");
  if (wanted.length > MAX_QUOTE_CHARS) return problem("tooLong");
  const chars = Array.from(section.text);
  const starts = [];
  for (let start = 0; start + wanted.length <= chars.length; start += 1) {
    if (wanted.every((character, offset) => chars[start + offset] === character)) starts.push(start);
  }
  if (starts.length === 0) return problem("notFound");
  let start = starts[0];
  if (starts.length > 1) {
    if (!Number.isFinite(hint)) return problem("ambiguous");
    const distance = (candidate) => Math.abs(candidate - hint);
    const [nearest, next] = [...starts].sort((a, b) => distance(a) - distance(b));
    if (distance(nearest) === distance(next)) return problem("ambiguous");
    start = nearest;
  }
  const made = createQuoteTarget(passages, index, start, start + wanted.length);
  if (!made.ok) return problem(made.error.code === "splitCharacter" ? "splitCharacter" : "notFound");
  return { ok: true, target: made.target };
}

const HEADINGS = "h1, h2, h3, h4, h5, h6";
// Node.DOCUMENT_POSITION_FOLLOWING; a descendant also follows its ancestor.
const FOLLOWING = 4;

const inside = (container, node) => Boolean(node && container.contains(node));

/**
 * Where a selection is in the post, read from the page only to name the
 * section (by the heading before it) and roughly where in it: { index, text,
 * hint }, or { problem } for a selection the form cannot use, or null when
 * the selection is not in the post at all (text in the form, for instance).
 */
export function locateSelection(prose, selection, passages, doc = document) {
  if (!prose || !selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  const startInside = inside(prose, range.startContainer);
  const endInside = inside(prose, range.endContainer);
  if (!startInside && !endInside) return null;
  if (!startInside || !endInside) return { problem: "outside" };
  const anchors = new Set(passages.sections.map((section) => section.anchor).filter((anchor) => anchor !== undefined));
  const headings = Array.from(prose.querySelectorAll(HEADINGS)).filter((heading) => anchors.has(heading.id));
  let heading = null;
  for (const candidate of headings) {
    if (candidate === range.startContainer || candidate.compareDocumentPosition(range.startContainer) & FOLLOWING) heading = candidate;
    else break;
  }
  let index;
  if (heading) {
    const named = passages.sections.filter((section) => section.anchor === heading.id).map((section) => section.index);
    const ordinal = headings.slice(0, headings.indexOf(heading) + 1).filter((candidate) => candidate.id === heading.id).length - 1;
    index = named[ordinal];
  } else {
    index = passages.sections.find((section) => section.anchor === undefined)?.index;
  }
  if (index === undefined) return { problem: "notFound" };
  let hint;
  if (typeof doc.createRange === "function") {
    try {
      const before = doc.createRange();
      if (heading) before.setStartBefore(heading);
      else before.setStart(prose, 0);
      before.setEnd(range.startContainer, range.startOffset);
      hint = Array.from(normalizePassageText(before.toString())).length;
    } catch {
      hint = undefined;
    }
  }
  return { index, text: selection.toString(), hint };
}

const KIND_HINTS = Object.freeze({
  question: "Ask what a passage means, how it was reached or where it comes from.",
  "source-suggestion": "Suggest a source that bears on the passage. A link to it is required.",
  "correction-suggestion": "Suggest a correction to a section or to words you selected. It stays a suggestion until the author decides.",
  "alternative-interpretation": "Offer another reading of the passage.",
});

/** What a refused submission means to the reader, and which control to fix. */
const FIELD_PROBLEMS = Object.freeze({
  invalidBody: ["body", "Write your note, in plain text of up to 4,000 characters."],
  tooLarge: ["body", "Your note is too long to send. Shorten it a little."],
  missingSource: ["source", "A suggested source needs a link to the source."],
  invalidSourceUrl: ["source", "Enter a full web address that starts with https:// or http://, without a user name or password."],
  invalidSuggestedText: ["suggested", "Write the suggested wording in plain text of up to 2,000 characters."],
  targetNotAllowed: ["passage", "A suggested correction needs a section or words you selected, not the whole post."],
  invalidTarget: ["passage", "That passage cannot be used. Choose a section, or select the words again."],
  invalidName: ["name", "Use plain text of up to 80 characters for your name."],
  consentWithoutName: ["consent", "Enter your name to have it shown, or leave this unchecked."],
});

/** A contact link the build allows: a plain mailto: address or an https: page. */
export function safeContact(value) {
  if (!isText(value)) return null;
  if (/^mailto:[A-Za-z0-9._+-]+@[A-Za-z0-9.-]+$/.test(value)) return value;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && url.hostname ? url.href : null;
  } catch {
    return null;
  }
}

/** The safe endpoint of the hosted function: an https: address without credentials. */
function safeEndpoint(value) {
  if (!isText(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
    return url.href.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

let instances = 0;

export class ObPassageFeedback extends HTMLElement {
  #listeners = null;
  #passages = null;
  #prose = null;
  #endpoint = "";
  #page = "";
  #contact = null;
  #seenAt = undefined;
  #ui = null;
  #quote = null;
  #sending = null;
  #scheduled = false;

  connectedCallback() {
    if (this.#listeners) return;
    if (!this.#ui) {
      const passages = readPassages(document.getElementById(DATA_ELEMENT_ID)?.textContent);
      const endpoint = safeEndpoint(this.getAttribute("endpoint"));
      // Without its data or an endpoint the static text stays, as without JavaScript.
      if (!passages || !endpoint) return;
      this.#passages = passages;
      this.#endpoint = endpoint;
      this.#page = this.getAttribute("page") || "";
      this.#contact = safeContact(this.getAttribute("contact"));
      const seen = canonicalTime(new Date());
      this.#seenAt = seen && isCanonicalTime(seen) ? seen : undefined;
      instances += 1;
      this.#ui = this.#build(`ob-passage-feedback-${instances}`);
      this.querySelector(".ob-passage-feedback-static")?.remove();
      this.append(this.#ui.done, this.#ui.form, this.#ui.status, this.#ui.fallback, this.#ui.selectionButton);
      this.#kindChanged();
    }
    // The form's own listeners live as long as it does; these follow the page.
    this.#prose = this.closest("article")?.querySelector(".ob-prose") ?? null;
    this.#listeners = new AbortController();
    const { signal } = this.#listeners;
    if (this.#prose) {
      document.addEventListener("selectionchange", () => this.#schedule(), { signal });
      window.addEventListener("scroll", () => this.#schedule(), { signal, passive: true });
      window.addEventListener("resize", () => this.#schedule(), { signal });
    }
  }

  disconnectedCallback() {
    this.#listeners?.abort();
    this.#listeners = null;
    this.#sending?.abort();
    this.#sending = null;
    if (this.#ui) this.#ui.selectionButton.hidden = true;
  }

  /** The form and its companions, every reader-facing string set as text. */
  #build(id) {
    const make = (tag, className, text) => {
      const element = document.createElement(tag);
      if (className) element.className = className;
      if (text !== undefined) element.textContent = text;
      return element;
    };
    const describe = (control, ...ids) => control.setAttribute("aria-describedby", ids.filter(Boolean).join(" "));
    const errorFor = (name) => {
      const error = make("p", "ob-passage-feedback-error");
      error.id = `${id}-${name}-error`;
      error.hidden = true;
      return error;
    };
    const hint = (name, text) => {
      const element = make("p", "ob-passage-feedback-hint", text);
      element.id = `${id}-${name}-hint`;
      return element;
    };
    const labelled = (control, controlId, text) => {
      control.id = controlId;
      const label = make("label", undefined, text);
      label.htmlFor = controlId;
      return label;
    };
    const choice = (control, label) => {
      const wrapper = make("div", "ob-passage-feedback-choice");
      wrapper.append(control, label);
      return wrapper;
    };

    const form = make("form", "ob-passage-feedback-form");
    form.noValidate = true;
    const alert = make("div", "ob-passage-feedback-alert");
    alert.setAttribute("role", "alert");

    // Which part of the post.
    const passage = make("fieldset", "ob-passage-feedback-passage");
    const passageError = errorFor("passage");
    const passageHint = hint("passage", "Select words in the post to quote them, or choose a section or the whole post.");
    const radio = (value) => {
      const input = make("input");
      input.type = "radio";
      input.name = `${id}-passage`;
      input.value = value;
      return input;
    };
    const work = radio("work");
    work.checked = true;
    const section = radio("section");
    const quote = radio("quote");
    quote.disabled = true;
    const sectionSelect = make("select");
    for (const item of this.#passages.sections) {
      const option = make("option", undefined, item.title || (item.anchor === undefined ? "The opening, before the first heading" : `#${item.anchor}`));
      option.value = String(item.index);
      sectionSelect.append(option);
    }
    const sectionField = make("div", "ob-passage-feedback-subfield");
    sectionField.append(labelled(sectionSelect, `${id}-section-select`, "Section"));
    sectionField.append(sectionSelect);
    if (this.#passages.sections.length === 0) {
      section.disabled = true;
      sectionSelect.disabled = true;
    }
    const quoteText = make("p", "ob-passage-feedback-quote", "No words selected yet.");
    quoteText.id = `${id}-quote-text`;
    const selectionNote = make("p", "ob-passage-feedback-hint");
    selectionNote.id = `${id}-selection-note`;
    selectionNote.hidden = true;
    describe(quote, quoteText.id);
    passage.setAttribute("aria-describedby", passageHint.id);
    passage.append(
      make("legend", undefined, "Which part of the post?"),
      passageHint,
      choice(work, labelled(work, `${id}-work`, "The whole post")),
      choice(section, labelled(section, `${id}-section`, "A section")),
      sectionField,
      choice(quote, labelled(quote, `${id}-quote`, "The words I selected")),
      quoteText,
      selectionNote,
      passageError,
    );

    // Kind, note, source and suggested wording.
    const field = (...children) => {
      const wrapper = make("div", "ob-passage-feedback-field");
      wrapper.append(...children);
      return wrapper;
    };
    const kind = make("select");
    for (const [value, rules] of Object.entries(FEEDBACK_KINDS)) {
      const option = make("option", undefined, rules.label);
      option.value = value;
      kind.append(option);
    }
    const kindHint = hint("kind", "");
    describe(kind, kindHint.id);
    const body = make("textarea");
    body.rows = 6;
    body.required = true;
    const bodyError = errorFor("body");
    const source = make("input");
    source.type = "url";
    source.autocomplete = "url";
    source.spellcheck = false;
    source.setAttribute("inputmode", "url");
    const sourceHint = hint("source", "A web address that starts with https:// or http://.");
    const sourceError = errorFor("source");
    const sourceLabel = labelled(source, `${id}-source`, "Link to a source (optional)");
    const suggested = make("textarea");
    suggested.rows = 3;
    const suggestedError = errorFor("suggested");
    const suggestedField = field(labelled(suggested, `${id}-suggested`, "Suggested wording (optional)"), suggested, suggestedError);

    // The reader's name, private unless they agree to show it.
    const attribution = make("fieldset", "ob-passage-feedback-attribution");
    const name = make("input");
    name.type = "text";
    name.autocomplete = "name";
    const nameError = errorFor("name");
    const consent = make("input");
    consent.type = "checkbox";
    const consentError = errorFor("consent");
    const nameHint = hint("name", "Leave it empty to send your note without a name. A name is kept private unless you agree below.");
    attribution.append(
      make("legend", undefined, "Your name (optional)"),
      field(labelled(name, `${id}-name`, "Name"), nameHint, name, nameError),
      choice(consent, labelled(consent, `${id}-consent`, "Show my name with this note if the author publishes it")),
      consentError,
    );

    const privacy = hint("privacy", "Your note goes to the author for review. Nothing is published unless they approve it, and no e-mail address or account is asked for.");
    const submit = make("button", undefined, "Send for review");
    submit.type = "submit";
    const actions = make("div", "ob-passage-feedback-actions");
    actions.append(submit);
    form.append(
      alert,
      passage,
      field(labelled(kind, `${id}-kind`, "Kind of feedback"), kind, kindHint),
      field(labelled(body, `${id}-body`, "Your note"), body, bodyError),
      field(sourceLabel, source, sourceHint, sourceError),
      suggestedField,
      attribution,
      privacy,
      actions,
    );

    // Outside the form, so a busy form never silences them.
    const status = make("p", "ob-passage-feedback-status");
    status.id = `${id}-status`;
    status.setAttribute("role", "status");
    const done = make("p", "ob-passage-feedback-done");
    done.id = `${id}-done`;
    done.tabIndex = -1;
    done.hidden = true;

    const fallback = make("div", "ob-passage-feedback-fallback");
    fallback.hidden = true;
    const fallbackMessage = make("p", "ob-passage-feedback-fallback-message");
    fallbackMessage.id = `${id}-fallback-message`;
    fallbackMessage.tabIndex = -1;
    const copyArea = make("textarea");
    copyArea.readOnly = true;
    copyArea.rows = 10;
    const copyButton = make("button", undefined, "Copy note");
    copyButton.type = "button";
    const fallbackActions = make("div", "ob-passage-feedback-actions");
    fallbackActions.append(copyButton);
    const contactLink = make("a", "ob-passage-feedback-contact", this.#contact?.startsWith("mailto:") ? "Write to the author" : "Open the author’s contact page");
    contactLink.hidden = !this.#contact;
    fallbackActions.append(contactLink);
    fallback.append(fallbackMessage, labelled(copyArea, `${id}-copy`, "Your note, ready to send to the author"), copyArea, fallbackActions);

    const selectionButton = make("button", "ob-passage-feedback-selection", "Give feedback on the selected words");
    selectionButton.type = "button";
    selectionButton.hidden = true;

    const errors = { passage: passageError, body: bodyError, source: sourceError, suggested: suggestedError, name: nameError, consent: consentError };
    const controls = { body, source, suggested, name, consent };
    const hints = { passage: passageHint.id, source: sourceHint.id, name: nameHint.id };
    describe(source, sourceHint.id);
    describe(name, nameHint.id);

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      this.#submit();
    });
    kind.addEventListener("change", () => this.#kindChanged());
    sectionSelect.addEventListener("change", () => {
      section.checked = true;
    });
    copyButton.addEventListener("click", () => this.#copy());
    // A press on the button must not collapse the selection it is about.
    selectionButton.addEventListener("mousedown", (event) => event.preventDefault());
    selectionButton.addEventListener("click", () => this.#useSelection());

    return {
      form, alert, passage, work, section, quote, sectionSelect, quoteText, selectionNote, kind, kindHint, body, source,
      sourceLabel, suggested, suggestedField, name, consent, submit, status, done, fallback, fallbackMessage, copyArea,
      copyButton, contactLink, selectionButton, errors, controls, hints,
    };
  }

  #kindChanged() {
    const ui = this.#ui;
    const rules = FEEDBACK_KINDS[ui.kind.value] ?? FEEDBACK_KINDS.question;
    ui.kindHint.textContent = KIND_HINTS[ui.kind.value] ?? "";
    const required = rules.sourceUrl === "required";
    ui.sourceLabel.textContent = required ? "Link to the source" : "Link to a source (optional)";
    ui.source.required = required;
    ui.suggestedField.hidden = rules.suggestedText === "notUsed";
  }

  #schedule() {
    if (this.#scheduled) return;
    this.#scheduled = true;
    const run = () => {
      this.#scheduled = false;
      if (this.#listeners) this.#capture();
    };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
    else setTimeout(run, 0);
  }

  /** Reads the current selection, keeping the last usable quotation until a new one replaces it. */
  #capture() {
    const ui = this.#ui;
    const selection = document.getSelection?.();
    const located = locateSelection(this.#prose, selection, this.#passages);
    if (!located) {
      ui.selectionButton.hidden = true;
      return;
    }
    const made = located.problem ? problem(located.problem) : quoteFromSelection(this.#passages, located.index, located.text, located.hint);
    if (!made.ok) {
      ui.selectionButton.hidden = true;
      ui.selectionNote.textContent = made.message;
      ui.selectionNote.hidden = false;
      return;
    }
    ui.selectionNote.hidden = true;
    ui.selectionNote.textContent = "";
    this.#quote = made.target;
    ui.quote.disabled = false;
    ui.quoteText.textContent = `“${made.target.exact}”`;
    this.#placeButton(selection.getRangeAt(0));
  }

  /** Shows the selection button just below the selection (or above it), inside the viewport. */
  #placeButton(range) {
    const button = this.#ui.selectionButton;
    const view = document.documentElement;
    const rect = range.getBoundingClientRect?.();
    if (!rect || !view) {
      button.hidden = true;
      return;
    }
    const width = view.clientWidth;
    const height = view.clientHeight;
    if (rect.bottom < 0 || rect.top > height) {
      button.hidden = true;
      return;
    }
    button.hidden = false;
    const box = button.getBoundingClientRect();
    let left = Math.min(Math.max(rect.left, GUTTER), width - GUTTER - box.width);
    left = Math.max(left, GUTTER);
    let top = rect.bottom + GAP;
    if (top + box.height > height - GUTTER && rect.top - GAP - box.height >= GUTTER) top = rect.top - GAP - box.height;
    top = Math.max(GUTTER, Math.min(top, height - GUTTER - box.height));
    button.style.setProperty("--ob-passage-feedback-x", `${Math.round(left)}px`);
    button.style.setProperty("--ob-passage-feedback-y", `${Math.round(top)}px`);
  }

  #useSelection() {
    const ui = this.#ui;
    if (!this.#quote) return;
    ui.quote.checked = true;
    ui.selectionButton.hidden = true;
    ui.quote.focus();
    ui.passage.scrollIntoView?.({ block: "center" });
  }

  #target() {
    const ui = this.#ui;
    if (ui.quote.checked && this.#quote) return this.#quote;
    if (ui.section.checked) {
      const item = this.#passages.sections[Number(ui.sectionSelect.value)];
      if (!item) return null;
      const value = { version: 1, kind: "section", digest: item.digest };
      if (item.anchor !== undefined) value.section = item.anchor;
      const read = readTarget(value);
      return read.ok ? read.target : null;
    }
    return { version: 1, kind: "work" };
  }

  #clearErrors() {
    const ui = this.#ui;
    ui.alert.textContent = "";
    for (const [name, error] of Object.entries(ui.errors)) {
      error.hidden = true;
      error.textContent = "";
      if (name === "passage") continue;
      const control = ui.controls[name];
      control.removeAttribute("aria-invalid");
      if (ui.hints[name]) control.setAttribute("aria-describedby", ui.hints[name]);
      else control.removeAttribute("aria-describedby");
    }
    ui.passage.setAttribute("aria-describedby", ui.hints.passage);
    for (const radio of [ui.work, ui.section, ui.quote]) radio.removeAttribute("aria-invalid");
  }

  /** Marks one control invalid, describes it with the message, announces it and moves focus there. */
  #showError(name, message) {
    const ui = this.#ui;
    const error = ui.errors[name];
    error.textContent = message;
    error.hidden = false;
    ui.alert.textContent = message;
    if (name === "passage") {
      ui.passage.setAttribute("aria-describedby", `${ui.hints.passage} ${error.id}`);
      const checked = [ui.work, ui.section, ui.quote].find((radio) => radio.checked) ?? ui.work;
      checked.setAttribute("aria-invalid", "true");
      checked.focus();
      return;
    }
    const control = ui.controls[name];
    control.setAttribute("aria-invalid", "true");
    control.setAttribute("aria-describedby", [ui.hints[name], error.id].filter(Boolean).join(" "));
    control.focus();
  }

  #submit() {
    const ui = this.#ui;
    if (this.#sending) return;
    this.#clearErrors();
    ui.done.hidden = true;
    ui.fallback.hidden = true;
    ui.status.textContent = "";
    const target = this.#target();
    if (!target) {
      this.#showError("passage", FIELD_PROBLEMS.invalidTarget[1]);
      return;
    }
    const rules = FEEDBACK_KINDS[ui.kind.value];
    const value = {
      version: 1,
      kind: ui.kind.value,
      work: this.#passages.work,
      revision: this.#passages.revision,
      target,
      body: ui.body.value,
    };
    const details = {};
    if (ui.source.value.trim() !== "") details.sourceUrl = ui.source.value.trim();
    if (rules?.suggestedText !== "notUsed" && ui.suggested.value.trim() !== "") details.suggestedText = ui.suggested.value;
    if (Object.keys(details).length) value.details = details;
    if (this.#seenAt) value.seenAt = this.#seenAt;
    const name = ui.name.value;
    if (name.trim() !== "" || ui.consent.checked) value.attribution = { name, publishName: ui.consent.checked };
    const read = readFeedbackSubmissionJson(JSON.stringify(value));
    if (!read.ok) {
      const known = FIELD_PROBLEMS[read.error.code];
      if (known) {
        this.#showError(known[0], known[1]);
        return;
      }
      this.#fallback(null, "This page’s feedback data cannot be used, so the form cannot send your note. Please write to the author instead.");
      return;
    }
    this.#send(read.submission);
  }

  async #send(submission) {
    const ui = this.#ui;
    if (globalThis.navigator?.onLine === false) {
      this.#fallback(submission, "You seem to be offline, so your note was not sent.");
      return;
    }
    const controller = new AbortController();
    this.#sending = controller;
    const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT);
    ui.form.setAttribute("aria-busy", "true");
    ui.submit.setAttribute("aria-disabled", "true");
    ui.submit.textContent = "Sending…";
    ui.status.textContent = "Sending your note…";
    let outcome;
    try {
      const response = await fetch(`${this.#endpoint}/feedback`, {
        method: "POST",
        credentials: "omit",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(submissionValue(submission)),
        signal: controller.signal,
      });
      const result = await response.json().catch(() => ({}));
      outcome = { status: response.status, code: result && typeof result === "object" ? result.code : undefined };
    } catch {
      outcome = { status: 0 };
    } finally {
      clearTimeout(timer);
      if (this.#sending === controller) this.#sending = null;
      ui.form.removeAttribute("aria-busy");
      ui.submit.removeAttribute("aria-disabled");
      ui.submit.textContent = "Send for review";
    }
    if (!this.#listeners) return;
    if (outcome.status === 202) {
      this.#succeeded();
      return;
    }
    const known = FIELD_PROBLEMS[outcome.code];
    if ((outcome.status === 422 || outcome.status === 413) && known) {
      ui.status.textContent = "";
      this.#showError(known[0], known[1]);
      return;
    }
    if (outcome.status === 403 && outcome.code === "closed") {
      ui.status.textContent = "Feedback on this post is closed, so your note was not sent.";
      return;
    }
    const reason =
      outcome.status === 0
        ? "Your note could not be sent: the feedback service did not answer."
        : outcome.status === 429
          ? "Your note was not sent: too many notes have come from here recently."
          : outcome.status === 404 || outcome.code === "unavailable"
            ? "Your note was not sent: this site is not taking feedback through the form right now."
            : "Your note could not be sent: the feedback service had a problem.";
    this.#fallback(submission, reason);
  }

  #succeeded() {
    const ui = this.#ui;
    for (const control of [ui.body, ui.source, ui.suggested]) control.value = "";
    ui.status.textContent = "Sent for review.";
    ui.done.textContent = "Thank you. Your note was sent to the author for review. Nothing is published unless they approve it.";
    ui.done.hidden = false;
    ui.done.focus();
  }

  /** The copy-and-send path: the note as plain text, a copy button and the author's contact, if any. */
  #fallback(submission, reason) {
    const ui = this.#ui;
    const nothingLost = submission
      ? " Nothing you wrote was lost: copy the note below and send it to the author."
      : "";
    ui.status.textContent = "";
    ui.fallbackMessage.textContent = `${reason}${nothingLost}`;
    ui.copyArea.value = submission ? feedbackCopyText(submission, this.#page) : "";
    const copyable = Boolean(submission);
    ui.copyArea.hidden = !copyable;
    ui.copyButton.hidden = !copyable;
    for (const label of ui.fallback.querySelectorAll("label")) label.hidden = !copyable;
    if (this.#contact) ui.contactLink.href = this.#contactHref(submission);
    ui.fallback.hidden = false;
    ui.fallbackMessage.focus();
  }

  #contactHref(submission) {
    const contact = this.#contact;
    if (!contact.startsWith("mailto:") || !submission) return contact;
    const subject = `${FEEDBACK_KINDS[submission.kind].label} about ${this.#page || submission.work}`;
    const withBody = `${contact}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(this.#ui.copyArea.value)}`;
    return withBody.length <= MAX_MAIL_LINK ? withBody : `${contact}?subject=${encodeURIComponent(subject)}`;
  }

  async #copy() {
    const ui = this.#ui;
    try {
      await globalThis.navigator.clipboard.writeText(ui.copyArea.value);
      ui.status.textContent = "Your note was copied.";
    } catch {
      ui.copyArea.focus();
      ui.copyArea.select();
      ui.status.textContent = "Your note is selected: press Control+C (or Command+C) to copy it.";
    }
  }
}

if (!customElements.get("ob-passage-feedback")) {
  customElements.define("ob-passage-feedback", ObPassageFeedback);
}
