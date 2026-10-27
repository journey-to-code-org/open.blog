// <ob-explanation-levels> adds a level selector to an interpretation comparison
// page (ADR 0306, #90). The page is complete without it: every explanation
// level is a section of the page, linked from a list of links, in a fixed
// order, and the interpretations and their evidence sit above the levels
// where no level can reach them.
//
// With JavaScript the component replaces the list of links with a group of
// buttons: "All levels" (the starting state, so nothing is hidden until the
// reader chooses) and one button per level that has explanations. Choosing a
// level hides the other level sections with the `hidden` attribute and says
// what is shown in a polite status line. It never moves focus, never touches
// anything outside the level sections (so the quoted evidence is the same at
// every level), and stores nothing. A link to a level, or to an explanation
// inside one, shows it. Print shows every level.

const LEVELS = ["beginner", "student", "scholarly"];
const ALL = "all";

const label = (level) => level.charAt(0).toUpperCase() + level.slice(1);

/** The levels a page offers, in the fixed order, from its level sections. */
export function levelsOf(values) {
  return LEVELS.filter((level) => values.includes(level));
}

/**
 * The level a URL fragment asks for: `#level-student` names student, and
 * `#level-student-heading` too. Anything else is no request.
 */
export function levelFromHash(hash, levels) {
  const match = /^#level-([a-z]+)(?:-heading)?$/.exec(typeof hash === "string" ? hash : "");
  return match && levels.includes(match[1]) ? match[1] : null;
}

/** What the status line says for the choice. */
export function statusFor(choice) {
  if (choice === ALL) return "Showing every explanation level.";
  return `Showing the ${choice} explanations. The interpretations and their evidence above are unchanged.`;
}

const BaseElement = globalThis.HTMLElement ?? class {};

export class ObExplanationLevels extends BaseElement {
  #controller = null;
  #added = [];
  #hiddenNav = null;

  connectedCallback() {
    if (this.#controller) return;
    const sections = [...this.querySelectorAll("section.ob-level[data-level]")];
    const levels = levelsOf(sections.map((section) => section.getAttribute("data-level")));
    if (levels.length < 2) return;
    const controller = new AbortController();
    const { signal } = controller;
    this.#controller = controller;

    const make = (tag, props = {}, text = "") => {
      const element = document.createElement(tag);
      for (const [name, value] of Object.entries(props)) element.setAttribute(name, value);
      if (text) element.textContent = text;
      return element;
    };
    const nav = this.querySelector("nav.ob-level-links");
    const group = make("div", { class: "ob-level-switch", role: "group", "aria-label": "Explanation level" });
    const status = make("p", { class: "ob-meta ob-level-status", role: "status", "aria-live": "polite" });
    const buttons = new Map();
    for (const choice of [ALL, ...levels]) {
      const button = make("button", { type: "button", "aria-pressed": "false", "data-choice": choice }, choice === ALL ? "All levels" : label(choice));
      buttons.set(choice, button);
      group.append(button);
    }
    if (nav) {
      this.insertBefore(group, nav);
      nav.hidden = true;
      this.#hiddenNav = nav;
    } else {
      this.prepend(group);
    }
    group.after(status);
    this.#added.push(group, status);

    let current = ALL;
    const choose = (choice, announce = true) => {
      current = choice;
      for (const section of sections) {
        section.hidden = choice !== ALL && section.getAttribute("data-level") !== choice;
      }
      for (const [name, button] of buttons) button.setAttribute("aria-pressed", String(name === choice));
      status.textContent = announce ? statusFor(choice) : "";
    };
    choose(ALL, false);

    group.addEventListener(
      "click",
      (event) => {
        const button = event.target instanceof Element ? event.target.closest("button[data-choice]") : null;
        if (button) choose(button.getAttribute("data-choice"));
      },
      { signal },
    );

    // A link to a level shows that level; a link to anything inside a hidden
    // level shows every level so the target is never hidden.
    const follow = () => {
      const hash = globalThis.location?.hash ?? "";
      const level = levelFromHash(hash, levels);
      if (level) return choose(level);
      if (current === ALL || !hash) return;
      let target = null;
      try {
        target = this.querySelector(`#${CSS.escape(decodeURIComponent(hash.slice(1)))}`);
      } catch {
        target = null;
      }
      if (target && target.closest("[hidden]")) choose(ALL);
    };
    globalThis.addEventListener?.("hashchange", follow, { signal });
    follow();
  }

  disconnectedCallback() {
    this.#controller?.abort();
    this.#controller = null;
    for (const element of this.#added) element.remove();
    this.#added = [];
    if (this.#hiddenNav) this.#hiddenNav.hidden = false;
    this.#hiddenNav = null;
    for (const section of this.querySelectorAll("section.ob-level[hidden]")) section.hidden = false;
  }
}

if (globalThis.customElements && !globalThis.customElements.get("ob-explanation-levels")) {
  globalThis.customElements.define("ob-explanation-levels", ObExplanationLevels);
}
