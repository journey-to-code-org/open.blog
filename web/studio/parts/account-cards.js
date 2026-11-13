// Your accounts' cards (Studio R2): an attempt that isn't finished, an account with its health in
// words, and a place she can connect. Names are only ever text; a provider link is drawn only when
// this page holds one that passed safeAuthorizeUrl. docs/specs/studio/r2/ux.md.
import { h } from "./dom.js";
import { sayDay } from "./dates.js";
import { healthBadge, healthWords, providerName } from "./share-words.js";
import { detailsBox } from "./account-details.js";
import * as R from "./social-rules.js";

const needs = (a) => a?.health === "needs-reauth" || a?.health === "expiring";

/** A button that shows it's working while `run` runs, and can't be pressed twice meanwhile. */
async function withLoading(button, run) {
  if (button.loading || button.disabled) return;
  if ("loading" in button) button.loading = true; else button.disabled = true;
  try {
    await run();
  } finally {
    if ("loading" in button) button.loading = false; else button.disabled = false;
  }
}

/** `ctx`: { sheets, links, timeZone, onRetry(account, failed, button), onDisconnect(account, opener) }. */
export function createAccountCards({ sheets, links, timeZone, onRetry, onDisconnect }) {
  function buttonsFor(connection, account = null) {
    const p = providerName(connection.provider);
    const card = R.attemptCard(connection, { hasLink: links.has(connection.id), timeZone });
    const out = [];
    for (const kind of card.buttons) {
      if (kind === "continue") out.push(h("a", { class: "studio-open-link", href: links.get(connection.id), target: "_blank", rel: "noopener noreferrer", "aria-label": `Continue to ${p}, in a new tab`, text: `Continue to ${p}` }));
      if (kind === "again") out.push(h("action-button", { variant: account ? "primary" : "secondary", label: `Start connecting ${p} again`, onClick: (e) => withLoading(e.currentTarget, () => sheets.startAgain(connection, account)) }, "Start again"));
      if (kind === "choose") out.push(h("action-button", { label: `Choose where ${p} posts go`, onClick: (e) => sheets.openChoose(connection, { opener: e.currentTarget }) }, "Choose where posts go"));
    }
    return { card, out };
  }

  /** An attempt that isn't finished, with what to do next. */
  function attempt(connection) {
    const { card, out } = buttonsFor(connection);
    const id = `studio-attempt-${connection.id}`;
    return h("li", { class: "studio-comment", "data-connection": connection.id },
      h("h3", { id, class: "studio-comment-who", tabindex: "-1", text: card.heading }),
      h("p", { class: "studio-help", text: card.words }),
      out.length ? h("div", { class: "studio-comment-actions" }, ...out) : null,
      card.buttons.includes("stop") ? sheets.stopButton(connection) : null);
  }

  /**
   * One account: its health in words, a reconnect still going (`attempt`), how many shares wait for
   * it, the shares to try again (`failed`), and More (Disconnect). `primary`: Reconnect is the
   * screen's one next step.
   */
  function account(account, { primary = false, attempt = null, waiting = 0, failed = [] } = {}) {
    const id = `studio-account-${account.id}`;
    const buttons = [];
    let words = healthWords(account, { timeZone });
    let badge = healthBadge(account, { timeZone });
    let stop = null;
    if (attempt && attempt.status !== "exchanging") {
      const { out } = buttonsFor(attempt, account);
      badge = "Needs reconnecting";
      words = "Reconnecting isn't finished.";
      buttons.push(...out);
      stop = sheets.stopButton(attempt);
    } else if (!attempt && needs(account)) {
      buttons.push(h("action-button", { variant: primary ? "primary" : "secondary", label: `Reconnect ${account.displayName}`,
        onClick: (e) => sheets.openReconnect(account, { opener: e.currentTarget }) }, "Reconnect"));
    }
    const menu = h("dropdown-menu", { class: "studio-row-menu", items: [{ value: "disconnect", label: "Disconnect…" }], onItemselect: () => onDisconnect(account, menu) },
      h("span", { slot: "label" }, "More", h("span", { class: "studio-visually-hidden", text: ` for ${account.displayName}` })));
    const c = account.credential || {};
    return h("li", { class: "studio-comment studio-account", "data-account": account.id },
      h("div", { class: "studio-comment-head" },
        h("h3", { id, class: "studio-comment-who", tabindex: "-1", text: account.displayName }),
        h("status-badge", { variant: account.health === "ok" && !attempt ? "success" : "warning" }, badge)),
      h("p", { class: "studio-help", text: R.accountKind(account) }),
      words ? h("p", { text: words }) : null,
      attempt?.status === "exchanging" ? h("p", { class: "studio-help", text: `${providerName(account.provider)} said yes. Your blog is finishing up.` }) : null,
      waiting ? h("p", { class: "studio-help", text: `${waiting === 1 ? "1 post is" : `${waiting} posts are`} waiting for it.` }) : null,
      failed.length ? h("alert-banner", { variant: "info" }, `${failed.length === 1 ? "1 post" : `${failed.length} posts`} didn't go out while it wasn't working. `,
        h("action-button", { variant: "secondary", size: "sm", label: `Try them again: ${account.displayName}`, onClick: (e) => onRetry(account, failed, e.currentTarget) }, "Try them again")) : null,
      h("div", { class: "studio-comment-actions" }, ...buttons, menu),
      stop,
      detailsBox([
        `${account.provider} id ${account.externalId}`, `kind ${account.kind}`,
        `Connected${account.connectedBy ? ` by ${account.connectedBy}` : ""}${account.createdAt ? ` on ${sayDay(account.createdAt, { timeZone })}` : ""}`,
        c.accessExpiresAt ? `Access good until ${sayDay(c.accessExpiresAt, { timeZone })}` : "",
        c.refreshExpiresAt ? `Can renew until ${sayDay(c.refreshExpiresAt, { timeZone })}` : "",
        ...(c.scopes || []).map((scope) => `granted ${scope}: ${R.scopeWords(scope)}`),
      ]));
  }

  /** A place the site offers, with its Connect button. */
  function provider(provider, { primary = false, connected = false } = {}) {
    const p = providerName(provider.provider) || provider.label;
    return h("li", { class: "studio-comment", "data-provider": provider.provider },
      h("h4", { class: "studio-comment-who", text: p }),
      h("p", { class: "studio-help", text: R.providerLine(provider, { connected }) }),
      h("div", { class: "studio-comment-actions" }, h("action-button", { variant: primary ? "primary" : "secondary", onClick: (e) => sheets.openConnect(provider, { opener: e.currentTarget }) }, `Connect ${p}`)));
  }

  return { attempt, account, provider };
}
