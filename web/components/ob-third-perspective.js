// <ob-third-perspective> turns a post's Third Perspective region into a form for a reader's own
// reflection on the work (ADR 0114). The page is complete without it: the region's static text
// tells a reader how to write to the author instead.
//
// A reflection is about the whole work or one section, may take one of the optional prompt
// categories (never a score, a vote or a side), and carries the reader's explicit consent: whether
// it may be published once a moderator approves it, whether their name may be shown, and whether
// they may be asked to clarify it. Nothing is assumed: publication is a choice the reader makes
// before anything is sent, and choosing not to publish keeps the reflection on the page, ready to
// copy and send privately.
//
// A submission is checked by the shared validator (third-perspective.js) and sent to the hosted
// function's /feedback route only where the site says the service issues receipts, because a
// reader must always be able to take a published reflection back. When it cannot be sent
// (offline, the service off or failing), the reader can try again or copy the reflection, and
// nothing they wrote is lost. Nothing is stored in the browser and nothing is e-mailed.
//
// Every piece of state is a private field, so nothing here can shadow one of HTMLElement's own
// properties.

import { normalizePassageText } from "./passage-target.js";
import {
  MAX_BODY_CHARS,
  RESPONSE_CATEGORIES,
  isCanonicalTime,
  isPassageRevision,
  isWorkPath,
  readThirdPerspectiveSubmissionJson,
  thirdPerspectiveCopyText,
  thirdPerspectiveSubmissionValue,
} from "./third-perspective.js";
import { isReceipt, receiptManager, receiptPanel } from "./feedback-receipt.js";

export const DATA_ELEMENT_ID = "ob-passages";
const SUPPORTED_VERSION = 1;
const MAX_DATA_LENGTH = 8_000_000;
const SEND_TIMEOUT = 20_000;
// Mail programs refuse long links; a longer reflection is pasted instead.
const MAX_MAIL_LINK = 1800;

const isText = (value) => typeof value === "string";
const isDigest = (value) => isText(value) && /^[0-9a-f]{32}$/.test(value);

/**
 * The page's passage data as { work, revision, sections: [{ index, anchor?, title?, digest }] },
 * or null when there is none, it cannot be read, or its version is newer than this component
 * knows. A Third Perspective needs only each section's name and digest, never its text.
 */
export function readSections(text) {
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
    if (!section || typeof section !== "object" || section.index !== position || !isDigest(section.digest)) return null;
    const anchor = section.anchor ?? undefined;
    const title = section.title ?? undefined;
    if ((anchor !== undefined && (!isText(anchor) || anchor === "")) || (title !== undefined && !isText(title))) return null;
    sections.push(Object.freeze({ index: position, anchor, title: title === undefined ? undefined : normalizePassageText(title), digest: section.digest }));
  }
  return Object.freeze({ work: data.work, revision: data.revision, sections: Object.freeze(sections) });
}

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

/** What a refused submission means to the reader, and which control to fix. */
const FIELD_PROBLEMS = Object.freeze({
  publication: ["publication", "Choose whether your reflection may be published."],
  invalidBody: ["body", `Write your reflection, in plain text of up to ${MAX_BODY_CHARS.toLocaleString("en")} characters.`],
  tooLarge: ["body", "Your reflection is too long to send. Shorten it a little."],
  invalidTarget: ["about", "That section cannot be used. Choose another section, or the whole work."],
  targetNotAllowed: ["about", "Choose the whole work or a section."],
  unknownCategory: ["category", "Choose one of the prompts, or none."],
  invalidName: ["name", "Use plain text of up to 80 characters for your name."],
  consentWithoutName: ["showName", "Enter your name to have it shown, or leave this unchecked."],
});

let instances = 0;

export class ObThirdPerspective extends HTMLElement {
  #passages = null;
  #endpoint = "";
  #page = "";
  #contact = null;
  #hosted = false;
  #seenAt = undefined;
  #ui = null;
  #sending = null;
  #connected = false;
  #receipt = null;
  #pending = null;

  connectedCallback() {
    this.#connected = true;
    if (this.#ui) return;
    const passages = readSections(document.getElementById(DATA_ELEMENT_ID)?.textContent);
    const endpoint = safeEndpoint(this.getAttribute("endpoint"));
    // Without its data or an endpoint the static text stays, as without JavaScript.
    if (!passages || !endpoint) return;
    this.#passages = passages;
    this.#endpoint = endpoint;
    this.#page = this.getAttribute("page") || "";
    this.#contact = safeContact(this.getAttribute("contact"));
    // A hosted copy always has a receipt, so the form sends only where receipts are issued.
    this.#hosted = this.hasAttribute("receipts");
    const seen = new Date().toISOString().replace(/\.[0-9]{3}Z$/, "Z");
    this.#seenAt = isCanonicalTime(seen) ? seen : undefined;
    instances += 1;
    this.#ui = this.#build(`ob-third-perspective-${instances}`);
    this.querySelector(".ob-third-perspective-static")?.remove();
    this.append(this.#ui.done, this.#ui.form, this.#ui.status, this.#ui.fallback);
    if (this.#hosted) this.append(receiptManager({ endpoint, noun: "reflection" }));
  }

  disconnectedCallback() {
    this.#connected = false;
    this.#sending?.abort();
    this.#sending = null;
  }

  /** The form and its companions, every reader-facing string set as text. */
  #build(id) {
    const make = (tag, className, text) => {
      const element = document.createElement(tag);
      if (className) element.className = className;
      if (text !== undefined) element.textContent = text;
      return element;
    };
    const errorFor = (name) => {
      const error = make("p", "ob-third-perspective-error");
      error.id = `${id}-${name}-error`;
      error.hidden = true;
      return error;
    };
    const hint = (name, text) => {
      const element = make("p", "ob-third-perspective-hint", text);
      element.id = `${id}-${name}-hint`;
      return element;
    };
    const labelled = (control, controlId, text) => {
      control.id = controlId;
      const label = make("label", undefined, text);
      label.htmlFor = controlId;
      return label;
    };
    const choice = (control, label, description) => {
      const wrapper = make("div", "ob-third-perspective-choice");
      wrapper.append(control, label);
      if (description) wrapper.append(description);
      return wrapper;
    };
    const radio = (group, value) => {
      const input = make("input");
      input.type = "radio";
      input.name = `${id}-${group}`;
      input.value = value;
      return input;
    };
    const field = (...children) => {
      const wrapper = make("div", "ob-third-perspective-field");
      wrapper.append(...children);
      return wrapper;
    };

    const form = make("form", "ob-third-perspective-form");
    form.noValidate = true;
    const alert = make("div", "ob-third-perspective-alert");
    alert.setAttribute("role", "alert");

    // What it is about.
    const about = make("fieldset", "ob-third-perspective-about");
    const aboutError = errorFor("about");
    const work = radio("about", "work");
    work.checked = true;
    const section = radio("about", "section");
    const sectionSelect = make("select");
    for (const item of this.#passages.sections) {
      const option = make("option", undefined, item.title || (item.anchor === undefined ? "The opening, before the first heading" : `#${item.anchor}`));
      option.value = String(item.index);
      sectionSelect.append(option);
    }
    const sectionField = make("div", "ob-third-perspective-subfield");
    sectionField.append(labelled(sectionSelect, `${id}-section-select`, "Section"), sectionSelect);
    if (this.#passages.sections.length === 0) {
      section.disabled = true;
      sectionSelect.disabled = true;
    }
    about.append(
      make("legend", undefined, "What is it about?"),
      choice(work, labelled(work, `${id}-work`, "The whole work")),
      choice(section, labelled(section, `${id}-section`, "One section")),
      sectionField,
      aboutError,
    );

    // An optional prompt: a description of the thought, never a rating.
    const category = make("fieldset", "ob-third-perspective-category");
    const categoryHint = hint("category", "Optional. A prompt only describes what kind of thought it is; there are no ratings, votes or sides.");
    category.setAttribute("aria-describedby", categoryHint.id);
    const categoryError = errorFor("category");
    const none = radio("category", "");
    none.checked = true;
    const categories = [none];
    const categoryChoices = [choice(none, labelled(none, `${id}-category-none`, "No prompt"))];
    for (const entry of RESPONSE_CATEGORIES) {
      const input = radio("category", entry.id);
      const description = hint(`category-${entry.id}`, entry.prompt);
      input.setAttribute("aria-describedby", description.id);
      categories.push(input);
      categoryChoices.push(choice(input, labelled(input, `${id}-category-${entry.id}`, entry.label), description));
    }
    category.append(make("legend", undefined, "A prompt (optional)"), categoryHint, ...categoryChoices, categoryError);

    // The reflection itself.
    const body = make("textarea");
    body.rows = 8;
    body.required = true;
    const bodyHint = hint("body", `Plain text, up to ${MAX_BODY_CHARS.toLocaleString("en")} characters. It is never shown as one of the authors’ perspectives.`);
    const bodyError = errorFor("body");

    // Publication: an explicit choice, never assumed.
    const publication = make("fieldset", "ob-third-perspective-publication");
    const publicationHint = hint("publication", "Nothing is published unless you choose yes and a moderator approves this exact text.");
    publication.setAttribute("aria-describedby", publicationHint.id);
    const publicationError = errorFor("publication");
    const publishYes = radio("publish", "yes");
    const publishNo = radio("publish", "no");
    publication.append(
      make("legend", undefined, "May it be published?"),
      publicationHint,
      choice(publishYes, labelled(publishYes, `${id}-publish-yes`, "Yes, publish it on this page if a moderator approves it")),
      choice(publishNo, labelled(publishNo, `${id}-publish-no`, "No, it is only for the author")),
      publicationError,
    );

    // The reader's name, hidden unless they ask to show it.
    const identity = make("fieldset", "ob-third-perspective-identity");
    const name = make("input");
    name.type = "text";
    name.autocomplete = "name";
    const nameHint = hint("name", "Optional. Leave it empty to stay anonymous. A name you give is seen by moderators and shown only if you check the box below.");
    const nameError = errorFor("name");
    const showName = make("input");
    showName.type = "checkbox";
    const showNameError = errorFor("showName");
    const recordHint = hint("record", "A name that is published becomes part of the site’s public record: you can withdraw it later, but copies already published may remain.");
    identity.append(
      make("legend", undefined, "Your name (optional)"),
      field(labelled(name, `${id}-name`, "Name"), nameHint, name, nameError),
      choice(showName, labelled(showName, `${id}-show-name`, "Show my name with my reflection if it is published"), recordHint),
      showNameError,
    );

    // Permission to be asked to clarify, through the reader's private receipt.
    const clarification = make("input");
    clarification.type = "checkbox";
    const clarificationHint = hint("clarification", "A moderator may ask you, through the private receipt you get after sending, to make it clearer. Nothing is e-mailed.");
    clarification.setAttribute("aria-describedby", clarificationHint.id);

    const privacy = hint("privacy", this.#hosted
      ? "It goes to a moderator for review, and is never published without your yes and their approval. No account or e-mail address is asked for; keep the receipt you get to check on it or take it back."
      : "This site does not take reflections through the form: when you are ready, your reflection is prepared for you to copy and send to the author.");
    const submit = make("button", undefined, this.#hosted ? "Send for review" : "Prepare to send to the author");
    submit.type = "submit";
    const actions = make("div", "ob-third-perspective-actions");
    actions.append(submit);
    form.append(
      alert,
      about,
      category,
      field(labelled(body, `${id}-body`, "Your reflection"), bodyHint, body, bodyError),
      publication,
      identity,
      choice(clarification, labelled(clarification, `${id}-clarification`, "You may ask me to clarify it"), clarificationHint),
      privacy,
      actions,
    );

    // Outside the form, so a busy form never silences them.
    const status = make("p", "ob-third-perspective-status");
    status.setAttribute("role", "status");
    const done = make("p", "ob-third-perspective-done");
    done.tabIndex = -1;
    done.hidden = true;

    const fallback = make("div", "ob-third-perspective-fallback");
    fallback.hidden = true;
    const fallbackMessage = make("p", "ob-third-perspective-fallback-message");
    fallbackMessage.tabIndex = -1;
    const copyArea = make("textarea");
    copyArea.readOnly = true;
    copyArea.rows = 10;
    const copyLabel = labelled(copyArea, `${id}-copy`, "Your reflection, ready to send to the author");
    const retry = make("button", undefined, "Try again");
    retry.type = "button";
    retry.hidden = true;
    const copyButton = make("button", undefined, "Copy reflection");
    copyButton.type = "button";
    const contactLink = make("a", "ob-third-perspective-contact", this.#contact?.startsWith("mailto:") ? "Write to the author" : "Open the author’s contact page");
    contactLink.hidden = !this.#contact;
    const fallbackActions = make("div", "ob-third-perspective-actions");
    fallbackActions.append(retry, copyButton, contactLink);
    fallback.append(fallbackMessage, copyLabel, copyArea, fallbackActions);

    const errors = { about: aboutError, category: categoryError, body: bodyError, publication: publicationError, name: nameError, showName: showNameError };
    const controls = { body, name, showName };
    const hints = { body: bodyHint.id, name: nameHint.id, showName: recordHint.id };
    showName.setAttribute("aria-describedby", recordHint.id);
    body.setAttribute("aria-describedby", bodyHint.id);
    name.setAttribute("aria-describedby", nameHint.id);

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      this.#submit();
    });
    sectionSelect.addEventListener("change", () => {
      section.checked = true;
    });
    copyButton.addEventListener("click", () => this.#copy());
    retry.addEventListener("click", () => {
      if (this.#pending) this.#send(this.#pending);
    });

    return {
      form, alert, about, work, section, sectionSelect, category, categories, body, publication, publishYes, publishNo, name, showName,
      clarification, submit, status, done, fallback, fallbackMessage, copyArea, copyLabel, retry, copyButton, contactLink, errors, controls, hints,
    };
  }

  #target() {
    const ui = this.#ui;
    if (!ui.section.checked) return { version: 1, kind: "work" };
    const item = this.#passages.sections[Number(ui.sectionSelect.value)];
    if (!item) return null;
    const value = { version: 1, kind: "section", digest: item.digest };
    if (item.anchor !== undefined) value.section = item.anchor;
    return value;
  }

  #clearErrors() {
    const ui = this.#ui;
    ui.alert.textContent = "";
    for (const [name, error] of Object.entries(ui.errors)) {
      error.hidden = true;
      error.textContent = "";
      const control = ui.controls[name];
      if (control) {
        control.removeAttribute("aria-invalid");
        if (ui.hints[name]) control.setAttribute("aria-describedby", ui.hints[name]);
        else control.removeAttribute("aria-describedby");
      }
    }
    for (const group of [ui.about, ui.category, ui.publication]) group.removeAttribute("aria-invalid");
    const errorIds = new Set(Object.values(ui.errors).map((error) => error.id));
    for (const radio of [ui.work, ui.section, ui.publishYes, ui.publishNo, ...ui.categories]) {
      radio.removeAttribute("aria-invalid");
      // A radio keeps its own description (a prompt's question); only an error's is taken off.
      const kept = (radio.getAttribute("aria-describedby") || "").split(/\s+/).filter((token) => token && !errorIds.has(token));
      if (kept.length) radio.setAttribute("aria-describedby", kept.join(" "));
      else radio.removeAttribute("aria-describedby");
    }
  }

  /** Marks one control invalid, describes it with the message, announces it and moves focus there. */
  #showError(name, message) {
    const ui = this.#ui;
    const error = ui.errors[name];
    error.textContent = message;
    error.hidden = false;
    ui.alert.textContent = message;
    const groups = { about: [ui.about, [ui.work, ui.section]], category: [ui.category, ui.categories], publication: [ui.publication, [ui.publishYes, ui.publishNo]] };
    if (groups[name]) {
      const [group, radios] = groups[name];
      group.setAttribute("aria-invalid", "true");
      const checked = radios.find((radio) => radio.checked) ?? radios[0];
      checked.setAttribute("aria-invalid", "true");
      checked.setAttribute("aria-describedby", [checked.getAttribute("aria-describedby"), error.id].filter(Boolean).join(" "));
      checked.focus();
      return;
    }
    const control = ui.controls[name];
    control.setAttribute("aria-invalid", "true");
    control.setAttribute("aria-describedby", [ui.hints[name], error.id].filter(Boolean).join(" "));
    control.focus();
  }

  /** The reader's choices as a submission value, before the shared validator reads it. */
  #value(publish) {
    const ui = this.#ui;
    const value = {
      version: 1,
      kind: "third-perspective",
      work: this.#passages.work,
      revision: this.#passages.revision,
      target: this.#target(),
      body: ui.body.value,
      consent: { publish, clarification: ui.clarification.checked },
    };
    const category = ui.categories.find((radio) => radio.checked)?.value;
    if (category) value.category = category;
    if (this.#seenAt) value.seenAt = this.#seenAt;
    const name = ui.name.value;
    if (name.trim() !== "" || ui.showName.checked) value.attribution = { name, publishName: ui.showName.checked };
    return value;
  }

  #submit() {
    const ui = this.#ui;
    if (this.#sending) return;
    this.#clearErrors();
    ui.done.hidden = true;
    ui.fallback.hidden = true;
    ui.status.textContent = "";
    if (!ui.publishYes.checked && !ui.publishNo.checked) {
      this.#showError(...FIELD_PROBLEMS.publication);
      return;
    }
    if (!this.#target()) {
      this.#showError(...FIELD_PROBLEMS.invalidTarget);
      return;
    }
    // The reflection is checked as a publishable submission either way, so a private copy is as
    // complete as one the author could publish.
    const read = readThirdPerspectiveSubmissionJson(JSON.stringify(this.#value(true)));
    if (!read.ok) {
      const known = FIELD_PROBLEMS[read.error.code];
      if (known) {
        this.#showError(...known);
        return;
      }
      this.#fallback(null, "This page’s data cannot be used, so the form cannot prepare your reflection. Please write to the author instead.");
      return;
    }
    if (ui.publishNo.checked) {
      const privateCopy = { ...read.submission, consent: Object.freeze({ publish: false, clarification: false, feature: false }) };
      this.#fallback(privateCopy, "You chose not to publish it, so it was not sent through the form.", { lost: false });
      return;
    }
    if (!this.#hosted) {
      this.#fallback(read.submission, "Your reflection is ready.", { lost: false });
      return;
    }
    this.#send(read.submission);
  }

  async #send(submission) {
    const ui = this.#ui;
    if (this.#sending) return;
    this.#pending = submission;
    ui.fallback.hidden = true;
    if (globalThis.navigator?.onLine === false) {
      this.#fallback(submission, "You seem to be offline, so your reflection was not sent.", { retry: true });
      return;
    }
    const controller = new AbortController();
    this.#sending = controller;
    const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT);
    ui.form.setAttribute("aria-busy", "true");
    ui.submit.setAttribute("aria-disabled", "true");
    ui.retry.setAttribute("aria-disabled", "true");
    ui.submit.textContent = "Sending…";
    ui.status.textContent = "Sending your reflection…";
    let outcome;
    try {
      const response = await fetch(`${this.#endpoint}/feedback`, {
        method: "POST",
        credentials: "omit",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(thirdPerspectiveSubmissionValue(submission)),
        signal: controller.signal,
      });
      const result = await response.json().catch(() => ({}));
      outcome = {
        status: response.status,
        code: result && typeof result === "object" ? result.code : undefined,
        receipt: result && typeof result === "object" && isReceipt(result.receipt) ? result.receipt : undefined,
      };
    } catch {
      outcome = { status: 0 };
    } finally {
      clearTimeout(timer);
      if (this.#sending === controller) this.#sending = null;
      ui.form.removeAttribute("aria-busy");
      ui.submit.removeAttribute("aria-disabled");
      ui.retry.removeAttribute("aria-disabled");
      ui.submit.textContent = "Send for review";
    }
    if (!this.#connected) return;
    if (outcome.status === 202) {
      this.#succeeded(submission, outcome.receipt);
      return;
    }
    const known = FIELD_PROBLEMS[outcome.code];
    if ((outcome.status === 422 || outcome.status === 413) && known) {
      ui.status.textContent = "";
      this.#showError(...known);
      return;
    }
    if (outcome.status === 403 && outcome.code === "closed") {
      this.#fallback(submission, "This work is not taking Third Perspectives now, so your reflection was not sent.");
      return;
    }
    // The same reflection from here within the hour: it is already waiting for review.
    if (outcome.status === 409 && outcome.code === "duplicate") {
      this.#pending = null;
      ui.status.textContent = "This reflection was already sent and is waiting for review.";
      return;
    }
    const retry = outcome.status === 0 || outcome.status === 429 || outcome.status >= 500;
    const reason =
      outcome.status === 0
        ? "Your reflection could not be sent: the service did not answer."
        : outcome.status === 429
          ? "Your reflection was not sent: too many have come from here recently. Try again later."
          : outcome.status === 404 || outcome.code === "unavailable"
            ? "Your reflection was not sent: this site is not taking reflections through the form right now."
            : "Your reflection could not be sent: the service had a problem.";
    this.#fallback(submission, reason, { retry });
  }

  #succeeded(submission, receipt) {
    const ui = this.#ui;
    this.#pending = null;
    ui.body.value = "";
    ui.status.textContent = "Sent for review.";
    ui.done.textContent = receipt
      ? "Thank you. Your reflection was sent for review. It is published only if a moderator approves it, as you chose. Keep the receipt below."
      : "Thank you. Your reflection was sent for review. It is published only if a moderator approves it, as you chose.";
    ui.done.hidden = false;
    this.#receipt?.remove();
    this.#receipt = receipt ? receiptPanel({ endpoint: this.#endpoint, receipt, consent: submission.consent.clarification, noun: "reflection" }) : null;
    if (this.#receipt) ui.done.after(this.#receipt);
    ui.done.focus();
  }

  /** The copy-and-send path: the reflection as plain text, retry when it may help, and the contact. */
  #fallback(submission, reason, { retry = false, lost = true } = {}) {
    const ui = this.#ui;
    const nothingLost = submission
      ? lost
        ? " Nothing you wrote was lost: try again, or copy your reflection below and send it to the author."
        : " Copy it below to send it to the author."
      : "";
    ui.status.textContent = "";
    ui.fallbackMessage.textContent = `${reason}${nothingLost}`;
    ui.copyArea.value = submission ? thirdPerspectiveCopyText(submission, this.#page) : "";
    const copyable = Boolean(submission);
    ui.copyArea.hidden = !copyable;
    ui.copyLabel.hidden = !copyable;
    ui.copyButton.hidden = !copyable;
    ui.retry.hidden = !(retry && copyable);
    if (this.#contact) ui.contactLink.href = this.#contactHref(submission);
    ui.fallback.hidden = false;
    ui.fallbackMessage.focus();
  }

  #contactHref(submission) {
    const contact = this.#contact;
    if (!contact.startsWith("mailto:") || !submission) return contact;
    const subject = `A reflection on ${this.#page || submission.work}`;
    const withBody = `${contact}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(this.#ui.copyArea.value)}`;
    return withBody.length <= MAX_MAIL_LINK ? withBody : `${contact}?subject=${encodeURIComponent(subject)}`;
  }

  async #copy() {
    const ui = this.#ui;
    try {
      await globalThis.navigator.clipboard.writeText(ui.copyArea.value);
      ui.status.textContent = "Your reflection was copied.";
    } catch {
      ui.copyArea.focus();
      ui.copyArea.select();
      ui.status.textContent = "Your reflection is selected: press Control+C (or Command+C) to copy it.";
    }
  }
}

if (!customElements.get("ob-third-perspective")) {
  customElements.define("ob-third-perspective", ObThirdPerspective);
}
