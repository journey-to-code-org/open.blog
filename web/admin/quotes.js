// <ob-quote-requests>: the Requests screen of optional quote requests (ADR 0384). The owner reads
// new requests newest first, copies a phone number or email with one tap, marks a request handled
// or archived, exports a range as CSV, and erases requests after a preview and a confirmation.
// When the email that tells the owner about a request did not go out (ADR 0383), the request says
// so and the page offers to send those emails again.
// There is no scoring, pipeline or automation beyond the status.
//
// Everything here is a request to the Admin server, which holds the key to the hosted function:
// this page never sees a key, a database or Supabase. Status is words plus a symbol (never colour
// alone), every control is a native button, link, select or checkbox, focus goes somewhere sensible
// after each change, and the layout is one column that wraps long values, so it holds at 400 px.

import { el } from "./block-forms.js";

let uid = 0;

export const STATUS_WORDS = Object.freeze({
  new: { symbol: "●", text: "New" },
  handled: { symbol: "✓", text: "Handled" },
  archived: { symbol: "–", text: "Archived" },
});

export const OFF_TEXT = Object.freeze({
  off: "Quote requests are not set up. They are optional and off by default; your site works the same without them. To turn them on, follow docs/quote-requests.md, then set OPENBLOG_QUOTE_ENDPOINT and OPENBLOG_QUOTE_ADMIN_KEY where Admin runs.",
  invalid: "Admin's quote settings are not valid, so the feature stays off. Fix these settings, then reload:",
  unavailable: "Admin reached the quote function, but it says quote requests are not enabled there. Set OPENBLOG_QUOTE_ENABLED=true in its environment.",
});

/** Why the email about a request did not go out, in plain words (the hosted notifier's fixed codes). */
export const NOTIFY_REASONS = Object.freeze({
  "refused-key": "the email service did not accept the key it was given",
  rejected: "the email service turned the message down; the sender address may need checking",
  "rate-limited": "the email service was too busy",
  "provider-error": "the email service had a problem",
  timeout: "the email service did not answer in time",
  network: "the email service could not be reached",
});
/** How many times the hosted function tries one email before it stops (ADR 0383). */
export const MAX_NOTIFY_ATTEMPTS = 5;
const STALE_PENDING_MS = 10 * 60 * 1000;

const DAY = 24 * 60 * 60 * 1000;
const errorText = (error) => String(error?.message || "That did not work. Try again.");
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const date = (stamp) => (stamp ? String(stamp).slice(0, 10) : "");

/** "in 12 days (2026-11-30)", "today", or "overdue" for an archived request. */
export function countdown(eraseAfter, now = Date.now()) {
  if (!eraseAfter) return "";
  const left = Math.ceil((new Date(eraseAfter).getTime() - now) / DAY);
  if (Number.isNaN(left)) return "";
  if (left <= 0) return `Erased automatically at the next daily sweep (due ${date(eraseAfter)})`;
  return `Erased automatically in ${plural(left, "day", "days")} (${date(eraseAfter)})`;
}

/** "failed", "late" (still not sent after ten minutes) or "" for a request's email to the owner. */
export function emailTrouble(request, now = Date.now()) {
  if (request.notify === "failed") return "failed";
  if (request.notify === "pending" && now - new Date(request.createdAt).getTime() > STALE_PENDING_MS) return "late";
  return "";
}

/** The line a request shows when its email to the owner did not go out, or "". */
export function emailNote(request, now = Date.now()) {
  const trouble = emailTrouble(request, now);
  if (!trouble) return "";
  if (trouble === "late") return "The email telling you about this request has not gone out yet. The request itself is safe here.";
  const reason = NOTIFY_REASONS[request.notifyError];
  const tries = request.notifyAttempts >= MAX_NOTIFY_ATTEMPTS ? ` It was tried ${request.notifyAttempts} times and will not be tried again.` : "";
  return `The email telling you about this request did not go out${reason ? `: ${reason}` : ""}. The request itself is safe here.${tries}`;
}

/** Returns `{ element, load, isDirty, isBusy, destroy }`. */
export function createQuoteRequests({ api, win = globalThis.window, now = () => Date.now(), download = defaultDownload }) {
  const root = el("ob-quote-requests", { class: "oba-quotes", "data-quote-requests": "true" });
  const ids = `oba-quotes-${++uid}`;
  let generation = 0;
  let busy = false;
  let state = null;
  let filters = { status: "", service: "" };
  let selected = new Set();
  let confirming = null;
  let focusTarget = null;
  let message = { text: "", error: false };

  const status = el("p", { class: "oba-small oba-quotes-status", role: "status", "aria-live": "polite", "data-quote-status": "true", tabindex: "-1" });
  const say = (text, error = false) => {
    message = { text, error };
    status.className = `oba-small oba-quotes-status${error ? " oba-error" : ""}`;
    status.setAttribute("role", error ? "alert" : "status");
    status.textContent = text;
  };

  const query = () => {
    const parts = [];
    if (filters.status) parts.push(`status=${encodeURIComponent(filters.status)}`);
    if (filters.service) parts.push(`service=${encodeURIComponent(filters.service)}`);
    return parts.length ? `?${parts.join("&")}` : "";
  };

  async function load() {
    const mine = ++generation;
    root.replaceChildren(el("h2", { id: `${ids}-title`, tabindex: "-1" }, "Quote requests"), el("p", { class: "oba-small", role: "status", "data-quote-loading": "true" }, "Loading requests…"));
    try {
      const overview = await api.call("GET", "quote/status");
      let list = { requests: [], services: [], retentionDays: null, retentionSource: null, notifyEnabled: false };
      if (overview.enabled) list = await api.call("GET", `quote/requests${query()}`);
      if (mine !== generation) return;
      state = { overview, ...list };
      const present = new Set(list.requests.map((r) => r.id));
      selected = new Set([...selected].filter((id) => present.has(id)));
    } catch (error) {
      if (mine !== generation) return;
      state = null;
      root.replaceChildren(
        el("h2", { id: `${ids}-title`, tabindex: "-1" }, "Quote requests"),
        el("p", { class: "oba-error", role: "alert", "data-quote-error": "true" }, errorText(error)),
        el("button", { class: "oba-btn", type: "button", "data-action": "quote-retry", onClick: () => load() }, "Try again"),
      );
      return;
    }
    render();
  }

  /** Runs one request with the controls locked, then draws the page again. */
  async function act(label, run, after) {
    if (busy) return;
    busy = true;
    root.setAttribute("aria-busy", "true");
    for (const control of root.querySelectorAll?.("button") || []) control.disabled = true;
    say(label);
    try {
      await run();
      busy = false;
      root.removeAttribute("aria-busy");
      if (after) await after();
    } catch (error) {
      busy = false;
      root.removeAttribute("aria-busy");
      render();
      say(errorText(error), true);
    }
  }

  async function copy(value, what) {
    try {
      await win.navigator.clipboard.writeText(value);
      say(`Copied ${what}.`);
    } catch {
      say(`Could not copy automatically. ${what[0].toUpperCase()}${what.slice(1)}: ${value}`, true);
    }
  }

  function setStatus(request, next, label) {
    focusTarget = `request-${request.id}`;
    return act(
      label,
      () => api.call("POST", `quote/requests/${request.id}/status`, { json: { status: next } }),
      async () => {
        await load();
        say(`${request.name}: ${STATUS_WORDS[next].text.toLowerCase()}.`);
      },
    );
  }

  function exportCsv(from, to) {
    const params = [from ? `from=${encodeURIComponent(from)}` : "", to ? `to=${encodeURIComponent(to)}` : ""].filter(Boolean).join("&");
    return act("Preparing the export…", async () => {
      const result = await api.call("GET", `quote/export${params ? `?${params}` : ""}`);
      download(result.filename, result.csv, win);
      busy = false;
      root.removeAttribute("aria-busy");
      render();
      say(`Exported ${plural(result.count, "request", "requests")} to ${result.filename}.`);
    });
  }

  function startErase() {
    const list = [...selected];
    if (!list.length) return say("Choose at least one request to erase.", true);
    focusTarget = "erase-confirm";
    return act("Checking what would be erased…", async () => {
      const preview = await api.call("POST", "quote/erase/preview", { json: { ids: list } });
      confirming = { ids: list, ...preview };
      busy = false;
      root.removeAttribute("aria-busy");
      render();
      say("Review what will be erased, then confirm.");
    });
  }

  function confirmErase() {
    const plan = confirming;
    focusTarget = "list";
    return act(
      "Erasing…",
      async () => {
        const result = await api.call("POST", "quote/erase", { json: { ids: plan.ids, token: plan.token } });
        confirming = null;
        selected = new Set();
        state.erased = result;
      },
      async () => {
        const erased = state.erased;
        await load();
        const pending = erased.photosPending > 0 ? ` ${plural(erased.photosPending, "of their photos", "of their photos")} could not be removed yet. No request points to ${erased.photosPending === 1 ? "it" : "them"} any more, and the next erase removes ${erased.photosPending === 1 ? "it" : "them"}.` : "";
        say(`Erased ${plural(erased.erased, "request", "requests")} and checked afterward: none of them remain.${pending}`);
      },
    );
  }

  // The owner's choice of days (ADR 0387). Empty or "Keep" means archived requests stay until erased.
  function saveRetention(raw) {
    const value = String(raw ?? "").trim();
    const days = value === "" ? null : Number(value);
    if (days !== null && !(Number.isInteger(days) && days >= 1 && days <= 3650)) {
      say("Write a whole number of days from 1 to 3650, or leave the box empty to keep archived requests until you erase them.", true);
      focusTarget = "retention-days";
      render();
      return undefined;
    }
    focusTarget = "retention-days";
    return act(
      "Saving…",
      async () => {
        state.retentionSaved = await api.call("POST", "quote/retention", { json: { days } });
      },
      async () => {
        const saved = state.retentionSaved;
        await load();
        say(saved.retentionDays ? `Saved. Archived requests are now erased automatically ${plural(saved.retentionDays, "day", "days")} after you archive them.` : "Saved. Archived requests are now kept until you erase them.");
      },
    );
  }

  function sweepNow() {
    focusTarget = "list";
    return act(
      "Erasing expired requests…",
      async () => {
        state.swept = await api.call("POST", "quote/retention/run", { json: {} });
      },
      async () => {
        const swept = state.swept;
        await load();
        say(`Erased ${plural(swept.erased, "expired request", "expired requests")}.`);
      },
    );
  }

  function retryEmails() {
    focusTarget = "emails";
    return act(
      "Sending the emails again…",
      async () => {
        state.retried = await api.call("POST", "quote/notifications/retry", { json: {} });
      },
      async () => {
        const result = state.retried;
        await load();
        const parts = [];
        if (result.sent) parts.push(`Sent ${plural(result.sent, "email", "emails")}.`);
        if (result.failed) parts.push(`${plural(result.failed, "email", "emails")} still did not go out.`);
        if (result.gaveUp) parts.push(`${plural(result.gaveUp, "email was", "emails were")} tried ${MAX_NOTIFY_ATTEMPTS} times and will not be tried again.`);
        say(parts.length ? parts.join(" ") : "There was no email left to send.", Boolean(result.failed));
      },
    );
  }

  /** A summary above the list when emails about requests did not go out, with a way to resend them. */
  function emailBanner() {
    const troubled = state.requests.filter((r) => emailTrouble(r, now()));
    if (!troubled.length) return null;
    const retryable = troubled.some((r) => (r.notifyAttempts || 0) < MAX_NOTIFY_ATTEMPTS);
    return el(
      "div",
      { class: "oba-quotes-emails", "data-quote-emails": "true", "data-focus": "emails", tabindex: "-1" },
      el("p", {}, `The email telling you about ${plural(troubled.length, "request", "requests")} below did not go out. The requests are safe; you can read them here.`),
      !state.notifyEnabled
        ? el("p", { class: "oba-small" }, "Emails to you are turned off where the quote function runs, so they cannot be sent again from here.")
        : retryable
          ? el("button", { class: "oba-btn", type: "button", "data-action": "retry-emails", onClick: retryEmails }, "Send those emails again")
          : el("p", { class: "oba-small" }, `Each was tried ${MAX_NOTIFY_ATTEMPTS} times, so they will not be tried again. Whoever set up your email can check its settings.`),
    );
  }

  const chip = (value) => {
    const info = STATUS_WORDS[value] || STATUS_WORDS.new;
    return el("span", { class: `oba-quotes-chip oba-quotes-chip-${value}`, "data-status": value }, el("span", { "aria-hidden": "true" }, `${info.symbol} `), info.text);
  };

  const copyButton = (label, value, what) =>
    el("button", { class: "oba-btn oba-quotes-copy", type: "button", "data-action": `copy-${what}`, "aria-label": `Copy ${what}: ${value}`, onClick: () => copy(value, what) }, el("span", { "aria-hidden": "true" }, "⧉ "), label || value);

  function card(request) {
    const checkId = `${ids}-pick-${request.id}`;
    const photos = request.photos.length
      ? el(
          "ul",
          { class: "oba-quotes-photos", "aria-label": "Photos" },
          request.photos.map((photo, index) =>
            el(
              "li",
              {},
              el(
                "a",
                { href: photo.url, target: "_blank", rel: "noopener noreferrer", "aria-label": `Open photo ${index + 1} of ${request.photos.length} from ${request.name}` },
                el("img", { src: photo.url, alt: `Photo ${index + 1} from ${request.name}`, loading: "lazy", width: "96", height: "96" }),
              ),
            ),
          ),
        )
      : request.photoCount
        ? el("p", { class: "oba-small" }, `${plural(request.photoCount, "photo", "photos")} could not be shown right now. Reload to try again.`)
        : null;
    const actions = [];
    if (request.status !== "handled") actions.push(el("button", { class: "oba-btn", type: "button", "data-action": "mark-handled", onClick: () => setStatus(request, "handled", "Marking handled…") }, "Mark handled"));
    if (request.status !== "archived") actions.push(el("button", { class: "oba-btn", type: "button", "data-action": "archive", onClick: () => setStatus(request, "archived", "Archiving…") }, "Archive"));
    if (request.status !== "new") actions.push(el("button", { class: "oba-btn", type: "button", "data-action": "mark-new", onClick: () => setStatus(request, "new", "Marking new…") }, "Mark as new"));
    const when = countdown(request.eraseAfter, now());
    const email = emailNote(request, now());
    return el(
      "li",
      { class: "oba-quotes-card", "data-request": request.id, "data-status": request.status },
      el(
        "article",
        { "aria-labelledby": `${ids}-${request.id}` },
        el("div", { class: "oba-quotes-head" }, el("h3", { id: `${ids}-${request.id}`, tabindex: "-1", "data-focus": `request-${request.id}` }, request.name), chip(request.status)),
        el("p", { class: "oba-small oba-quotes-meta" }, `${request.service} · ${request.town} · received ${date(request.createdAt)}`),
        el("p", { class: "oba-quotes-description" }, request.description),
        photos,
        el("div", { class: "oba-quotes-contact" }, copyButton(request.phone, request.phone, "phone"), request.email ? copyButton(request.email, request.email, "email") : null),
        when ? el("p", { class: "oba-small", "data-quote-countdown": "true" }, when) : null,
        email ? el("p", { class: "oba-small oba-quotes-email", "data-quote-email": emailTrouble(request, now()) }, el("span", { "aria-hidden": "true" }, "! "), email) : null,
        el("div", { class: "oba-quotes-actions" }, actions, el("label", { class: "oba-quotes-pick", for: checkId }, el("input", { id: checkId, type: "checkbox", "data-action": "pick", checked: selected.has(request.id), onChange: (event) => {
          if (event.target.checked) selected.add(request.id);
          else selected.delete(request.id);
          syncErase();
        } }), `Select ${request.name} for erase`)),
      ),
    );
  }

  function filterBar() {
    const statusSelect = el(
      "select",
      { id: `${ids}-status`, "data-filter": "status", onChange: (event) => { filters = { ...filters, status: event.target.value }; focusTarget = "filters"; load(); } },
      [["", "All"], ["new", "New"], ["handled", "Handled"], ["archived", "Archived"]].map(([value, label]) => el("option", { value, selected: filters.status === value }, label)),
    );
    const serviceSelect = el(
      "select",
      { id: `${ids}-service`, "data-filter": "service", onChange: (event) => { filters = { ...filters, service: event.target.value }; focusTarget = "filters"; load(); } },
      [el("option", { value: "", selected: !filters.service }, "All services"), ...state.services.map((service) => el("option", { value: service, selected: filters.service === service }, service))],
    );
    return el("div", { class: "oba-quotes-filters", role: "group", "aria-label": "Filter requests", "data-focus": "filters", tabindex: "-1" }, el("label", { for: `${ids}-status` }, "Status"), statusSelect, el("label", { for: `${ids}-service` }, "Service"), serviceSelect);
  }

  let eraseButton = null;
  let exportOpen = false;
  // Picking a request changes only the erase button, so focus and the open panel stay where they are.
  function syncErase() {
    if (!eraseButton) return;
    eraseButton.disabled = selected.size === 0;
    eraseButton.textContent = selected.size ? `Erase ${plural(selected.size, "selected request", "selected requests")}…` : "Erase selected…";
  }

  function exportForm() {
    const from = el("input", { id: `${ids}-from`, type: "date", "data-field": "from" });
    const to = el("input", { id: `${ids}-to`, type: "date", "data-field": "to" });
    const panel = el(
      "details",
      { class: "oba-quotes-export", open: exportOpen, onToggle: (event) => { exportOpen = event.target.open === true; } },
      el("summary", {}, "Export or erase"),
      el(
        "fieldset",
        {},
        el("legend", {}, "Export as CSV"),
        el("p", { class: "oba-small" }, "Choose the days to include, or leave both empty for everything. The file contains names, phone numbers and details, so keep it somewhere private."),
        el("label", { for: `${ids}-from` }, "From"),
        from,
        el("label", { for: `${ids}-to` }, "To"),
        to,
        el("button", { class: "oba-btn", type: "button", "data-action": "export", onClick: () => exportCsv(from.value, to.value) }, "Download CSV"),
      ),
      el(
        "fieldset",
        {},
        el("legend", {}, "Erase"),
        el("p", { class: "oba-small" }, "Erasing removes the selected requests and their photos for good. You will see what will go before anything is erased. If erasing fails partway, every request and every photo stays."),
        (eraseButton = el("button", { class: "oba-btn", type: "button", "data-action": "erase", onClick: startErase })),
      ),
    );
    syncErase();
    return panel;
  }

  function retentionNote() {
    const archived = state.requests.some((r) => r.status === "archived");
    const days = state.retentionDays;
    const sweep = days && archived ? el("button", { class: "oba-btn", type: "button", "data-action": "sweep", onClick: sweepNow }, "Erase expired now") : null;
    const said = days ? `Archived requests are erased automatically ${days} days after you archive them.` : "Archived requests are kept until you erase them.";
    // A number set where the quote function runs wins (ADR 0387), so it is shown, not offered.
    if (days && state.retentionSource !== "admin") {
      return el("p", { class: "oba-small", "data-quote-retention": "on", "data-quote-retention-source": "host" }, `${said} This is set where your quote form runs, so it is changed there, not here. `, sweep);
    }
    const box = el("input", { id: `${ids}-retention`, type: "number", inputmode: "numeric", min: "1", max: "3650", step: "1", value: days ? String(days) : "", "data-field": "retention-days", "data-focus": "retention-days", "aria-describedby": `${ids}-retention-help` });
    return el(
      "fieldset",
      { class: "oba-quotes-retention", "data-quote-retention": days ? "on" : "off", "data-quote-retention-source": days ? "admin" : "none" },
      el("legend", {}, "Erase archived requests automatically"),
      el("p", { class: "oba-small", id: `${ids}-retention-help` }, `${said} To erase them a number of days after you archive them, write the days and press Save. Leave the box empty to keep them until you erase them.`),
      el("label", { for: `${ids}-retention` }, "Days after archiving"),
      box,
      el("button", { class: "oba-btn", type: "button", "data-action": "retention-save", onClick: () => saveRetention(box.value) }, "Save"),
      days ? el("button", { class: "oba-btn", type: "button", "data-action": "retention-off", onClick: () => saveRetention("") }, "Keep until I erase them") : null,
      sweep,
    );
  }

  function confirmPanel() {
    return el(
      "div",
      { class: "oba-quotes-confirm", role: "alertdialog", "aria-labelledby": `${ids}-confirm-title`, "aria-describedby": `${ids}-confirm-text`, "data-focus": "erase-confirm", tabindex: "-1" },
      el("h3", { id: `${ids}-confirm-title` }, `Erase ${plural(confirming.count, "request", "requests")}?`),
      el("p", { id: `${ids}-confirm-text` }, `This permanently removes ${plural(confirming.count, "request", "requests")} and ${plural(confirming.photos, "photo", "photos")}. It cannot be undone. If anything fails, every request and every photo stays as it is.`),
      el("button", { class: "oba-btn oba-btn-danger", type: "button", "data-action": "erase-confirm", onClick: confirmErase }, "Erase permanently"),
      el("button", { class: "oba-btn", type: "button", "data-action": "erase-cancel", onClick: () => { confirming = null; focusTarget = "list"; render(); say("Nothing was erased."); } }, "Cancel"),
    );
  }

  function render() {
    const overview = state.overview;
    if (!overview.enabled) {
      const problems = overview.problems || [];
      root.replaceChildren(
        el("h2", { id: `${ids}-title`, tabindex: "-1" }, "Quote requests"),
        el("p", { class: "oba-small", "data-quote-off": overview.state }, OFF_TEXT[overview.state] || OFF_TEXT.off),
        ...(problems.length ? [el("ul", {}, problems.map((p) => el("li", {}, el("code", {}, p))))] : []),
      );
      return;
    }
    const list = state.requests;
    const empty = filters.status || filters.service ? "No requests match these filters." : "No requests yet. When a visitor sends the quote form, it appears here.";
    root.replaceChildren(
      el("h2", { id: `${ids}-title`, tabindex: "-1" }, "Quote requests"),
      el("p", { class: "oba-small" }, "Newest first. Requests are stored privately; this list is the only place their details are shown."),
      ...[emailBanner()].filter(Boolean),
      ...(state.unreadable > 0
        ? [el("p", { class: "oba-error", role: "alert", "data-quote-unreadable": String(state.unreadable) }, `${plural(state.unreadable, "stored request", "stored requests")} could not be shown here because the quote function sent ${state.unreadable === 1 ? "it" : "them"} in a form Admin does not read. ${state.unreadable === 1 ? "It is" : "They are"} still stored. Ask whoever set up your quote form to check the function.`)]
        : []),
      filterBar(),
      status,
      ...(confirming ? [confirmPanel()] : []),
      list.length ? el("ul", { class: "oba-quotes-list", "data-focus": "list", tabindex: "-1", "aria-label": `${plural(list.length, "request", "requests")}` }, list.map(card)) : el("p", { "data-quote-empty": "true", "data-focus": "list", tabindex: "-1" }, empty),
      exportForm(),
      retentionNote(),
    );
    status.textContent = message.text;
    if (focusTarget) {
      const wanted = focusTarget;
      const target = [...(root.querySelectorAll?.("[data-focus]") || [])].find((node) => node.dataset.focus === wanted);
      focusTarget = null;
      target?.focus?.();
    }
  }

  return {
    element: root,
    load,
    isDirty: () => false,
    isBusy: () => busy,
    destroy() {
      generation += 1;
    },
  };
}

/** Hands the file to the browser as a download. */
function defaultDownload(filename, csv, win) {
  const url = win.URL.createObjectURL(new win.Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = win.document.createElement("a");
  link.href = url;
  link.download = filename;
  win.document.body.append(link);
  link.click();
  link.remove();
  win.setTimeout(() => win.URL.revokeObjectURL(url), 1000);
}
