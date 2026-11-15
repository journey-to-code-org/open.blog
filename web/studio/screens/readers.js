// Readers, what readers sent: one list for every kind of note, six views, a kind filter, a card per
// note with only the decisions the server offers, Undo for the no's, and a way to fix what is on the
// post. `#/readers/visitors` and `#/readers/setup` are the area's other two places. Studio R10;
// docs/specs/studio/r10/ux.md.
import { h } from "../parts/dom.js";
import { use } from "../zubra.js";
import { ask } from "../parts/dialogs.js";
import { sayWhen } from "../parts/dates.js";
import { sendOut, wentOutWords } from "../parts/publish.js";
import { routeHash } from "../router.js";
import { quietNotifyLink } from "../parts/notify-link.js";
import { say } from "../parts/words.js";
import { readerHeader } from "../parts/reader-tabs.js";
import { createReaderCard } from "../parts/reader-card.js";
import { cardDetails, screenDetails } from "../parts/reader-details.js";
import { createReaderExtras } from "../parts/reader-extras.js";
import { createReaderSheets } from "../parts/reader-sheets.js";
import { drawBanners } from "../parts/reader-banners.js";
import { auditBanners, noteWords, extrasProblem } from "../parts/reader-notes-rules.js";
import { createReaderDecisions } from "../parts/reader-decide.js";
import { createReaderBulk, readerKeys } from "../parts/reader-bulk.js";
import { guardedLeave } from "../parts/sheet.js";
import {
  shownViews, viewOf, viewLabel, viewLede, emptyWords, otherViewWords, kindsOffered, kindFilterWords, kindKnown, hasBeyondComments,
  readersHash, parseItemRef, readerProblem, problemWords, waitingLine, cardLabel, needsNoteExtras, VIEWS,
} from "../parts/reader-rules.js";

export async function createReaders(context, route) {
  await use("action-button", "alert-banner", "breadcrumb-trail", "dropdown-menu", "empty-state", "select-field", "skeleton-block", "status-badge", "text-field");
  const { api, meta, go } = context;
  const view = viewOf(route.arg);
  const kind = kindKnown(route.query.kind) ? route.query.kind : "";
  const wanted = parseItemRef(route.query.item);
  // The list, shared with the parts that change it. `undo`: the last decision that can go back to Waiting.
  const state = { items: [], next: null, page: null, undo: null };
  let settings = null;
  // What the cards' extras read: the notes on the posts (with the file's etag), features, links.
  const extra = { published: new Map(), etag: "absent", features: new Map(), continuations: { links: [], works: [] }, linksOffered: false };
  const auditHost = h("div", { class: "studio-banner studio-reader-audits" });
  const tell = (words, { undo: run } = {}) => {
    status.textContent = words;
    if (run) decisions.offerUndo(null, words, run);
  };
  const reloadAll = async (ref) => { await loadExtras(); await decisions.reloadKeeping(ref, null); };
  const sheets = await createReaderSheets({ api, meta, state: () => extra, tell, reload: reloadAll });
  const extras = createReaderExtras({ api, meta, state: () => extra, tell, reload: reloadAll, sheets });

  const { trail, tabs } = readerHeader({ tab: "sent", visitors: Boolean(meta.visitors) });
  const heading = h("h2", { id: "studio-readers-h", class: "studio-question", tabindex: "-1", text: say("readers.title") });
  const lede = h("p", { class: "studio-lede", text: viewLede(view) });
  const viewPicker = h("select-field", { label: say("readers.whichOnes"), value: view.id || "waiting", onValuechange: (e) => go(readersHash(e.detail === "waiting" ? "" : e.detail, kind)) });
  const kindPicker = h("select-field", { label: say("readers.whatKind"), hidden: true, onValuechange: (e) => go(readersHash(view.id, e.detail === "all" ? "" : e.detail)) });
  const status = h("p", { class: "studio-help", role: "status", "aria-live": "polite" });
  const banner = h("div", { class: "studio-banner" });
  const undoSlot = h("div", { class: "studio-banner" });
  const list = h("ul", { class: "studio-comment-list", "aria-labelledby": "studio-readers-h", "aria-busy": "true" }, ...[1, 2, 3].map(() => h("li", {}, h("skeleton-block", { lines: 3 }))));
  const moreButton = h("action-button", { variant: "secondary", hidden: true, onClick: () => showMore() }, say("readers.showMore"));
  const after = h("div", { class: "studio-comment-after" });
  const details = h("details", { class: "studio-help" });
  const linksButton = h("action-button", { variant: "secondary", hidden: true, onClick: (e) => sheets.links(e.currentTarget) }, say("readers.linksButton"));
  const notifyLink = h("p", { class: "studio-quiet-link" });
  // Deciding many at once (Waiting only): Select turns on a checkbox on each card that can be decided in bulk.
  const selectBox = h("input", { type: "checkbox", id: "studio-readers-select" });
  const selectLabel = h("label", { class: "studio-select-toggle", for: "studio-readers-select", hidden: true }, selectBox, " ", say("readers.select"));
  selectBox.addEventListener("change", () => bulk.setSelecting(selectBox.checked));
  const bulkBar = h("div", { class: "studio-bulk-bar", role: "group", "aria-label": say("readers.bulkGroup"), hidden: true });

  const element = h("section", { class: "studio-page studio-readers", "aria-labelledby": "studio-readers-h" },
    trail, tabs, h("div", { class: "studio-today" }, heading, lede, notifyLink, viewPicker, kindPicker, selectLabel),
    undoSlot, bulkBar, banner, auditHost, status,
    h("div", { class: "studio-comment-columns" }, h("div", { class: "studio-comment-main" }, list, moreButton, after), h("div", { class: "studio-comment-side" }, linksButton, details)));

  // ---- loading ----------------------------------------------------------------------------------

  const fetchPage = (cursor) => {
    const query = new URLSearchParams({ state: view.state });
    if (kind) query.set("kind", kind);
    if (cursor) query.set("after", cursor);
    return api.get(`engagement/moderation?${query}`);
  };

  const commentsOnly = () => !hasBeyondComments(kindsOffered(settings, state.page, kind));

  function drawChrome() {
    const kinds = kindsOffered(settings, state.page, kind);
    const beyond = hasBeyondComments(kinds);
    viewPicker.options = shownViews(beyond || view.beyondComments).map((v) => ({ value: v.id || "waiting", label: viewLabel(v) }));
    viewPicker.value = view.id || "waiting";
    kindPicker.hidden = kinds.length < 2;
    kindPicker.options = ["", ...kinds].map((id) => ({ value: id || "all", label: kindFilterWords(id) }));
    kindPicker.value = kind || "all";
    lede.textContent = viewLede(view, { privateKinds: kinds.includes("future-suggestion") || kinds.includes("abuse-report") });
    banner.querySelector(".studio-comments-off")?.remove();
    if (settings && settings.comments === false) {
      banner.prepend(h("alert-banner", { class: "studio-comments-off", variant: "info", heading: say("readers.offTitle") },
        say("readers.offText"), " ", h("action-button", { size: "sm", onClick: () => go("#/readers/setup") }, say("readers.turnOn"))));
    }
  }

  async function loadSettings() {
    try {
      settings = await api.get("engagement/settings");
    } catch (error) {
      if (error.status === 401) throw error;
      settings = null;
    }
    drawChrome();
    if (!state.items.length && list.getAttribute("aria-busy") !== "true") draw();
  }

  // The notes on the posts, the two checks of what's on them, and the links to later posts: in
  // parallel, never blocking the list. A 403 (not the site's owner) says nothing; anything else is said.
  // Decided from the settings and the notes on the list both, so it never depends on which answered first.
  async function loadExtras() {
    if (!needsNoteExtras(settings, state.items, kind)) return;
    const get = (path) => api.get(path).then((value) => ({ value }), (error) => { if (error.status === 401) throw error; return { error }; });
    const [published, perspectives, features, continuations] = await Promise.all([
      get("engagement/feedback/published"), get("engagement/third-perspectives/published"), get("engagement/community/features"), get("engagement/continuations"),
    ]);
    extra.published = new Map((published.value?.items || []).map((entry) => [entry.id, entry]));
    extra.etag = published.value?.etag || extra.etag;
    extra.features = new Map((features.value?.features || []).map((entry) => [entry.id, entry]));
    extra.continuations = { links: continuations.value?.links || [], works: continuations.value?.works || [] };
    extra.linksOffered = Boolean(continuations.value);
    // The links failing to load is said (a 403 just means it isn't hers to change).
    if (continuations.error && continuations.error.status !== 403 && continuations.error.status !== 404) status.textContent = say("readers.linksFailed");
    linksButton.hidden = !extra.linksOffered;
    drawBanners(auditHost, auditBanners(perspectives.error ? { failed: perspectives.error } : perspectives.value, features.error ? { failed: features.error } : features.value), {
      onFix: (entry, button) => fixFromBanner(entry, button),
      onRetry: () => loadExtras().then(() => draw()),
    });
  }

  async function fixFromBanner(entry, button) {
    button.loading = true;
    try {
      await api.post(`engagement/${entry.route}/${entry.operation}`, { id: entry.id });
      const out = await sendOut(api, "A reader's note on a post");
      tell(`${say("readers.auditDone")} ${wentOutWords(out, { meta, action: "saved" }).words.replace(/^Saved\.\s*/, "")}`.trim());
      await loadExtras();
      draw();
    } catch (error) {
      if (error.status === 401) throw error;
      status.textContent = noteWords(extrasProblem(error, "fix"));
    } finally {
      button.loading = false;
    }
  }

  async function load() {
    quietNotifyLink(notifyLink, { meta, what: hasBeyondComments(kindsOffered(settings, state.page, kind)) ? say("notify.readersLink") : say("notify.commentsLink") });
    if (!meta.engagementSetUp && meta.engagement !== true) {
      list.removeAttribute("aria-busy");
      list.replaceChildren(h("li", {}, h("empty-state", { heading: say("readers.notSetUpTitle") }, say("readers.notSetUpText"), " ", say("common.canTurnOn"))));
      return;
    }
    if (meta.engagement !== true) {
      list.removeAttribute("aria-busy");
      list.replaceChildren();
      banner.replaceChildren(h("alert-banner", { variant: "warning", heading: say("readers.notReadyTitle") }, say("readers.notReadyText"), " ", say("common.tell"), " ",
        h("a", { href: "#/readers/setup", text: say("readers.setupLink") })));
      return;
    }
    list.setAttribute("aria-busy", "true");
    // Asked alongside the list; awaited before the extras, which read it.
    const settingsReady = loadSettings();
    settingsReady.catch(() => {});
    try {
      state.page = await fetchPage(null);
      state.items = state.page.items || [];
      state.next = state.page.next || null;
      banner.querySelector(".studio-load-trouble")?.remove();
      await settingsReady;
      drawChrome();
      await loadExtras().catch((error) => { if (error.status === 401) throw error; });
      draw();
      if (wanted) await showWanted();
    } catch (error) {
      if (error.status === 401) throw error;
      list.removeAttribute("aria-busy");
      list.replaceChildren();
      const problem = readerProblem(error, "list");
      if (problem.id === "readers.listReset" && (kind || view.id)) { status.textContent = say("readers.listReset"); go("#/readers"); return; }
      banner.append(h("alert-banner", { class: "studio-load-trouble", variant: "danger", heading: say("readers.listFailed") },
        problemWords(problem), " ", h("action-button", { variant: "secondary", size: "sm", onClick: () => load() }, say("readers.tryAgain"))));
    }
  }

  async function showMore() {
    if (!state.next) return;
    moreButton.loading = true;
    const first = state.items.length;
    try {
      const more = await fetchPage(state.next);
      state.items = state.items.concat(more.items || []);
      state.next = more.next || null;
      state.page = { ...state.page, invalid: (state.page.invalid || 0) + (more.invalid || 0), next: state.next };
      draw();
      status.textContent = say("readers.showing", { n: state.items.length });
      focusCard(state.items[first] && `${state.items[first].source}:${state.items[first].id}`);
    } catch (error) {
      status.textContent = problemWords(readerProblem(error, "list"));
    } finally {
      moreButton.loading = false;
    }
  }

  // The card a notification names: on the page, focused; not on it, shown first when the server can
  // say (one item), else said in words.
  async function showWanted() {
    const ref = `${wanted.source}:${wanted.id}`;
    if (state.items.some((i) => `${i.source}:${i.id}` === ref)) { focusCard(ref); return; }
    try {
      const one = await api.get(`engagement/moderation/item?source=${encodeURIComponent(wanted.source)}&id=${encodeURIComponent(wanted.id)}`);
      const item = one.item || one;
      const there = VIEWS.find((v) => v.state === item.status) || VIEWS[0];
      if (there.state !== view.state) {
        status.textContent = say("readers.itemDecided", { view: viewLabel(there) });
        banner.append(h("p", { class: "studio-help" }, h("a", { href: readersHash(there.id, kind, ref), text: viewLabel(there) })));
        return;
      }
      state.items = [item, ...state.items.filter((i) => `${i.source}:${i.id}` !== ref)];
      draw();
      status.textContent = say("readers.itemHere");
      focusCard(ref);
    } catch (error) {
      if (error.status === 401) throw error;
      // Said by what happened: gone, no signal, or the service not answering; never a guess.
      status.textContent = error.status === 404 ? say("readers.itemGone") : !error.status ? say("readers.noSignal") : problemWords(readerProblem(error, "card"));
    }
  }

  // ---- drawing ----------------------------------------------------------------------------------

  const focusCard = (ref) => requestAnimationFrame(() => list.querySelector(`[data-ref="${ref}"] .studio-comment-who`)?.focus());
  const decisions = createReaderDecisions({ api, meta, view, state, list, status, heading, undoSlot, draw: () => draw(), load: () => load(), focusCard, fetchPage });
  const bulk = createReaderBulk({ api, view, state, list, status, heading, bulkBar, selectBox, selectLabel, draw: () => draw(), focusCard, decisions });

  const on = {
    decide: (item, action, reason, line, control) => decisions.decide(item, action, reason, line, control),
    start: (item, button, line, control) => decisions.startDecision(item, button, line, control),
    fix: (item, fixState, line, control) => decisions.fix(item, fixState, line, control),
    more: (item, value, line) => decisions.moreMenu(item, value, line),
    focusRef: (ref) => focusCard(ref),
    cardDetails: (item, row) => row.append(cardDetails(item)),
    details: (item, row) => extras.details(item, row),
    extras: (item, row, line) => extras.extras(item, row, line),
    moreItems: (item) => (item.suggestion?.export ? [{ value: "copy-notes", label: say("readers.menuCopyNotes") }] : []),
    select: (item, label) => (bulk.selecting() ? bulk.selectCheckbox(item, label) : null),
  };

  function draw() {
    list.removeAttribute("aria-busy");
    bulk.drawBar();
    moreButton.hidden = !state.next;
    after.replaceChildren();
    if (state.page?.invalid > 0) after.append(h("p", { class: "studio-help", text: say("readers.invalid") }));
    details.replaceChildren(...screenDetails({ view, kind, page: state.page, next: state.next, settings }), h("p", { class: "studio-help", text: say("readers.keysHelp") }));
    if (!state.items.length) {
      const off = view.state === "pending" && settings && settings.comments === false;
      const [title, text] = emptyWords(view, { commentsOnly: commentsOnly() });
      const action = off
        ? h("action-button", { slot: "actions", onClick: () => go("#/readers/setup") }, say("readers.turnOn"))
        : h("action-button", { slot: "actions", variant: "secondary", onClick: () => go(readersHash(view.other, kind)) }, otherViewWords(view));
      list.replaceChildren(h("li", {}, h("empty-state", { heading: title }, off ? say("readers.emptyOff") : text, action)));
      return;
    }
    list.replaceChildren(...state.items.map((item) => createReaderCard({ item, meta, view, on })));
  }

  readerKeys(list, { runUndo: () => decisions.runUndo(), selecting: () => bulk.selecting() });

  return {
    title: say("readers.nav"),
    element,
    load,
    reload: load,
    focus: () => heading.focus(),
    get palette() {
      const group = say("readers.findGroup");
      return [
        ...shownViews(true).map((v) => ({ id: `view:${v.id}`, label: viewLabel(v), group })),
        ...kindsOffered(settings, state.page, kind).map((id) => ({ id: `kind:${id}`, label: say("readers.findKind", { kind: kindFilterWords(id).toLowerCase() }), group })),
        { id: "kind:", label: say("readers.findEveryKind"), group },
        ...(settings ? [{ id: "switch", label: settings.comments === false ? say("readers.findSwitchOn") : say("readers.findSwitchOff"), group }] : []),
        ...(state.undo ? [{ id: "undo", label: say("readers.findUndo"), group }] : []),
        ...(extra.linksOffered ? [{ id: "links", label: say("readers.linksTitle"), group }] : []),
      ];
    },
    isDirty: () => extras.isDirty() || sheets.sheet.isDirty(),
    leave: async () => {
      if (!(await guardedLeave(sheets.sheet))) return false;
      if (!extras.isDirty()) return true;
      const choice = await ask({ heading: say("readers.leaveAsk"), text: say("readers.leaveAnswerText"),
        choices: [{ label: say("readers.leaveStay"), value: "stay" }, { label: say("readers.leaveGo"), value: "go", variant: "secondary" }] });
      if (choice === "go") extras.forget();
      return choice === "go";
    },
    command(id) {
      if (id.startsWith("view:")) go(readersHash(id.slice(5), kind));
      else if (id.startsWith("kind:")) go(readersHash(view.id, id.slice(5)));
      else if (id === "switch") go("#/readers/setup");
      else if (id === "undo") decisions.runUndo();
      else if (id === "links") sheets.links(heading);
    },
  };
}

export { routeHash, cardLabel, waitingLine, sayWhen };
