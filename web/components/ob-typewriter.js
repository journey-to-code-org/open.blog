// <ob-typewriter> types its text out the first time it scrolls into view.
//
// The complete text is in the DOM from the start (good for search engines,
// screen readers and no-JS), and the visible copy is clipped rather than
// replaced, so the heading's size never changes while it types.
// Respects prefers-reduced-motion by doing nothing at all.

const STEP_MS = 35;

class ObTypewriter extends HTMLElement {
  connectedCallback() {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (this.dataset.done) return;
    this.full = this.textContent;
    if (!this.full.trim()) return;

    // Keep an accessible copy; the animated copy is hidden from assistive tech.
    this.textContent = "";
    const accessible = document.createElement("span");
    accessible.className = "ob-sr-only";
    accessible.textContent = this.full;
    accessible.style.cssText =
      "position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap";
    const sizer = document.createElement("span");
    sizer.setAttribute("aria-hidden", "true");
    sizer.style.visibility = "hidden";
    sizer.textContent = this.full;
    this.visible = document.createElement("span");
    this.visible.setAttribute("aria-hidden", "true");
    this.visible.style.cssText = "position:absolute;inset:0";
    this.append(accessible, sizer, this.visible);

    this.observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        this.observer.disconnect();
        this.#type();
      }
    });
    this.observer.observe(this);
  }

  disconnectedCallback() {
    this.observer?.disconnect();
    clearInterval(this.timer);
  }

  #type() {
    let count = 0;
    this.setAttribute("typing", "");
    this.timer = setInterval(() => {
      count += 1;
      this.visible.textContent = this.full.slice(0, count);
      if (count >= this.full.length) {
        clearInterval(this.timer);
        this.removeAttribute("typing");
        this.dataset.done = "true";
      }
    }, STEP_MS);
  }
}

if (!customElements.get("ob-typewriter")) {
  customElements.define("ob-typewriter", ObTypewriter);
}
