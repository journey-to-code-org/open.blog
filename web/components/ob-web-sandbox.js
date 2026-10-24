// A dependency-free HTML/CSS/JavaScript lesson runner. Preview documents run
// in an opaque-origin iframe whose CSP blocks external resources and network APIs.

const MAX_SOURCE = 100_000;
let sandboxSequence = 0;
export const WEB_SANDBOX_PERMISSIONS = "allow-scripts";
export const WEB_SANDBOX_WARNING = "External resources and network APIs are blocked. Do not enter secrets; code can navigate its own preview.";

export function parseWebSandbox(source) {
  const files = { html: "", css: "", js: "" };
  let active = null;
  let markers = 0;
  for (const line of String(source || "").replace(/\r\n?/g, "\n").split("\n")) {
    const marker = /^---(html|css|js)\s*$/.exec(line);
    if (marker) {
      active = marker[1];
      markers += 1;
    } else if (active) {
      files[active] += `${files[active] ? "\n" : ""}${line}`;
    }
  }
  if (!markers || !Object.values(files).some((value) => value.trim()) || String(source).length > MAX_SOURCE) return null;
  return files;
}

export function webSandboxDocument({ html = "", css = "", js = "" }) {
  const safeCss = css.replace(/<\/style/gi, "<\\/style");
  const safeJs = js.replace(/<\/script/gi, "<\\/script");
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; font-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'"><style>${safeCss}</style></head><body>${html}<script>${safeJs}<\/script></body></html>`;
}

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

export class ObWebSandbox extends HTMLElement {
  connectedCallback() {
    if (this.dataset.enhanced) return;
    const pre = this.querySelector("pre");
    const code = pre?.querySelector("code");
    const initial = parseWebSandbox(code?.textContent || "");
    if (!initial) return;
    const instanceId = this.id || `ob-web-sandbox-${++sandboxSequence}`;
    pre.hidden = true;
    const editors = {};
    const shell = el("div", "ob-web-sandbox-shell");
    const tabs = el("div", "ob-web-sandbox-tabs");
    tabs.setAttribute("role", "group");
    tabs.setAttribute("aria-label", "Choose code editor");
    const panels = el("div", "ob-web-sandbox-editors");
    let active = "html";
    const select = (name) => {
      active = name;
      for (const [key, editor] of Object.entries(editors)) {
        editor.hidden = key !== name;
        editor.button.setAttribute("aria-pressed", String(key === name));
      }
      editors[name].focus();
    };
    for (const name of ["html", "css", "js"]) {
      const button = el("button", "ob-web-sandbox-tab", name === "js" ? "JavaScript" : name.toUpperCase());
      button.type = "button";
      const editor = el("textarea", "ob-web-sandbox-editor");
      editor.id = `${instanceId}-${name}-editor`;
      editor.value = initial[name];
      editor.rows = 12;
      editor.spellcheck = false;
      editor.setAttribute("aria-label", `Editable ${name === "js" ? "JavaScript" : name.toUpperCase()}`);
      button.setAttribute("aria-controls", editor.id);
      editor.button = button;
      button.addEventListener("click", () => select(name));
      tabs.append(button);
      panels.append(editor);
      editors[name] = editor;
    }
    const controls = el("div", "ob-web-sandbox-controls");
    const run = el("button", "", "Run preview");
    const reset = el("button", "", "Reset");
    run.type = reset.type = "button";
    const warning = el("p", "ob-web-sandbox-warning", WEB_SANDBOX_WARNING);
    const status = el("p", "ob-web-sandbox-status", "Preview ready.");
    status.setAttribute("role", "status");
    const frame = el("iframe", "ob-web-sandbox-preview");
    frame.title = "Web sandbox preview";
    frame.setAttribute("sandbox", WEB_SANDBOX_PERMISSIONS);
    frame.setAttribute("referrerpolicy", "no-referrer");
    const render = () => {
      frame.srcdoc = webSandboxDocument({ html: editors.html.value, css: editors.css.value, js: editors.js.value });
      status.textContent = "Preview updated in an isolated sandbox.";
    };
    run.addEventListener("click", render);
    reset.addEventListener("click", () => {
      for (const name of ["html", "css", "js"]) editors[name].value = initial[name];
      render();
      editors[active].focus();
    });
    controls.append(run, reset);
    shell.append(tabs, panels, controls, warning, status, frame);
    this.append(shell);
    this.dataset.enhanced = "true";
    select("html");
    render();
  }
}

if (!customElements.get("ob-web-sandbox")) customElements.define("ob-web-sandbox", ObWebSandbox);
