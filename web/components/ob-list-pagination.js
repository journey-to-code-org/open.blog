import { pageCount, pageFromSearch, pageHref, pageRange } from "./list-pagination.js";

class ObListPagination extends HTMLElement {
  #items = [];
  #pageSize = 0;
  #pages = 1;
  #parameter = "page";
  #itemLabel = "items";
  #nav = null;
  #onClick = null;
  #onPopState = null;
  #onPagination = null;

  connectedCallback() {
    const list = this.querySelector(".ob-list");
    this.#pageSize = Number.parseInt(this.getAttribute("page-size") || "", 10);
    this.#parameter = this.getAttribute("page-param") || "page";
    this.#itemLabel = this.getAttribute("item-label") || "items";
    this.#items = list ? Array.from(list.children) : [];
    this.#pages = pageCount(this.#items.length, this.#pageSize);
    if (!list || this.#pages <= 1) return;

    this.#nav = document.createElement("nav");
    this.#nav.className = "ob-pager";
    this.#nav.setAttribute("aria-label", `${this.#itemLabel[0].toUpperCase()}${this.#itemLabel.slice(1)} pages`);
    this.append(this.#nav);

    this.#onClick = (event) => {
      const link = event.target.closest?.("a[data-ob-list-page]");
      if (
        !link ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      event.preventDefault();
      const page = Number.parseInt(link.dataset.obListPage, 10);
      history.pushState(null, "", pageHref(location.href, page, this.#parameter));
      this.#render(true);
      window.dispatchEvent(new CustomEvent("ob:list-pagination", { detail: this }));
    };
    this.#onPopState = () => this.#render(false);
    this.#onPagination = (event) => {
      if (event.detail !== this) this.#render(false);
    };
    this.#nav.addEventListener("click", this.#onClick);
    window.addEventListener("popstate", this.#onPopState);
    window.addEventListener("ob:list-pagination", this.#onPagination);
    this.#render(false);
  }

  disconnectedCallback() {
    if (this.#nav && this.#onClick) this.#nav.removeEventListener("click", this.#onClick);
    if (this.#onPopState) window.removeEventListener("popstate", this.#onPopState);
    if (this.#onPagination) window.removeEventListener("ob:list-pagination", this.#onPagination);
    this.#nav?.remove();
    this.#nav = null;
    this.#onClick = null;
    this.#onPopState = null;
    this.#onPagination = null;
  }

  #edge(page, direction, relation) {
    if (page < 1 || page > this.#pages) return document.createElement("span");
    const link = document.createElement("a");
    link.href = pageHref(location.href, page, this.#parameter);
    link.dataset.obListPage = String(page);
    link.rel = relation;
    link.textContent = direction === "newer" ? `← Newer ${this.#itemLabel}` : `Older ${this.#itemLabel} →`;
    return link;
  }

  #render(focusFirst) {
    const page = pageFromSearch(location.search, this.#pages, this.#parameter);
    const canonical = pageHref(location.href, page, this.#parameter);
    if (`${location.pathname}${location.search}${location.hash}` !== canonical) {
      history.replaceState(null, "", canonical);
    }
    const [start, end] = pageRange(this.#items.length, this.#pageSize, page);
    this.#items.forEach((item, index) => {
      item.hidden = index < start || index >= end;
    });

    const status = document.createElement("span");
    status.className = "ob-pager-status";
    status.setAttribute("aria-live", "polite");
    status.textContent = `Page ${page} of ${this.#pages}`;
    this.#nav.replaceChildren(
      this.#edge(page - 1, "newer", "prev"),
      status,
      this.#edge(page + 1, "older", "next"),
    );

    if (focusFirst) this.#items[start]?.querySelector("a")?.focus();
  }
}

if (!customElements.get("ob-list-pagination")) {
  customElements.define("ob-list-pagination", ObListPagination);
}
