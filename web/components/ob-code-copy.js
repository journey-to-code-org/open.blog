// <ob-code-copy> wraps rendered Markdown and adds a "Copy" button to every
// code block. Without JS the code blocks are simply plain <pre>.

class ObCodeCopy extends HTMLElement {
  connectedCallback() {
    if (!navigator.clipboard) return;
    for (const pre of this.querySelectorAll("pre")) {
      if (pre.querySelector(".ob-copy")) continue;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ob-copy";
      button.textContent = "Copy";
      button.setAttribute("aria-label", "Copy code to clipboard");
      button.addEventListener("click", async () => {
        const code = pre.querySelector("code")?.textContent ?? pre.textContent;
        try {
          await navigator.clipboard.writeText(code);
          button.textContent = "Copied";
        } catch {
          button.textContent = "Failed";
        }
        setTimeout(() => (button.textContent = "Copy"), 1600);
      });
      pre.append(button);
    }
  }
}

if (!customElements.get("ob-code-copy")) {
  customElements.define("ob-code-copy", ObCodeCopy);
}
