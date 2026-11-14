// About this post: one side-sheet per Write screen with the little things about a post, grouped by
// question: what kind of post, its own facts (This recipe, This video, This trip outdoors), On the
// page, In search and when shared, Who wrote it, and Details for the person who set up the site.
// It has no Save of its own: every value is part of the post (drafts save themselves; a published
// post keeps changes on this device until Update). Write reads `extra()` and `credits()` when it
// saves. Everything she or the server wrote is placed as text. Studio R5.
import { fill, h, toast } from "./dom.js";
import { use } from "../zubra.js";
import { ask } from "./dialogs.js";
import { choosePicture } from "./picture-picker.js";
import { createControls } from "./about-fields.js";
import { createCredits } from "./about-credits.js";
import { createDetails } from "./about-details.js";
import { trapFocus } from "./focus-trap.js";
import {
  aboutExtra, aboutFromDocument, aboutKeys, aboutLine, aboutProblems, cardSummary, pinCounts, slugEditable, slugPreview, summaryCount,
} from "./about-rules.js";
import { KIND_WORDS, kindChoices, kindLabel, PROFILE_GROUPS } from "./profile-words.js";
import { tradeSite } from "./record-kinds.js";

/** Which group each opener asks for, and the value whose field gets focus. */
const GROUP_FIRST = { kind: "profile", recipe: "course", page: "subtitle", search: "description", credits: "", details: "slug" };

/**
 * `post()` → { state, wasPublished, path, fields, title, url, excerpt, cover, coverAlt, collection, facts };
 * `onChange()` after every edit; `onKind(from, to)` changes Write's boxes and returns kindChange's
 * { help, addParts }; `addParts()` puts the recipe parts in; `goPeople({ add })` opens People.
 */
export async function createAboutPost({ api, meta, post, onChange, onKind, addParts, goPeople, setCoverAddress, maxBytes = 0 }) {
  await use("side-sheet", "text-field", "select-field", "toggle-switch", "action-button", "alert-banner", "content-card", "skeleton-block", "status-badge");
  let keys = {};
  let initial = {};
  const values = {};
  let opener = null;
  let onClose = null;
  let kindUndo = null; // { from, body } while the sheet is open after a kind change
  const controls = createControls({ values, onChange: (name) => edited(name) });
  const credits = createCredits({ meta, people: () => api.get("contributors"), onChange: () => { paintLine(); onChange?.(); }, goPeople });
  const details = createDetails({ meta, controls, credits, post: () => ({ ...post(), kind: values.profile, keys }), setCoverAddress,
    setKind: (to) => { if (to && to !== values.profile) changeKind(values.profile || "article", to); } });

  const heading = h("span", { slot: "heading", tabindex: "-1", text: "About this post" });
  const footStatus = h("p", { class: "studio-help studio-about-foot", role: "status" });
  const done = h("action-button", { slot: "actions", onClick: () => close() }, "Done");
  const groups = {
    kind: h("section", { class: "studio-about-group", "aria-labelledby": "studio-about-kind-h" }),
    own: h("section", { class: "studio-about-group" }),
    page: h("section", { class: "studio-about-group", "aria-labelledby": "studio-about-page-h" }),
    search: h("section", { class: "studio-about-group", "aria-labelledby": "studio-about-search-h" }),
    credits: h("section", { class: "studio-about-group", "aria-labelledby": "studio-about-credits-h" },
      h("h3", { id: "studio-about-credits-h", tabindex: "-1", text: "Who wrote it" }), credits.element),
  };
  const element = h("side-sheet", { label: "About this post", side: "right", class: "studio-about-sheet" },
    heading, h("div", { class: "studio-about-body" }, groups.kind, groups.own, groups.page, groups.search, groups.credits, details.element),
    h("div", { slot: "actions", class: "studio-about-actions" }, footStatus, done));
  trapFocus(element, () => element.open);
  // Closed by Escape or the × (openchange), or by Done (setting `open` fires no openchange).
  element.addEventListener("openchange", (event) => {
    if (event.target !== element || event.detail) return;
    finish();
  });
  function finish() {
    if (!shownNow) return;
    shownNow = false;
    kindUndo = null;
    drawKind();
    const back = opener;
    opener = null;
    const after = onClose;
    onClose = null;
    after?.();
    if (back?.isConnected) requestAnimationFrame(() => (back.querySelector?.("button, a, input") || back).focus?.());
  }
  let shownNow = false;

  // ---- values
  function edited(name) {
    if (name === "description") paintSearch();
    if (name === "profile") return; // the kind's own handler
    paintLine();
    onChange?.();
  }

  // ---- What kind of post
  let kindHelp = "";
  let kindParts = false;
  function drawKind() {
    const trade = tradeSite(meta);
    const current = values.profile || "article";
    const choices = Object.fromEntries(kindChoices(meta, current, { trade }).map((c) => [c.value, { label: c.label, help: c.help }]));
    controls.forget(["profile"]);
    const box = controls.choice("profile", { legend: "What kind of post", choices, confirm: (to) => changeKind(current, to) });
    box.querySelector("legend").id = "studio-about-kind-h";
    fill(groups.kind, box,
      kindHelp ? h("p", { class: "studio-help", role: "status", text: kindHelp }) : null,
      kindParts ? h("action-button", { variant: "secondary", onClick: () => { addParts?.(); kindParts = false; drawKind(); } }, "Add the recipe parts") : null,
      kindUndo ? h("action-button", { variant: "link", class: "studio-about-kind-undo", onClick: () => undoKind() }, "Undo") : null);
  }

  async function changeKind(from, to) {
    if (from === to) return false;
    const before = post().body;
    values.profile = to;
    const said = (await onKind?.(from, to)) || {};
    kindHelp = said.help || "";
    kindParts = Boolean(said.addParts);
    kindUndo = { from, body: before };
    drawKind();
    drawOwn();
    details.draw();
    paintLine();
    onChange?.();
    // The toast says it; Undo sits under the choice until the sheet closes (a toast's action is a link).
    toast(`Now ${kindLabel(to).replace(/^A /, "a ")}.`);
    requestAnimationFrame(() => controls.get("profile")?.focus());
    return true;
  }

  async function undoKind() {
    if (!kindUndo) return;
    const { from, body } = kindUndo;
    const to = values.profile;
    values.profile = from;
    await onKind?.(to, from, { body });
    kindHelp = "";
    kindParts = false;
    kindUndo = null;
    drawKind();
    drawOwn();
    details.draw();
    paintLine();
    onChange?.();
    toast(`Back to ${kindLabel(from).replace(/^A /, "a ")}.`);
    requestAnimationFrame(() => controls.get("profile")?.focus());
  }

  // ---- This recipe / This video / This trip outdoors
  function drawOwn() {
    const group = PROFILE_GROUPS[values.profile];
    if (!group?.fields.length) { groups.own.replaceChildren(); groups.own.hidden = true; return; }
    groups.own.hidden = false;
    const id = `studio-about-own-h`;
    const listing = meta.recipeListing !== false;
    groups.own.setAttribute("aria-labelledby", id);
    groups.own.replaceChildren(h("h3", { id, tabindex: "-1", text: group.heading }), ...group.fields.map((spec) => ownField(spec, listing)));
  }

  function ownField(spec, listing) {
    if (spec.control === "choice" && spec.select) {
      return controls.select(spec.key, { label: spec.label, help: spec.help, options: [{ value: "", label: "Not set" }, ...Object.entries(spec.choices).map(([value, label]) => ({ value, label }))] });
    }
    if (spec.control === "choice") {
      const confirm = spec.key === "locationPrivacy"
        ? async (to) => to !== "exact" || (await ask({ heading: "Show the exact route?", text: "Anyone can see where you started and finished.", choices: [{ label: "Show it", value: "yes" }, { label: "Keep it hidden", value: "no", variant: "secondary" }] })) === "yes"
        : null;
      return controls.choice(spec.key, { legend: spec.label, choices: spec.choices, help: spec.help, start: spec.start || "", confirm });
    }
    const field = controls.text(spec.key, {
      label: spec.label, help: spec.key === "course" && !listing ? spec.helpNoList : spec.help,
      rows: spec.control === "rows" ? 3 : 0, inputmode: spec.inputmode, type: spec.control === "url" ? "url" : "text",
    });
    if (spec.control !== "picture") return field;
    return h("div", { class: "studio-field-with" }, field,
      h("action-button", { variant: "secondary", size: "sm", onClick: async (e) => {
        const opened = e.currentTarget;
        const picked = await choosePicture(api, { heading: "Choose a picture", describe: false, maxBytes });
        if (picked) { values[spec.key] = picked.url; controls.get(spec.key)?.set(picked.url); edited(spec.key); }
        opened?.querySelector("button")?.focus();
      } }, "Choose one of your photos"));
  }

  // ---- On the page
  function drawPage() {
    const p = post();
    const parts = [h("h3", { id: "studio-about-page-h", tabindex: "-1", text: "On the page" }),
      controls.text("subtitle", { label: "A line under the title", maxlength: 200, help: "Shown under the title on your post. Optional." })];
    if (p.collection) parts.push(controls.text("seriesOrder", { label: `Part in ${p.collection}`, inputmode: "numeric", help: "Which part this is, like 3. Leave empty to go by date." }));
    else controls.forget(["seriesOrder"]);
    if (meta.engagementSetUp) {
      parts.push(controls.choice("comments", {
        legend: "Comments",
        choices: { "": "Open", locked: "Show, but no new ones", hidden: "Hidden" },
        help: `Only this post. Comments are set up for your whole blog under Comments.${meta.engagement === false ? " Comments aren't working right now, so nothing shows yet." : ""}`,
      }));
    }
    groups.page.replaceChildren(...parts);
  }

  // ---- In search and when shared
  // The counter shows every change; the live region speaks only when the limit is crossed.
  const count = h("p", { class: "studio-help" });
  const countSay = h("p", { class: "studio-visually-hidden", "aria-live": "polite" });
  const card = {
    image: h("img", { class: "studio-about-card-img", alt: "" }),
    address: h("p", { class: "studio-about-card-address" }),
    title: h("p", { class: "studio-about-card-title" }),
    summary: h("p", { class: "studio-about-card-summary" }),
  };
  const pinSay = h("p", { class: "studio-help" });
  const pinLive = h("p", { class: "studio-visually-hidden", "aria-live": "polite" });
  function drawSearch() {
    const pins = meta.siteUses?.pinterest
      ? h("details", { class: "studio-about-pins", open: Boolean(values.cardTitle || values.cardDescription) },
        h("summary", { text: "Words for a Pinterest Pin" }),
        h("p", { class: "studio-help", text: "Only used when your blog sends a Pin. Leave them empty to use the title and summary." }),
        controls.text("cardTitle", { label: "Pin title", maxlength: 300, live: () => paintPins() }),
        controls.text("cardDescription", { label: "Pin description", rows: 3, live: () => paintPins() }), pinSay, pinLive)
      : null;
    fill(groups.search,
      h("h3", { id: "studio-about-search-h", tabindex: "-1", text: "In search and when shared" }),
      controls.text("description", { label: "Summary", rows: 3, maxlength: 500, help: "One or two sentences. Leave empty and your blog uses the first lines of your post." }),
      count, countSay,
      h("p", { class: "studio-label", id: "studio-about-card-h", text: "Roughly how it looks in a search or a shared link" }),
      h("content-card", { class: "studio-about-card", "aria-labelledby": "studio-about-card-h" },
        h("div", { slot: "media" }, card.image), card.address, card.title, card.summary),
      h("p", { class: "studio-help", text: "Roughly how it looks. To see the real card, use See how it looks." }),
      pins);
    paintSearch();
  }

  function paintSearch() {
    const p = post();
    // Spoken only when crossing the limit: the live region changes only then.
    const words = summaryCount(values.description);
    if (Boolean(words) !== Boolean(count.textContent)) countSay.textContent = words;
    count.textContent = words;
    card.address.textContent = p.path || p.state !== "new"
      ? slugPreview({ siteUrl: meta.siteUrl, postPath: meta.postPath, slug: values.slug, title: p.title, path: p.path }).replace(/\/$/, "")
      : "your blog's address";
    card.title.textContent = p.title || "Your title";
    const own = cardSummary(values.description);
    card.summary.textContent = own || cardSummary(p.excerpt || "") || "The first lines of your post.";
    card.summary.classList.toggle("studio-about-card-auto", !own);
    if (p.cover) { card.image.src = p.cover; card.image.alt = p.coverAlt || ""; card.image.hidden = false; } else { card.image.removeAttribute("src"); card.image.hidden = true; }
  }

  function paintPins() {
    const said = pinCounts({ cardTitle: values.cardTitle, cardDescription: values.cardDescription, coverCredit: values.coverCredit });
    const words = [said.title, said.description].filter(Boolean).join(" ");
    if (Boolean(words) !== Boolean(pinSay.textContent)) pinLive.textContent = words;
    pinSay.textContent = words;
  }

  // ---- the button's line and the footer
  let lineTarget = null;
  function paintLine() {
    if (!lineTarget) return;
    lineTarget(line());
  }
  function line({ unsent = false } = {}) {
    return aboutLine({ about: values, commentsSetUp: Boolean(meta.engagementSetUp), names: credits.names(), unsent });
  }

  function paintFooter() {
    const p = post();
    footStatus.textContent = p.state === "new" ? "Saves with your post once it has a title."
      : p.state === "published" ? (p.dirty ? "Press Update to put these on your site." : "Changes wait on this device until you press Update.")
        : p.state === "scheduled" ? "Changes wait on this device until you press Schedule."
          : "Saves by itself.";
  }

  // ---- opening and closing
  function open({ group = "", focusName = "", from = document.activeElement, closed = null } = {}) {
    opener = from;
    onClose = closed;
    paintFooter();
    paintSearch();
    credits.ready();
    if (group === "details") details.open();
    element.open = true;
    shownNow = true;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const name = focusName || GROUP_FIRST[group] || "";
      if (group === "credits") { groups.credits.scrollIntoView?.({ block: "start" }); credits.focus(); return; }
      const target = name && controls.get(name);
      if (target) { target.element.scrollIntoView?.({ block: "center" }); target.focus(); } else heading.focus();
    }));
  }

  function close() { element.open = false; finish(); }

  return {
    element,
    /** Fill from the post as it opened (`reply` from GET document, or {} for a new post). */
    load(fields = {}, reply = {}) {
      keys = aboutKeys(fields, meta.profiles || []);
      initial = aboutFromDocument(fields, keys, reply.resolvedProfile || "");
      for (const key of Object.keys(values)) delete values[key];
      Object.assign(values, initial);
      credits.reset(reply);
      kindHelp = ""; kindParts = false; kindUndo = null;
      drawKind(); drawOwn(); drawPage(); drawSearch(); details.draw();
      paintLine();
      // The names for the button's line (and the sheet when it opens), asked once.
      credits.ready().then(() => paintLine());
    },
    /** Redraw the parts that follow the rest of Write (the collection's name, the title, the cover). */
    refresh() { drawPage(); controls.sync(); paintSearch(); paintFooter(); details.draw(); },
    open, close,
    get isOpen() { return element.open; },
    /** Where the About this post button's line goes. */
    onLine(fn) { lineTarget = fn; paintLine(); },
    line,
    kind: () => values.profile || "article",
    value: (name) => values[name] ?? "",
    setValue(name, value) { values[name] = value; controls.get(name)?.set(value); paintLine(); },
    /** The card follows the title and cover as she changes them. */
    paintCard: () => paintSearch(),
    /** What a save adds to the post's fields: only what changed, under the post's own keys. */
    extra: () => aboutExtra(keys, initial, values),
    /** What a save sends as `credits` (undefined: leave the credit file alone). */
    credits: () => credits.toSend(),
    /** The sheet's values for a set of fields (an older kept copy that has only its fields). */
    fromFields: (fields) => aboutFromDocument(fields, aboutKeys(fields, meta.profiles || [])),
    /** For kept copies: the values and the credit draft. */
    keep: () => ({ about: { ...values }, credits: credits.draft() }),
    restore(kept) {
      if (kept?.about) { Object.assign(values, kept.about); drawKind(); drawOwn(); drawPage(); drawSearch(); details.draw(); controls.sync(); }
      if (kept && "credits" in kept) credits.restore(kept.credits);
      paintLine();
    },
    /** Her checks before any save. */
    problems() {
      const p = post();
      return [...aboutProblems(values, { collection: Boolean(p.collection), slugOpen: slugEditable({ state: p.state, wasPublished: p.wasPublished }) }), ...credits.problems()];
    },
    /** A problem beside its field, the sheet open on it. */
    showProblem(name, words, { from } = {}) {
      if (name === "credits" || name === "roles") {
        if (name === "roles") details.open();
        open({ group: "credits", from });
        credits.showProblem(words);
        return;
      }
      if (["slug", "canonical", "theme", "aliases", "cardTitle", "cardDescription", "doi", "license", "videoFile", "captions", "videoTitle", "videoDescription", "seasonNumber", "episodeNumber", "productionCredits"].includes(name) && !(name.startsWith("card") && meta.siteUses?.pinterest)) details.open();
      controls.error(name, words);
      open({ focusName: controls.get(name) ? name : "", from });
    },
    clearProblems: () => controls.clear(),
    /** After a save went through: what was sent is what the post has now. */
    saved({ fields, sentCredits, sent } = {}) {
      if (fields) { keys = aboutKeys(fields, meta.profiles || []); }
      initial = { ...(sent || values) };
      credits.saved(sentCredits);
      paintFooter();
      paintLine();
    },
    /** The other computer's credits, after "Use that list". */
    takeCredits: (reply) => credits.takeTheirs(reply),
    /** Someone just added in People: listed as the next author. */
    addPerson(id) { credits.refresh(); credits.add(id); credits.ready(); },
    paintFooter,
    names: () => credits.names(),
    kindWords: (id) => KIND_WORDS[id]?.label || "",
  };
}
