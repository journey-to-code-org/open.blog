// open.blog admin editor: <ob-admin>. A single autonomous custom element that
// renders three views (sign in, content list, editor) with plain DOM calls.
// Nothing user-controlled is ever assigned through innerHTML; the only HTML we
// render from content is the Markdown preview, which goes into a sandboxed
// iframe whose nonce policy runs only the built-in quiz enhancement.

const ADMIN_SCHEME_KEY = "ob-admin-scheme";
const ADMIN_PREVIEW_WIDTH_KEY = "ob-admin-preview-width";

function preferredAdminScheme() {
  try {
    const saved = localStorage.getItem(ADMIN_SCHEME_KEY) || localStorage.getItem("ob-scheme");
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // Storage can be blocked; fall back to the system preference.
  }
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyAdminScheme(scheme, persist = false) {
  document.documentElement.dataset.theme = scheme;
  if (!persist) return;
  try {
    localStorage.setItem(ADMIN_SCHEME_KEY, scheme);
  } catch {
    // The visual change still works when storage is blocked.
  }
}

applyAdminScheme(preferredAdminScheme());

// ---------------------------------------------------------------- helpers

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") el.className = value;
    // The admin's CSP forbids style *attributes*; assigning through the CSSOM is allowed.
    else if (key === "style") el.style.cssText = value;
    else if (key.startsWith("on")) el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (["value", "checked", "disabled", "selected"].includes(key)) el[key] = value;
    else el.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

function themeButton() {
  const icon = h("span", { class: "oba-theme-icon", "aria-hidden": "true" });
  const label = h("span", { class: "oba-theme-label" });
  const button = h("button", { class: "oba-btn oba-theme-toggle", type: "button" }, icon, label);
  const sync = () => {
    const dark = document.documentElement.dataset.theme === "dark";
    const next = dark ? "light" : "dark";
    icon.textContent = dark ? "☀" : "☾";
    label.textContent = dark ? "Light" : "Dark";
    button.setAttribute("aria-label", "Dark mode");
    button.setAttribute("title", `Switch to ${next} mode`);
    button.setAttribute("aria-pressed", String(dark));
  };
  button.addEventListener("click", () => {
    applyAdminScheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark", true);
    sync();
  });
  sync();
  return button;
}

const pad = (n) => String(n).padStart(2, "0");

/** ISO instant -> value for <input type="datetime-local"> in the browser's zone. */
function toLocalInput(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Value from <input type="datetime-local"> -> UTC ISO instant ("" if empty/invalid). */
function fromLocalInput(value) {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function formatWhen(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso || "";
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function searchCommands(commands, query) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return commands;
  return commands.filter((command) => {
    const haystack = `${command.label} ${command.category} ${command.keywords || ""}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

class Api {
  csrf = "";

  async call(method, path, { json, body, headers } = {}) {
    const init = {
      method,
      credentials: "same-origin",
      headers: {
        ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(this.csrf ? { "X-CSRF-Token": this.csrf } : {}),
        ...headers,
      },
      body: json !== undefined ? JSON.stringify(json) : body,
    };
    const res = await fetch(`/admin/api/${path}`, init);
    let data = null;
    try {
      data = await res.json();
    } catch {
      // A non-JSON error page; fall through with null.
    }
    if (!res.ok) throw new ApiError(data?.error || res.statusText || "Request failed", res.status, data);
    return data;
  }
}

let enginePromise;
/** The WebAssembly engine (same Rust code as the build), or null if unavailable. */
function loadEngine() {
  enginePromise ??= (async () => {
    try {
      const mod = await import("/assets/wasm/openblog_wasm.js");
      await mod.default();
      return mod;
    } catch {
      return null;
    }
  })();
  return enginePromise;
}

const KINDS = {
  posts: { label: "Posts", single: "post", titleKey: "title" },
  pages: { label: "Pages", single: "page", titleKey: "title" },
  series: { label: "Series", single: "series", titleKey: "name" },
};

// ---------------------------------------------------------------- component

class ObAdmin extends HTMLElement {
  api = new Api();
  meta = null;
  user = "";
  dirty = false;
  editVersion = 0;
  skipRoute = false;
  currentHash = "";

  connectedCallback() {
    this.addEventListener("input", (e) => {
      if (this.editor && this.editor.root.contains(e.target)) {
        this.dirty = true;
        this.editor.markDirty();
      }
    });
    addEventListener("hashchange", () => this.onHash());
    addEventListener("beforeunload", (e) => {
      if (this.dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    });
    addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        this.openCommandPalette();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s" && this.editor) {
        e.preventDefault();
        this.editor.save();
        return;
      }
      if (this.editor && e.altKey && ["1", "2", "3"].includes(e.key)) {
        e.preventDefault();
        const pane = ["settings", "markdown", "preview"][Number(e.key) - 1];
        this.editor.activatePane(pane, true);
      }
    });
    this.start();
  }

  async start() {
    try {
      const s = await this.api.call("GET", "session");
      this.api.csrf = s.csrf;
      this.user = s.user;
      await this.enter();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) this.showLogin();
      else this.showFatal(err);
    }
  }

  async enter() {
    this.meta = await this.api.call("GET", "meta");
    document.title = `Admin · ${this.meta.siteTitle}`;
    this.onHash();
  }

  // ---- views

  mount(...nodes) {
    this.editor = null;
    this.replaceChildren(...nodes);
  }

  showFatal(err) {
    this.mount(h("div", { class: "oba-card" }, h("h1", {}, "Something went wrong"), h("p", { class: "oba-error", role: "alert" }, err.message)));
  }

  showLogin(message = "") {
    const user = h("input", { id: "oba-user", type: "text", autocomplete: "username", required: true, autocapitalize: "none", spellcheck: "false" });
    const pass = h("input", { id: "oba-pass", type: "password", autocomplete: "current-password", required: true });
    const status = h("p", { class: "oba-error", role: "alert", hidden: !message }, message);
    const submit = h("button", { class: "oba-btn oba-btn-primary", type: "submit" }, "Sign in");
    const form = h(
      "form",
      {
        class: "oba-card",
        onSubmit: async (e) => {
          e.preventDefault();
          submit.disabled = true;
          status.hidden = true;
          try {
            const res = await this.api.call("POST", "login", { json: { username: user.value.trim(), password: pass.value } });
            this.api.csrf = res.csrf;
            this.user = res.user;
            pass.value = "";
            await this.enter();
          } catch (err) {
            status.textContent = err.message;
            status.hidden = false;
            pass.value = "";
            pass.focus();
          } finally {
            submit.disabled = false;
          }
        },
      },
      h("div", { class: "oba-login-head" }, h("div", {}, h("p", { class: "oba-eyebrow" }, "open.blog"), h("h1", {}, "Welcome back")), themeButton()),
      h("p", { class: "oba-login-copy" }, "Sign in to write, preview, and publish your blog."),
      h("div", { class: "oba-field" }, h("label", { for: "oba-user" }, "Username"), user),
      h("div", { class: "oba-field" }, h("label", { for: "oba-pass" }, "Password"), pass),
      status,
      submit,
    );
    this.mount(form);
    user.focus();
  }

  shell(active, ...content) {
    const publishBox = h("span", { class: "oba-publish" });
    this.loadPublishStatus(publishBox);
    const logout = h(
      "button",
      {
        class: "oba-btn",
        type: "button",
        "data-action": "logout",
        onClick: async () => {
          if (!(await this.confirmLeave())) return;
          try {
            await this.api.call("POST", "logout", { json: {} });
          } catch {
            // Already signed out is fine.
          }
          this.api.csrf = "";
          this.showLogin();
        },
      },
      "Sign out",
    );
    const commandTrigger = h(
      "button",
      { class: "oba-btn oba-command-trigger", type: "button", onClick: () => this.openCommandPalette() },
      h("span", {}, "Search workspace"),
      h("kbd", {}, "Ctrl K"),
    );
    const toolGroup = (label, ...tools) =>
      h("div", { class: "oba-tool-group" }, h("span", { class: "oba-tool-label" }, label), h("div", { class: "oba-tool-actions" }, tools));
    const contentTabs = Object.entries(KINDS).map(([kind, info]) =>
      h("a", { class: "oba-tab", "aria-current": kind === active ? "page" : null, href: `#/${kind}` }, info.label),
    );
    const activeInfo = active === "analytics"
      ? { title: "Analytics", detail: "Understand readership without tracking individual readers." }
      : { title: KINDS[active]?.label || "Workspace", detail: "Create, review, and publish content from the files you own." };
    return h(
      "div",
      { class: "oba-shell" },
      h(
        "header",
        { class: "oba-app-header" },
        h(
          "a",
          { class: "oba-brand", href: "#/posts", "aria-label": `${this.meta.siteTitle} admin home` },
          h("span", { class: "oba-brand-mark", "aria-hidden": "true" }, "ob"),
          h("span", { class: "oba-brand-copy" }, h("strong", {}, this.meta.siteTitle), h("small", {}, "Publishing studio")),
        ),
        h("span", { class: "oba-spacer" }),
        commandTrigger,
        h("span", { class: "oba-small" }, `Signed in as ${this.user}`),
        themeButton(),
        logout,
      ),
      h(
        "nav",
        { class: "oba-toolbelt", "aria-label": "Admin tools" },
        toolGroup("Content", ...contentTabs),
        toolGroup("Observe", h("a", { class: "oba-tab", "aria-current": active === "analytics" ? "page" : null, href: "#/analytics" }, "Analytics")),
        toolGroup("Site", h("a", { class: "oba-tab", href: "/", target: "_blank", rel: "noopener" }, "View site ↗")),
      ),
      h(
        "section",
        { class: "oba-context-bar", "aria-label": "Workspace status" },
        h("div", { class: "oba-context-copy" }, h("span", { class: "oba-eyebrow" }, "Workspace"), h("h1", {}, activeInfo.title), h("p", {}, activeInfo.detail)),
        h("span", { class: "oba-spacer" }),
        publishBox,
      ),
      h("main", { class: "oba-workspace-content" }, ...content),
    );
  }

  openCommandPalette() {
    const activeDialog = document.querySelector("dialog[open]");
    if (activeDialog?.classList.contains("oba-command-dialog")) {
      activeDialog.close();
      activeDialog.remove();
      return;
    }
    if (activeDialog) return;
    if (!this.meta) return;

    const trigger = document.activeElement;
    const go = (hash) => (location.hash = hash);
    const commands = [
      { label: "New post", category: "Create", keywords: "write article", run: () => go("#/new/posts") },
      { label: "New page", category: "Create", keywords: "write", run: () => go("#/new/pages") },
      { label: "New series", category: "Create", keywords: "collection", run: () => go("#/new/series") },
      { label: "Posts", category: "Content", keywords: "articles", run: () => go("#/posts") },
      { label: "Pages", category: "Content", run: () => go("#/pages") },
      { label: "Series", category: "Content", run: () => go("#/series") },
      { label: "Analytics", category: "Observe", keywords: "views visitors", run: () => go("#/analytics") },
      { label: "View site", category: "Site", keywords: "public blog", run: () => open("/", "_blank", "noopener") },
      { label: "Switch theme", category: "Workspace", keywords: "dark light mode", run: () => document.querySelector(".oba-theme-toggle")?.click() },
      { label: "Sign out", category: "Account", keywords: "logout", run: () => this.querySelector('[data-action="logout"]')?.click() },
    ];
    if (this.editor) {
      commands.unshift({ label: "Save document", category: "Editor", keywords: "publish ctrl s", run: () => this.editor.save() });
      for (const pane of ["settings", "markdown", "preview"]) {
        commands.unshift({ label: `Show ${pane}`, category: "Editor", keywords: "pane", run: () => this.editor.activatePane(pane) });
      }
    }

    const input = h("input", { id: "oba-command-search", type: "search", autocomplete: "off", placeholder: "Type a command…" });
    const status = h("p", { class: "oba-small", role: "status", "aria-live": "polite" });
    const results = h("div", { class: "oba-command-results", "aria-label": "Command results" });
    const dialog = h(
      "dialog",
      { class: "oba-dialog oba-command-dialog", "aria-labelledby": "oba-command-title" },
      h("div", { class: "oba-command-heading" }, h("div", {}, h("p", { class: "oba-eyebrow" }, "Quick navigation"), h("h2", { id: "oba-command-title" }, "Search workspace")), h("kbd", {}, "Esc")),
      h("label", { class: "oba-field", for: "oba-command-search" }, h("span", { class: "oba-sr" }, "Search commands and content"), input),
      status,
      results,
    );
    let found = [];
    let activeIndex = 0;
    const close = () => {
      dialog.close();
      dialog.remove();
      if (trigger instanceof HTMLElement) trigger.focus();
    };
    const choose = (index) => {
      const command = found[index];
      if (!command) return;
      close();
      command.run();
    };
    const focusResult = (index) => {
      const buttons = [...results.querySelectorAll("button")];
      if (!buttons.length) return;
      activeIndex = (index + buttons.length) % buttons.length;
      buttons[activeIndex].focus();
    };
    const render = () => {
      found = searchCommands(commands, input.value);
      activeIndex = 0;
      results.replaceChildren(
        ...found.map((command, index) =>
          h(
            "button",
            { class: "oba-command-result", type: "button", onClick: () => choose(index) },
            h("span", {}, command.label),
            h("small", {}, command.category),
          ),
        ),
      );
      status.textContent = found.length ? `${found.length} command${found.length === 1 ? "" : "s"}` : "No matching commands.";
    };
    input.addEventListener("input", render);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        choose(0);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        focusResult(0);
      }
    });
    results.addEventListener("keydown", (e) => {
      const current = [...results.querySelectorAll("button")].indexOf(document.activeElement);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        focusResult(current + (e.key === "ArrowDown" ? 1 : -1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        choose(current);
      }
    });
    dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      close();
    });
    document.body.append(dialog);
    render();
    dialog.showModal();
    input.focus();
  }

  /** Fill the header's publish area: pending changes and a Publish button. */
  async loadPublishStatus(box) {
    let st;
    try {
      st = await this.api.call("GET", "publish");
    } catch {
      return;
    }
    if (!st.repo) {
      box.replaceChildren(h("span", { class: "oba-small", title: "Run `openblog publish setup` to publish with git" }, "Not a git repository"));
      return;
    }
    const pending = st.changed.length;
    const drafts = st.drafts.length;
    const summary = [
      pending ? `${pending} unpublished change${pending === 1 ? "" : "s"}` : st.ahead ? `${st.ahead} commit${st.ahead === 1 ? "" : "s"} to push` : "Everything published",
      drafts ? `${drafts} draft${drafts === 1 ? "" : "s"} kept local` : null,
      st.behind ? `${st.behind} new elsewhere` : null,
    ].filter(Boolean).join(" · ");
    const button = h(
      "button",
      {
        class: `oba-btn ${pending || st.ahead ? "oba-btn-primary" : ""}`,
        type: "button",
        disabled: !(pending || st.ahead),
        title: st.remote ? `Commit and push to ${st.remote}` : "Commit locally (no remote configured)",
        onClick: async () => {
          button.disabled = true;
          button.textContent = "Publishing…";
          try {
            const res = await this.api.call("POST", "publish", { json: { summary: "" } });
            box.replaceChildren(h("span", { class: "oba-ok" }, res.message));
            setTimeout(() => this.loadPublishStatus(box), 4000);
          } catch (err) {
            box.replaceChildren(h("span", { class: "oba-error", role: "alert" }, err.data?.error || err.message), button);
            button.disabled = false;
            button.textContent = "Publish";
          }
        },
      },
      st.auto ? "Publish now" : "Publish",
    );
    box.replaceChildren(h("span", { class: "oba-small" }, summary + (st.auto ? " · auto" : "")), " ", button);
  }

  async confirmLeave() {
    if (!this.dirty) return true;
    return confirm("You have unsaved changes. Leave without saving?");
  }

  async onHash() {
    if (this.skipRoute) {
      this.skipRoute = false;
      this.currentHash = location.hash;
      return;
    }
    const nextHash = location.hash || "#/posts";
    if (this.dirty && this.currentHash && nextHash !== this.currentHash && !(await this.confirmLeave())) {
      history.replaceState(null, "", this.currentHash);
      return;
    }
    const hash = location.hash.replace(/^#\/?/, "");
    const [head, ...rest] = hash.split("/");
    const tail = rest.join("/");
    this.dirty = false;
    try {
      if (head === "edit" && tail) await this.showEditor(decodeURIComponent(tail));
      else if (head === "new" && KINDS[tail]) await this.showEditor(null, tail);
      else if (head === "analytics") await this.showAnalytics(Number(tail) || 30);
      else await this.showList(KINDS[head] ? head : "posts");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) this.showLogin("Your session ended. Sign in again.");
      else this.showFatal(err);
    }
    this.currentHash = location.hash || "#/posts";
  }

  // ---- list

  async showList(kind) {
    const [list, status] = await Promise.all([
      this.api.call("GET", `documents?kind=${kind}`),
      this.api.call("GET", "status"),
    ]);
    const items = list.items;
    const filter = h("input", { class: "oba-search", type: "search", placeholder: `Filter ${KINDS[kind].label.toLowerCase()}…`, "aria-label": "Filter" });
    const stateSel = h(
      "select",
      { class: "oba-search", "aria-label": "Status", style: null },
      ["all", "published", "scheduled", "draft", "error"].map((s) => h("option", { value: s }, s === "all" ? "All statuses" : s[0].toUpperCase() + s.slice(1))),
    );
    const tbody = h("tbody");
    const render = () => {
      const q = filter.value.trim().toLowerCase();
      const wanted = stateSel.value;
      const rows = items.filter(
        (i) => (wanted === "all" || i.status === wanted) && (!q || `${i.title} ${(i.tags || []).join(" ")} ${i.series || ""}`.toLowerCase().includes(q)),
      );
      tbody.replaceChildren(
        ...rows.map((i) =>
          h(
            "tr",
            {},
            h("td", {}, h("span", { class: `oba-badge oba-badge-${i.status}` }, i.status)),
            h("td", {}, h("a", { href: `#/edit/${encodeURIComponent(i.path)}` }, i.title || i.path), i.error ? h("div", { class: "oba-small" }, i.error) : null),
            h("td", { title: i.date || "" }, i.date ? formatWhen(i.date) : ""),
            h("td", { class: "oba-small" }, [...(i.series ? [`Series: ${i.series}`] : []), ...(i.tags || [])].join(", ")),
          ),
        ),
      );
      if (!rows.length) tbody.append(h("tr", {}, h("td", { colspan: 4 }, items.length ? "Nothing matches." : `No ${KINDS[kind].label.toLowerCase()} yet.`)));
    };
    filter.addEventListener("input", render);
    stateSel.addEventListener("change", render);
    render();

    const dateHeader = kind === "posts" ? "Date" : "";
    const table = h(
      "table",
      { class: "oba-table" },
      h("thead", {}, h("tr", {}, h("th", {}, "Status"), h("th", {}, "Title"), h("th", {}, dateHeader), h("th", {}, "Details"))),
      tbody,
    );
    const rebuild = h(
      "button",
      {
        class: "oba-btn",
        type: "button",
        onClick: async () => {
          rebuild.disabled = true;
          try {
            await this.api.call("POST", "rebuild", { json: {} });
            this.showList(kind);
          } catch (err) {
            alert(err.data?.error || err.message);
            rebuild.disabled = false;
          }
        },
      },
      "Rebuild site",
    );
    const banner = [];
    if (status.lastError) banner.push(h("p", { class: "oba-error", role: "alert" }, `The last site build failed: ${status.lastError}`));
    if (status.scheduled.length) {
      banner.push(
        h(
          "p",
          { class: "oba-notice" },
          `${status.scheduled.length} scheduled ${status.scheduled.length === 1 ? "post" : "posts"} waiting. Next: “${status.scheduled[0].title}” on ${formatWhen(status.scheduled[0].date)}.`,
        ),
      );
    }
    this.mount(
      this.shell(
        kind,
        ...banner,
        h("div", { class: "oba-toolbar" }, h("a", { class: "oba-btn oba-btn-primary", href: `#/new/${kind}`, style: null }, `New ${KINDS[kind].single}`), filter, kind === "posts" ? stateSel : null, h("span", { class: "oba-spacer" }), rebuild),
        table,
      ),
    );
  }

  // ---- analytics

  async showAnalytics(days) {
    let data;
    try {
      data = await this.api.call("GET", `analytics?days=${days}`);
    } catch (err) {
      if (err.status === 404) {
        this.mount(this.shell("analytics", h("p", { class: "oba-notice" }, "The built-in view counter is switched off (analytics.builtin in openblog.json).")));
        return;
      }
      throw err;
    }
    const n = (v) => Number(v || 0).toLocaleString();
    const tile = (label, value, note) =>
      h("div", { class: "oba-tile" }, h("span", { class: "oba-tile-value" }, value), h("span", { class: "oba-tile-label" }, label), note ? h("span", { class: "oba-small" }, note) : null);
    const ranges = h(
      "div",
      { class: "oba-tabs" },
      [7, 30, 90, 365].map((d) => h("a", { class: "oba-tab", "aria-selected": String(d === data.days), href: `#/analytics/${d}` }, `${d} days`)),
    );
    const maxViews = Math.max(1, ...data.series.map((s) => s.views));
    const bars = h(
      "ol",
      { class: "oba-chart", "aria-label": "Views per day" },
      data.series.map((s) =>
        h(
          "li",
          { title: `${s.day}: ${n(s.views)} views, ${n(s.uniques)} visitors` },
          h("span", { class: "oba-chart-bar", style: `height:${Math.round((s.views / maxViews) * 100)}%` }),
          h("span", { class: "oba-sr" }, `${s.day}: ${s.views} views`),
        ),
      ),
    );
    const table = (caption, rows, cols) =>
      h(
        "table",
        { class: "oba-table" },
        h("caption", { class: "oba-legend" }, caption),
        h("thead", {}, h("tr", {}, cols.map((c) => h("th", {}, c)))),
        h("tbody", {}, rows.length ? rows : h("tr", {}, h("td", { colspan: cols.length }, "Nothing yet."))),
      );
    const posts = data.topPosts.map((p) =>
      h("tr", {}, h("td", {}, h("a", { href: p.path, target: "_blank", rel: "noopener" }, p.path)), h("td", {}, n(p.views)), h("td", {}, n(p.uniques)), h("td", {}, n(p.allTime))),
    );
    const refs = data.referrers.map((r) => h("tr", {}, h("td", {}, r.host), h("td", {}, n(r.views))));
    const agents = data.agents.map((agent) =>
      h("tr", {}, h("td", {}, agent.name), h("td", {}, agent.category), h("td", {}, n(agent.requests))),
    );
    const agentPages = data.agentPages.map((page) =>
      h("tr", {}, h("td", {}, h("a", { href: page.path, target: "_blank", rel: "noopener" }, page.path)), h("td", {}, n(page.requests)), h("td", {}, page.agents.join(", "))),
    );
    this.mount(
      this.shell(
        "analytics",
        ranges,
        h("div", { class: "oba-tiles" }, tile("Views", n(data.views), `${data.from} to ${data.to}`), tile("Unique visitors", n(data.uniques), "per page, per day"), tile("All-time views", n(data.allTimeViews), data.firstDay ? `since ${data.firstDay}` : ""), tile("AI agent requests", n(data.agentRequests), "server-observed user-agent claims")),
        bars,
        h("div", { class: "oba-columns" }, table("Top pages", posts, ["Page", "Views", "Visitors", "All time"]), table("Referrers", refs, ["Site", "Views"])),
        h("div", { class: "oba-columns" }, table("AI agents", agents, ["Agent", "Kind", "Requests"]), table("Pages requested by AI agents", agentPages, ["Page", "Requests", "Named agents"])),
        h("p", { class: "oba-small" }, "No cookies, addresses, or raw user-agent strings are stored. AI labels are aggregate user-agent claims and may be spoofed. Readers with Do Not Track or Global Privacy Control are not counted."),
      ),
    );
  }

  // ---- editor

  async showEditor(path, newKind) {
    let doc;
    if (path) {
      doc = await this.api.call("GET", `document?path=${encodeURIComponent(path)}`);
      if (doc.raw !== undefined) {
        this.mount(
          this.shell(
            doc.kind,
            h("p", { class: "oba-error", role: "alert" }, `${path} can't be opened in the editor: ${doc.error}. Fix its front matter in a text editor.`),
          ),
        );
        return;
      }
    } else {
      doc = { path: null, kind: newKind, etag: null, fields: {}, body: "" };
    }
    const editor = new Editor(this, doc);
    this.editor = editor;
    this.replaceChildren(this.shell(doc.kind, editor.render()));
    this.editor = editor;
    editor.afterMount();
  }
}

// ---------------------------------------------------------------- editor

class Editor {
  constructor(app, doc) {
    this.app = app;
    this.doc = doc;
    this.kind = doc.kind;
    this.isNew = !doc.path;
    this.f = { ...doc.fields };
    this.slugTouched = !this.isNew;
    this.previewTimer = 0;
  }

  get meta() {
    return this.app.meta;
  }

  initialStatus() {
    if (this.kind !== "posts") return "published";
    if (String(this.f.draft || "").toLowerCase() === "true") return "draft";
    if (this.f.date && new Date(this.f.date) > new Date()) return "scheduled";
    return this.isNew ? "draft" : "published";
  }

  field(id, label, control, help) {
    return h("div", { class: "oba-field" }, h("label", { for: id }, label), control, help ? h("p", { class: "oba-help" }, help) : null);
  }

  render() {
    const kind = this.kind;
    const titleKey = KINDS[kind].titleKey;
    const f = this.f;
    this.ui = {};
    const ui = this.ui;

    ui.title = h("input", { class: "oba-title-input", id: "oba-title", type: "text", placeholder: kind === "series" ? "Series name" : "Title", value: f[titleKey] || "", "aria-label": "Title" });
    ui.body = h("textarea", { class: "oba-body", id: "oba-body", spellcheck: "true", "aria-label": "Markdown", value: this.doc.body || "" });
    ui.preview = h("iframe", { class: "oba-preview", title: "Preview", sandbox: "allow-scripts" });
    ui.status = h("div", { role: "status", "aria-live": "polite" });
    ui.documentStats = h("span", { class: "oba-small" });
    ui.saveState = h("span", { class: "oba-save-state", role: "status", "aria-live": "polite" }, this.isNew ? "Not saved yet" : "Saved");

    const side = [];

    if (kind === "posts") {
      const status = this.initialStatus();
      ui.statusRadios = ["draft", "published", "scheduled"].map((value) =>
        h("label", {}, h("input", { type: "radio", name: "oba-status", value, checked: value === status }), " ", { draft: "Draft", published: "Published", scheduled: "Scheduled" }[value]),
      );
      ui.date = h("input", { id: "oba-date", type: "datetime-local", value: f.date ? toLocalInput(f.date) : "" });
      ui.dateField = this.field("oba-date", "Publish at", ui.date, `Your local time. A scheduled post goes live automatically at this moment, while the server is running.`);
      side.push(
        h("fieldset", { class: "oba-fieldset" }, h("legend", { class: "oba-legend" }, "Status"), h("div", { class: "oba-radios" }, ui.statusRadios)),
        ui.dateField,
      );
    }

    ui.slug = h("input", { id: "oba-slug", type: "text", value: f.slug || (this.isNew ? "" : this.slugFromPath()), autocapitalize: "none", spellcheck: "false" });
    side.push(this.field("oba-slug", "Slug", ui.slug, this.isNew ? "Part of the web address." : "Changing the slug changes the post's address."));

    if (kind === "posts") {
      ui.description = h("textarea", { id: "oba-desc", rows: 3, value: f.description || "" });
      side.push(this.field("oba-desc", "Description", ui.description, "Shown in search results and feeds. Leave empty to use an excerpt."));
      ui.tags = h("input", { id: "oba-tags", type: "text", list: "oba-taglist", value: (Array.isArray(f.tags) ? f.tags : f.tags ? [f.tags] : []).join(", ") });
      side.push(
        this.field("oba-tags", "Tags", ui.tags, "Comma separated."),
        h("datalist", { id: "oba-taglist" }, this.meta.tags.map((t) => h("option", { value: t }))),
      );
      ui.series = h(
        "select",
        { id: "oba-series" },
        h("option", { value: "" }, "None"),
        this.meta.series.map((s) => h("option", { value: s.slug, selected: s.slug === f.series }, s.name)),
      );
      if (f.series && !this.meta.series.some((s) => s.slug === f.series)) ui.series.append(h("option", { value: f.series, selected: true }, f.series));
      ui.order = h("input", { id: "oba-order", type: "number", min: 1, value: f.seriesOrder || "" });
      side.push(this.field("oba-series", "Series", ui.series), this.field("oba-order", "Part number", ui.order, "Optional. Defaults to date order."));
    } else if (kind === "pages") {
      ui.description = h("textarea", { id: "oba-desc", rows: 3, value: f.description || "" });
      ui.nav = h("input", { id: "oba-nav", type: "checkbox", checked: String(f.nav || "").toLowerCase() === "true" });
      side.push(this.field("oba-desc", "Description", ui.description), h("div", { class: "oba-field" }, h("label", { for: "oba-nav" }, ui.nav, " Show in the header navigation")));
    } else {
      ui.order = h("input", { id: "oba-order", type: "number", min: 0, value: f.order || "" });
      side.push(this.field("oba-order", "List order", ui.order, "Lower numbers first."));
    }

    ui.theme = h(
      "select",
      { id: "oba-theme" },
      h("option", { value: "" }, `Inherit (${kind === "posts" ? "series or site theme" : "site theme"})`),
      this.meta.themes.map((t) => h("option", { value: t.name, selected: t.name === f.theme }, t.label || t.name)),
    );
    side.push(this.field("oba-theme", "Theme", ui.theme));

    if (kind !== "pages") {
      ui.cover = h("input", { id: "oba-cover", type: "text", value: f.cover || "", placeholder: "/images/…" });
      ui.coverFile = h("input", { type: "file", accept: "image/png,image/jpeg,image/gif,image/webp,image/avif", class: "oba-sr", tabindex: "-1", "aria-hidden": "true" });
      ui.coverFile.addEventListener("change", async () => {
        const file = ui.coverFile.files[0];
        if (file) {
          const url = await this.upload(file);
          if (url) {
            ui.cover.value = url;
            this.app.dirty = true;
            this.markDirty();
            this.updateSeoAudit();
          }
        }
        ui.coverFile.value = "";
      });
      const coverButton = h("button", { class: "oba-btn", type: "button", onClick: () => ui.coverFile.click() }, "Upload cover");
      side.push(this.field("oba-cover", "Cover image", ui.cover), coverButton, ui.coverFile);
    }
    if (kind === "posts") {
      ui.canonical = h("input", { id: "oba-canonical", type: "text", value: f.canonical || "", placeholder: "https://…" });
      side.push(this.field("oba-canonical", "Canonical URL", ui.canonical, "Only for posts first published elsewhere."));
      ui.coverAlt = h("input", { id: "oba-cover-alt", type: "text", value: f.coverAlt || "", placeholder: "Describe the meaningful image content" });
      side.push(this.field("oba-cover-alt", "Cover alternative text", ui.coverAlt, "Required when the cover conveys information; also helps image discovery."));
      ui.seoAudit = h("ul", { class: "oba-seo-checks", "aria-live": "polite" });
      side.push(h("fieldset", { class: "oba-fieldset" }, h("legend", { class: "oba-legend" }, "Search & answer readiness"), ui.seoAudit));
    }

    ui.saveBtn = h("button", { class: "oba-btn oba-btn-primary", type: "button", onClick: () => this.save() }, this.isNew ? "Create" : "Save");
    ui.deleteBtn = this.isNew ? null : h("button", { class: "oba-btn oba-btn-danger", type: "button", onClick: () => this.remove() }, "Move to trash");
    ui.live = h("span", { class: "oba-small" });

    const imageButton = h("button", { class: "oba-btn", type: "button", onClick: () => ui.imageFile.click() }, "Insert image");
    const quizButton = kind === "posts" ? h("button", { class: "oba-btn oba-btn-feature", type: "button", onClick: () => this.openKnowledgeCheck() }, "✦ Add knowledge check") : null;
    ui.imageFile = h("input", { type: "file", accept: "image/png,image/jpeg,image/gif,image/webp,image/avif", class: "oba-sr", tabindex: "-1", "aria-hidden": "true" });
    ui.imageFile.addEventListener("change", async () => {
      const file = ui.imageFile.files[0];
      if (file) await this.insertImage(file);
      ui.imageFile.value = "";
    });
    const back = h("a", { class: "oba-btn", href: `#/${kind}` }, "← Back");
    const toolbar = h("div", { class: "oba-toolbar oba-editor-actions" }, back, ui.saveBtn, ui.deleteBtn, imageButton, quizButton, ui.imageFile, ui.live, h("span", { class: "oba-small" }, "Ctrl+S saves"));

    let savedPreviewWidth = "wide";
    try {
      const stored = localStorage.getItem(ADMIN_PREVIEW_WIDTH_KEY);
      if (["wide", "tablet", "mobile"].includes(stored)) savedPreviewWidth = stored;
    } catch {
      // Storage can be blocked; use the wide preview for this session.
    }
    ui.previewWidth = h(
      "select",
      { class: "oba-preview-width", "aria-label": "Preview width" },
      ["wide", "tablet", "mobile"].map((width) => h("option", { value: width, selected: width === savedPreviewWidth }, width[0].toUpperCase() + width.slice(1))),
    );

    const paneHeader = (eyebrow, title, trailing = null) =>
      h(
        "header",
        { class: "oba-pane-header" },
        h("div", {}, h("span", { class: "oba-pane-eyebrow" }, eyebrow), h("h2", {}, title)),
        trailing,
      );
    let paneButtons = [];
    const activatePane = (pane, focus = false) => {
      this.root.dataset.mobilePane = pane;
      for (const button of paneButtons) {
        const selected = button.dataset.paneTarget === pane;
        button.setAttribute("aria-pressed", String(selected));
      }
      if (focus) {
        const container = this.root.querySelector(`[data-pane="${pane}"]`);
        const target = pane === "markdown" ? this.ui.body : pane === "preview" ? this.ui.preview : container?.querySelector("input,select,textarea,button");
        requestAnimationFrame(() => target?.focus());
      }
    };
    this.activatePane = activatePane;
    paneButtons = ["settings", "markdown", "preview"].map((pane) =>
      h(
        "button",
        {
          class: "oba-tab",
          type: "button",
          "data-pane-target": pane,
          "aria-pressed": String(pane === "markdown"),
          onClick: () => activatePane(pane),
        },
        pane[0].toUpperCase() + pane.slice(1),
      ),
    );
    const mobileNav = h("nav", { class: "oba-mobile-nav", "aria-label": "Editor panes" }, paneButtons);

    this.root = h(
      "div",
      { class: "oba-editor", "data-mobile-pane": "markdown", "data-preview-width": savedPreviewWidth },
      mobileNav,
      h("aside", { class: "oba-side oba-pane", "data-pane": "settings", "aria-label": "Document settings" }, paneHeader("Document", "Settings"), h("div", { class: "oba-side-fields" }, side)),
      h(
        "div",
        { class: "oba-main" },
        toolbar,
        ui.status,
        ui.title,
        h(
          "div",
          { class: "oba-panes" },
          h("section", { class: "oba-pane oba-markdown-pane", "data-pane": "markdown", "aria-label": "Markdown editor" }, paneHeader("Write", "Markdown", h("span", { class: "oba-small" }, "Plain text · portable")), ui.body),
          h(
            "section",
            { class: "oba-pane oba-preview-pane", "data-pane": "preview", "aria-label": "Live preview" },
            paneHeader("Review", "Live preview", h("div", { class: "oba-preview-tools" }, h("span", { class: "oba-live-dot" }, "Live"), ui.previewWidth)),
            h("div", { class: "oba-preview-canvas" }, ui.preview),
          ),
        ),
        h("footer", { class: "oba-editor-status" }, ui.saveState, h("span", { class: "oba-spacer" }), ui.documentStats, h("span", { class: "oba-small" }, "Markdown · UTF-8")),
      ),
    );
    return this.root;
  }

  slugFromPath() {
    const name = (this.doc.path || "").split("/").pop().replace(/\.md$/, "");
    return name.replace(/^\d{4}-\d{2}-\d{2}-/, "");
  }

  afterMount() {
    const ui = this.ui;
    ui.title.addEventListener("input", () => {
      if (!this.slugTouched) ui.slug.value = slugify(ui.title.value);
    });
    ui.slug.addEventListener("input", () => (this.slugTouched = true));
    ui.body.addEventListener("input", () => this.schedulePreview());
    ui.body.addEventListener("input", () => this.updateDocumentStats());
    ui.theme.addEventListener("change", () => this.schedulePreview());
    ui.previewWidth.addEventListener("input", (e) => e.stopPropagation());
    ui.previewWidth.addEventListener("change", () => {
      this.root.dataset.previewWidth = ui.previewWidth.value;
      try {
        localStorage.setItem(ADMIN_PREVIEW_WIDTH_KEY, ui.previewWidth.value);
      } catch {
        // The preview still changes when storage is blocked.
      }
    });
    for (const r of ui.statusRadios || []) r.querySelector("input").addEventListener("change", () => this.syncDateField());
    for (const control of [ui.title, ui.description, ui.tags, ui.cover, ui.coverAlt, ui.body].filter(Boolean)) {
      control.addEventListener("input", () => this.updateSeoAudit());
    }

    // Drag and drop or paste an image into the Markdown.
    ui.body.addEventListener("dragover", (e) => {
      if ([...(e.dataTransfer?.types || [])].includes("Files")) {
        e.preventDefault();
        ui.body.classList.add("oba-dropping");
      }
    });
    ui.body.addEventListener("dragleave", () => ui.body.classList.remove("oba-dropping"));
    ui.body.addEventListener("drop", async (e) => {
      ui.body.classList.remove("oba-dropping");
      const file = [...(e.dataTransfer?.files || [])].find((f) => f.type.startsWith("image/"));
      if (file) {
        e.preventDefault();
        await this.insertImage(file);
      }
    });
    ui.body.addEventListener("paste", async (e) => {
      const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith("image/"));
      if (file) {
        e.preventDefault();
        await this.insertImage(file);
      }
    });

    this.syncDateField();
    this.updateSeoAudit();
    this.updateDocumentStats();
    this.renderPreview();
    (this.isNew ? ui.title : ui.body).focus();
  }

  syncDateField() {
    if (!this.ui.dateField) return;
    this.ui.dateField.hidden = this.currentStatus() === "draft";
  }

  currentStatus() {
    if (this.kind !== "posts") return "published";
    return this.ui.statusRadios.map((l) => l.querySelector("input")).find((i) => i.checked)?.value || "draft";
  }

  markDirty() {
    if (!this.ui?.saveState) return;
    this.app.editVersion += 1;
    if (this.ui.saveState.textContent === "Unsaved changes") return;
    this.ui.saveState.textContent = "Unsaved changes";
    this.ui.saveState.classList.add("is-dirty");
  }

  updateDocumentStats() {
    const text = this.ui.body.value;
    const lines = text ? text.split("\n").length : 1;
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const characters = text.length;
    this.ui.documentStats.textContent = `${lines} line${lines === 1 ? "" : "s"} · ${words.toLocaleString()} word${words === 1 ? "" : "s"} · ${characters.toLocaleString()} character${characters === 1 ? "" : "s"}`;
  }

  updateSeoAudit() {
    const ui = this.ui;
    if (!ui.seoAudit) return;
    const titleLength = ui.title.value.trim().length;
    const descriptionLength = ui.description.value.trim().length;
    const body = ui.body.value.trim();
    const checks = [
      [titleLength > 0 && titleLength <= 70, "Concise title", titleLength ? `${titleLength} characters` : "Add a descriptive title"],
      [descriptionLength >= 50 && descriptionLength <= 180, "Useful description", descriptionLength ? `${descriptionLength} characters; aim for 50–180` : "Summarize the answer and its value"],
      [ui.tags.value.split(",").some((tag) => tag.trim()), "Topic signals", "Add at least one specific tag"],
      [!ui.cover.value.trim() || ui.coverAlt.value.trim().length > 0, "Accessible cover", "Describe a cover image when it conveys information"],
      [/^#{2,3}\s+\S/m.test(body), "Scannable sections", "Use descriptive H2/H3 headings for readers and answer engines"],
      [this.meta.authorReady, "Author identity", "Set author.name and author.url in openblog.json"],
    ];
    ui.seoAudit.replaceChildren(
      ...checks.map(([ok, label, detail]) =>
        h("li", { class: ok ? "is-ready" : "needs-work" }, h("strong", {}, `${ok ? "Ready" : "Improve"}: ${label}`), h("span", {}, detail)),
      ),
    );
  }

  schedulePreview() {
    clearTimeout(this.previewTimer);
    this.previewTimer = setTimeout(() => this.renderPreview(), 250);
  }

  async renderPreview() {
    const body = this.ui.body.value;
    let html;
    const engine = await loadEngine();
    if (engine) {
      html = JSON.parse(engine.renderMarkdown(body)).html;
    } else {
      try {
        html = (await this.app.api.call("POST", "preview", { json: { body } })).html;
      } catch {
        html = "<p>Preview unavailable.</p>";
      }
    }
    const known = this.meta.themes.map((t) => t.name);
    const chosen = this.ui.theme.value || this.meta.defaultTheme;
    const theme = known.includes(chosen) ? chosen : "base";
    const nonce = [...crypto.getRandomValues(new Uint8Array(16))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    this.ui.preview.srcdoc =
      `<!doctype html><html><head><meta charset="utf-8"><base target="_blank">` +
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src http: https:; img-src http: https: data:; font-src http: https: data:; script-src 'nonce-${nonce}'">` +
      `<link rel="stylesheet" href="/assets/base.css"><link rel="stylesheet" href="/themes/${theme}/tokens.css">` +
      `</head><body data-ob-theme="${theme}"><div class="ob-container ob-container-reading"><div class="ob-prose">${html}</div></div>` +
      `<script nonce="${nonce}" src="/assets/components/ob-quiz.js"></script></body></html>`;
  }

  async upload(file) {
    try {
      const res = await this.app.api.call("POST", `upload?name=${encodeURIComponent(file.name)}`, {
        body: file,
        headers: { "Content-Type": "application/octet-stream" },
      });
      this.flash("ok", `Uploaded ${res.url}`);
      return res.url;
    } catch (err) {
      this.flash("error", err.message);
      return null;
    }
  }

  async insertImage(file) {
    const url = await this.upload(file);
    if (!url) return;
    const alt = file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
    const ta = this.ui.body;
    const snippet = `![${alt}](${url})`;
    const start = ta.selectionStart ?? ta.value.length;
    const end = ta.selectionEnd ?? start;
    ta.value = ta.value.slice(0, start) + snippet + ta.value.slice(end);
    ta.selectionStart = ta.selectionEnd = start + snippet.length;
    this.app.dirty = true;
    this.markDirty();
    this.schedulePreview();
    this.updateSeoAudit();
    this.updateDocumentStats();
    ta.focus();
  }

  openKnowledgeCheck() {
    const trigger = document.activeElement;
    const dialog = h("dialog", { class: "oba-dialog", "aria-labelledby": "oba-quiz-title" });
    const questions = h("div", { class: "oba-quiz-editors" });
    const status = h("p", { class: "oba-error", role: "alert", hidden: true });
    let count = 0;

    const addQuestion = (draft = null) => {
      if (count >= 3) return;
      count += 1;
      const number = count;
      const promptId = `oba-quiz-prompt-${number}`;
      const feedbackId = `oba-quiz-feedback-${number}`;
      const prompt = h("input", { id: promptId, type: "text", required: true, placeholder: "What should the reader remember?", value: draft?.prompt || "" });
      const explanation = h("textarea", { id: feedbackId, rows: 2, placeholder: "Optional explanation shown after answering", value: draft?.explanation || "" });
      const draftChoices = Array.isArray(draft?.choices) && draft.choices.length >= 2 ? draft.choices.slice(0, 4) : ["", "", ""];
      const choices = draftChoices.map((choice, index) => {
        const choiceId = `oba-quiz-${number}-choice-${index + 1}`;
        const correct = h("input", { type: "radio", name: `oba-correct-${number}`, value: index, checked: index === (draft?.correctIndex ?? 0), "aria-label": `Choice ${index + 1} is correct` });
        const text = h("input", { id: choiceId, type: "text", required: true, placeholder: index === 0 ? "Correct answer" : "Other answer", value: choice });
        return h("div", { class: "oba-quiz-choice-edit" }, correct, h("label", { for: choiceId, class: "oba-sr" }, `Answer ${index + 1}`), text);
      });
      const fieldset = h(
        "fieldset",
        { class: "oba-quiz-editor" },
        h("legend", {}, `Question ${number}`),
        h("div", { class: "oba-field" }, h("label", { for: promptId }, "Question"), prompt),
        h("p", { class: "oba-help" }, "Select the radio button beside the correct answer."),
        ...choices,
        h("div", { class: "oba-field" }, h("label", { for: feedbackId }, "Feedback"), explanation),
      );
      fieldset.quizControls = { prompt, choices, explanation };
      questions.append(fieldset);
      add.disabled = count >= 3;
      prompt.focus();
    };

    const add = h("button", { class: "oba-btn", type: "button", onClick: addQuestion }, "Add another question");
    const generation = [];
    if (this.meta.quizGeneration) {
      const amount = h("select", { "aria-label": "Number of generated questions" }, [1, 2, 3].map((n) => h("option", { value: n, selected: n === 1 }, `${n} question${n === 1 ? "" : "s"}`)));
      const generate = h("button", {
        class: "oba-btn oba-btn-primary",
        type: "button",
        onClick: async () => {
          const ta = this.ui.body;
          const selected = ta.value.slice(ta.selectionStart ?? 0, ta.selectionEnd ?? 0).trim();
          let context = selected;
          if (!context) {
            const cursor = ta.selectionStart ?? ta.value.length;
            const before = ta.value.slice(0, cursor);
            const heading = [...before.matchAll(/^#{1,6}\s+.+$/gm)].pop();
            if (heading) {
              const rest = ta.value.slice(cursor);
              const next = rest.match(/^#{1,6}\s+.+$/m);
              const end = next?.index === undefined ? ta.value.length : cursor + next.index;
              context = ta.value.slice(heading.index, end).trim();
            } else {
              context = ta.value.trim();
            }
          }
          generate.disabled = true;
          status.hidden = true;
          try {
            const result = await this.app.api.call("POST", "quiz/generate", { json: { context, count: Number(amount.value) } });
            questions.replaceChildren();
            count = 0;
            result.questions.forEach((question) => addQuestion(question));
            status.textContent = "Draft questions generated. Review every answer before inserting.";
            status.className = "oba-ok";
            status.hidden = false;
          } catch (error) {
            status.textContent = error.message;
            status.className = "oba-error";
            status.hidden = false;
          } finally {
            generate.disabled = false;
          }
        },
      }, "Generate draft");
      generation.push(h("div", { class: "oba-generation" }, h("span", {}, "Use the selected text or current section:"), amount, generate));
    }
    const close = (focusBody = false) => {
      dialog.close();
      dialog.remove();
      if (focusBody) this.ui.body.focus();
      else if (trigger instanceof HTMLElement) trigger.focus();
    };
    const insert = h("button", {
      class: "oba-btn oba-btn-primary",
      type: "button",
      onClick: () => {
        const oneLine = (value) => value.trim().replace(/\s+/g, " ");
        const blocks = [];
        for (const fieldset of questions.children) {
          const { prompt, choices, explanation } = fieldset.quizControls;
          const question = oneLine(prompt.value);
          const answers = choices.map((row) => oneLine(row.querySelector('input[type="text"]').value));
          if (!question || answers.some((answer) => !answer)) {
            status.className = "oba-error";
            status.textContent = "Every question and answer choice is required.";
            status.hidden = false;
            return;
          }
          if ([question, ...answers, explanation.value].some((value) => value.includes("```"))) {
            status.className = "oba-error";
            status.textContent = "Knowledge-check text cannot contain a triple backtick.";
            status.hidden = false;
            return;
          }
          const correct = choices.findIndex((row) => row.querySelector('input[type="radio"]').checked);
          const lines = ["```quiz", question, ...answers.map((answer, index) => `- [${index === correct ? "x" : " "}] ${answer}`)];
          const feedback = oneLine(explanation.value);
          if (feedback) lines.push(`> ${feedback}`);
          lines.push("```");
          blocks.push(lines.join("\n"));
        }
        const ta = this.ui.body;
        const at = ta.selectionEnd ?? ta.value.length;
        const before = ta.value.slice(0, at).replace(/\s*$/, "");
        const after = ta.value.slice(at).replace(/^\s*/, "");
        const snippet = `${before ? "\n\n" : ""}${blocks.join("\n\n")}${after ? "\n\n" : ""}`;
        ta.value = before + snippet + after;
        ta.selectionStart = ta.selectionEnd = (before + snippet).length;
        this.app.dirty = true;
        this.markDirty();
        this.schedulePreview();
        this.updateDocumentStats();
        close(true);
      },
    }, "Insert");
    dialog.append(
      h("h2", { id: "oba-quiz-title" }, "Add a knowledge check"),
      h("p", { class: "oba-help" }, "Add up to three short multiple-choice questions. Readers get feedback immediately."),
      ...generation,
      questions,
      status,
      h("div", { class: "oba-toolbar" }, add, h("span", { class: "oba-spacer" }), h("button", { class: "oba-btn", type: "button", onClick: () => close() }, "Cancel"), insert),
    );
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      close();
    });
    document.body.append(dialog);
    addQuestion();
    dialog.showModal();
  }

  flash(kind, message, problems = [], action = null) {
    const box = h("p", { class: kind === "error" ? "oba-error" : "oba-ok", role: kind === "error" ? "alert" : null }, message);
    if (problems.length) box.append(h("ul", {}, problems.map((p) => h("li", {}, p))));
    if (action) box.append(" ", action);
    this.ui.status.replaceChildren(box);
  }

  /** Build the front matter object from the form, keeping fields the form doesn't know about. */
  collect() {
    const ui = this.ui;
    const fields = { ...this.f };
    const set = (key, value) => {
      const empty = value === "" || value === null || value === undefined || (Array.isArray(value) && !value.length);
      if (empty) delete fields[key];
      else fields[key] = value;
    };
    const titleKey = KINDS[this.kind].titleKey;
    set(titleKey, ui.title.value.trim());
    set("slug", ui.slug.value.trim());
    set("theme", ui.theme.value);
    if (ui.cover) set("cover", ui.cover.value.trim());
    if (this.kind === "posts") {
      set("description", ui.description.value.trim());
      set("tags", ui.tags.value.split(",").map((t) => t.trim()).filter(Boolean));
      set("series", ui.series.value);
      set("seriesOrder", ui.order.value);
      set("canonical", ui.canonical.value.trim());
      set("coverAlt", ui.coverAlt.value.trim());
      const status = this.currentStatus();
      const picked = fromLocalInput(ui.date.value);
      if (status === "draft") {
        set("draft", "true");
        set("date", picked || fields.date || "");
      } else {
        delete fields.draft;
        if (status === "scheduled") {
          set("date", picked);
        } else {
          // Published: keep an existing past date, otherwise publish now.
          const keep = picked && new Date(picked) <= new Date() ? picked : "";
          set("date", keep || nowIso());
        }
      }
    } else if (this.kind === "pages") {
      set("description", ui.description.value.trim());
      set("nav", ui.nav.checked ? "true" : "");
    } else {
      set("order", ui.order.value);
    }
    return fields;
  }

  validateClient(fields) {
    if (!fields[KINDS[this.kind].titleKey] && !fields.slug) return "Give it a title first.";
    if (this.kind === "posts" && this.currentStatus() === "scheduled") {
      if (!fields.date) return "Pick the date and time to publish.";
      if (new Date(fields.date) <= new Date()) return "A scheduled post needs a time in the future. Choose “Published” to publish now.";
    }
    return "";
  }

  async save() {
    if (this.saving) return;
    const fields = this.collect();
    const problem = this.validateClient(fields);
    if (problem) {
      this.flash("error", problem);
      return;
    }
    const ui = this.ui;
    this.saving = true;
    ui.saveBtn.disabled = true;
    ui.saveState.textContent = "Saving…";
    const saveVersion = this.app.editVersion;
    const payload = { fields, body: ui.body.value, etag: this.doc.etag, kind: this.kind };
    try {
      const res = this.doc.path
        ? await this.app.api.call("PUT", `document?path=${encodeURIComponent(this.doc.path)}`, { json: payload })
        : await this.app.api.call("POST", "document", { json: payload });
      this.f = fields;
      this.doc.path = res.path;
      this.doc.etag = res.etag;
      this.isNew = false;
      this.slugTouched = true;
      if (this.app.editVersion === saveVersion) {
        this.app.dirty = false;
        ui.saveState.textContent = "Saved";
        ui.saveState.classList.remove("is-dirty");
      } else {
        this.app.dirty = true;
        ui.saveState.textContent = "Unsaved changes";
        ui.saveState.classList.add("is-dirty");
      }
      ui.saveBtn.textContent = "Save";
      // Update the address without re-rendering the editor. Only arm the skip flag
      // when the hash really changes; otherwise no event fires and the flag would
      // swallow the next genuine navigation.
      const target = `#/edit/${encodeURIComponent(res.path)}`;
      if (location.hash !== target) {
        this.app.skipRoute = true;
        location.hash = target;
      }
      this.reportSaved(res, this.app.editVersion === saveVersion);
    } catch (err) {
      if (err.status === 401) {
        this.app.showLogin("Your session ended. Sign in again; your edits are still in the form only until you reload.");
      } else if (err.status === 409) {
        this.flash("error", err.message, [], h("button", { class: "oba-btn", type: "button", onClick: () => location.reload() }, "Reload"));
      } else {
        this.flash("error", err.message, err.data?.problems || []);
      }
      ui.saveState.textContent = "Save failed";
      ui.saveState.classList.add("is-dirty");
    } finally {
      this.saving = false;
      ui.saveBtn.disabled = false;
    }
  }

  reportSaved(res, current = true) {
    let message = "Saved.";
    const link = res.url ? h("a", { href: res.url, target: "_blank", rel: "noopener" }, "View on the site") : null;
    if (res.status === "scheduled") message = `Scheduled for ${formatWhen(this.f.date)}. It goes live automatically.`;
    else if (res.status === "published" && res.url) message = "Saved and live.";
    else if (res.status === "draft") message = "Draft saved. It is not public.";
    if (!current) message = "Saved the earlier version. Your newer edits are still unsaved.";
    if (res.build && res.build.ok === false) {
      this.flash("error", `Saved, but the site build failed: ${res.build.error}`);
    } else {
      this.flash("ok", message, [], link);
    }
    this.ui.live.textContent = "";
  }

  async remove() {
    if (!confirm("Move this to the trash? It is removed from the site but kept in .openblog/trash.")) return;
    try {
      await this.app.api.call("DELETE", `document?path=${encodeURIComponent(this.doc.path)}`);
      this.app.dirty = false;
      location.hash = `#/${this.kind}`;
    } catch (err) {
      this.flash("error", err.message);
    }
  }
}

if (!customElements.get("ob-admin")) customElements.define("ob-admin", ObAdmin);
