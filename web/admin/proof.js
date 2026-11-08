// The Reviews screen (ADR 0389, #520): a customer's real review, saved with where it came from. A list under
// `#/reviews`, and a form for one (`#/reviews/new`, `#/reviews/edit/<path>`) with the reviewer's name, the day
// it was written, where it was left, its link, its stars and its words. A review comes in one of two ways:
// typed in by hand, or copied once from its link through the same URL snapshot route the Assistant uses
// (`assistant/context/url/retrieve`), so the limits and refusals are that route's own. Nothing is fetched
// again later: the copy's time is written into the file and only a new review fetches anything.
//
// It edits the `proof/` collection through the same document routes services, posts and pages use; the
// server judges every file with the build's own rules. Designed at 400px first: one column, every control
// at least 44px tall. The pure functions at the top are the contract and are tested without a page.

import { el } from "./block-forms.js";

export const PROOF_VERSION = 1;
export const SNAPSHOT_ROUTE = "assistant/context/url/retrieve";

export const LIMITS = Object.freeze({ id: 64, author: 80, text: 5000, url: 500 });

export const PLATFORMS = Object.freeze([
  ["google", "Google"],
  ["facebook", "Facebook"],
  ["nextdoor", "Nextdoor"],
  ["yelp", "Yelp"],
  ["houzz", "Houzz"],
  ["angi", "Angi"],
  ["other", "Somewhere else"],
]);

// The same hosts the build accepts for each platform (crates/openblog-core/src/proof.rs).
const BRANDS = Object.freeze({
  google: [["google"], ["g.page", "goo.gl"]],
  facebook: [["facebook"], ["fb.com", "fb.me"]],
  nextdoor: [["nextdoor"], []],
  yelp: [["yelp"], []],
  houzz: [["houzz"], []],
  angi: [["angi", "angieslist"], []],
});

// Keys the form owns; any other key in a file is carried through a save untouched.
const MANAGED = new Set(["version", "id", "author", "date", "platform", "sourceUrl", "rating", "provenance", "retrievedAt", "draft"]);
const CONTROL = /[\u0000-\u001f\u007f]/;
const TEXT_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

const clean = (value) => (typeof value === "string" ? value.trim() : value === undefined || value === null ? "" : String(value).trim());
const sentence = (message) => {
  const text = String(message || "").trim();
  if (!text) return "";
  const capital = text[0].toUpperCase() + text.slice(1);
  return /[.!?]$/.test(capital) ? capital : `${capital}.`;
};

/** Whether `host` is the platform's own site, by the build's rule. `other` accepts any host. */
export function platformOwnsHost(platform, host) {
  if (platform === "other") return true;
  const known = BRANDS[platform];
  if (!known) return false;
  const name = String(host || "").toLowerCase().replace(/\.$/, "");
  if (known[1].some((short) => name === short || name.endsWith(`.${short}`))) return true;
  const labels = name.split(".");
  return labels.some((label, at) => known[0].includes(label) && at + 1 < labels.length && labels.slice(at + 1).every((tld) => tld.length >= 2 && tld.length <= 3));
}

/** The platform a link is on, or `other`. */
export function platformForUrl(address) {
  let host = "";
  try {
    host = new URL(address).hostname;
  } catch {
    return "other";
  }
  return Object.keys(BRANDS).find((platform) => platformOwnsHost(platform, host)) || "other";
}

/** A review id made from the reviewer's name and the day: lowercase letters, digits and hyphens. */
export function reviewId(author, date) {
  const base = clean(author)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return [base, clean(date)].filter(Boolean).join("-").slice(0, LIMITS.id).replace(/-+$/g, "");
}

export function isReviewId(value) {
  return /^[A-Za-z0-9_-]+$/.test(value) && value.length <= LIMITS.id;
}

export function blankReview() {
  return { id: "", author: "", date: "", platform: "", sourceUrl: "", rating: "", provenance: "entered", retrievedAt: "", draft: false, text: "", extra: {} };
}

/** The form for a stored document: its front matter fields and its body (the review's words). */
export function formFromDocument(fields = {}, body = "") {
  const form = blankReview();
  for (const [key, value] of Object.entries(fields)) if (!MANAGED.has(key)) form.extra[key] = value;
  for (const key of ["id", "author", "date", "platform", "sourceUrl", "rating", "retrievedAt"]) form[key] = clean(fields[key]);
  form.platform = form.platform.toLowerCase();
  form.provenance = clean(fields.provenance).toLowerCase() === "snapshot" ? "snapshot" : "entered";
  form.draft = ["true", "yes", "on"].includes(clean(fields.draft).toLowerCase());
  form.text = typeof body === "string" ? body.replace(/\r\n?/g, "\n").trim() : "";
  return form;
}

/** The front matter fields a save sends: the form's answers, then every key it does not own, as it was. */
export function fieldsFromForm(form) {
  const fields = { ...form.extra, version: String(PROOF_VERSION) };
  for (const key of ["id", "author", "date", "platform", "sourceUrl", "rating"]) {
    if (clean(form[key])) fields[key] = clean(form[key]);
  }
  fields.provenance = form.provenance === "snapshot" ? "snapshot" : "entered";
  if (form.provenance === "snapshot" && clean(form.retrievedAt)) fields.retrievedAt = clean(form.retrievedAt);
  if (form.draft) fields.draft = "true";
  return fields;
}

/**
 * The form after a snapshot of `address` came back: the link, the platform it is on and the time it was
 * copied are filled in, and the words too when the page held no more than a review can. The reviewer's
 * name, the day and the stars are the owner's to read off the page; nothing is guessed for them.
 */
export function formFromSnapshot(form, snapshot) {
  const next = { ...form, extra: { ...form.extra } };
  next.sourceUrl = clean(snapshot?.sourceUrl);
  next.retrievedAt = clean(snapshot?.retrievedAt);
  next.provenance = "snapshot";
  next.platform = platformForUrl(next.sourceUrl);
  // A short or shared link that led onto a named platform keeps that platform with the address it led to,
  // so the link the review keeps is on the platform it names (ADR 0390).
  const landed = clean(snapshot?.canonicalUrl);
  if (next.platform === "other" && landed && platformForUrl(landed) !== "other") {
    next.platform = platformForUrl(landed);
    next.sourceUrl = landed;
  }
  const words = clean(snapshot?.text);
  if (!clean(next.text) && words && [...words].length <= LIMITS.text) next.text = words;
  return next;
}

/** What the snapshot route is sent: the link, and the owner's say-so that it may be fetched now. */
export function snapshotRequest(address) {
  return { url: clean(address), confirmed: true };
}

/** The problems the build would find, as `{ field, message }`. A draft is only held to having an id. */
export function validateForm(form) {
  const problems = [];
  const add = (field, message) => problems.push({ field, message });
  const id = clean(form.id);
  if (!id) add("id", "Add a short id, such as dana-r-2026-10-20. A job uses it to show this review.");
  else if (!isReviewId(id)) add("id", `Use letters, digits, - and _, up to ${LIMITS.id} characters.`);
  if (form.draft) return problems;

  const author = clean(form.author);
  if (!author) add("author", "Add the name the reviewer shows, such as Dana R.");
  else if (CONTROL.test(author) || [...author].length > LIMITS.author) add("author", `Use 1 to ${LIMITS.author} characters on one line.`);

  const date = clean(form.date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) add("date", "Add the day the review was written.");
  else if (form.provenance === "snapshot" && clean(form.retrievedAt) && date > clean(form.retrievedAt).slice(0, 10)) add("date", "A review cannot be written after the day it was copied.");

  const platform = clean(form.platform);
  if (!PLATFORMS.some(([value]) => value === platform)) add("platform", "Choose where the review was left.");

  const link = clean(form.sourceUrl);
  let url = null;
  try {
    url = new URL(link);
  } catch {
    url = null;
  }
  if (!link) add("sourceUrl", "Add the link to the review, starting https://.");
  else if (!url || !/^https?:$/.test(url.protocol) || url.username || url.password || /\s/.test(link) || link.length > LIMITS.url) add("sourceUrl", "Use the review's full link, starting https://.");
  else if (platform && !platformOwnsHost(platform, url.hostname)) {
    const label = PLATFORMS.find(([value]) => value === platform)?.[1] || platform;
    add("sourceUrl", `That link is not on ${label}. Use the review's link there, or choose Somewhere else.`);
  }

  const rating = clean(form.rating);
  if (rating && !/^[1-5]$/.test(rating)) add("rating", "Choose 1 to 5 stars, or no stars.");

  const text = clean(form.text);
  if (!text) add("text", "Add the review's words.");
  else if (TEXT_CONTROL.test(text) || [...text].length > LIMITS.text) add("text", `Use up to ${LIMITS.text} characters of plain text.`);
  return problems;
}

const FIELD_NAMES = ["id", "author", "date", "platform", "sourceUrl", "rating", "retrievedAt", "provenance", "text"];

/** The server's problem sentences (`proof/x.md: rating: ...; text: ...`) as the form's `{ field, message }`. */
export function problemsFromServer(items) {
  const out = [];
  for (const item of Array.isArray(items) ? items : []) {
    const text = String(item).replace(/^[^\s:]*\.md: /, "");
    for (const part of text.split(/; (?=(?:version|id|author|date|platform|sourceUrl|rating|retrievedAt|provenance|text): )/)) {
      const named = /^([A-Za-z]+): (.*)$/s.exec(part);
      if (named && FIELD_NAMES.includes(named[1])) {
        const field = named[1] === "retrievedAt" || named[1] === "provenance" ? "sourceUrl" : named[1];
        out.push({ field, message: sentence(named[2]) });
      } else out.push({ field: "", message: sentence(part) });
    }
  }
  return out;
}

/** Plain words for a snapshot the route refused or could not make. */
export function snapshotErrorText(error) {
  const detail = String(error?.data?.error || error?.message || "").trim();
  const fallback = " You can type the review in instead.";
  if (error?.status === 401) return "You were signed out. Sign in again, then fetch the page.";
  if (/local or private/i.test(detail)) return `That link points to a private or local address, which is never fetched.${fallback}`;
  if (/timed out/i.test(detail)) return `The page took too long to answer.${fallback}`;
  if (/KiB/i.test(detail)) return `That page is too big to copy.${fallback}`;
  if (/only HTML|content type|UTF-8/i.test(detail)) return `That link is not a page of text.${fallback}`;
  if (/redirect/i.test(detail)) return `That link sent us on too many times.${fallback}`;
  if (/HTTP (\d+)/.test(detail)) return `The page answered with an error (HTTP ${/HTTP (\d+)/.exec(detail)[1]}). Check the link.${fallback}`;
  if (/complete HTTP|only HTTP|credentials|requires a host/i.test(detail)) return "Use the review's full link, starting https://.";
  return detail ? `That page could not be copied: ${detail}.${fallback}` : `That page could not be copied.${fallback}`;
}

export function reviewErrorText(error, { creating = false, id = "" } = {}) {
  const status = error?.status;
  if (status === 401) return "You were signed out. Sign in again, then save.";
  if (status === 413) return "That is too much to save. Shorten the review and try again.";
  if (status === 409 && creating) {
    const named = clean(id) ? ` called ${clean(id)}` : "";
    return `The review was not saved. You already have a review${named}. Change the id, for example by adding -2 to the end, then save again.`;
  }
  if (status === 409) return "This review changed in another window. Reload it, then make your changes again.";
  const detail = String(error?.data?.error || error?.message || "").trim();
  return detail ? `The review was not saved. ${detail}` : "The review was not saved. Check your connection and try again.";
}

const stars = (rating) => (/^[1-5]$/.test(clean(rating)) ? `${"★".repeat(Number(rating))}${"☆".repeat(5 - Number(rating))}` : "");
const longDay = (value) => {
  const date = new Date(`${clean(value).slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? clean(value) : date.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
};

let uid = 0;

/**
 * `route` is what follows `#/reviews/`: nothing for the list, `new`, or `edit/<encoded path>`. `onSaved(path)`
 * runs after a first save gives a new review its address; `onLeave(hash)` after a delete.
 */
export function createReviews({ api, route = "", onSaved = () => {}, onLeave = () => {} }) {
  const id = `oba-proof-${++uid}`;
  const editPath = route.startsWith("edit/") ? decodeURIComponent(route.slice(5)) : "";
  const listing = !route;
  let path = editPath;
  let form = blankReview();
  let saved = "";
  let etag = "";
  let busy = false;
  let destroyed = false;
  let idTouched = Boolean(editPath);

  const root = el("div", { class: "oba-business oba-services oba-reviews", "data-reviews-screen": listing ? "list" : "form" });
  const status = el("p", { class: "oba-small oba-business-status", role: "status", "aria-live": "polite", "data-reviews-status": "true" });
  const say = (message, kind = "small") => {
    status.className = `oba-business-status oba-${kind === "error" ? "error" : kind === "ok" ? "ok" : "small"}`;
    status.setAttribute("role", kind === "error" ? "alert" : "status");
    status.textContent = message;
  };
  const current = () => JSON.stringify([fieldsFromForm(form), clean(form.text)]);
  const isDirty = () => !listing && current() !== saved;

  const clearProblems = () => {
    for (const slot of root.querySelectorAll("[data-problem-for]")) {
      slot.hidden = true;
      slot.textContent = "";
    }
    for (const control of root.querySelectorAll("[aria-invalid]")) control.removeAttribute("aria-invalid");
  };
  const showProblems = (problems) => {
    clearProblems();
    let first = null;
    const loose = [];
    for (const item of problems) {
      const slot = item.field ? root.querySelector(`[data-problem-for="${item.field}"]`) : null;
      if (!slot) {
        loose.push(item.message);
        continue;
      }
      slot.hidden = false;
      slot.textContent = slot.textContent ? `${slot.textContent} ${item.message}` : item.message;
      const control = root.querySelector(`[data-review-field="${item.field}"]`);
      control?.setAttribute("aria-invalid", "true");
      first ||= control;
    }
    if (loose.length) say(loose.join(" "), "error");
    return first;
  };

  const dirtyNote = el("span", { class: "oba-small oba-business-dirty", "data-reviews-dirty": "true" });
  const changed = () => {
    dirtyNote.textContent = isDirty() ? "You have unsaved changes." : "All changes saved.";
    if (status.textContent && status.getAttribute("role") !== "alert") status.textContent = "";
  };
  const slot = (key, control, label, help) => {
    const problem = el("p", { class: "oba-error oba-business-problem", id: `${id}-${key}-error`, hidden: true, "data-problem-for": key });
    const helpId = help ? `${id}-${key}-help` : null;
    control.setAttribute("aria-describedby", [helpId, problem.id].filter(Boolean).join(" "));
    control.setAttribute("data-review-field", key);
    return el("div", { class: "oba-field" }, el("label", { for: control.id }, label), help ? el("p", { class: "oba-help", id: helpId }, help) : null, control, problem);
  };
  const syncId = () => {
    if (idTouched || path) return;
    form.id = reviewId(form.author, form.date);
    const control = root.querySelector('[data-review-field="id"]');
    if (control) control.value = form.id;
  };
  const input = (key, label, { type = "text", help, maxlength, readonly = false, autocapitalize } = {}) => {
    const control = el("input", { id: `${id}-${key}`, type, name: key, maxlength, value: form[key] ?? "", readonly, autocomplete: "off", autocapitalize });
    control.addEventListener("input", () => {
      form[key] = control.value;
      if (key === "id") idTouched = true;
      if (key === "author" || key === "date") syncId();
      changed();
    });
    return slot(key, control, label, help);
  };
  const choose = (key, label, options, help) => {
    const control = el("select", { id: `${id}-${key}`, name: key }, ...options.map(([value, text]) => el("option", { value }, text)));
    if (form[key] && !options.some(([value]) => value === form[key])) control.append(el("option", { value: form[key] }, form[key]));
    control.value = form[key];
    control.addEventListener("change", () => {
      form[key] = control.value;
      changed();
    });
    return slot(key, control, label, help);
  };

  // ----- copy from a link

  const linkInput = el("input", { id: `${id}-fetch-url`, type: "url", inputmode: "url", autocomplete: "off", autocapitalize: "none", spellcheck: "false", placeholder: "https://", "data-review-fetch-url": "true" });
  const fetchButton = el("button", { class: "oba-btn oba-btn-primary", type: "button", "data-action": "review-fetch" }, "Copy the page");
  const fetchStatus = el("p", { class: "oba-small", role: "status", "aria-live": "polite", "data-review-fetch-status": "true" });
  const pageText = el("textarea", { id: `${id}-page-text`, rows: 8, readonly: true, "data-review-page-text": "true" });
  const pageBox = el("div", { class: "oba-field", hidden: true, "data-review-page": "true" },
    el("label", { for: pageText.id }, "What the page said"),
    el("p", { class: "oba-help" }, "Read the name, the day and the stars off this, and copy the review's own words into The review below."),
    pageText);
  const fetchArea = () =>
    el("fieldset", { class: "oba-business-group", "data-review-group": "fetch" }, el("legend", {}, "Copy it from its link"),
      el("p", { class: "oba-help" }, "Paste the review's link. The page is fetched once, now, when you tap Copy the page, and never again. Pages that need you to sign in usually cannot be copied; then type the review in below."),
      el("div", { class: "oba-field" }, el("label", { for: linkInput.id }, "Link to copy from"), linkInput),
      fetchButton, fetchStatus, pageBox);
  fetchButton.addEventListener("click", async () => {
    if (busy) return;
    const address = clean(linkInput.value);
    if (!address) {
      fetchStatus.className = "oba-error";
      fetchStatus.textContent = "Paste the review's link first.";
      linkInput.focus();
      return;
    }
    busy = true;
    fetchButton.disabled = true;
    fetchStatus.className = "oba-small";
    fetchStatus.textContent = "Copying the page…";
    try {
      const result = await api.call("POST", SNAPSHOT_ROUTE, { json: snapshotRequest(address) });
      if (destroyed) return;
      form = formFromSnapshot(form, result.snapshot || {});
      build();
      pageText.value = clean(result.snapshot?.text);
      pageBox.hidden = false;
      fetchStatus.className = "oba-ok";
      fetchStatus.textContent = "Copied. Check every box below against the page, then save.";
      root.querySelector('[data-review-field="author"]')?.focus();
    } catch (error) {
      if (destroyed) return;
      fetchStatus.className = "oba-error";
      fetchStatus.textContent = snapshotErrorText(error);
    } finally {
      busy = false;
      fetchButton.disabled = false;
    }
  });

  // ----- the form

  const saveButton = el("button", { class: "oba-btn oba-btn-primary", type: "submit", "data-action": "review-save" }, "Save review");
  const fields = el("div", { "data-review-fields": "true" });
  const formElement = el("form", { class: "oba-business-form", novalidate: true, "data-review-form": "true", "aria-label": "Review", onSubmit: (event) => { event.preventDefault(); save(); } });

  const provenanceNote = () => {
    if (form.provenance !== "snapshot") return el("p", { class: "oba-help", "data-review-provenance": "entered" }, "Typed in by you. Your site says it was typed in from the original review.");
    return el("p", { class: "oba-help", "data-review-provenance": "snapshot" }, `Copied from its link on ${longDay(form.retrievedAt)}. The link stays as it was copied; to use another link, add a new review.`);
  };

  const build = () => {
    const isNew = !path;
    const draft = el("input", { id: `${id}-draft`, type: "checkbox", name: "draft", checked: form.draft, "data-review-field": "draft" });
    draft.addEventListener("change", () => {
      form.draft = draft.checked;
      changed();
    });
    const words = el("textarea", { id: `${id}-text`, name: "text", rows: 6, maxlength: LIMITS.text, value: form.text });
    words.addEventListener("input", () => {
      form.text = words.value;
      changed();
    });
    fields.replaceChildren(
      el("fieldset", { class: "oba-business-group", "data-review-group": "review" }, el("legend", {}, "The review"),
        input("author", "Reviewer's name", { help: "As it shows on the review, such as Dana R. Customers can see it on your site.", maxlength: LIMITS.author }),
        input("date", "Day it was written", { type: "date" }),
        choose("platform", "Where it was left", [["", "Choose one"], ...PLATFORMS]),
        input("sourceUrl", "Link to the review", { type: "url", help: "Your site links to the review there, so anyone can check it.", maxlength: LIMITS.url, readonly: form.provenance === "snapshot", autocapitalize: "none" }),
        provenanceNote(),
        choose("rating", "Stars", [["", "No stars"], ["5", "5 stars"], ["4", "4 stars"], ["3", "3 stars"], ["2", "2 stars"], ["1", "1 star"]], "Only what the reviewer gave. Leave No stars when the review has none."),
        slot("text", words, "The review", "The customer's own words, as they wrote them."),
      ),
      el("fieldset", { class: "oba-business-group", "data-review-group": "id" }, el("legend", {}, "Its id"),
        input("id", "Id", { help: isNew ? "Made from the name and the day. A job uses it to show this review: choose the review in the job's Customer review box." : "The id names this review's file, so it cannot be changed here.", maxlength: LIMITS.id, readonly: !isNew, autocapitalize: "none" })),
      el("div", { class: "oba-field" },
        el("label", { class: "oba-business-check", for: draft.id }, draft, " Keep this as a draft"),
        el("p", { class: "oba-help" }, "A draft is not on your site. Untick it when the review is ready.")),
    );
    changed();
  };

  const deleteArea = () => {
    const ask = el("button", { class: "oba-btn", type: "button", "data-action": "review-delete" }, "Delete this review");
    const confirmBox = el("div", { class: "oba-notice", hidden: true, "data-reviews-delete-confirm": "true" },
      el("p", {}, "Move this review to the trash? It leaves your site, and a job that shows it must choose another first. The file is kept in .openblog/trash."),
      el("div", { class: "oba-business-actions" },
        el("button", { class: "oba-btn oba-btn-primary", type: "button", "data-action": "review-delete-yes", onClick: () => remove() }, "Yes, delete it"),
        el("button", { class: "oba-btn", type: "button", "data-action": "review-delete-no", onClick: () => { confirmBox.hidden = true; ask.hidden = false; ask.focus(); } }, "Keep it")));
    ask.addEventListener("click", () => {
      ask.hidden = true;
      confirmBox.hidden = false;
      confirmBox.querySelector("button")?.focus();
    });
    return el("div", { class: "oba-business-actions oba-services-delete" }, ask, confirmBox);
  };

  const layout = () => {
    formElement.replaceChildren(
      ...(path ? [] : [fetchArea()]),
      fields,
      el("div", { class: "oba-business-actions" }, saveButton, dirtyNote),
      ...(path ? [deleteArea()] : []),
    );
    build();
  };

  // ----- load, save, delete

  async function loadList() {
    const result = await api.call("GET", "documents?kind=proof");
    const items = Array.isArray(result.items) ? result.items : [];
    root.replaceChildren(
      status,
      el("section", { class: "oba-contributor-intro" }, el("p", {}, "Save a real review a customer left on Google, Facebook or elsewhere, with its link. It goes on your Reviews page, and beside the job it is about when you choose it on that job.")),
      el("div", { class: "oba-business-actions" }, el("a", { class: "oba-btn oba-btn-primary", href: "#/reviews/new", "data-action": "review-new" }, "Add a review")),
      items.length
        ? el("ul", { class: "oba-services-list", "data-reviews-list": "true" },
            items.map((item) =>
              el("li", { class: "oba-services-item", "data-review-row": item.path },
                item.status === "error"
                  ? el("span", {}, `${item.path}: ${item.error || "Invalid front matter"}`)
                  : el("a", { href: `#/reviews/edit/${encodeURIComponent(item.path)}` }, item.title || item.path),
                stars(item.rating) ? el("span", { class: "oba-small", role: "img", "aria-label": `${item.rating} out of 5 stars` }, ` ${stars(item.rating)}`) : null,
                item.date ? el("span", { class: "oba-small" }, ` ${longDay(item.date)}`) : null,
                item.status === "draft" ? el("span", { class: "oba-badge oba-badge-draft" }, "draft") : null)),
          )
        : el("p", { class: "oba-small", "data-reviews-empty": "true" }, "No reviews yet. Add the first one a customer left you."),
    );
  }

  async function loadForm() {
    if (path) {
      const document = await api.call("GET", `document?path=${encodeURIComponent(path)}`);
      if (document.error) {
        root.replaceChildren(el("p", { class: "oba-error", role: "alert" }, `${path} cannot be edited here: ${document.error}`), el("a", { class: "oba-btn", href: "#/reviews" }, "Back to reviews"));
        return;
      }
      etag = document.etag || "";
      form = formFromDocument(document.fields || {}, document.body || "");
    } else {
      form = blankReview();
      etag = "";
    }
    saved = current();
    layout();
  }

  async function load() {
    root.setAttribute("aria-busy", "true");
    try {
      if (listing) await loadList();
      else await loadForm();
    } catch (error) {
      if (error?.status === 401) throw error;
      say(error?.status === 404 ? "That review was not found." : reviewErrorText(error), "error");
    } finally {
      root.removeAttribute("aria-busy");
    }
  }

  async function save() {
    if (busy) return false;
    clearProblems();
    const problems = validateForm(form);
    if (problems.length) {
      say(`${problems.length === 1 ? "One thing needs fixing" : `${problems.length} things need fixing`} before this can be saved.`, "error");
      showProblems(problems)?.focus?.();
      return false;
    }
    busy = true;
    saveButton.disabled = true;
    say("Saving…");
    try {
      const sent = structuredClone(form);
      const payload = { fields: fieldsFromForm(sent), body: `${clean(sent.text)}\n`, etag, kind: "proof" };
      const result = path
        ? await api.call("PUT", `document?path=${encodeURIComponent(path)}`, { json: payload })
        : await api.call("POST", "document", { json: payload });
      if (destroyed) return false;
      const wasNew = !path;
      path = result.path;
      etag = result.etag;
      saved = JSON.stringify([payload.fields, clean(sent.text)]);
      if (wasNew) {
        layout();
        onSaved(path);
      }
      changed();
      if (result.build && result.build.ok === false) say(`Saved, but your site could not be rebuilt yet: ${result.build.error}`, "error");
      else say(sent.draft ? "Draft saved. It is not on your site yet." : "Saved. It is on your Reviews page now. To show it beside a job, choose it in that job's Customer review box. Make your site live to publish it.", "ok");
      return true;
    } catch (error) {
      if (destroyed) return false;
      if (error?.status === 422 && Array.isArray(error.data?.problems)) {
        say("The server found something to fix.", "error");
        showProblems(problemsFromServer(error.data.problems))?.focus?.();
      } else if (error?.status === 409 && !path) {
        say(reviewErrorText(error, { creating: true, id: form.id }), "error");
        showProblems([{ field: "id", message: "This id is already used by another review. Change it, then save again." }])?.focus?.();
      } else say(reviewErrorText(error), "error");
      return false;
    } finally {
      busy = false;
      saveButton.disabled = false;
    }
  }

  async function remove() {
    if (busy || !path) return false;
    busy = true;
    try {
      await api.call("DELETE", `document?path=${encodeURIComponent(path)}`);
      if (destroyed) return true;
      saved = current();
      onLeave("#/reviews");
      return true;
    } catch (error) {
      say(reviewErrorText(error), "error");
      return false;
    } finally {
      busy = false;
    }
  }

  if (!listing) root.append(
    el("section", { class: "oba-contributor-intro" }, el("p", {}, "This is one customer review. Everything here is shown on your site, with a link to where the customer left it. Only save a review a customer really wrote.")),
    el("p", {}, el("a", { href: "#/reviews", "data-action": "review-back" }, "All reviews")),
    status,
    formElement,
  );
  else root.append(status);

  return {
    element: root,
    load,
    save,
    isDirty,
    isBusy: () => busy,
    destroy: () => {
      destroyed = true;
    },
  };
}
