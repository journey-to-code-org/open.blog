// <ob-reading-modes> wraps a post that has author-written supplements
// (ADR 0172). The page is complete without it: every supplement is written out
// visible, labelled and in order, and no control exists until this runs.
//
//   default="guided"  - the mode the author opens the post in (standard if absent)
//
// It adds one radio group (Standard, Guided, Deep dive) and a reset button, and
// shows or hides each `.ob-supplement` by its `data-ob-level`. It never changes
// the article, its citations or its headings. A supplement that holds a warning
// or caution (`data-ob-always`) is never hidden. The reader's choice is kept in
// localStorage on this device, as a preference only: it is never sent anywhere
// and the page works when storage is blocked. Navigating to something inside a
// hidden supplement (a heading, a citation back-link) shows that supplement.
//
// Fields are private (#name): a public field named like an HTMLElement property
// (`hidden`, `popover`, `title`) would silently shadow it.

import {
  LABELS,
  MODES,
  announcement,
  clearPreference,
  countsByMode,
  describe,
  localStore,
  readPreference,
  resolveMode,
  shows,
  writePreference,
} from "./reading-modes.js";

const el = (tag, props = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "class") node.className = value;
    else if (key.startsWith("aria-") || key.startsWith("data-")) node.setAttribute(key, value);
    else node[key] = value;
  }
  node.append(...children);
  return node;
};

const SUPPLEMENTS = ".ob-supplement[data-ob-supplement]";
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
let instances = 0;

class ObReadingModes extends HTMLElement {
  #lifetime = null;
  #supplements = [];
  #radios = new Map();
  #helps = new Map();
  #status = null;
  #reset = null;
  #storage = null;
  #mode = "standard";

  connectedCallback() {
    if (this.dataset.ready) return;
    this.#supplements = [...this.querySelectorAll(SUPPLEMENTS)];
    // Nothing to choose between: add nothing.
    if (!this.#supplements.length) return;
    this.dataset.ready = "true";
    this.#lifetime = new AbortController();
    const { signal } = this.#lifetime;
    this.#storage = localStore();
    this.#build();
    this.#apply(resolveMode(readPreference(this.#storage), this.getAttribute("default")), false);
    addEventListener("hashchange", () => this.#revealHash(), { signal });
    // Another tab of this site chose a mode: follow it.
    addEventListener(
      "storage",
      () => this.#apply(resolveMode(readPreference(this.#storage), this.getAttribute("default")), false),
      { signal },
    );
    if (location.hash) this.#revealHash();
  }

  disconnectedCallback() {
    this.#lifetime?.abort();
  }

  #items() {
    return this.#supplements.map((node) => ({
      level: node.getAttribute("data-ob-level"),
      always: node.hasAttribute("data-ob-always"),
    }));
  }

  #build() {
    const id = ++instances;
    const counts = countsByMode(this.#items());
    const total = this.#supplements.length;
    const group = el("fieldset", { class: "ob-reading-controls" }, el("legend", {}, "Reading mode"));
    const options = el("div", { class: "ob-reading-options" });
    for (const mode of MODES) {
      const input = el("input", {
        type: "radio",
        name: `ob-reading-mode-${id}`,
        id: `ob-reading-mode-${id}-${mode}`,
        value: mode,
      });
      const help = el("span", { class: "ob-reading-help", id: `ob-reading-mode-${id}-${mode}-help` }, describe(mode, counts[mode], total));
      input.setAttribute("aria-describedby", help.id);
      input.addEventListener("change", () => {
        if (!input.checked) return;
        const saved = writePreference(this.#storage, mode);
        this.#apply(mode, true, saved ? "" : " This choice could not be saved on this device, so it applies to this page only.");
      });
      this.#radios.set(mode, input);
      this.#helps.set(mode, help);
      options.append(
        el("div", { class: "ob-reading-option" }, input, el("label", { htmlFor: input.id }, LABELS[mode]), help),
      );
    }
    this.#reset = el("button", { class: "ob-reading-reset", type: "button" }, "Use the author’s default");
    this.#reset.addEventListener("click", () => {
      const cleared = clearPreference(this.#storage);
      this.#apply(
        resolveMode(null, this.getAttribute("default")),
        true,
        cleared ? " Your saved choice was cleared." : " Your saved choice could not be cleared.",
      );
    });
    this.#status = el("p", { class: "ob-visually-hidden", role: "status", "aria-live": "polite" });
    group.append(options, this.#reset);
    this.prepend(group, this.#status);
  }

  /** Shows what `mode` shows. With `announce`, says so, followed by `note`. */
  #apply(mode, announce, note = "") {
    this.#mode = mode;
    this.#radios.get(mode).checked = true;
    let shown = 0;
    for (const node of this.#supplements) {
      const visible = shows(mode, node.getAttribute("data-ob-level"), node.hasAttribute("data-ob-always"));
      node.hidden = !visible;
      node.removeAttribute("data-ob-revealed");
      if (visible) shown += 1;
    }
    this.#reset.disabled = readPreference(this.#storage) === null;
    this.#status.textContent = "";
    if (announce) {
      // A fresh text node each time, so a repeated choice is announced again.
      this.#status.textContent = `${announcement(mode, shown, this.#supplements.length)}${note}`;
    }
  }

  /** Shows the supplement that holds the link target, if it is hidden. */
  #revealHash() {
    let id = "";
    try {
      id = decodeURIComponent(location.hash.slice(1));
    } catch {
      return;
    }
    const target = id ? document.getElementById(id) : null;
    if (!target || !this.contains(target)) return;
    // A note cited only inside supplements names them; the target itself may
    // be a hidden supplement or sit inside one.
    let holder = target.closest(".ob-supplement[hidden]");
    if (!holder) {
      const named = (target.getAttribute("data-ob-supplement") || "").split(/\s+/).find(Boolean);
      const candidate = named ? document.getElementById(named) : null;
      if (candidate && this.contains(candidate) && candidate.matches(SUPPLEMENTS)) holder = candidate;
    }
    if (!holder) return;
    let revealed = null;
    for (let node = holder; node; node = node.parentElement?.closest(SUPPLEMENTS)) {
      if (node.hidden) {
        node.hidden = false;
        node.setAttribute("data-ob-revealed", "");
        revealed ??= node;
      }
    }
    if (!revealed) return;
    const kind = revealed.querySelector(".ob-supplement-kind")?.textContent || "Supplement";
    this.#status.textContent = "";
    this.#status.textContent = `Showed the ${kind.toLowerCase()} supplement that holds this link.`;
    if (!target.matches("a[href], button, input, select, textarea, [tabindex]")) target.tabIndex = -1;
    target.scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" });
    target.focus({ preventScroll: true });
  }
}

if (!customElements.get("ob-reading-modes")) {
  customElements.define("ob-reading-modes", ObReadingModes);
}
