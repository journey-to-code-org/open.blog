// Comments: what people said on her posts, and whether each one shows. Four views (Waiting, Shown,
// Not shown, Taken down); a card per comment with its yes or no on top, a reason asked only when
// saying no, Undo for the no's, and the one switch that lets people comment at all. Reports of a
// comment are handled here too; every other kind of note (the scholarly ones) links to the full
// inbox in the old Admin. Studio slice 8; docs/specs/studio/slice-8/ux.md.
import { h, toast } from "../parts/dom.js";
import { use } from "../zubra.js";
import { ask } from "../parts/dialogs.js";
import { sayDay, sayWhen } from "../parts/dates.js";
import { sendOut, siteLink, wentOutWords } from "../parts/publish.js";
import { routeHash } from "../router.js";
import {
  VIEWS, viewOf, otherViewWords, reasonWords, handled, cardLabel, buttonsFor, quietReason,
  decidedWords, undoWords, decisionLine, troubleWords, decisionRequest,
} from "../parts/comment-words.js";

const LONG = 600;

export async function createComments({ api, meta, go }, route) {
  await use("action-button", "alert-banner", "content-card", "dropdown-menu", "empty-state", "select-field", "skeleton-block", "status-badge", "toggle-switch");
  const view = viewOf(route.arg);
  const kind = ["comment", "report"].includes(route.query.kind) ? route.query.kind : "";
  const fullInbox = `/admin/#/moderation/${view.state}${kind ? `?kind=${kind}` : ""}`;
  let items = [];
  let next = null;
  let page = null;
  let settings = null;
  let settingsTrouble = false;
  let undo = null; // { item, words }: the last decision that can go back to Waiting

  const heading = h("h2", { id: "studio-comments-h", class: "studio-question", tabindex: "-1", text: "What have people said?" });
  const picker = h("select-field", {
    label: "Which comments",
    options: VIEWS.map((v) => ({ value: v.id || "waiting", label: v.label })),
    value: view.id || "waiting",
    onValuechange: (e) => go(routeHash("comments", e.detail === "waiting" ? "" : e.detail, { kind })),
  });
  const status = h("p", { class: "studio-help", role: "status", "aria-live": "polite" });
  const banner = h("div", { class: "studio-banner" });
  const undoSlot = h("div", { class: "studio-banner" });
  const list = h("ul", { class: "studio-comment-list", "aria-labelledby": "studio-comments-h", "aria-busy": "true" },
    ...[1, 2, 3].map(() => h("li", {}, h("skeleton-block", { lines: 3 }))));
  const more = h("action-button", { variant: "secondary", hidden: true, onClick: () => showMore() }, "Show more");
  const after = h("div", { class: "studio-comment-after" });
  const switcher = h("toggle-switch", {
    label: "Let people leave comments",
    description: "When it's off, the comments section leaves your posts and nobody can leave a new one.",
    onCheckedchange: (e) => setComments(e.detail),
  });
  const switchSection = h("section", { class: "studio-section studio-comment-switch", "aria-labelledby": "studio-taking-h" },
    h("h3", { id: "studio-taking-h", text: "Taking comments" }), switcher);
  const details = h("details", { class: "studio-help" });
  const element = h("section", { class: "studio-page studio-comments", "aria-labelledby": "studio-comments-h" },
    h("div", { class: "studio-today" }, heading, h("p", { class: "studio-lede", text: view.lede }), picker),
    undoSlot, banner, status,
    h("div", { class: "studio-comment-columns" },
      h("div", { class: "studio-comment-main" }, list, more, after),
      h("div", { class: "studio-comment-side" }, switchSection, details)));

  // ---- the list -------------------------------------------------------------------------------

  async function fetchPage(cursor) {
    const query = new URLSearchParams({ state: view.state });
    if (kind) query.set("kind", kind);
    if (cursor) query.set("after", cursor);
    return api.get(`engagement/moderation?${query}`);
  }

  async function load() {
    list.setAttribute("aria-busy", "true");
    loadSettings();
    try {
      page = await fetchPage(null);
      items = page.items || [];
      next = page.next || null;
      banner.replaceChildren();
      draw();
    } catch (error) {
      if (error.status === 401) throw error;
      list.removeAttribute("aria-busy");
      list.replaceChildren();
      banner.replaceChildren(h("alert-banner", { variant: "danger", heading: "Your comments didn't load" },
        troubleWords(error, "list"), " ",
        h("action-button", { variant: "secondary", size: "sm", onClick: () => load() }, "Try again")));
    }
  }

  async function showMore() {
    if (!next) return;
    more.loading = true;
    const first = items.length;
    try {
      const more_ = await fetchPage(next);
      items = items.concat(more_.items || []);
      next = more_.next || null;
      page = { ...page, invalid: (page.invalid || 0) + (more_.invalid || 0), next };
      draw();
      status.textContent = `Showing ${items.length} ${items.length === 1 ? "comment" : "comments"}.`;
      focusCard(items[first]?.id);
    } catch (error) {
      status.textContent = troubleWords(error, "list");
    } finally {
      more.loading = false;
    }
  }

  function draw() {
    list.removeAttribute("aria-busy");
    more.hidden = !next;
    after.replaceChildren();
    if (page?.invalid > 0) {
      after.append(h("p", { class: "studio-help" }, "Some notes couldn't be shown here. ", h("a", { href: fullInbox, target: "_blank", rel: "noopener" }, "Open in the full inbox")));
    }
    drawDetails();
    if (!items.length) {
      const off = view.state === "pending" && settings && settings.comments === false;
      const [title, text] = view.empty;
      const action = off
        ? h("action-button", { slot: "actions", onClick: () => focusSwitch() }, "Turn comments on")
        : h("action-button", { slot: "actions", variant: "secondary", onClick: () => go(routeHash("comments", view.other, { kind })) }, otherViewWords(view));
      list.replaceChildren(h("li", {}, h("empty-state", { heading: title },
        off ? "Comments are switched off, so nobody can leave a new one." : text, action)));
      return;
    }
    list.replaceChildren(...items.map(card));
  }

  function card(item) {
    const label = cardLabel(item);
    const headingId = `studio-comment-${item.id}`;
    const when = sayWhen(item.receivedAt);
    const postLink = item.post?.url
      ? h("a", { href: siteLink(meta, item.post.url), target: "_blank", rel: "noopener", "aria-label": `${item.post.title} on your site, opens in a new tab`, text: `“${item.post.title}”` })
      : null;
    const on = h("p", { class: "studio-help studio-comment-meta" }, "on ", postLink || "your site", when ? `, ${when}` : "");
    const line = h("p", { class: "studio-comment-trouble", tabindex: "-1", role: "alert", hidden: true });
    const row = h("li", { class: "studio-comment", "data-id": item.id, "aria-label": label });

    if (!handled(item)) {
      row.append(h("h3", { id: headingId, class: "studio-comment-who", tabindex: "-1", text: "A different kind of note" }), on,
        h("p", { class: "studio-help", text: "Studio doesn't handle this kind of note yet." }),
        h("a", { href: fullInbox, target: "_blank", rel: "noopener" }, "Open in the full inbox"),
        cardDetails(item));
      return row;
    }

    const report = item.source === "report";
    const who = report ? `${item.reader?.name || "Someone"} reported a comment` : item.reader?.name || "Someone";
    const { top, more: extra } = buttonsFor(item);
    const buttons = top.map((b) => button(item, b, headingId, line));
    const menuItems = [
      ...(item.post?.url ? [{ value: "see", label: "See it on your site" }] : []),
      ...extra.map((b) => ({ value: `do:${b.action}`, label: b.label })),
      { value: "inbox", label: "Open in the full inbox" },
    ];
    const menu = h("dropdown-menu", {
      class: "studio-row-menu",
      items: menuItems,
      onItemselect: (e) => {
        if (e.detail === "see") window.open(siteLink(meta, item.post.url), "_blank", "noopener");
        else if (e.detail === "inbox") window.open(fullInbox, "_blank", "noopener");
        else {
          const chosen = extra.find((b) => `do:${b.action}` === e.detail);
          if (chosen) startDecision(item, chosen, line, null);
        }
      },
    }, h("span", { slot: "label" }, "More", h("span", { class: "studio-visually-hidden", text: ` for ${label}` })));

    const head = h("div", { class: "studio-comment-head" },
      report ? h("status-badge", { variant: "warning" }, "Reported") : null,
      h("h3", { id: headingId, class: "studio-comment-who", tabindex: "-1", text: who }),
      menu);
    row.append(head);
    if (!report && item.reader && item.reader.publishName === false) row.append(h("p", { class: "studio-help", text: "Only you see this name." }));
    row.append(on);

    if (report) {
      if (item.report?.groundLabel) row.append(h("p", { text: `Why: ${item.report.groundLabel}` }));
      const target = item.target;
      const quote = h("blockquote", { class: "studio-comment-quote" },
        h("p", { class: "studio-help", text: `${target?.authorName || "Someone"} wrote${item.post?.title ? ` on “${item.post.title}”` : ""}:` }),
        target?.body ? words(target.body) : h("p", { class: "studio-help", text: "Its words were erased." }));
      row.append(quote);
      if (target && target.status && target.status !== "approved" && target.statusLabel) {
        row.append(h("p", { class: "studio-help", text: `Right now it's ${target.statusLabel.toLowerCase()}.` }));
      }
    } else if (item.purged || item.body == null) {
      row.append(h("p", { class: "studio-help", text: "Its words were erased." }));
    } else {
      row.append(words(item.body));
    }

    const decided = decisionLine(item, (iso) => sayDay(iso));
    if (decided && view.state !== "pending") row.append(h("p", { class: "studio-help studio-comment-decided", text: decided }));
    if (buttons.length && !(item.purged && !report)) row.append(h("div", { class: "studio-comment-actions" }, ...buttons));
    row.append(line, cardDetails(item));
    return row;
  }

  function words(text) {
    const body = h("div", { class: "studio-comment-body" }, ...String(text).split(/\n{2,}/).map((p) => h("p", { text: p })));
    if (String(text).length <= LONG) return body;
    body.classList.add("studio-comment-clamped");
    const read = h("button", { type: "button", class: "studio-link-button", "aria-expanded": "false" }, "Read all");
    read.addEventListener("click", () => {
      const open = body.classList.toggle("studio-comment-clamped");
      read.setAttribute("aria-expanded", String(!open));
      read.textContent = open ? "Read all" : "Show less";
    });
    return h("div", {}, body, read);
  }

  function button(item, b, headingId, line) {
    const attrs = { variant: b.primary ? "primary" : "secondary", "aria-describedby": headingId, "data-action": b.action };
    if (!b.asks) return h("action-button", { ...attrs, onClick: (e) => startDecision(item, b, line, e.currentTarget) }, b.label);
    // Saying no asks why: one tap on a reason decides.
    const reasons = b.offer.reasons.map((r) => ({ value: r.id, label: reasonWords(r, { report: item.source === "report" }) }));
    return h("dropdown-menu", {
      class: "studio-why",
      "data-action": b.action,
      items: reasons,
      onItemselect: (e) => decide(item, b.action, e.detail, line, e.currentTarget),
    }, h("span", { slot: "label" }, b.label, h("span", { class: "studio-visually-hidden", text: ` (choose why) for ${cardLabel(item)}` })));
  }

  async function startDecision(item, b, line, control) {
    if (b.action === "erase") {
      const choice = await ask({
        heading: `Erase ${cardLabel(item).replace(/ on .*$/, "")} for good?`,
        text: "Its words and the name on it are deleted. Only a private note that you decided stays. This can't be undone.",
        choices: [{ label: "Keep it", value: "keep", variant: "secondary" }, { label: "Erase it", value: "erase", variant: "destructive" }],
      });
      if (choice !== "erase") return;
      return decide(item, "erase", null, line, control);
    }
    if (b.asks) {
      // From the More menu: the server's reasons, asked in a dialog.
      const choice = await ask({
        heading: "Why?",
        text: b.offer.guidance && b.offer.guidance.length < 120 ? b.offer.guidance : "Choose the reason that fits best.",
        choices: [...b.offer.reasons.map((r) => ({ label: reasonWords(r), value: r.id, variant: "secondary" })), { label: "Cancel", value: "", variant: "ghost" }],
      });
      if (!choice) return;
      return decide(item, b.action, choice, line, control);
    }
    const reason = b.action === "reject" && item.source === "report" ? quietReason(b.offer) : null;
    return decide(item, b.action, reason, line, control);
  }

  const busy = new Set();

  async function decide(item, action, reason, line, control) {
    if (busy.has(item.id)) return;
    busy.add(item.id);
    if (control && "loading" in control) control.loading = true;
    line.hidden = true;
    try {
      const reply = await api.patch("engagement/moderation", decisionRequest(item, action, reason));
      const said = decidedWords(item, action);
      const undoText = undoWords(item, action);
      const index = items.findIndex((i) => i.id === item.id);
      items = items.filter((i) => i.id !== item.id);
      draw();
      status.textContent = said;
      toast(said);
      const after_ = items[index] || items[index - 1];
      if (after_) focusCard(after_.id);
      else requestAnimationFrame(() => list.querySelector("empty-state")?.focus?.() || heading.focus());
      if (undoText && reply?.item?.version) offerUndo({ ...item, ...reply.item, source: item.source }, undoText);
      else if (action !== "reopen") clearUndo();
    } catch (error) {
      if (error.status === 401) throw error;
      if (error.status === 409) {
        await reloadKeeping(item.id);
        return;
      }
      if (error.status === 422 && !reason) {
        line.textContent = "Choose why first.";
      } else {
        line.textContent = troubleWords(error, "card");
      }
      line.hidden = false;
      line.focus();
    } finally {
      busy.delete(item.id);
      if (control && "loading" in control) control.loading = false;
    }
  }

  async function reloadKeeping(id) {
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
      if (items.some((i) => i.id === id)) {
        focusCard(id);
        const line = list.querySelector(`[data-id="${id}"] .studio-comment-trouble`);
        if (line) { line.textContent = "This comment changed somewhere else just now. Here it is as it is now. Choose again."; line.hidden = false; }
      } else {
        status.textContent = "This comment was already decided somewhere else.";
        heading.focus();
      }
    } catch (error) {
      status.textContent = troubleWords(error, "list");
    }
  }

  // ---- undo: the last no goes back to Waiting --------------------------------------------------

  function offerUndo(item, words) {
    undo = { item, words };
    const button_ = h("action-button", { size: "sm", onClick: () => runUndo() }, "Undo");
    const alert = h("alert-banner", { variant: "info", dismissible: true, heading: words }, button_);
    alert.addEventListener("close", () => clearUndo());
    undoSlot.replaceChildren(alert);
  }

  function clearUndo() {
    undo = null;
    undoSlot.replaceChildren();
  }

  async function runUndo() {
    if (!undo) return;
    const { item } = undo;
    try {
      await api.patch("engagement/moderation", decisionRequest(item, "reopen", null));
      clearUndo();
      status.textContent = "Back in Waiting.";
      toast("Back in Waiting.");
      if (view.state === "pending") await load();
    } catch (error) {
      if (error.status === 401) throw error;
      const where_ = VIEWS.find((v) => v.state === item.status)?.label || "its list";
      status.textContent = error.status === 409
        ? `It changed again since, so it wasn't undone. It's under ${where_}.`
        : troubleWords(error, "card");
    }
  }

  // ---- the switch -----------------------------------------------------------------------------

  async function loadSettings() {
    try {
      settings = await api.get("engagement/settings");
      settingsTrouble = false;
    } catch (error) {
      if (error.status === 401) throw error;
      settings = null;
      settingsTrouble = true;
    }
    drawSwitch();
  }

  function drawSwitch() {
    switchSection.querySelector(".studio-switch-trouble")?.remove();
    banner.querySelector(".studio-comments-off")?.remove();
    if (settingsTrouble) {
      switcher.hidden = true;
      switchSection.append(h("p", { class: "studio-help studio-switch-trouble" }, "Studio couldn't check whether comments are on. ",
        h("action-button", { variant: "secondary", size: "sm", onClick: () => loadSettings() }, "Try again")));
      return;
    }
    if (!settings) return;
    switcher.hidden = false;
    switcher.checked = settings.comments !== false;
    if (settings.comments === false) {
      banner.prepend(h("alert-banner", { class: "studio-comments-off", variant: "info", heading: "Comments are switched off" },
        "Your posts don't show any, and nobody can leave new ones. ",
        h("action-button", { size: "sm", onClick: () => focusSwitch() }, "Turn comments on")));
    }
    if (!items.length && list.getAttribute("aria-busy") !== "true") draw();
  }

  function focusSwitch() {
    switcher.scrollIntoView?.({ block: "center" });
    (switcher.querySelector("button, input, [role=switch]") || switcher).focus();
  }

  let saving = false;
  async function setComments(on) {
    if (!settings || saving || on === (settings.comments !== false)) return;
    saving = true;
    try {
      const body = {
        enabled: settings.enabled, comments: on, analytics: settings.analytics, endpoint: settings.endpoint,
        feedback: settings.feedback, etag: settings.etag, credentialAction: "keep",
      };
      const reply = await api.put("engagement/settings", body);
      settings = { ...settings, ...reply };
      drawSwitch();
      const result = await sendOut(api, on ? "Turn comments on" : "Turn comments off");
      const said = wentOutWords(result, { meta, action: "saved" });
      const words = `Comments are ${on ? "on" : "off"}. ${said.words.replace(/^Saved\.\s*/, "")}`.trim();
      status.textContent = words;
      toast(words, { variant: said.variant });
    } catch (error) {
      if (error.status === 401) throw error;
      if (error.status === 409) {
        await loadSettings();
        status.textContent = "Your comment settings changed somewhere else. Here they are now; switch again if you still want to.";
      } else {
        switcher.checked = settings.comments !== false;
        status.textContent = "Your comment setting wasn't saved. Try again.";
      }
    } finally {
      saving = false;
    }
  }

  // ---- for Mikey ------------------------------------------------------------------------------

  function cardDetails(item) {
    const offered = (item.actions || []).map((a) => `${a.action}: ${a.label}${a.guidance ? ` (${a.guidance})` : ""}${a.confirm ? ` [confirm: ${a.confirm}]` : ""}`);
    return h("details", { class: "studio-help studio-comment-details" },
      h("summary", { text: "For the person who set up your site" }),
      h("ul", { class: "studio-mono" },
        ...[
          `id ${item.id}`, `source ${item.source}, kind ${item.kind} (${item.kindLabel || ""})`, `status ${item.status}, version ${item.version}`,
          item.reason ? `reason ${item.reason} (${item.reasonLabel || ""})` : null,
          `received ${item.receivedAt}${item.moderatedAt ? `, decided ${item.moderatedAt}` : ""}`,
          item.post?.source ? `post ${item.post.source}` : null, `work ${item.work}`, `public ${item.public}`,
          item.purged ? "purged" : null, item.reader?.private ? "reader name private" : null,
          ...offered,
        ].filter(Boolean).map((t) => h("li", { text: t }))));
  }

  function drawDetails() {
    details.replaceChildren(h("summary", { text: "For the person who set up your site" }),
      h("ul", { class: "studio-mono" },
        ...[
          `state ${view.state}${kind ? `, kind ${kind}` : ""}`, `protocol ${page?.protocol || "?"}`, `invalid ${page?.invalid || 0}`, `next ${next || "none"}`,
          settings ? `endpoint ${settings.endpoint}, comments ${settings.comments}` : null,
          "Show it has no Undo: going back would record a take-down. Keep the comment sends the no-action reason when the server offers it.",
        ].filter(Boolean).map((t) => h("li", { text: t }))),
      h("p", {}, h("a", { href: "/admin/#/analytics", target: "_blank", rel: "noopener" }, "Comments setup in the old Admin")));
  }

  const focusCard = (id) => requestAnimationFrame(() => list.querySelector(`[data-id="${id}"] .studio-comment-who`)?.focus());

  return {
    title: "Comments",
    element,
    load,
    reload: load,
    focus: () => heading.focus(),
    get palette() {
      const views = VIEWS.map((v) => ({ id: `view:${v.id}`, label: `${v.label} comments`, group: "Comments" }));
      return [
        ...views,
        { id: "kind:comment", label: "Show only comments", group: "Comments" },
        { id: "kind:report", label: "Show only reports", group: "Comments" },
        { id: "kind:", label: "Show every kind", group: "Comments" },
        ...(settings ? [{ id: "switch", label: settings.comments === false ? "Turn comments on" : "Turn comments off", group: "Comments" }] : []),
        ...(undo ? [{ id: "undo", label: "Undo the last decision", group: "Comments" }] : []),
        { id: "inbox", label: "Open the full inbox", group: "Comments" },
      ];
    },
    command(id) {
      if (id.startsWith("view:")) go(routeHash("comments", id.slice(5), { kind }));
      else if (id.startsWith("kind:")) go(routeHash("comments", view.id, { kind: id.slice(5) }));
      else if (id === "switch") setComments(settings.comments === false);
      else if (id === "undo") runUndo();
      else if (id === "inbox") window.open(fullInbox, "_blank", "noopener");
    },
  };
}
