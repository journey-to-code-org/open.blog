// Native top-layer tooltips; links and their title fallback work without this enhancement.
export class ObSeriesPreviews extends HTMLElement {
  connectedCallback() {
    if (this.controller || typeof HTMLElement.prototype.showPopover !== "function") return;
    this.controller = new AbortController();
    const { signal } = this.controller;
    this.triggers = new Map();
    for (const trigger of this.querySelectorAll("[data-series-trigger]")) {
      const panel = trigger.nextElementSibling;
      if (!panel?.matches(".ob-series-preview[popover]")) continue;
      this.triggers.set(trigger, { panel, title: trigger.getAttribute("title") });
      trigger.removeAttribute("title");
      trigger.addEventListener("pointerenter", (event) => {
        if (event.pointerType === "touch") return;
        clearTimeout(this.closeTimer);
        clearTimeout(this.openTimer);
        this.openTimer = setTimeout(() => this.open(trigger), 250);
      }, { signal });
      trigger.addEventListener("pointerleave", () => this.leave(), { signal });
      trigger.addEventListener("focus", () => this.open(trigger), { signal });
      trigger.addEventListener("blur", () => this.leave(), { signal });
      panel.addEventListener("pointerenter", () => clearTimeout(this.closeTimer), { signal });
      panel.addEventListener("pointerleave", () => this.leave(), { signal });
    }
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") this.close();
    }, { signal });
    const outside = (event) => {
      if (event.target !== this.current && !this.panel?.contains(event.target)) this.close();
    };
    document.addEventListener("pointerdown", outside, { signal });
    document.addEventListener("focusin", outside, { signal });
    window.addEventListener("resize", () => this.place(), { signal });
    window.addEventListener("scroll", () => this.place(), { signal, capture: true });
  }

  disconnectedCallback() {
    this.close();
    this.controller?.abort();
    this.controller = null;
    for (const [trigger, { title }] of this.triggers || []) {
      if (title !== null) trigger.setAttribute("title", title);
    }
    this.triggers = null;
  }

  open(trigger) {
    clearTimeout(this.openTimer);
    clearTimeout(this.closeTimer);
    if (this.current === trigger) return;
    this.close();
    this.current = trigger;
    this.panel = this.triggers.get(trigger).panel;
    this.panel.showPopover();
    this.place();
  }

  close() {
    clearTimeout(this.openTimer);
    clearTimeout(this.closeTimer);
    if (this.panel?.matches(":popover-open")) this.panel.hidePopover();
    this.current = null;
    this.panel = null;
  }

  leave() {
    clearTimeout(this.openTimer);
    clearTimeout(this.closeTimer);
    this.closeTimer = setTimeout(() => {
      if (document.activeElement !== this.current) this.close();
    }, 300);
  }

  place() {
    if (!this.current || !this.panel) return;
    const node = this.current.getBoundingClientRect();
    const card = this.panel.getBoundingClientRect();
    const gutter = 8;
    const gap = 4;
    const width = document.documentElement.clientWidth;
    const height = document.documentElement.clientHeight;
    const left = Math.max(gutter, Math.min(node.left, width - card.width - gutter));
    const below = node.bottom + gap;
    const top = below + card.height <= height - gutter ? below : node.top - card.height - gap;
    this.panel.style.left = `${left}px`;
    this.panel.style.top = `${Math.max(gutter, Math.min(top, height - card.height - gutter))}px`;
  }
}

customElements.define("ob-series-previews", ObSeriesPreviews);
