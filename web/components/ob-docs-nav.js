// <ob-docs-nav> wraps the documentation sidebar (ADR 0405), a plain <details> that is open in
// the HTML so it works without JavaScript. On a narrow screen this folds it once the page
// loads, so the reader sees the page first and opens the list when they want it; on a wide
// screen, where it sits beside the page, it is kept open.

const wide = matchMedia("(min-width: 60rem)");

class ObDocsNav extends HTMLElement {
  connectedCallback() {
    this.details = this.querySelector("details");
    wide.addEventListener("change", this.#update);
    this.#update();
  }

  disconnectedCallback() {
    wide.removeEventListener("change", this.#update);
  }

  #update = () => {
    if (this.details) this.details.open = wide.matches;
  };
}

if (!customElements.get("ob-docs-nav")) {
  customElements.define("ob-docs-nav", ObDocsNav);
}
