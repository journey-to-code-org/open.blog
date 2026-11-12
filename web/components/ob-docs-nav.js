// <ob-docs-nav> wraps the documentation sidebar (ADR 0405), a plain <details> that is open in
// the HTML so it works without JavaScript. On a narrow screen this folds it once the page
// loads, so the reader sees the page first and opens the list when they want it; on a wide
// screen, where it sits beside the page, it is kept open, and the current page is scrolled into
// view inside it (a folder of hundreds of pages would otherwise hide it).

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
    if (!this.details) return;
    this.details.open = wide.matches;
    const current = this.details.querySelector('[aria-current="page"]');
    if (wide.matches && current && this.details.scrollHeight > this.details.clientHeight) {
      this.details.scrollTop = Math.max(0, current.offsetTop - this.details.clientHeight / 3);
    }
  };
}

if (!customElements.get("ob-docs-nav")) {
  customElements.define("ob-docs-nav", ObDocsNav);
}
