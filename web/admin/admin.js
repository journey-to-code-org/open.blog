// open.blog admin editor: <ob-admin>. A single autonomous custom element that
// renders three views (sign in, content list, editor) with plain DOM calls.
// Nothing user-controlled is ever assigned through innerHTML; the only HTML we
// render from content is the Markdown preview, which goes into a sandboxed
// iframe that cannot run scripts.

// Follow the colour scheme the reader chose on the blog (the page's CSP forbids inline scripts).
try {
  const saved = localStorage.getItem("ob-scheme");
  if (saved === "light" || saved === "dark") document.documentElement.dataset.theme = saved;
} catch {
  // Storage can be blocked; fall back to the system preference.
}

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
  skipRoute = false;

  connectedCallback() {
    this.addEventListener("input", (e) => {
      if (this.editor && this.editor.root.contains(e.target)) this.dirty = true;
    });
    addEventListener("hashchange", () => this.onHash());
    addEventListener("beforeunload", (e) => {
      if (this.dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    });
    addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s" && this.editor) {
        e.preventDefault();
        this.editor.save();
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
      h("h1", {}, "Sign in"),
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
    const tabs = h(
      "div",
      { class: "oba-tabs", role: "tablist" },
      Object.entries(KINDS).map(([kind, info]) =>
        h("a", { class: "oba-tab", role: "tab", "aria-selected": String(kind === active), href: `#/${kind}` }, info.label),
      ),
      h("a", { class: "oba-tab", role: "tab", "aria-selected": String(active === "analytics"), href: "#/analytics" }, "Analytics"),
    );
    return h(
      "div",
      { class: "oba-shell" },
      h(
        "header",
        { class: "oba-bar" },
        h("h1", {}, this.meta.siteTitle),
        h("span", { class: "oba-small" }, "Admin"),
        h("span", { class: "oba-spacer" }),
        h("a", { href: "/", target: "_blank", rel: "noopener" }, "View site"),
        publishBox,
        h("span", { class: "oba-small" }, `Signed in as ${this.user}`),
        logout,
      ),
      tabs,
      ...content,
    );
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
    this.mount(
      this.shell(
        "analytics",
        ranges,
        h("div", { class: "oba-tiles" }, tile("Views", n(data.views), `${data.from} to ${data.to}`), tile("Unique visitors", n(data.uniques), "per page, per day"), tile("All-time views", n(data.allTimeViews), data.firstDay ? `since ${data.firstDay}` : "")),
        bars,
        h("div", { class: "oba-columns" }, table("Top pages", posts, ["Page", "Views", "Visitors", "All time"]), table("Referrers", refs, ["Site", "Views"])),
        h("p", { class: "oba-small" }, "No cookies and no addresses are stored. Readers with Do Not Track or Global Privacy Control are not counted."),
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
    ui.preview = h("iframe", { class: "oba-preview", title: "Preview", sandbox: "" });
    ui.status = h("div", { role: "status", "aria-live": "polite" });

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
    }

    ui.saveBtn = h("button", { class: "oba-btn oba-btn-primary", type: "button", onClick: () => this.save() }, this.isNew ? "Create" : "Save");
    ui.deleteBtn = this.isNew ? null : h("button", { class: "oba-btn oba-btn-danger", type: "button", onClick: () => this.remove() }, "Move to trash");
    ui.live = h("span", { class: "oba-small" });

    const imageButton = h("button", { class: "oba-btn", type: "button", onClick: () => ui.imageFile.click() }, "Insert image");
    ui.imageFile = h("input", { type: "file", accept: "image/png,image/jpeg,image/gif,image/webp,image/avif", class: "oba-sr", tabindex: "-1", "aria-hidden": "true" });
    ui.imageFile.addEventListener("change", async () => {
      const file = ui.imageFile.files[0];
      if (file) await this.insertImage(file);
      ui.imageFile.value = "";
    });
    const back = h("a", { class: "oba-btn", href: `#/${kind}` }, "← Back");
    const toolbar = h("div", { class: "oba-toolbar" }, back, ui.saveBtn, ui.deleteBtn, imageButton, ui.imageFile, ui.live, h("span", { class: "oba-small" }, "Ctrl+S saves"));

    this.root = h(
      "div",
      { class: "oba-editor" },
      h("aside", { class: "oba-side", "aria-label": "Settings" }, side),
      h("div", { class: "oba-main" }, toolbar, ui.status, ui.title, h("div", { class: "oba-panes" }, ui.body, ui.preview)),
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
    ui.theme.addEventListener("change", () => this.schedulePreview());
    for (const r of ui.statusRadios || []) r.querySelector("input").addEventListener("change", () => this.syncDateField());

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
    this.ui.preview.srcdoc =
      `<!doctype html><html><head><meta charset="utf-8"><base target="_blank">` +
      `<link rel="stylesheet" href="/assets/base.css"><link rel="stylesheet" href="/themes/${theme}/tokens.css">` +
      `</head><body data-ob-theme="${theme}"><div class="ob-container ob-container-reading"><div class="ob-prose">${html}</div></div></body></html>`;
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
    this.schedulePreview();
    ta.focus();
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
    const fields = this.collect();
    const problem = this.validateClient(fields);
    if (problem) {
      this.flash("error", problem);
      return;
    }
    const ui = this.ui;
    ui.saveBtn.disabled = true;
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
      this.app.dirty = false;
      ui.saveBtn.textContent = "Save";
      // Update the address without re-rendering the editor. Only arm the skip flag
      // when the hash really changes; otherwise no event fires and the flag would
      // swallow the next genuine navigation.
      const target = `#/edit/${encodeURIComponent(res.path)}`;
      if (location.hash !== target) {
        this.app.skipRoute = true;
        location.hash = target;
      }
      this.reportSaved(res);
    } catch (err) {
      if (err.status === 401) {
        this.app.showLogin("Your session ended. Sign in again; your edits are still in the form only until you reload.");
      } else if (err.status === 409) {
        this.flash("error", err.message, [], h("button", { class: "oba-btn", type: "button", onClick: () => location.reload() }, "Reload"));
      } else {
        this.flash("error", err.message, err.data?.problems || []);
      }
    } finally {
      ui.saveBtn.disabled = false;
    }
  }

  reportSaved(res) {
    let message = "Saved.";
    const link = res.url ? h("a", { href: res.url, target: "_blank", rel: "noopener" }, "View on the site") : null;
    if (res.status === "scheduled") message = `Scheduled for ${formatWhen(this.f.date)}. It goes live automatically.`;
    else if (res.status === "published" && res.url) message = "Saved and live.";
    else if (res.status === "draft") message = "Draft saved. It is not public.";
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
