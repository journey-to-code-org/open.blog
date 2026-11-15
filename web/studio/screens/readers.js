// Readers, what readers sent: one list for every kind of note, six views, a kind filter, a card per
// note with only the decisions the server offers, Undo for the no's, and a way to fix what is on the
// post. `#/readers/visitors` and `#/readers/setup` are the area's other two places. Studio R10;
// docs/specs/studio/r10/ux.md.
import { h, toast } from "../parts/dom.js";
import { use } from "../zubra.js";
import { ask } from "../parts/dialogs.js";
import { sayWhen } from "../parts/dates.js";
import { sendOut, siteLink, wentOutWords } from "../parts/publish.js";
import { routeHash } from "../router.js";
import { quietNotifyLink } from "../parts/notify-link.js";
import { say, sayParts } from "../parts/words.js";
import { readerHeader } from "../parts/reader-tabs.js";
import { createReaderCard } from "../parts/reader-card.js";
import { cardDetails, screenDetails } from "../parts/reader-details.js";
import { createReaderExtras } from "../parts/reader-extras.js";
import { createReaderSheets } from "../parts/reader-sheets.js";
import { drawBanners } from "../parts/reader-banners.js";
import { auditBanners, fixOpposite, noteWords, extrasProblem } from "../parts/reader-notes-rules.js";
import { guardedLeave } from "../parts/sheet.js";
import {
  shownViews, viewOf, viewLabel, viewLede, emptyWords, otherViewWords, kindsOffered, kindFilterWords, kindKnown, hasBeyondComments,
  readersHash, parseItemRef, reasonWords, quietReason, reportReason, decisionRequest, needsAcknowledge, didWords, undoWords,
  readerProblem, problemWords, readerWords, bulkEligible, sharedReasons, bulkRequest, bulkOutcome, bulkWords, bulkLine, fixRoute, waitingLine, cardLabel, VIEWS,
} from "../parts/reader-rules.js";

export async function createReaders(context, route) {
  await use("action-button", "alert-banner", "breadcrumb-trail", "dropdown-menu", "empty-state", "select-field", "skeleton-block", "status-badge", "text-field");
  const { api, meta, go } = context;
  const view = viewOf(route.arg);
  const kind = kindKnown(route.query.kind) ? route.query.kind : "";
  const wanted = parseItemRef(route.query.item);
  let items = [];
  let next = null;
  let page = null;
  let settings = null;
  let undo = null; // { item, words }: the last decision that can go back to Waiting
  const busy = new Set();
  // What the cards' extras read: the notes on the posts (with the file's etag), features, links.
  const extra = { published: new Map(), etag: "absent", features: new Map(), continuations: { links: [], works: [] }, linksOffered: false };
  const auditHost = h("div", { class: "studio-banner studio-reader-audits" });
  const tell = (words, { undo: run } = {}) => {
    status.textContent = words;
    if (run) offerUndo(null, words, run);
  };
  const reloadAll = async (ref) => { await loadExtras(); await reloadKeeping(ref, null); };
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
  let selecting = false;
  const chosen = new Set();
  const selectBox = h("input", { type: "checkbox", id: "studio-readers-select" });
  const selectLabel = h("label", { class: "studio-select-toggle", for: "studio-readers-select", hidden: true }, selectBox, " ", say("readers.select"));
  selectBox.addEventListener("change", () => setSelecting(selectBox.checked));
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

  const commentsOnly = () => !hasBeyondComments(kindsOffered(settings, page, kind));

  function drawChrome() {
    const kinds = kindsOffered(settings, page, kind);
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
    if (!items.length && list.getAttribute("aria-busy") !== "true") draw();
  }

  // The notes on the posts, the two checks of what's on them, and the links to later posts: in
  // parallel, never blocking the list. A 403 (not the site's owner) says nothing; anything else is said.
  async function loadExtras() {
    if (!hasBeyondComments(kindsOffered(settings, page, kind))) return;
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
    quietNotifyLink(notifyLink, { meta, what: hasBeyondComments(kindsOffered(settings, page, kind)) ? say("notify.readersLink") : say("notify.commentsLink") });
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
    loadSettings();
    try {
      page = await fetchPage(null);
      items = page.items || [];
      next = page.next || null;
      banner.querySelector(".studio-load-trouble")?.remove();
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
    if (!next) return;
    moreButton.loading = true;
    const first = items.length;
    try {
      const more = await fetchPage(next);
      items = items.concat(more.items || []);
      next = more.next || null;
      page = { ...page, invalid: (page.invalid || 0) + (more.invalid || 0), next };
      draw();
      status.textContent = say("readers.showing", { n: items.length });
      focusCard(items[first] && `${items[first].source}:${items[first].id}`);
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
    if (items.some((i) => `${i.source}:${i.id}` === ref)) { focusCard(ref); return; }
    try {
      const one = await api.get(`engagement/moderation/item?source=${encodeURIComponent(wanted.source)}&id=${encodeURIComponent(wanted.id)}`);
      const item = one.item || one;
      const there = VIEWS.find((v) => v.state === item.status) || VIEWS[0];
      if (there.state !== view.state) {
        status.textContent = say("readers.itemDecided", { view: viewLabel(there) });
        banner.append(h("p", { class: "studio-help" }, h("a", { href: readersHash(there.id, kind, ref), text: viewLabel(there) })));
        return;
      }
      items = [item, ...items.filter((i) => `${i.source}:${i.id}` !== ref)];
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

  const on = {
    decide: (item, action, reason, line, control) => decide(item, action, reason, line, control),
    start: (item, button, line, control) => startDecision(item, button, line, control),
    fix: (item, state, line, control) => fix(item, state, line, control),
    more: (item, value, line) => moreMenu(item, value, line),
    focusRef: (ref) => focusCard(ref),
    cardDetails: (item, row) => row.append(cardDetails(item)),
    details: (item, row) => extras.details(item, row),
    extras: (item, row, line) => extras.extras(item, row, line),
    moreItems: (item) => (item.suggestion?.export ? [{ value: "copy-notes", label: say("readers.menuCopyNotes") }] : []),
    select: (item, label) => (selecting ? selectCheckbox(item, label) : null),
  };

  function draw() {
    list.removeAttribute("aria-busy");
    drawBar();
    moreButton.hidden = !next;
    after.replaceChildren();
    if (page?.invalid > 0) after.append(h("p", { class: "studio-help", text: say("readers.invalid") }));
    details.replaceChildren(...screenDetails({ view, kind, page, next, settings }), h("p", { class: "studio-help", text: say("readers.keysHelp") }));
    if (!items.length) {
      const off = view.state === "pending" && settings && settings.comments === false;
      const [title, text] = emptyWords(view, { commentsOnly: commentsOnly() });
      const action = off
        ? h("action-button", { slot: "actions", onClick: () => go("#/readers/setup") }, say("readers.turnOn"))
        : h("action-button", { slot: "actions", variant: "secondary", onClick: () => go(readersHash(view.other, kind)) }, otherViewWords(view));
      list.replaceChildren(h("li", {}, h("empty-state", { heading: title }, off ? say("readers.emptyOff") : text, action)));
      return;
    }
    list.replaceChildren(...items.map((item) => createReaderCard({ item, meta, view, on })));
  }

  const focusCard = (ref) => requestAnimationFrame(() => list.querySelector(`[data-ref="${ref}"] .studio-comment-who`)?.focus());

  // ---- bulk ---------------------------------------------------------------------------------------

  const ref = (item) => `${item.source}:${item.id}`;
  const eligible = () => items.filter(bulkEligible);
  const picked = () => items.filter((i) => chosen.has(ref(i)));

  function selectCheckbox(item, label) {
    const ok = bulkEligible(item);
    const box = h("input", { type: "checkbox", "aria-label": say("readers.selectOne", { label }), checked: chosen.has(ref(item)), disabled: !ok, class: "studio-select-one" });
    if (!ok) box.setAttribute("aria-describedby", `studio-bulk-no-${item.id}`);
    box.addEventListener("change", () => {
      if (box.checked) chosen.add(ref(item)); else chosen.delete(ref(item));
      drawBar();
    });
    return h("span", { class: "studio-select-cell" }, box, ok ? null : h("span", { id: `studio-bulk-no-${item.id}`, class: "studio-visually-hidden", text: say("readers.bulkNotThis") }));
  }

  function setSelecting(on) {
    selecting = on && view.state === "pending";
    if (!selecting) chosen.clear();
    selectBox.checked = selecting;
    draw();
    if (selecting) selectLabel.querySelector("input")?.focus();
  }

  function drawBar() {
    const canSelect = view.state === "pending" && eligible().length >= 2;
    selectLabel.hidden = !canSelect && !selecting;
    if (!canSelect && selecting) { selecting = false; chosen.clear(); selectBox.checked = false; }
    for (const r of [...chosen]) if (!items.some((i) => ref(i) === r)) chosen.delete(r);
    bulkBar.hidden = !selecting;
    if (!selecting) { bulkBar.replaceChildren(); return; }
    const n = chosen.size;
    bulkBar.replaceChildren(
      h("span", { class: "studio-bulk-count", role: "status", "aria-live": "polite", text: say("readers.selected", { n }) }),
      h("action-button", { variant: "secondary", size: "sm", onClick: () => { eligible().forEach((i) => chosen.add(ref(i))); draw(); } }, say("readers.selectAll", { m: eligible().length })),
      h("action-button", { size: "sm", disabled: n < 1, onClick: () => bulkAsk("approve") }, say("readers.bulkShow", { n })),
      h("action-button", { variant: "secondary", size: "sm", disabled: n < 1, onClick: () => bulkAsk("reject") }, say("readers.bulkHide", { n })),
      h("action-button", { variant: "ghost", size: "sm", onClick: () => setSelecting(false) }, say("readers.cancel")),
    );
  }

  async function bulkAsk(action) {
    const them = picked();
    if (!them.length) return;
    let reason = null;
    if (action === "approve") {
      if (them.length >= 2) {
        const choice = await ask({
          heading: say("readers.bulkShowTitle", { n: them.length }), text: say("readers.bulkShowText"),
          choices: [{ label: say("readers.bulkShowYes"), value: "yes", variant: "secondary" }, { label: say("readers.bulkNotNow"), value: "no" }], focus: 1,
        });
        if (choice !== "yes") return;
      }
    } else {
      const reasons = sharedReasons(them);
      const choice = await ask({
        heading: say("readers.bulkHideTitle", { n: them.length }), text: say("readers.bulkHideText"),
        choices: [...reasons.map((r) => ({ label: reasonWords(r), value: r.id, variant: "secondary" })), { label: say("readers.cancel"), value: "", variant: "ghost" }],
      });
      if (!choice) return;
      reason = choice;
    }
    return bulkRun(them, action, reason);
  }

  async function bulkRun(them, action, reason) {
    bulkBar.querySelectorAll("action-button").forEach((b) => { b.disabled = true; });
    let reply;
    try {
      reply = await api.patch("engagement/moderation/batch", bulkRequest(them, action, reason));
    } catch (error) {
      if (error.status === 401) throw error;
      status.textContent = problemWords(readerProblem(error, "list"));
      drawBar();
      return;
    }
    const outcome = bulkOutcome(them, reply);
    const gone = new Set(outcome.done.map(ref));
    items = items.filter((i) => !gone.has(ref(i)));
    outcome.done.forEach((i) => chosen.delete(ref(i)));
    draw();
    for (const { item, code } of outcome.failed) {
      const line = list.querySelector(`[data-ref="${ref(item)}"] .studio-comment-trouble`);
      if (line) { line.textContent = bulkLine(code); line.hidden = false; }
    }
    const said = bulkWords(outcome, action);
    status.textContent = said;
    toast(said);
    if (outcome.done.length && action === "reject") {
      undo = { bulk: outcome.done, words: say("readers.bulkUndoNote", { n: outcome.done.length }) };
      const button = h("action-button", { size: "sm", onClick: () => runUndo() }, say("readers.undo"));
      const alert = h("alert-banner", { variant: "info", dismissible: true, heading: undo.words }, button);
      alert.addEventListener("close", () => clearUndo());
      undoSlot.replaceChildren(alert);
    } else clearUndo();
    const near = outcome.failed[0] ? ref(outcome.failed[0].item) : items[0] ? ref(items[0]) : "";
    if (near) focusCard(near); else heading.focus();
  }

  // ---- deciding ---------------------------------------------------------------------------------

  async function startDecision(item, b, line, control) {
    if (b.action === "erase") {
      const choice = await ask({
        heading: sayParts("readers.eraseTitle", { name: item.reader?.name || say("readers.someone"), kind: item.source === "report" ? say("readers.kind.abuseReport").toLowerCase() : say("readers.kind.comment").toLowerCase() }, item.reader?.name ? ["name"] : []),
        text: say("readers.eraseText"),
        choices: [{ label: say("readers.eraseKeep"), value: "keep", variant: "secondary" }, { label: say("readers.eraseYes"), value: "erase", variant: "destructive" }],
      });
      return choice === "erase" ? decide(item, "erase", null, line, control) : undefined;
    }
    if (b.asks) {
      const choice = await ask({
        heading: say("readers.whyTitle"),
        text: b.offer.guidance && b.offer.guidance.length < 120 ? b.offer.guidance : say("readers.whyText"),
        choices: [...b.offer.reasons.map((r) => ({ label: reasonWords(r), value: r.id, variant: "secondary" })), { label: say("readers.cancel"), value: "", variant: "ghost" }],
      });
      return choice ? decide(item, b.action, choice, line, control) : undefined;
    }
    if (needsAcknowledge(item, b.action)) {
      const postUrl = item.post?.url ? siteLink(meta, item.post.url) : "";
      const choice = await ask({
        heading: say("readers.ackTitle"), text: say("readers.ackText"),
        choices: [{ label: say("readers.ackNo"), value: "no", variant: "primary" }, { label: say("readers.ackYes"), value: "yes", variant: "secondary" }, ...(postUrl ? [{ label: say("readers.ackOpen"), value: "open", variant: "ghost" }] : [])],
      });
      if (choice === "open") { window.open(postUrl, "_blank", "noopener"); return; }
      return choice === "yes" ? decide(item, b.action, null, line, control, { acknowledged: true }) : undefined;
    }
    const reason = item.source !== "report" ? null : b.action === "reject" ? quietReason(b.offer) : b.action === "uphold-report" ? reportReason(item) : null;
    return decide(item, b.action, reason, line, control);
  }

  async function decide(item, action, reason, line, control, options = {}) {
    const ref = `${item.source}:${item.id}`;
    if (busy.has(ref)) return;
    busy.add(ref);
    if (control && "loading" in control) control.loading = true;
    line.hidden = true;
    try {
      const reply = await api.patch("engagement/moderation", decisionRequest(item, action, reason, options));
      let said = didWords(item, action, reply).text;
      if (reply.publishError) said += ` ${say("readers.postNotUpdated")}`;
      if (reply.continuationsError) said += ` ${say("readers.linksNotUpdated")}`;
      if (reply.published) {
        const out = await sendOut(api, "A note from a reader");
        const sent = wentOutWords(out, { meta, action: "saved" }).words.replace(/^Saved\.\s*/, "");
        said = `${said} ${sent}`.trim();
      }
      const index = items.findIndex((i) => `${i.source}:${i.id}` === ref);
      items = items.filter((i) => `${i.source}:${i.id}` !== ref);
      draw();
      status.textContent = said;
      toast(said);
      const near = items[index] || items[index - 1];
      if (near) focusCard(`${near.source}:${near.id}`);
      else requestAnimationFrame(() => list.querySelector("empty-state")?.focus?.() || heading.focus());
      const undoText = undoWords(item, action);
      if (undoText && reply?.item?.version) offerUndo({ ...item, ...reply.item, source: item.source }, undoText);
      else if (action !== "reopen") clearUndo();
    } catch (error) {
      if (error.status === 401) throw error;
      const problem = readerProblem(error, "card");
      if (problem.reload) {
        await reloadKeeping(ref, problem.id);
        return;
      }
      line.textContent = problemWords(problem);
      line.hidden = false;
      line.focus();
    } finally {
      busy.delete(ref);
      if (control && "loading" in control) control.loading = false;
    }
  }

  async function reloadKeeping(ref, id) {
    const want = items.length;
    try {
      let fresh = await fetchPage(null);
      let all = fresh.items || [];
      while (fresh.next && all.length < want) {
        fresh = await fetchPage(fresh.next);
        all = all.concat(fresh.items || []);
      }
      page = { ...fresh, invalid: page?.invalid || 0 };
      items = all;
      next = fresh.next || null;
      draw();
      if (items.some((i) => `${i.source}:${i.id}` === ref)) {
        focusCard(ref);
        const line = list.querySelector(`[data-ref="${ref}"] .studio-comment-trouble`);
        if (line && id) { line.textContent = readerWords(id); line.hidden = false; }
      } else if (id) {
        status.textContent = say("readers.decidedElsewhere");
        heading.focus();
      }
    } catch (error) {
      status.textContent = problemWords(readerProblem(error, "list"));
    }
  }

  // What is on the post: one button, the opposite call for Undo.
  async function fix(item, state, line, control, { undoing = false } = {}) {
    if (control) control.loading = true;
    try {
      const body = { id: item.id, version: item.version };
      await api.post(fixRoute(item, state.action), body);
      const out = await sendOut(api, "A note from a reader");
      const went = wentOutWords(out, { meta, action: "saved" }).words.replace(/^Saved\.\s*/, "");
      const said = `${undoing ? say("readers.fixUndone") : say("readers.fixDone")} ${went}`.trim();
      const back = fixOpposite(state.action);
      status.textContent = said;
      toast(said);
      if (!undoing && back) offerUndo(null, said, () => fix(item, { ...state, action: back }, line, null, { undoing: true }));
      await reloadKeeping(`${item.source}:${item.id}`, null);
    } catch (error) {
      if (error.status === 401) throw error;
      line.textContent = say("readers.fixFailed");
      line.hidden = false;
      line.focus();
    } finally {
      if (control) control.loading = false;
    }
  }

  async function moreMenu(item, value, line) {
    if (value === "copy-notes") {
      try {
        await api.post("engagement/suggestions/export", { id: item.id, version: item.version });
        status.textContent = say("readers.ideaCopied");
      } catch (error) {
        if (error.status === 401) throw error;
        if (error.status === 409) await reloadKeeping(`${item.source}:${item.id}`, "readers.changedHere");
        else { line.textContent = noteWords(extrasProblem(error, "export")); line.hidden = false; }
      }
      return;
    }
    if (value !== "copy-link") return;
    const link = `${location.origin}${location.pathname}${readersHash(viewOf(VIEWS.find((v) => v.state === item.status)?.id || "").id, "", `${item.source}:${item.id}`)}`;
    try {
      await navigator.clipboard.writeText(link);
      status.textContent = say("readers.menuCopied");
    } catch {
      line.textContent = link;
      line.hidden = false;
    }
  }

  // ---- undo: the last no goes back to Waiting ---------------------------------------------------

  /** The banner's one Undo: `item` goes back to Waiting, or `run` undoes something else (a fix, an answer). */
  function offerUndo(item, words, run = null) {
    undo = { item, words, run };
    const button = h("action-button", { size: "sm", onClick: () => runUndo() }, say("readers.undo"));
    const alert = h("alert-banner", { variant: "info", dismissible: true, heading: words }, button);
    alert.addEventListener("close", () => clearUndo());
    undoSlot.replaceChildren(alert);
  }

  function clearUndo() {
    undo = null;
    undoSlot.replaceChildren();
  }

  let undoing = false;
  async function runUndo() {
    if (!undo || undoing) return;
    undoing = true;
    const { item, bulk, run } = undo;
    const button = undoSlot.querySelector("action-button");
    if (button) button.loading = true;
    try {
      if (run) {
        clearUndo();
        await run();
        return;
      }
      if (bulk) {
        const reply = await api.patch("engagement/moderation/batch", bulkRequest(bulk.map((i) => ({ ...i, status: "rejected" })), "reopen"));
        const back = bulkOutcome(bulk, reply).done.length;
        clearUndo();
        status.textContent = say("readers.bulkUndone", { n: back });
        await load();
        return;
      }
      await api.patch("engagement/moderation", decisionRequest(item, "reopen", null));
      clearUndo();
      status.textContent = say("readers.didBack");
      toast(say("readers.didBack"));
      if (view.state === "pending") await load();
    } catch (error) {
      if (error.status === 401) throw error;
      const there = VIEWS.find((v) => v.state === item.status) || VIEWS[0];
      status.textContent = error.status === 409 ? say("readers.undoChanged", { where: viewLabel(there) }) : problemWords(readerProblem(error, "card"));
    } finally {
      undoing = false;
      if (button) button.loading = false;
    }
  }

  // ---- keys: only while a card has focus (WCAG 2.1.4) -------------------------------------------

  list.addEventListener("keydown", (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target.closest?.("input, textarea, select, [contenteditable], dropdown-menu, [role=menu]")) return;
    const card = event.target.closest?.(".studio-reader");
    if (!card) return;
    const key = event.key.toLowerCase();
    const cards = [...list.querySelectorAll(".studio-reader")];
    const at = cards.indexOf(card);
    if (key === "j" || key === "k") {
      const target = cards[at + (key === "j" ? 1 : -1)];
      if (target) { event.preventDefault(); target.querySelector(".studio-comment-who")?.focus(); }
    } else if (key === "s") {
      card.querySelector('action-button[data-action="approve"] button, action-button[data-action="approve"]')?.click();
    } else if (key === "n" || key === "t") {
      const menu = card.querySelector(`dropdown-menu[data-action="${key === "n" ? "reject" : "remove"}"]`);
      (menu?.querySelector("button") || menu)?.click();
    } else if (key === "u") {
      runUndo();
    } else if (key === "x") {
      // Select (with Select on): the card's own checkbox.
      const box = card.querySelector("input[type=checkbox].studio-reader-select, input[type=checkbox]");
      if (!selecting || !box || box.disabled) return;
      box.click();
    } else return;
    if (key !== "j" && key !== "k") event.preventDefault();
  });

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
        ...kindsOffered(settings, page, kind).map((id) => ({ id: `kind:${id}`, label: say("readers.findKind", { kind: kindFilterWords(id).toLowerCase() }), group })),
        { id: "kind:", label: say("readers.findEveryKind"), group },
        ...(settings ? [{ id: "switch", label: settings.comments === false ? say("readers.findSwitchOn") : say("readers.findSwitchOff"), group }] : []),
        ...(undo ? [{ id: "undo", label: say("readers.findUndo"), group }] : []),
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
      else if (id === "undo") runUndo();
      else if (id === "links") sheets.links(heading);
    },
  };
}

export { routeHash, cardLabel, waitingLine, sayWhen };
