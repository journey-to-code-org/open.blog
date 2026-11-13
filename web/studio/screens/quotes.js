// Requests: who wants a quote, and has she called them back? New, Handled and Archived, newest
// first. Each request has Call on top, then Email and Mark handled; status changes can be undone;
// erasing one (a customer who asks to be forgotten) is always checked first and asked once. Customers'
// words are only ever text. Screen More: download chosen days, clean up archived requests (sheets in
// parts/quote-sheets.js). Studio slice 10b, R1; docs/specs/studio/slice-10bc/ux.md, r1/ux.md.
import { h, toast } from "../parts/dom.js";
import { use } from "../zubra.js";
import { ask } from "../parts/dialogs.js";
import { sayWhen } from "../parts/dates.js";
import { createSheet, guardedLeave } from "../parts/sheet.js";
import { openDownload, openCleanup } from "../parts/quote-sheets.js";
import { LISTS, listLabel, emailLine, troubleBanner, eraseLine, statusWords, telHref, quoteTrouble } from "../parts/quote-words.js";

export async function createQuotes({ api }) {
  await use("action-button", "alert-banner", "dropdown-menu", "empty-state", "select-field", "skeleton-block", "status-badge");
  let reply = null;
  let list = "new";
  let service = "";
  let undo = null;
  const sheet = await createSheet({ label: "Requests" });

  const heading = h("h2", { id: "studio-quotes-h", class: "studio-question", tabindex: "-1", text: "Who's asking for a quote?" });
  const screenMore = h("dropdown-menu", {
    class: "studio-row-menu",
    items: [{ value: "export", label: "Download a spreadsheet…" }, { value: "cleanup", label: "Clean up archived requests…" }],
    onItemselect: (e) => (e.detail === "export" ? download() : cleanup()),
  }, h("span", { slot: "label" }, "More", h("span", { class: "studio-visually-hidden", text: " for quote requests" })));
  const banner = h("div", { class: "studio-banner" });
  const undoSlot = h("div", { class: "studio-banner" });
  const status = h("p", { class: "studio-help", role: "status", "aria-live": "polite" });
  const pickers = h("div", { class: "studio-quote-pickers" });
  const cards = h("ul", { class: "studio-comment-list", "aria-labelledby": "studio-quotes-h", "aria-busy": "true" }, ...[1, 2, 3].map(() => h("li", {}, h("skeleton-block", { shape: "card" }))));
  const details = h("details", { class: "studio-help" });
  const element = h("section", { class: "studio-page studio-quotes", "aria-labelledby": "studio-quotes-h" },
    h("div", { class: "studio-today" }, h("div", { class: "studio-comment-head" }, heading, screenMore),
      h("p", { class: "studio-lede", text: "Newest first. Only you see these; they're never on your site." })),
    undoSlot, banner, status, pickers, cards, details);

  const requests = () => reply?.requests || [];

  async function load() {
    cards.setAttribute("aria-busy", "true");
    try {
      const state = await api.get("quote/status");
      if (!state.enabled) {
        cards.removeAttribute("aria-busy");
        cards.replaceChildren();
        banner.replaceChildren(h("alert-banner", { variant: "danger", heading: "Studio can't open your quote requests" }, "The quote form isn't connected properly. Tell the person who set up your site."));
        drawDetails(state);
        return;
      }
      reply = await api.get("quote/requests");
      banner.replaceChildren();
      draw();
    } catch (error) {
      if (error.status === 401) throw error;
      cards.removeAttribute("aria-busy");
      cards.replaceChildren();
      banner.replaceChildren(h("alert-banner", { variant: "danger", heading: "Your quote requests didn't load" }, quoteTrouble(error), " ",
        h("action-button", { variant: "secondary", size: "sm", onClick: () => load() }, "Try again")));
      drawDetails(null, error);
    }
  }

  function draw() {
    cards.removeAttribute("aria-busy");
    const all = requests();
    const trouble = troubleBanner(all, reply.notifyEnabled);
    banner.replaceChildren(
      ...(trouble ? [h("alert-banner", { variant: "warning", heading: trouble.heading }, trouble.text, trouble.retry ? " " : "",
        trouble.retry ? h("action-button", { variant: "secondary", size: "sm", onClick: (e) => retry(e.currentTarget) }, "Send those emails again") : "")] : []),
      ...(reply.unreadable ? [h("alert-banner", { variant: "warning", heading: `${reply.unreadable} ${reply.unreadable === 1 ? "request" : "requests"} can't be shown here` }, "They're still stored. Tell the person who set up your site.")] : []));
    const services = reply.services || [];
    pickers.replaceChildren(
      h("select-field", { label: "Which requests", options: LISTS.map((l) => ({ value: l.id, label: listLabel(l, all) })), value: list, onValuechange: (e) => { list = e.detail; draw(); } }),
      ...(services.length > 1 ? [h("select-field", { label: "Service", options: [{ value: "", label: "All services" }, ...services.map((s) => ({ value: s, label: s }))], value: service, onValuechange: (e) => { service = e.detail; draw(); } })] : []));
    const shown = all.filter((r) => r.status === list && (!service || r.service === service))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    drawDetails();
    if (!shown.length) {
      const [title, text] = service ? ["Nothing here", `No requests for ${service} here.`] : LISTS.find((l) => l.id === list).empty;
      cards.replaceChildren(h("li", {}, h("empty-state", { heading: title }, text)));
      return;
    }
    cards.replaceChildren(...shown.map(card));
  }

  function card(r) {
    const headingId = `studio-quote-${r.id}`;
    const isNew = r.status === "new";
    const call = telHref(r.phone);
    const word = { new: "New", handled: "Handled", archived: "Archived" }[r.status];
    const menu = h("dropdown-menu", {
      class: "studio-row-menu",
      items: [
        { value: "copy-phone", label: "Copy phone" },
        ...(r.email ? [{ value: "copy-email", label: "Copy email" }] : []),
        ...(r.status !== "archived" ? [{ value: "archived", label: "Archive" }] : []),
        ...(r.status !== "new" ? [{ value: "new", label: "Mark as new" }] : []),
        { value: "erase", label: "Erase this request" },
      ],
      onItemselect: (e) => {
        if (e.detail === "copy-phone") copy(r.phone, "Phone copied.");
        else if (e.detail === "copy-email") copy(r.email, "Email copied.");
        else if (e.detail === "erase") erase(r);
        else setStatus(r, e.detail);
      },
    }, h("span", { slot: "label" }, "More", h("span", { class: "studio-visually-hidden", text: ` for ${r.name}'s request` })));
    const photos = (r.photos || []).map((p, i) => h("a", { href: p.url, target: "_blank", rel: "noopener", class: "studio-quote-photo", "aria-label": `Open photo ${i + 1} of ${r.photos.length} from ${r.name}` },
      h("img", { src: p.url, alt: "", width: 96, height: 96, loading: "lazy" })));
    const trouble = emailLine(r);
    return h("li", { class: "studio-comment", "data-id": r.id, "aria-label": `${r.name}'s request` },
      h("div", { class: "studio-comment-head" },
        h("h3", { id: headingId, class: "studio-comment-who", tabindex: "-1", text: r.name }),
        h("status-badge", { variant: isNew ? "info" : "neutral" }, word), menu),
      h("p", { class: "studio-help", text: [r.service, r.town].filter(Boolean).join(" · ") }),
      h("p", { class: "studio-help", text: sayWhen(r.createdAt) }),
      h("p", { class: "studio-quote-words", text: r.description }),
      photos.length ? h("div", { class: "studio-quote-photos" }, ...photos)
        : r.photoCount ? h("p", { class: "studio-help", text: `${r.photoCount === 1 ? "1 photo" : `${r.photoCount} photos`} can't be shown right now. Reload to try again.` }) : null,
      trouble ? h("p", { class: "studio-help", text: trouble }) : null,
      r.status === "archived" && r.eraseAfter ? h("p", { class: "studio-help", text: eraseLine(r.eraseAfter) }) : null,
      h("div", { class: "studio-comment-actions" },
        call ? h("action-button", { href: call, variant: isNew ? "primary" : "secondary", label: `Call ${r.name} at ${r.phone}` }, `Call ${r.phone}`) : null,
        r.email ? h("action-button", { variant: "secondary", href: `mailto:${encodeURIComponent(r.email)}`, label: `Email ${r.name}` }, "Email") : null,
        isNew ? h("action-button", { variant: "secondary", label: `Mark handled: ${r.name}'s request`, onClick: () => setStatus(r, "handled") }, "Mark handled") : null));
  }

  async function copy(text, said) {
    try {
      await navigator.clipboard.writeText(String(text || ""));
      status.textContent = said;
    } catch {
      status.textContent = "Studio couldn't copy it. Select it and copy it instead.";
    }
  }

  /** Returns whether it saved. */
  async function setStatus(r, to, { quiet = false } = {}) {
    const was = r.status;
    const index = requests().filter((x) => x.status === list).findIndex((x) => x.id === r.id);
    try {
      await api.post(`quote/requests/${r.id}/status`, { status: to });
      r.status = to;
      draw();
      const words = statusWords(r, to, reply.retentionDays);
      status.textContent = words;
      if (quiet) return true;
      toast(words);
      const left = cards.querySelectorAll(".studio-comment-who");
      (left[Math.min(index, left.length - 1)] || heading).focus();
      const button = h("action-button", { size: "sm", onClick: async () => {
        if (button.loading) return;
        button.loading = true;
        if (await setStatus(r, was, { quiet: true })) {
          // Focus moves in the same moment the Undo button goes, so it never falls to the page.
          (cards.querySelector(`[data-id="${r.id}"] .studio-comment-who`) || heading).focus();
          undoSlot.replaceChildren();
          status.textContent = `Undone. ${r.name}'s request is back.`;
        } else {
          button.loading = false;
        }
      } }, "Undo");
      const alert = h("alert-banner", { variant: "info", dismissible: true, heading: words }, button);
      undoSlot.replaceChildren(alert);
      undo = r.id;
    } catch (error) {
      if (error.status === 401) throw error;
      status.textContent = "That didn't save. Try again.";
      drawDetails(null, error);
      return false;
    }
    return true;
  }

  async function erase(r, again = false) {
    let preview;
    try {
      preview = await api.post("quote/erase/preview", { ids: [r.id] });
    } catch (error) {
      if (error.status === 401) throw error;
      status.textContent = quoteTrouble(error);
      return;
    }
    const photos = preview.photos ? ` and ${preview.photos === 1 ? "its photo" : `its ${preview.photos} photos`}` : "";
    const choice = await ask({
      heading: `Erase ${r.name}'s request?`,
      text: `This removes it${photos} for good. It can't be undone. If anything goes wrong, nothing is removed.`,
      choices: [{ label: "Keep it", value: "keep" }, { label: "Erase for good", value: "erase", variant: "destructive" }],
    });
    if (choice !== "erase") return;
    try {
      const done = await api.post("quote/erase", { ids: [r.id], token: preview.token });
      reply.requests = requests().filter((x) => x.id !== r.id);
      draw();
      const words = `Erased, and checked: it's gone.${done.photosPending ? " A photo is still being removed; nothing points to it." : ""}`;
      status.textContent = words;
      toast(words);
      heading.focus();
    } catch (error) {
      if (error.status === 401) throw error;
      if (error.status === 409 && error.data?.code === "preview-required" && !again) return erase(r, true);
      if (error.status === 409) { await load(); status.textContent = "Something changed while you looked. Here's the list now; nothing was erased."; return; }
      status.textContent = quoteTrouble(error);
    }
  }

  async function retry(button) {
    button.loading = true;
    try {
      const done = await api.post("quote/notifications/retry", {});
      await load();
      status.textContent = done.failed || done.gaveUp
        ? `${done.failed + done.gaveUp === 1 ? "1 email" : `${done.failed + done.gaveUp} emails`} still didn't go out.`
        : `Sent ${done.sent === 1 ? "1 email" : `${done.sent} emails`}.`;
    } catch (error) {
      if (error.status === 401) throw error;
      status.textContent = quoteTrouble(error);
    } finally {
      button.loading = false;
    }
  }

  const say = (words) => { status.textContent = words; toast(words); };

  function download() {
    openDownload({ sheet, api, opener: screenMore, say });
  }

  function cleanup() {
    openCleanup({ sheet, api, opener: screenMore, reply, say, onChanged: (saved) => {
      if (saved && reply) { reply.retentionDays = saved.days; reply.retentionSource = saved.source; drawDetails(); }
      else load();
    } });
  }

  function drawDetails(state = null, error = null) {
    details.replaceChildren(h("summary", { text: "For the person who set up your site" }),
      h("ul", { class: "studio-mono" }, ...[
        state ? `state ${state.state}${(state.problems || []).length ? `: ${state.problems.join(", ")}` : ""}` : null,
        error ? `error ${error.status}: ${error.message}` : null,
        reply ? `retention ${reply.retentionDays ?? "none"} (${reply.retentionSource || "none"}), notify ${reply.notifyEnabled}` : null,
        ...requests().map((r) => `${r.id} ${r.status} created ${r.createdAt}${r.handledAt ? ` handled ${r.handledAt}` : ""}${r.eraseAfter ? ` erase ${r.eraseAfter}` : ""} notify ${r.notify || "none"}/${r.notifyAttempts}${r.notifyError ? ` ${r.notifyError}` : ""}${r.page ? ` from ${r.page}` : ""}`),
      ].filter(Boolean).map((t) => h("li", { text: t }))));
  }

  return {
    title: "Quote requests",
    element,
    load,
    reload: load,
    leave: () => guardedLeave(sheet),
    isDirty: () => sheet.isDirty(),
    focus: () => heading.focus(),
    get palette() {
      return [
        ...LISTS.map((l) => ({ id: `list:${l.id}`, label: `Show ${l.label.toLowerCase()} requests`, group: "Requests" })),
        { id: "export", label: "Download a spreadsheet", group: "Requests" },
        { id: "cleanup", label: "Clean up archived requests", group: "Requests" },
      ];
    },
    command(id) {
      if (id.startsWith("list:")) { list = id.slice(5); draw(); }
      if (id === "export") download();
      if (id === "cleanup") cleanup();
    },
  };
}
