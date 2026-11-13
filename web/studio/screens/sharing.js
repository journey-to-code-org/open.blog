// Sharing: where her posts have gone out to her accounts (Facebook, Bluesky...) and what's going out
// next, grouped by what needs her. Share a post opens the composer (share-new.js). Her accounts are
// at the bottom: what's connected, how it's doing, Disconnect. Connecting a new account, changing a
// share's words or time, and checking an unclear one are in the old Admin for now. Nothing is ever
// shared by itself: publishing never shares. Studio slice 10c; docs/specs/studio/slice-10bc/ux.md.
import { h, toast } from "../parts/dom.js";
import { use } from "../zubra.js";
import { ask } from "../parts/dialogs.js";
import { sayWhen } from "../parts/dates.js";
import { accountLabel, BADGES, deliveryOf, groups, healthWords, HEALTH_BADGES, needsReconnect, problemLine, providerName, shareTrouble } from "../parts/share-words.js";

export async function createSharing({ api, go }) {
  await use("action-button", "alert-banner", "dropdown-menu", "empty-state", "skeleton-block", "status-badge");
  let destinations = [];
  let posts = [];
  let items = [];
  let accounts = [];

  const heading = h("h2", { id: "studio-sharing-h", class: "studio-question", tabindex: "-1", text: "Where have your posts been shared?" });
  const share = h("action-button", { href: "#/sharing/new" }, "Share a post");
  const status = h("p", { class: "studio-help", role: "status", "aria-live": "polite" });
  const banner = h("div", { class: "studio-banner" });
  const body = h("div", { class: "studio-card-sections", "aria-busy": "true" }, h("skeleton-block", { shape: "card" }));
  const accountsBox = h("section", { class: "studio-section", "aria-labelledby": "studio-accounts-h" });
  const details = h("details", { class: "studio-help" });
  const element = h("section", { class: "studio-page studio-sharing", "aria-labelledby": "studio-sharing-h" },
    h("div", { class: "studio-today" }, heading,
      h("p", { class: "studio-lede", text: "Share a post to your Facebook Page or other accounts. Nothing is shared by itself; publishing a post never shares it." }), share),
    banner, status,
    h("div", { class: "studio-comment-columns" }, h("div", { class: "studio-comment-main" }, body), h("div", { class: "studio-comment-side" }, accountsBox, details)));

  const titleOf = (work) => posts.find((p) => p.work === work)?.title || "A post";

  async function load() {
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
      banner.replaceChildren();
      draw();
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
    banner.replaceChildren(...reconnect.map((a) => h("alert-banner", { variant: "warning", heading: `${accountLabel(a)} needs reconnecting` }, healthWords(a), " ",
      h("a", { href: "/admin/#/social", target: "_blank", rel: "noopener" }, "Reconnect it"))));
    share.hidden = !destinations.length;
    if (!destinations.length) {
      body.replaceChildren(h("empty-state", { heading: "Nothing to share to yet" },
        "Connect your Facebook Page or another account, then share posts from here.",
        h("action-button", { slot: "actions", href: "/admin/#/social", target: "_blank" }, "Connect an account")));
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
        ? h("action-button", { href: "/admin/#/social", target: "_blank", "aria-describedby": headingId }, "Reconnect")
        : h("action-button", { "aria-describedby": headingId, onClick: (e) => retry(item, e.currentTarget) }, "Try again"));
    }
    if (state === "unknown") buttons.push(h("action-button", { href: "/admin/#/announcements", target: "_blank", "aria-describedby": headingId }, "Check it"));
    if (state === "pending" || state === "retrying") {
      buttons.push(h("action-button", { variant: "secondary", href: "/admin/#/announcements", target: "_blank", "aria-describedby": headingId }, "Change"));
      buttons.push(h("action-button", { variant: "secondary", "aria-describedby": headingId, onClick: () => cancel(item, title) }, "Don't share it"));
    }
    return h("li", { class: "studio-comment", "data-id": item.id },
      h("div", { class: "studio-comment-head" },
        h("h4", { id: headingId, class: "studio-comment-who", tabindex: "-1", text: title }),
        h("status-badge", { variant: state === "failed" ? "danger" : state === "published" ? "success" : "neutral" }, BADGES[state])),
      h("p", { class: "studio-help", text: [accountLabel(item.destination), sayWhen(item.scheduledFor)].filter(Boolean).join(" · ") }),
      item.caption ? h("p", { class: "studio-comment-body", text: item.caption }) : null,
      (state === "failed" || state === "unknown" || state === "retrying") && item.lastErrorCode ? h("p", { class: "studio-help", text: problemLine(item.lastErrorCode) }) : null,
      buttons.length ? h("div", { class: "studio-comment-actions" }, ...buttons) : null);
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

  function drawAccounts() {
    accountsBox.replaceChildren(h("h3", { id: "studio-accounts-h", text: "Your accounts" }));
    if (!accounts.length) {
      accountsBox.append(h("p", { class: "studio-help", text: "None connected yet." }));
    } else {
      accountsBox.append(h("ul", { class: "studio-comment-list" }, ...accounts.map((a) => {
        const menu = h("dropdown-menu", {
          class: "studio-row-menu",
          items: [{ value: "disconnect", label: "Disconnect" }],
          onItemselect: () => disconnect(a),
        }, h("span", { slot: "label" }, "More", h("span", { class: "studio-visually-hidden", text: ` for ${accountLabel(a)}` })));
        const words = healthWords(a);
        return h("li", { class: "studio-comment", "data-account": a.id },
          h("div", { class: "studio-comment-head" },
            h("h4", { class: "studio-comment-who", tabindex: "-1", text: a.displayName }),
            h("status-badge", { variant: a.health === "ok" ? "success" : "warning" }, HEALTH_BADGES[a.health] || "Needs reconnecting"), menu),
          h("p", { class: "studio-help", text: providerName(a.provider) }),
          words ? h("p", { class: "studio-help", text: words }) : null);
      })));
    }
    accountsBox.append(h("p", {}, h("a", { href: "/admin/#/social", target: "_blank", rel: "noopener" }, "Connect or reconnect an account (opens the old Admin)")));
  }

  async function disconnect(a) {
    const choice = await ask({
      heading: `Disconnect ${a.displayName}?`,
      text: "Posts waiting to go there won't be shared, and Studio forgets how to post there. You can connect it again later.",
      choices: [{ label: "Keep it connected", value: "keep" }, { label: "Disconnect", value: "go", variant: "destructive" }],
    });
    if (choice !== "go") return;
    try {
      const done = await api.post(`social/accounts/${a.id}/disconnect`, {});
      await load();
      const n = done?.canceledAnnouncements || 0;
      const words = `Disconnected.${n ? ` ${n === 1 ? "1 waiting post won't" : `${n} waiting posts won't`} be shared.` : ""}`;
      status.textContent = words;
      toast(words);
      heading.focus();
    } catch (error) {
      if (error.status === 401) throw error;
      status.textContent = shareTrouble(error);
      drawDetails(error);
    }
  }

  function drawDetails(error = null) {
    details.replaceChildren(h("summary", { text: "For the person who set up your site" }),
      h("ul", { class: "studio-mono" }, ...[
        error ? `error ${error.status}${error.data?.code ? ` (${error.data.code})` : ""}: ${error.message}` : null,
        ...destinations.map((d) => `destination ${d.id} ${d.provider} ${d.kind} ${d.displayName}`),
        ...items.map((i) => `${i.id} v${i.version} ${i.status}/${deliveryOf(i)} ${i.scheduledFor}${i.lastErrorCode ? ` ${i.lastErrorCode}` : ""} ${i.canonicalUrl || i.work}`),
      ].filter(Boolean).map((t) => h("li", { text: t }))),
      h("p", {}, h("a", { href: "/admin/#/announcements", target: "_blank", rel: "noopener" }, "Announcements in the old Admin")));
  }

  return {
    title: "Sharing",
    element,
    load,
    reload: load,
    focus: () => heading.focus(),
    get palette() {
      return [{ id: "new", label: "Share a post", group: "Sharing" }];
    },
    command(id) {
      if (id === "new") go("#/sharing/new");
    },
  };
}
