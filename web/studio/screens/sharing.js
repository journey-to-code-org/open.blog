// Sharing: where her posts have gone out to her accounts (Facebook, Bluesky...) and what's going out
// next, grouped by what needs her. Share a post opens the composer (share-new.js). Her accounts are
// at the bottom: what's connected, how it's doing, Disconnect. Each row changes, checks or shows the
// history of its share in a sheet (parts/share-sheets.js), and one banner says when shares run late.
// Connecting, reconnecting and disconnecting are on Your accounts (#/sharing/accounts, R2), in the
// same tab; the side column only sums them up. Nothing is ever shared by
// itself: publishing never shares. A second view, "Where each post went" (?view=posts), shows every
// place each post ended up (parts/where-it-went.js); a site with no accounts that has shared
// something gets only that view. Studio slice 10c, R1; docs/specs/studio/slice-10bc/ux.md, r1/ux.md.
import { h, toast } from "../parts/dom.js";
import { use } from "../zubra.js";
import { ask } from "../parts/dialogs.js";
import { sayWhen } from "../parts/dates.js";
import { accountLabel, BADGES, deliveryOf, groups, healthBadge, healthWords, lateBanner, needsReconnect, problemLine, providerName, shareTrouble } from "../parts/share-words.js";
import { connectTarget, reconnectHref } from "../parts/social-rules.js";
import { browserZone, healthLines } from "../parts/announcements-rules.js";
import { createSheet, guardedLeave } from "../parts/sheet.js";
import { openChange, openCheck, openHistory } from "../parts/share-sheets.js";
import { createWhereItWent } from "../parts/where-it-went.js";
import { DAY_CHOICES, daysFrom, daysWords } from "../parts/distribution-rules.js";
import { say } from "../parts/words.js";

const SENDING_RELOAD_MS = 60 * 1000;

export async function createSharing({ api, go, meta = {}, posts: store = null }, route = { query: {} }) {
  await use("action-button", "alert-banner", "dropdown-menu", "empty-state", "segmented-control", "skeleton-block", "status-badge");
  const social = meta.social === true;
  const view = !social || route.query?.view === "posts" ? "posts" : "going";
  const days = daysFrom(route.query?.days);
  const checkId = route.query?.check || null;
  let destinations = [];
  let posts = [];
  let items = [];
  let accounts = [];
  let health = null;
  let providers = null;
  let sendingTimer = null;
  const zone = browserZone();
  const sheet = await createSheet({ label: "Share" });

  const heading = h("h2", { id: "studio-sharing-h", class: "studio-question", tabindex: "-1", text: "Where have your posts been shared?" });
  const share = h("action-button", { href: "#/sharing/new", hidden: !social }, "Share a post");
  const switcher = social ? h("segmented-control", { label: "Show", value: view, class: "studio-sharing-view",
    options: [{ value: "going", label: "Going out" }, { value: "posts", label: "Where each post went" }],
    onValuechange: (e) => go(e.detail === "posts" ? "#/sharing?view=posts" : "#/sharing") }) : null;
  const daysMenu = view === "posts" ? h("dropdown-menu", { class: "studio-row-menu",
    items: DAY_CHOICES.filter((n) => n !== days).map((n) => ({ value: String(n), label: `Show the last ${n === 365 ? "year" : `${n} days`}` })),
    onItemselect: (e) => go(`#/sharing?view=posts${e.detail === "30" ? "" : `&days=${e.detail}`}`) },
  h("span", { slot: "label" }, "More", h("span", { class: "studio-visually-hidden", text: " for where each post went" }))) : null;
  const where = view === "posts" ? await createWhereItWent({ api, days, social, posts: store }) : null;
  const status = h("p", { class: "studio-help", role: "status", "aria-live": "polite" });
  const banner = h("div", { class: "studio-banner" });
  const body = h("div", { class: "studio-card-sections", "aria-busy": "true" }, h("skeleton-block", { shape: "card" }));
  const accountsBox = h("section", { class: "studio-section", "aria-labelledby": "studio-accounts-h" });
  const details = h("details", { class: "studio-help" });
  const element = h("section", { class: "studio-page studio-sharing", "aria-labelledby": "studio-sharing-h" },
    h("div", { class: "studio-today" }, h("div", { class: "studio-comment-head" }, heading, daysMenu),
      h("p", { class: "studio-lede", text: social
        ? "Share a post to your Facebook Page or other accounts. Nothing is shared by itself; publishing a post never shares it."
        : `Every place your posts went ${daysWords(days)}, from your own records.` }), switcher, share),
    banner, status,
    where ? where.element
      : h("div", { class: "studio-comment-columns" }, h("div", { class: "studio-comment-main" }, body), h("div", { class: "studio-comment-side" }, accountsBox, details)));

  const titleOf = (work) => posts.find((p) => p.work === work)?.title || "A post";

  async function load() {
    if (where) return where.load();
    body.setAttribute("aria-busy", "true");
    try {
      const dest = await api.get("social/destinations");
      const found = await api.get("social/posts");
      const queue = await api.get("social/announcements");
      const acc = await api.get("social/accounts").catch(() => ({ accounts: [] }));
      destinations = dest.destinations || [];
      posts = found.posts || [];
      items = queue.announcements || [];
      accounts = (acc.accounts || []).filter((a) => a.status !== "disconnected" && a.health !== "disconnected");
      health = (await api.get("social/announcements/health").catch((error) => { if (error.status === 401) throw error; return null; }))?.health || null;
      // Only to name the empty state's button for the one place she can connect.
      if (!destinations.length) providers = (await api.get("social/status").catch((error) => { if (error.status === 401) throw error; return null; }))?.providers || null;
      banner.replaceChildren();
      draw();
      if (checkId) openFromLink(checkId);
    } catch (error) {
      if (error.status === 401) throw error;
      body.removeAttribute("aria-busy");
      body.replaceChildren(h("alert-banner", { variant: "danger", heading: "Your sharing didn't load" }, shareTrouble(error), " ",
        h("action-button", { variant: "secondary", size: "sm", onClick: () => load() }, "Try again")));
      drawDetails(error);
    }
  }

  function draw() {
    body.removeAttribute("aria-busy");
    drawAccounts();
    drawDetails();
    const reconnect = accounts.filter((a) => a.health === "needs-reauth" || a.health === "expiring");
    const late = lateBanner(health);
    banner.replaceChildren(
      ...(late ? [h("alert-banner", { variant: "warning", heading: late.heading }, ...late.lines.map((line) => h("p", { text: line })))] : []),
      ...reconnect.map((a) => h("alert-banner", { variant: "warning", heading: `${accountLabel(a)} needs reconnecting` }, healthWords(a, { timeZone: zone }), " ",
        h("a", { href: reconnectHref(a.id), "aria-label": `Reconnect ${a.displayName}` }, "Reconnect it"))));
    clearTimeout(sendingTimer);
    if (items.some((i) => deliveryOf(i) === "processing")) sendingTimer = setTimeout(() => { if (element.isConnected && !sheet.isOpen) load(); }, SENDING_RELOAD_MS);
    share.hidden = !destinations.length;
    if (!destinations.length) {
      const target = connectTarget(providers);
      body.replaceChildren(h("empty-state", { heading: "Nothing to share to yet" },
        "Connect your Facebook Page or another account, then share posts from here.",
        h("action-button", { slot: "actions", href: target.href }, target.label)));
      return;
    }
    const sets = groups(items);
    if (!sets.length) {
      body.replaceChildren(h("empty-state", { heading: "Nothing shared yet" }, "Share a post and it shows up here, with where it went.",
        h("action-button", { slot: "actions", href: "#/sharing/new" }, "Share a post")));
      return;
    }
    body.replaceChildren(...sets.map((g) => h("section", { class: "studio-section", "aria-labelledby": `studio-share-${g.id}` },
      h("h3", { id: `studio-share-${g.id}`, text: g.heading }),
      h("ul", { class: "studio-comment-list" }, ...g.items.slice(0, g.id === "shared" ? 10 : 100).map(row)))));
  }

  function row(item) {
    const state = deliveryOf(item);
    const headingId = `studio-share-${item.id}`;
    const title = titleOf(item.work);
    const buttons = [];
    if (state === "failed") {
      buttons.push(needsReconnect(item.lastErrorCode)
        ? h("action-button", { href: reconnectHref(item.accountId), label: `Reconnect: ${title}` }, "Reconnect")
        : h("action-button", { label: `Try again: ${title}`, onClick: (e) => retry(item, e.currentTarget) }, "Try again"));
    }
    if (state === "unknown") buttons.push(h("action-button", { label: `Check it: ${title}`, onClick: (e) => openCheck({ sheet, api, item, title, opener: e.currentTarget, onDone: (words, id) => changed(words, id), onRefresh: moved }) }, "Check it"));
    if (state === "pending" || state === "retrying") {
      buttons.push(h("action-button", { variant: "secondary", label: `Change: ${title}`, onClick: (e) => openChange({ sheet, api, item, title, zone, opener: e.currentTarget, onDone: (words, id) => changed(words, id), onRefresh: moved }) }, "Change"));
      buttons.push(h("action-button", { variant: "secondary", label: `Don't share it: ${title}`, onClick: () => cancel(item, title) }, "Don't share it"));
    }
    const menu = h("dropdown-menu", {
      class: "studio-row-menu",
      items: [{ value: "history", label: "Show its history" }],
      onItemselect: () => openHistory({ sheet, api, item, title, zone, opener: menu }),
    }, h("span", { slot: "label" }, "More", h("span", { class: "studio-visually-hidden", text: ` for ${title} on ${providerName(item.destination?.provider) || "an account"}` })));
    return h("li", { class: "studio-comment", "data-id": item.id },
      h("div", { class: "studio-comment-head" },
        h("h4", { id: headingId, class: "studio-comment-who", tabindex: "-1", text: title }),
        h("status-badge", { variant: state === "failed" ? "danger" : state === "published" ? "success" : "neutral" }, BADGES[state]), menu),
      h("p", { class: "studio-help", text: [accountLabel(item.destination), sayWhen(item.scheduledFor)].filter(Boolean).join(" · ") }),
      item.caption ? h("p", { class: "studio-comment-body", text: item.caption }) : null,
      (state === "failed" || state === "unknown" || state === "retrying") && item.lastErrorCode ? h("p", { class: "studio-help", text: problemLine(item.lastErrorCode) }) : null,
      state === "processing" ? h("p", { class: "studio-help", text: "It's going out now. This updates in a minute." }) : null,
      buttons.length ? h("div", { class: "studio-comment-actions" }, ...buttons) : null);
  }

  /** From "Check it" in Where each post went: that row, and its Check it sheet when it's unclear. */
  let linked = false;
  function openFromLink(id) {
    if (linked) return;
    linked = true;
    const item = items.find((i) => i.id === id);
    const rowHeading = body.querySelector(`[data-id="${CSS.escape(id)}"] .studio-comment-who`);
    if (!item || !rowHeading) return;
    requestAnimationFrame(() => {
      rowHeading.focus();
      if (deliveryOf(item) === "unknown") openCheck({ sheet, api, item, title: titleOf(item.work), opener: rowHeading, onDone: (words, done) => changed(words, done), onRefresh: moved });
    });
  }

  /** After a change or a check: the list again, the words, and her place on that row. */
  async function changed(words, id) {
    await load();
    status.textContent = words;
    toast(words);
    requestAnimationFrame(() => (body.querySelector(`[data-id="${id}"] .studio-comment-who`) || heading).focus());
  }

  async function moved(words) {
    await load();
    status.textContent = words;
    heading.focus();
  }

  async function retry(item, button) {
    button.loading = true;
    try {
      await api.post(`social/announcements/retry?id=${encodeURIComponent(item.id)}`, { version: item.version });
      await load();
      status.textContent = "It'll be tried again within a minute.";
      toast("It'll be tried again within a minute.");
    } catch (error) {
      if (error.status === 401) throw error;
      await refreshIfMoved(error);
    } finally {
      button.loading = false;
    }
  }

  async function cancel(item, title) {
    const where = providerName(item.destination?.provider) || "there";
    const choice = await ask({
      heading: `Don't share ${title} on ${where}?`,
      text: "It won't go out. You can share it again later.",
      choices: [{ label: "Keep it", value: "keep" }, { label: "Don't share it", value: "cancel", variant: "destructive" }],
    });
    if (choice !== "cancel") return;
    try {
      await api.post(`social/announcements/cancel?id=${encodeURIComponent(item.id)}`, { version: item.version });
      await load();
      status.textContent = "It won't be shared.";
      toast("It won't be shared.");
      heading.focus();
    } catch (error) {
      if (error.status === 401) throw error;
      await refreshIfMoved(error);
    }
  }

  async function refreshIfMoved(error) {
    if (["stale", "conflict", "not-editable", "not-retryable", "not-resolvable", "needs-resolution"].includes(error.data?.code)) {
      await load();
      status.textContent = "Something changed while you looked. Here's the list now.";
      return;
    }
    status.textContent = shareTrouble(error);
    drawDetails(error);
  }

  // ---- her accounts ---------------------------------------------------------------------------

  /** A summary: each account's name and how it's doing, then the way to manage them. */
  function drawAccounts() {
    accountsBox.replaceChildren(h("h3", { id: "studio-accounts-h", text: "Your accounts" }));
    if (!accounts.length) {
      accountsBox.append(h("p", { class: "studio-help", text: "None connected yet." }));
    } else {
      accountsBox.append(h("ul", { class: "studio-account-summary" }, ...accounts.map((a) => h("li", { "data-account": a.id },
        h("span", { class: "studio-account-name", text: a.displayName }), " ",
        h("status-badge", { variant: a.health === "ok" ? "success" : "warning" }, healthBadge(a, { timeZone: zone }))))));
    }
    accountsBox.append(h("p", {}, h("a", { class: "studio-more-link", href: "#/sharing/accounts" }, "Manage your accounts")));
  }

  function drawDetails(error = null) {
    details.replaceChildren(h("summary", { text: say("common.forHelper") }),
      h("ul", { class: "studio-mono" }, ...[
        error ? `error ${error.status}${error.data?.code ? ` (${error.data.code})` : ""}: ${error.message}` : null,
        ...destinations.map((d) => `destination ${d.id} ${d.provider} ${d.kind} ${d.displayName}`),
        ...items.map((i) => `${i.id} v${i.version} ${i.status}/${deliveryOf(i)} ${i.scheduledFor}${i.lastErrorCode ? ` ${i.lastErrorCode}` : ""}${i.checkedByOwner ? " checked by owner" : i.providerPostId ? ` post ${i.providerPostId}` : ""} ${i.canonicalUrl || i.work}`),
        ...(health && health.installed !== true ? ["health: not installed"] : []),
        ...healthLines(health).map((line) => `health ${line.code}: ${line.text}`),
      ].filter(Boolean).map((t) => h("li", { text: t }))));
  }

  return {
    title: "Sharing",
    element,
    load,
    reload: load,
    leave: async () => { const go = await guardedLeave(sheet); if (go) clearTimeout(sendingTimer); return go; },
    isDirty: () => sheet.isDirty(),
    focus: () => heading.focus(),
    get palette() {
      return [
        ...(social ? [{ id: "new", label: "Share a post", group: "Sharing" }, { id: "going", label: "Going out", group: "Sharing" }, { id: "accounts", label: "Go to Your accounts", group: "Sharing" }] : []),
        { id: "posts", label: "Where each post went", group: "Sharing" },
      ];
    },
    command(id) {
      if (id === "new") go("#/sharing/new");
      if (id === "posts") go("#/sharing?view=posts");
      if (id === "going") go("#/sharing");
      if (id === "accounts") go("#/sharing/accounts");
    },
  };
}
