// Your accounts (#/sharing/accounts, Studio R2): "Where can Studio post for me, and is it working?"
// Her accounts with their health in words, attempts still waiting, Connect for each place the site
// offers, Reconnect and Disconnect. Connecting happens in a sheet (parts/account-sheets.js); coming
// back from the provider lands here with ?connection=<id>, which is read once and taken out of the
// address so Back never runs it again. Nothing is connected until she picks where posts go.
// docs/specs/studio/r2/ux.md.
import { h, toast } from "../parts/dom.js";
import { use } from "../zubra.js";
import { ask } from "../parts/dialogs.js";
import { sayDay } from "../parts/dates.js";
import { browserZone } from "../parts/announcements-rules.js";
import { providerName, shareTrouble } from "../parts/share-words.js";
import { createSheet, guardedLeave } from "../parts/sheet.js";
import { createAccountSheets } from "../parts/account-sheets.js";
import { detailsBox } from "../parts/account-details.js";
import { createAccountCards } from "../parts/account-cards.js";
import * as R from "../parts/social-rules.js";

const POLL_MS = 3000;
const POLL_TRIES = 40; // two minutes
const ACCOUNTS = "#/sharing/accounts";

// The provider address of an attempt started in this page, for the new-tab way. Never kept past a
// reload: the server doesn't return it again, so Start again covers that (G6 b).
const links = new Map();

export async function createAccounts(context, route = { query: {} }) {
  const { api, go, meta = {} } = context;
  await use("action-button", "alert-banner", "dropdown-menu", "empty-state", "skeleton-block", "status-badge");
  const timeZone = browserZone();
  const sheet = await createSheet({ label: "Your accounts" });
  let overview = null;
  let accounts = [];
  let connections = [];
  let items = null;
  let pollTries = 0;
  let pollTimer = null;
  let pending = { ...route.query };
  let retried = new Set(); // accounts whose "Try them again" already ran this time
  const watchers = new Map();

  // The shell's h1 already says "Your accounts": like Your posts, the h2 is there for focus and screen readers only.
  const heading = h("h2", { id: "studio-accounts-page-h", class: "studio-visually-hidden", tabindex: "-1", text: "Your accounts" });
  const status = h("p", { class: "studio-help", role: "status", "aria-live": "polite", tabindex: "-1" });
  const top = h("div", { class: "studio-banner" });
  const primarySlot = h("div", { class: "studio-account-primary" });
  const main = h("div", { class: "studio-card-sections", "aria-busy": "true" }, h("skeleton-block", { shape: "card" }));
  const addHeading = h("h3", { id: "studio-accounts-add-h", tabindex: "-1", text: "Add an account" });
  const side = h("div", { class: "studio-account-side" });
  const element = h("section", { class: "studio-page studio-accounts", "aria-labelledby": "studio-accounts-page-h" },
    h("a", { class: "studio-more-link", href: "#/sharing", text: "< Back to Sharing" }),
    heading,
    h("p", { class: "studio-lede", text: "Where your blog can post for you. It posts only when you share a post." }),
    primarySlot, top, status,
    h("div", { class: "studio-account-columns" }, h("div", { class: "studio-account-main" }, main), side));

  const providerOf = (name) => overview?.providers?.find((p) => p.provider === name) || null;
  const sheets = createAccountSheets({
    api, sheet, links, timeZone, providerOf,
    reread: async (id) => { await readConnections(); return connections.find((c) => c.id === id) || null; },
    watch: (id, then) => watchers.set(id, then),
    done,
  });

  const cards = createAccountCards({ sheets, links, timeZone, onRetry: (account, failed, button) => retry(account, failed, button), onDisconnect: (account, opener) => disconnect(account, opener) });
  const say = (words) => { status.textContent = words; };
  const live = () => R.liveAttempts(connections, Date.now());
  const shown = () => accounts.filter((a) => a.status !== "disconnected" && a.health !== "disconnected");

  async function readConnections() {
    connections = (await api.get("social/connections")).connections || [];
  }

  async function load() {
    clearTimeout(pollTimer);
    // The address goes back to plain Your accounts whatever happens next (sharing off, a failed
    // read), so Back or a reload never runs a link again. `pending` keeps it for this page.
    if (Object.keys(pending).length) context.replaceRoute?.(ACCOUNTS);
    if (meta.social !== true) return drawOff({ state: "off" });
    main.setAttribute("aria-busy", "true");
    try {
      overview = await api.get("social/status");
      if (overview.enabled) {
        const [acc, con] = await Promise.all([api.get("social/accounts"), api.get("social/connections")]);
        accounts = acc.accounts || [];
        connections = con.connections || [];
        // Counts only: if the shares can't be read, the counts are left out.
        items = await api.get("social/announcements").then((r) => r.announcements || [], (error) => { if (error.status === 401) throw error; return null; });
      }
    } catch (error) {
      if (error.status === 401) throw error;
      main.removeAttribute("aria-busy");
      primarySlot.replaceChildren();
      main.replaceChildren(h("alert-banner", { variant: "danger", heading: "Your accounts didn't load" }, shareTrouble(error), " ",
        h("action-button", { variant: "secondary", size: "sm", onClick: () => load() }, "Try again")));
      side.replaceChildren(detailsBox([sheets.errorText(error)]));
      return;
    }
    if (!overview.enabled) return drawOff(overview);
    draw();
    for (const [id, then] of watchers) {
      const found = connections.find((c) => c.id === id);
      if (found && found.status !== "pending" && found.status !== "exchanging") { watchers.delete(id); then(found); }
    }
    poll();
    await followLink();
  }

  // ---- what she sees ---------------------------------------------------------------------------

  function drawOff(state) {
    main.removeAttribute("aria-busy");
    primarySlot.replaceChildren();
    side.replaceChildren();
    if (state.state === "invalid" || state.state === "unavailable") {
      main.replaceChildren(h("alert-banner", { variant: "warning", heading: "Sharing isn't set up right" }, "Tell the person who set up your site."));
      side.replaceChildren(detailsBox(state.state === "invalid"
        ? ["These settings aren't valid:", ...(state.problems || [])]
        : [state.message || "The sharing service says it isn't turned on (OPENBLOG_SOCIAL_ENABLED)."]));
      return;
    }
    main.replaceChildren(h("empty-state", { heading: "Sharing to Facebook isn't set up" }, "The person who set up your site can turn it on. Your site works the same without it."));
    side.replaceChildren(detailsBox(["Set OPENBLOG_SOCIAL_ENDPOINT and OPENBLOG_SOCIAL_ADMIN_KEY where Studio runs (docs/social-publishing.md)."]));
  }

  function draw() {
    main.removeAttribute("aria-busy");
    const providers = R.providerOrder(overview.providers || []);
    const next = R.primaryAction({ connections, accounts, providers, now: Date.now() });
    const attempts = live().filter((c) => !c.reauthAccountId);
    const mine = shown().sort((a, b) => Number(needs(b)) - Number(needs(a)));
    primarySlot.replaceChildren(next.kind === "share" ? h("action-button", { href: "#/sharing/new" }, "Share a post") : "");
    if (!providers.length && !mine.length) {
      main.replaceChildren(h("empty-state", { heading: "No accounts can be connected yet" }, "The person who set up your site needs to add Facebook or another place first."));
    } else {
      main.replaceChildren(
        ...(attempts.length ? [h("ul", { class: "studio-comment-list", "aria-label": "Not finished" }, ...attempts.map((c) => cards.attempt(c)))] : []),
        mine.length ? h("ul", { class: "studio-comment-list", "aria-label": "Your accounts" }, ...mine.map((a) => cards.account(a, {
          primary: next.kind === "reconnect" && next.account.id === a.id,
          attempt: live().find((c) => c.reauthAccountId === a.id),
          waiting: items ? R.waitingFor(items, a.id) : 0,
          failed: items && !needs(a) && !retried.has(a.id) ? R.toRetry(items, a.id) : [],
        }))) : h("p", { class: "studio-help", text: "None connected yet." }));
    }
    side.replaceChildren(addHeading,
      providers.length ? h("ul", { class: "studio-comment-list", "aria-labelledby": "studio-accounts-add-h" }, ...providers.map((p, i) => cards.provider(p, { primary: next.kind === "connect" && i === 0, connected: shown().some((a) => a.provider === p.provider) }))) : h("p", { class: "studio-help", text: "None offered yet." }),
      detailsBox(pageLines()));
  }

  const needs = (a) => a.health === "needs-reauth" || a.health === "expiring";

  function pageLines() {
    const gone = accounts.filter((a) => a.status === "disconnected" || a.health === "disconnected");
    return [
      `Sends you back to Studio after signing in: ${overview.returns === true ? "yes" : "no (the sharing service is from before this, or Studio isn't on https)"}`,
      ...(overview.problems?.length ? ["These provider settings aren't valid and were skipped:", ...overview.problems] : []),
      ...(!overview.providers?.length ? ["Add a provider's client id and secret, and OPENBLOG_SOCIAL_CALLBACK_BASE, to the sharing service (docs/social-publishing.md)."] : []),
      ...(overview.providers || []).filter((p) => p.redirectUri).map((p) => `${p.provider} redirect: ${p.redirectUri}`),
      ...gone.map((a) => `disconnected: ${a.displayName} (${a.provider} ${a.externalId})${a.disconnectedAt ? ` on ${sayDay(a.disconnectedAt, { timeZone })}` : ""}`),
      ...connections.slice(0, 10).map((c) => `attempt ${c.id} ${c.provider} ${c.status}${c.errorCode ? ` (${c.errorCode})` : ""}`),
    ];
  }

  // ---- what she does -----------------------------------------------------------------------------

  async function retry(account, failed, button) {
    button.loading = true;
    let done = 0;
    let stuck = 0;
    for (const item of failed) {
      try {
        await api.post(`social/announcements/retry?id=${encodeURIComponent(item.id)}`, { version: item.version });
        done += 1;
      } catch (error) {
        if (error.status === 401) throw error;
        stuck += 1;
      }
    }
    retried.add(account.id);
    await load();
    const words = R.retriedWords(done, stuck);
    say(words);
    if (stuck) status.append(" ", h("a", { href: "#/sharing", text: "Open Sharing" }));
    toast(words);
    focusCard(account.id);
  }

  async function disconnect(account, opener) {
    const waiting = items ? R.waitingFor(items, account.id) : 0;
    const choice = await ask({
      heading: `Disconnect ${account.displayName}?`,
      text: R.disconnectWords(waiting),
      choices: [{ label: "Keep it connected", value: "keep" }, { label: "Disconnect", value: "go", variant: "destructive" }],
    });
    if (choice !== "go") { opener?.focus?.(); return; }
    const at = shown().findIndex((a) => a.id === account.id);
    try {
      const reply = await api.post(`social/accounts/${account.id}/disconnect`, {});
      await load();
      const words = R.disconnectedWords(account.displayName, reply?.account?.canceledAnnouncements);
      say(words);
      toast(words);
      const after = shown()[Math.min(at, shown().length - 1)];
      requestAnimationFrame(() => (after ? element.querySelector(`#studio-account-${CSS.escape(after.id)}`) : heading)?.focus());
    } catch (error) {
      if (error.status === 401) throw error;
      say(R.actionTrouble(error, account.provider));
    }
  }

  function focusCard(accountId, fallback = heading) {
    requestAnimationFrame(() => (element.querySelector(`#studio-account-${CSS.escape(accountId)}`) || fallback).focus());
  }

  /** What a sheet reports back. */
  async function done(event) {
    if (event.kind === "connected") {
      await load();
      const words = R.connectedWords(event.account);
      say(words);
      toast("Connected.", { action: { label: "Share a post", href: "#/sharing/new" } });
      focusCard(event.account?.id);
    } else if (event.kind === "reconnected") {
      await load();
      const account = accounts.find((a) => a.id === event.accountId);
      say(`Reconnected. ${account?.displayName || "It"} works again.`);
      focusCard(event.accountId);
    } else if (event.kind === "stopped") {
      await load();
      say("Stopped. Nothing was connected.");
      requestAnimationFrame(() => addHeading.focus());
    } else if (event.kind === "refresh") {
      await load();
      say(event.words);
      heading.focus();
    } else if (event.kind === "already") {
      await load();
      say(`${event.name} is already connected. Use Reconnect on it if it stopped working.`);
      const found = shown().find((a) => a.externalId === event.externalId);
      focusCard(found?.id || "", heading);
    } else if (event.kind === "gone") {
      await load();
      say(`${event.account.displayName} isn't connected any more. Connect it again.`);
      requestAnimationFrame(() => addHeading.focus());
    } else if (event.kind === "returned") {
      sheet.close();
      await arrive(event.connection);
    } else if (event.kind === "trouble") {
      say(R.actionTrouble(event.error, event.provider));
    }
  }

  // ---- coming back, and links from elsewhere -----------------------------------------------------

  /** ?connection=<id> (back from the provider), ?connect=<provider>, ?reconnect=<account id>: read once. */
  async function followLink() {
    const query = pending;
    pending = {};
    if (!Object.keys(query).length) return;
    const id = R.returnConnectionId(query);
    if (id) {
      const found = connections.find((c) => c.id === id);
      if (!found) {
        say("Your blog couldn't find that connection. If your account isn't listed, connect it again.");
        requestAnimationFrame(() => status.focus());
        return;
      }
      await arrive(found);
      return;
    }
    if (query.connect) {
      const provider = providerOf(query.connect);
      if (provider) await sheets.openConnect(provider, { opener: addHeading });
    } else if (query.reconnect) {
      const account = shown().find((a) => a.id === query.reconnect);
      if (account) await sheets.openReconnect(account, { opener: heading });
      else say("That account isn't connected any more. Connect it again.");
    }
  }

  /** She came back from the provider: what happened, and the next step. */
  async function arrive(connection) {
    const account = connection.reauthAccountId ? accounts.find((a) => a.id === connection.reauthAccountId) : null;
    if (connection.status === "authorized" && !connection.reauthAccountId) return sheets.openChoose(connection, { opener: heading });
    if (connection.status === "exchanging") {
      await sheets.openFinishing(connection, { opener: heading });
      watchers.set(connection.id, (found) => { sheet.close(); arrive(found); });
      return;
    }
    if (connection.status === "completed" && account) {
      say(`Reconnected. ${account.displayName} works again.`);
      return focusCard(account.id);
    }
    if (connection.status === "completed") {
      const made = shown().filter((a) => a.provider === connection.provider && (connection.destinations || []).some((d) => d.id === a.externalId))
        .sort((a, b) => Date.parse(b.createdAt || "") - Date.parse(a.createdAt || ""))[0];
      say(made ? R.connectedWords(made) : "Connected.");
      return made ? focusCard(made.id) : heading.focus();
    }
    if (connection.status === "failed" || connection.status === "expired") {
      if (account) return sheets.openReconnect(account, { opener: heading, failure: connection });
      const provider = providerOf(connection.provider);
      if (provider) return sheets.openConnect(provider, { opener: addHeading, failure: connection });
      say(R.outcomeWords(connection.errorCode || connection.status, connection.provider));
    }
    // Canceled, or still pending (she came back some other way): the plain screen says it.
  }

  /** While an attempt is "finishing up", read again every 3 seconds, for up to two minutes. */
  function poll() {
    clearTimeout(pollTimer);
    const finishing = connections.some((c) => c.status === "exchanging" && Date.parse(c.expiresAt || "") > Date.now());
    if (!finishing) { pollTries = 0; return; }
    if (pollTries >= POLL_TRIES) {
      say(`${providerName(connections.find((c) => c.status === "exchanging")?.provider) || "It"} is taking a long time. Wait a minute, then reload this page.`);
      return;
    }
    pollTries += 1;
    pollTimer = setTimeout(async () => {
      if (!element.isConnected) return;
      try {
        await readConnections();
      } catch {
        return; // the next load says what's wrong
      }
      for (const [id, then] of watchers) {
        const found = connections.find((c) => c.id === id);
        if (found && found.status !== "pending" && found.status !== "exchanging") { watchers.delete(id); then(found); }
      }
      if (!sheet.isOpen) draw();
      poll();
    }, POLL_MS);
  }

  // The new-tab way: coming back to this tab reads the attempts again while one waits.
  const onFocus = () => {
    if (!element.isConnected) return removeEventListener("focus", onFocus);
    if (connections.some((c) => (c.status === "pending" || c.status === "exchanging") && links.has(c.id))) load();
  };
  addEventListener("focus", onFocus);
  // Back from the provider's page into a page the browser kept: read it all again.
  const onShow = (event) => {
    if (!element.isConnected) return removeEventListener("pageshow", onShow);
    if (event.persisted) { sheet.close(); load(); }
  };
  addEventListener("pageshow", onShow);

  const stopAll = () => {
    clearTimeout(pollTimer);
    removeEventListener("focus", onFocus);
    removeEventListener("pageshow", onShow);
  };

  return {
    title: "Your accounts",
    element,
    load,
    reload: load,
    leave: async () => { const ok = await guardedLeave(sheet); if (ok) stopAll(); return ok; },
    isDirty: () => sheet.isDirty(),
    focus: () => heading.focus(),
    get palette() {
      return [
        ...R.providerOrder(overview?.providers || []).map((p) => ({ id: `connect:${p.provider}`, label: `Connect ${providerName(p.provider) || p.label}`, group: "Your accounts" })),
        ...shown().map((a) => ({ id: `reconnect:${a.id}`, label: `Reconnect ${a.displayName}`, group: "Your accounts" })),
        { id: "share", label: "Share a post", group: "Sharing", href: "#/sharing/new" },
      ];
    },
    command(id) {
      const [kind, value] = String(id).split(/:(.*)/s);
      if (kind === "connect" && providerOf(value)) sheets.openConnect(providerOf(value), { opener: heading });
      if (kind === "reconnect") {
        const account = shown().find((a) => a.id === value);
        if (account) sheets.openReconnect(account, { opener: heading });
      }
      if (kind === "share") go("#/sharing/new");
    },
  };
}
