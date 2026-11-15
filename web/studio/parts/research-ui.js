// Pieces every research screen shares (Studio R11): the frame (breadcrumb, the area's tabs, the
// kept-forms banner, Back to your post), rows she adds and takes out (people, identifiers, places),
// a group of choices, someone else's words placed safely, a file saved in the page, and For
// {helper}. Every value is placed as text.
import { h } from "./dom.js";
import { say } from "./words.js";
import { builtScreens, keptWords, researchHash } from "./research-rules.js";
import { dropAll, keptForms } from "./research-kept.js";
import { PLACE_KINDS, placeKindWords } from "./notebook-rules.js";
import { ask } from "./dialogs.js";

let uid = 0;
const next = (base) => `${base}-${++uid}`;

/** The tab words for a research screen. Each id said by name, so the catalog test finds it. */
function tabWords(screen) {
  switch (screen.id) {
    case "sources": return say("research.tabSources");
    case "notebook": return say("research.tabNotebook");
    case "atlas": return say("research.tabAtlas");
    case "compare": return say("research.tabCompare");
    case "public": return say("research.tabPublic");
    default: return say("research.tabOverview");
  }
}

/** The post she came from, kept for this visit so Back to your post works from any research screen. */
let fromPost = null;
export const rememberPost = (post) => { if (post?.path) fromPost = { path: String(post.path), title: String(post.title || "") }; };
export const researchPost = () => fromPost;

/**
 * The top of every research screen: breadcrumb, the tabs (links; a select under 30rem), the
 * kept-forms banner and, when she came from a post, Back to your post.
 * `{ element, crumbs(list), paintKept() }`.
 */
export function researchFrame({ screen, crumbs = [], go }) {
  const trail = h("breadcrumb-trail", {});
  const setCrumbs = (list) => {
    trail.items = [{ label: say("research.home"), href: "#/" }, { label: say("research.nav"), href: list.length ? "#/research" : "" }, ...list];
  };
  setCrumbs(crumbs);
  const screens = builtScreens();
  const tabs = h("nav", { class: "studio-research-tabs", "aria-label": say("research.tabsLabel") },
    h("ul", {}, screens.map((item) => h("li", {}, h("a", { href: researchHash(item.id), "aria-current": item.id === screen ? "page" : null, text: tabWords(item) })))));
  const picker = h("select-field", { class: "studio-research-picker", label: say("research.tabsLabel"), value: screen,
    options: screens.map((item) => ({ value: item.id, label: tabWords(item) })),
    onValuechange: (event) => { if (event.detail && event.detail !== screen) go(researchHash(event.detail)); } });
  const keptLine = h("div", { class: "studio-research-kept", "aria-live": "polite" });
  const back = h("div", { class: "studio-research-back" });
  const element = h("div", { class: "studio-research-frame" }, trail, tabs, picker, back, keptLine);
  function paintKept(current = "") {
    const list = keptForms().filter((entry) => entry.key !== current);
    const words = keptWords(list);
    keptLine.replaceChildren(words ? h("alert-banner", { variant: "info" }, h("span", { text: words }), " ",
      h("a", { class: "studio-more-link", href: list[list.length - 1].hash, text: say("research.keptGo") })) : "");
  }
  function paintBack() {
    const post = researchPost();
    back.replaceChildren(post ? h("action-button", { variant: "link", class: "studio-back", href: `#/write/${encodeURIComponent(post.path)}` }, say("research.backToPost")) : "");
  }
  paintKept();
  paintBack();
  return { element, crumbs: setCrumbs, paintKept, paintBack };
}

/** A research screen's leave(): moving within research (or to Write) keeps her form; anywhere else asks. */
export async function leaveResearch({ dirty, keep, current = "" }) {
  const hash = String(globalThis.location?.hash || "");
  const staying = /^#\/(research|write)(\/|\?|$)/.test(hash);
  if (dirty()) {
    if (staying) { keep(); return true; }
  }
  const others = keptForms().filter((entry) => entry.key !== current);
  if (staying || (!dirty() && !others.length)) return true;
  const choice = await ask({ heading: say("research.leaveTitle"), text: say("research.leaveText"),
    choices: [{ label: say("research.leaveStay"), value: "stay" }, { label: say("research.leaveGo"), value: "go", variant: "secondary" }] });
  if (choice !== "go") return false;
  dropAll();
  return true;
}

// Closing the app with kept forms asks too (the router asks only about the screen in view).
let guarded = false;
export function guardUnload() {
  if (guarded || typeof globalThis.addEventListener !== "function") return;
  guarded = true;
  globalThis.addEventListener("beforeunload", (event) => { if (keptForms().length) event.preventDefault(); });
}

// ---- a form she couldn't send with no signal (decision 7): this tab's sessionStorage, and it says so

const tabStore = () => { try { return globalThis.sessionStorage; } catch { return null; } };
const unsentKey = (screen) => `studio-research-unsent:${screen}`;
/** Keep a form that couldn't be sent: `{ key, state }`. Removed once it is saved or left out. */
export function keepUnsent(screen, entry) { try { tabStore()?.setItem(unsentKey(screen), JSON.stringify(entry)); } catch { /* this page only */ } }
export function unsent(screen) { try { return JSON.parse(tabStore()?.getItem(unsentKey(screen)) || "null"); } catch { return null; } }
export function dropUnsent(screen) { try { tabStore()?.removeItem(unsentKey(screen)); } catch { /* nothing kept */ } }

/** The banner for a form kept with no signal, with Leave it out. */
export function unsentBanner(onLeave) {
  return h("alert-banner", { variant: "info" }, h("p", { text: say("research.noSignal") }), h("p", { text: say("research.keptHere") }),
    h("action-button", { variant: "secondary", size: "sm", onClick: () => onLeave() }, say("research.leaveItOut")));
}

/** An address a stored identifier may be opened at (http(s), or a DOI), or "". Never fetched or previewed. */
export function identifierAddress(identifier) {
  const scheme = String(identifier?.scheme || "").toLowerCase();
  const value = String(identifier?.value || "").trim();
  if (scheme === "doi" && /^10\.\S+$/.test(value)) return `https://doi.org/${value}`;
  if (/^https?:\/\/[^\s<>"]+$/i.test(value)) return value;
  return "";
}

/** Open, for an address from her research: a new tab, no referrer, and it says nothing checked it. */
export function openLink(href) {
  return h("a", { class: "studio-more-link", href, target: "_blank", rel: "noopener noreferrer nofollow", referrerpolicy: "no-referrer", text: say("research.open") });
}

/** Someone else's words, or text pasted from elsewhere: as text, its own direction, its language. */
export function stranger(tag, text, { lang = "", className = "" } = {}) {
  return h(tag, { class: `studio-stranger ${className}`.trim(), dir: "auto", lang: /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(lang) ? lang : null, text: String(text ?? "") });
}

/** For {helper}: lines of text, each as written. */
export function forHelper(...lines) {
  return h("details", { class: "studio-help studio-research-details" }, h("summary", { text: say("common.forHelper") }),
    ...lines.flat().filter((line) => line !== null && line !== undefined && line !== "").map((line) => (line instanceof Node ? line : h("p", { class: "studio-mono", text: String(line) }))));
}

/** A group of choices (native radios, as R5–R10), `{ element, value, set(v), focus(), error(words) }`. */
export function choiceGroup({ legend, choices, value = "", help = "", onChange = () => {} }) {
  const id = next("studio-research-choice");
  const err = h("p", { id: `${id}-error`, class: "studio-field-error", hidden: true });
  let current = value;
  const inputs = choices.map((choice, index) => {
    const inputId = `${id}-${index}`;
    const input = h("input", { type: "radio", name: id, id: inputId, value: choice.value, class: "studio-radio", checked: choice.value === current,
      "aria-describedby": choice.help ? `${inputId}-help` : null, onChange: () => { current = choice.value; onChange(current); } });
    return { input, row: h("div", { class: "studio-choice" }, input, h("label", { for: inputId, text: choice.label }), choice.help ? h("p", { id: `${inputId}-help`, class: "studio-help", text: choice.help }) : null) };
  });
  const element = h("fieldset", { class: "studio-field-group studio-choices", "aria-describedby": [help ? `${id}-help` : "", `${id}-error`].filter(Boolean).join(" ") },
    h("legend", { text: legend }), inputs.map((item) => item.row), help ? h("p", { id: `${id}-help`, class: "studio-help", text: help }) : null, err);
  return {
    element,
    get value() { return current; },
    set(next) { current = next; for (const { input } of inputs) input.checked = input.value === next; },
    focus() { (inputs.find((item) => item.input.checked) || inputs[0])?.input.focus(); },
    error(words) { err.textContent = words || ""; err.hidden = !words; if (words) element.setAttribute("aria-invalid", "true"); else element.removeAttribute("aria-invalid"); },
  };
}

/**
 * Rows she adds and takes out (people, identifiers, places). `make(row, n, set)` gives the row's
 * fields; `blank()` a new row. `{ element, rows(), focusRow(i), error(words, i) }`.
 */
export function rowsEditor({ legend, help = "", rows = [], max = 0, addLabel, takeOutLabel, blank, make, onChange = () => {} }) {
  const id = next("studio-research-rows");
  let list = rows.map((row) => ({ ...row }));
  const listEl = h("ol", { class: "studio-research-rows" });
  const err = h("p", { id: `${id}-error`, class: "studio-field-error", role: "alert", hidden: true });
  const limit = h("p", { class: "studio-help", hidden: true });
  const add = h("action-button", { variant: "secondary", size: "sm", onClick: () => {
    if (max && list.length >= max) return;
    list.push(blank());
    draw();
    onChange();
    requestAnimationFrame(() => listEl.lastElementChild?.querySelector("input, select, textarea, button")?.focus());
  } }, addLabel);
  function draw() {
    listEl.replaceChildren(...list.map((row, index) => {
      const n = index + 1;
      const set = (patch) => { list[index] = { ...list[index], ...patch }; onChange(); };
      const remove = h("action-button", { variant: "ghost", size: "sm", class: "studio-research-row-out", label: takeOutLabel(n), onClick: () => {
        list.splice(index, 1);
        draw();
        onChange();
        requestAnimationFrame(() => (listEl.children[Math.min(index, list.length - 1)]?.querySelector("input, select") || add).focus?.());
      } }, "×");
      return h("li", { class: "studio-research-row", "data-row": String(index) }, h("div", { class: "studio-research-row-fields" }, make(row, n, set)), remove);
    }));
    add.hidden = Boolean(max && list.length >= max);
  }
  draw();
  const element = h("fieldset", { class: "studio-field-group studio-research-rowset", "aria-describedby": [help ? `${id}-help` : "", `${id}-error`].filter(Boolean).join(" ") },
    h("legend", { text: legend }), help ? h("p", { id: `${id}-help`, class: "studio-help", text: help }) : null, listEl, err, limit, h("div", {}, add));
  return {
    element,
    rows: () => list.map((row) => ({ ...row })),
    set(next) { list = next.map((row) => ({ ...row })); draw(); },
    focusRow(index = 0) { (listEl.children[index]?.querySelector("input, select") || add).focus?.(); },
    error(words, index = -1) {
      err.textContent = words || "";
      err.hidden = !words;
      for (const li of listEl.children) li.removeAttribute("data-invalid");
      if (words && index >= 0) listEl.children[index]?.setAttribute("data-invalid", "true");
    },
  };
}

/** The kind-of-place options, with a kind she already has that isn't one of them kept as it is. */
export function placeOptions(current = "") {
  const options = [{ value: "", label: say("place.choose") }, ...PLACE_KINDS.map((kind) => ({ value: kind, label: placeKindWords(kind) }))];
  if (current && !PLACE_KINDS.includes(current)) options.push({ value: current, label: placeKindWords(current) });
  return options;
}

/** Places as rows: kind, at and to, up to `max`. */
export function placesEditor({ legend, help = "", rows = [], max = 8, onChange = () => {}, addLabel }) {
  return rowsEditor({
    legend, help, rows, max, onChange, addLabel,
    takeOutLabel: (n) => say("place.takeOut", { n }),
    blank: () => ({ kind: "page", value: "", to: "" }),
    make: (row, n, set) => [
      h("select-field", { label: say("place.kindRow", { n }), value: row.kind, options: placeOptions(row.kind), onValuechange: (e) => set({ kind: e.detail }) }),
      h("text-field", { label: say("place.atRow", { n }), value: row.value, onValuechange: (e) => set({ value: e.detail }) }),
      h("text-field", { label: say("place.toRow", { n }), value: row.to || "", onValuechange: (e) => set({ to: e.detail }) }),
    ],
  });
}

/** Save text as a file where her downloads go, made in the page (never fetched). */
export function saveFile(filename, content, type = "application/json") {
  const blob = new Blob([String(content ?? "")], { type });
  const url = URL.createObjectURL(blob);
  const link = h("a", { href: url, download: String(filename || "download") });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---- languages: names she types, tags the record keeps

const COMMON = ["en", "grc", "la", "el", "de", "fr", "es", "it", "pt", "nl", "he", "hbo", "ar", "fa", "syc", "cop", "sa", "zh", "ja", "ko", "ru", "pl", "sv", "da", "no", "fi", "tr", "hu", "cs", "ga", "cy", "ang", "enm", "fro", "goh", "non", "got"];

/** A language's name for a tag ("grc" → "Ancient Greek"), or the tag as written. */
export function languageName(tag) {
  const value = String(tag ?? "").trim();
  if (!value) return "";
  try { return new Intl.DisplayNames(["en"], { type: "language" }).of(value) || value; } catch { return value; }
}

/** The tag for what she typed: a known name, else what she typed (a tag, or text the server checks). */
export function languageTagFor(typed) {
  const value = String(typed ?? "").trim();
  if (!value) return "";
  const lower = value.toLowerCase();
  for (const tag of COMMON) if (languageName(tag).toLowerCase() === lower) return tag;
  return value;
}

/** The names offered as she types a language. */
export const languageNames = () => COMMON.map(languageName);
