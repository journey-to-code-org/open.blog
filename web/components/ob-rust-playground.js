// Progressive enhancement for an author-opted-in `rust runnable` fence. The
// original <pre><code> remains the no-JavaScript fallback; this component adds
// an editor and sends only the reader's source to the official Rust Playground.

import { playgroundUrl, runRust } from "./ob-rust-runner.js";
import { codeSettings, createCodeEditor } from "./ob-code-editor.js";

function element(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function combinedOutput({ stdout, stderr }) {
  if (!stdout) return stderr;
  if (!stderr) return stdout;
  return `${stdout}${stdout.endsWith("\n") ? "" : "\n"}${stderr}`;
}

class ObRustPlayground extends HTMLElement {
  connectedCallback() {
    if (this.dataset.enhanced) return;
    const pre = this.querySelector("pre");
    const code = pre?.querySelector("code");
    if (!code) return;
    pre.classList.add("ob-rust-source");

    const initial = code.textContent;
    const { shell, editor, refresh } = createCodeEditor({
      prefix: "ob-rust",
      language: "rust",
      label: "Rust playground",
      ariaLabel: "Editable Rust code",
      value: initial,
      source: code,
      ...codeSettings(this),
    });

    const controls = element("div", "ob-code-editor-controls ob-rust-controls");
    const run = element("button", "ob-code-editor-run ob-rust-run", "Run Rust");
    const reset = element("button", "ob-rust-reset", "Reset");
    const copy = element("button", "ob-rust-copy", "Copy");
    for (const button of [run, reset, copy]) button.type = "button";
    const external =
      this.dataset.playgroundLink === "false"
        ? null
        : element("a", "ob-rust-external", "Open in Rust Playground");
    if (external) {
      external.target = "_blank";
      external.rel = "noopener noreferrer";
    }
    controls.append(run, reset, copy, ...(external ? [external] : []));

    const notice = element(
      "p",
      "ob-code-editor-note ob-rust-notice",
      "Code runs on the official Rust Playground. open.blog does not store it.",
    );
    const status = element("p", "ob-code-editor-status ob-rust-status", "Ready.");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    const output = element("pre", "ob-rust-output");
    output.hidden = true;
    output.tabIndex = 0;
    output.setAttribute("aria-label", "Rust compiler and program output");

    const outputPanel = element("section", "ob-rust-output-panel");
    const outputLabel = element("div", "ob-rust-output-label", "Console output");
    outputPanel.hidden = true;
    outputPanel.append(outputLabel, output);

    function updateExternal() {
      if (external) external.href = playgroundUrl(editor.value);
    }
    editor.addEventListener("input", updateExternal);
    updateExternal();

    reset.addEventListener("click", () => {
      editor.value = initial;
      output.textContent = "";
      output.hidden = true;
      outputPanel.hidden = true;
      status.textContent = "Reset to the article's example.";
      refresh();
      updateExternal();
      editor.focus();
    });

    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(editor.value);
        copy.textContent = "Copied";
      } catch {
        copy.textContent = "Copy failed";
      }
      clearTimeout(this.copyTimer);
      this.copyTimer = setTimeout(() => (copy.textContent = "Copy"), 1600);
    });

    run.addEventListener("click", async () => {
      if (this.runController) return;
      const controller = new AbortController();
      this.runController = controller;
      this.runTimer = setTimeout(() => controller.abort(), 20_000);
      run.setAttribute("aria-disabled", "true");
      run.setAttribute("aria-busy", "true");
      output.hidden = true;
      outputPanel.hidden = true;
      status.textContent = "Compiling and running on the Rust Playground…";
      try {
        const result = await runRust(editor.value, { signal: controller.signal });
        output.textContent = combinedOutput(result) || "Program finished without output.";
        output.hidden = false;
        outputPanel.hidden = false;
        status.textContent = result.success ? "Finished." : "Compilation failed.";
      } catch (error) {
        output.textContent =
          error?.name === "AbortError"
            ? "The Rust Playground did not respond within 20 seconds."
            : `${error?.message || "The Rust Playground request failed."}${external ? " You can still use the Open in Rust Playground link." : ""}`;
        output.hidden = false;
        outputPanel.hidden = false;
        status.textContent = "Could not run this example here.";
      } finally {
        clearTimeout(this.runTimer);
        this.runController = null;
        this.runTimer = null;
        run.removeAttribute("aria-disabled");
        run.removeAttribute("aria-busy");
      }
    });

    this.append(shell, controls, notice, status, outputPanel);
    this.dataset.enhanced = "true";
  }

  disconnectedCallback() {
    clearTimeout(this.copyTimer);
    clearTimeout(this.runTimer);
    this.runController?.abort();
  }
}

if (!customElements.get("ob-rust-playground")) {
  customElements.define("ob-rust-playground", ObRustPlayground);
}
