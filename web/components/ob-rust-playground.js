// Progressive enhancement for an author-opted-in `rust runnable` fence. The
// original <pre><code> remains the no-JavaScript fallback; this component adds
// an editor and sends only the reader's source to the official Rust Playground.

import { playgroundUrl, runRust } from "./ob-rust-runner.js";
import { enhanceCode } from "./ob-code.js";

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
    const codeHost = this.closest?.("ob-code");
    const decorationOptions = {
      colour: codeHost?.hasAttribute("highlight") ?? true,
      numbers: codeHost?.hasAttribute("line-numbers") ?? false,
    };

    const shell = element("div", "ob-rust-editor-shell");
    const editorBar = element("div", "ob-rust-editor-bar");
    const editorLabel = element("span", "ob-rust-editor-label", "Rust playground");
    const liveLabel = element("span", "ob-rust-editor-live", "EDITABLE");
    const cursor = element("span", "ob-rust-cursor", "_");
    cursor.setAttribute("aria-hidden", "true");
    liveLabel.append(cursor);
    editorBar.append(editorLabel, liveLabel);

    const editorStack = element("div", "ob-rust-editor-stack");
    const decoration = element("pre", "ob-rust-editor-decoration");
    decoration.setAttribute("aria-hidden", "true");
    const painted = element("code", "language-rust");
    for (const name of ["lineNumbers", "lineStart", "highlightLines"]) {
      if (code.dataset[name] !== undefined) painted.dataset[name] = code.dataset[name];
    }
    decoration.append(painted);

    const editor = element("textarea", "ob-rust-editor");
    editor.value = initial;
    editor.rows = Math.min(24, Math.max(6, initial.replace(/\n$/, "").split("\n").length));
    editor.spellcheck = false;
    editor.setAttribute("aria-label", "Editable Rust code");
    editor.setAttribute("autocapitalize", "off");
    editor.setAttribute("autocomplete", "off");
    editor.setAttribute("wrap", "off");
    editorStack.append(decoration, editor);
    shell.append(editorBar, editorStack);

    const updateDecoration = () => {
      const lineCount = editor.value.replace(/\n$/, "").split("\n").length;
      const asked = painted.dataset.lineNumbers;
      const numbered = asked === "true" || (asked !== "false" && decorationOptions.numbers && lineCount >= 2);
      if (numbered) {
        const start = Math.max(1, Number(painted.dataset.lineStart) || 1);
        shell.dataset.lineNumbers = "true";
        shell.style.setProperty("--ob-rust-line-digits", String(String(start + lineCount - 1).length));
      } else {
        delete shell.dataset.lineNumbers;
      }
      painted.className = "language-rust";
      painted.textContent = editor.value;
      delete painted.dataset.enhanced;
      delete painted.dataset.highlighted;
      delete painted.dataset.language;
      enhanceCode(painted, decorationOptions);
    };
    updateDecoration();

    editor.addEventListener("scroll", () => {
      decoration.scrollTop = editor.scrollTop;
      decoration.scrollLeft = editor.scrollLeft;
    });
    const controls = element("div", "ob-rust-controls");
    const run = element("button", "ob-rust-run", "Run Rust");
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
      "ob-rust-notice",
      "Code runs on the official Rust Playground. open.blog does not store it.",
    );
    const status = element("p", "ob-rust-status", "Ready.");
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
    editor.addEventListener("input", () => {
      updateDecoration();
      updateExternal();
    });
    updateExternal();

    reset.addEventListener("click", () => {
      editor.value = initial;
      output.textContent = "";
      output.hidden = true;
      outputPanel.hidden = true;
      status.textContent = "Reset to the article's example.";
      updateDecoration();
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
