// Your accounts' sheets (Studio R2): Connect (the provider's sign-in page, or Bluesky's name and app
// password), the choose step, and Reconnect. One side-sheet, reused. Studio follows only addresses
// safeAuthorizeUrl accepts, in the same tab when the sharing service sends her back (G6), otherwise
// in a new tab she opens herself. The app password is emptied before anything is sent, every time,
// and is never put in a status, a detail or a question. Names are only ever text.
// docs/specs/studio/r2/ux.md.
import { h } from "./dom.js";
import { use } from "../zubra.js";
import { providerName } from "./share-words.js";
import * as R from "./social-rules.js";
import { blueskySheet } from "./bluesky-sheet.js";
import { connectionLines, detailsBox, providerLines, redirectRow } from "./account-details.js";

let uid = 0;


const errorText = (error) => `error ${error?.status ?? "no answer"}${error?.data?.code ? ` (${error.data.code})` : ""}: ${error?.message || ""}`;

/**
 * The sheets of one screen. `ctx`: { api, sheet, providerOf(name), links, timeZone,
 * done(event) } where event is { kind: "connected" | "reconnected" | "stopped" | "refresh" |
 * "gone" | "already", ... }.
 */
export function createAccountSheets(ctx) {
  const { api, sheet } = ctx;
  const say = (status, words, variant = "warning") => status.replaceChildren(words ? h("alert-banner", { variant }, words) : "");
  const statusBox = () => h("div", { role: "status", "aria-live": "polite", class: "studio-account-sheet-status" });
  // The sheet's own heading (side-sheet draws it from the label): focused on open and after an error.
  const headingOf = () => ({
    focus() {
      const node = sheet.element.querySelector("h2");
      if (!node) return;
      node.tabIndex = -1;
      node.focus();
    },
  });
  const focusOn = (node) => () => node.focus();

  /** Start (or start again) at the provider: same tab when she'll be sent back, else the new-tab step. */
  async function startAt(provider, startCall, { status, heading, onFallback }) {
    const reply = await startCall();
    const instance = provider === "mastodon" ? ctx.providerOf("mastodon")?.instance || null : null;
    const url = R.safeAuthorizeUrl(reply?.authorizeUrl, instance);
    if (!url) {
      if (reply?.connection?.id) await api.post(`social/connections/${reply.connection.id}/cancel`, {}).catch(() => {});
      say(status, `Your blog couldn't open ${providerName(provider)}. Tell the person who set up your site.`, "danger");
      heading.focus();
      return { refused: true, lines: ["authorizeUrl refused"] };
    }
    // Decided by this start's own reply: true only when Admin named the way back with it.
    if (reply?.returns === true) {
      // She leaves for the provider now. The link isn't kept: coming Back means she didn't finish.
      location.assign(url);
      return { left: true };
    }
    ctx.links.set(reply.connection.id, url);
    onFallback(url, reply.connection);
    return { url };
  }

  /** The new-tab way, when the sharing service can't send her back. */
  function fallback({ provider, url, connection, title, opener }) {
    const p = providerName(provider);
    const heading = headingOf(title);
    const status = statusBox();
    const check = h("action-button", { variant: "secondary", onClick: () => recheck() }, "I've said yes");
    async function recheck() {
      check.loading = true;
      try {
        const found = await ctx.reread(connection.id);
        if (found?.status === "authorized" && !found.reauthAccountId) return openChoose(found, { opener });
        if (found?.status === "completed" || found?.status === "failed" || found?.status === "expired") return ctx.done({ kind: "returned", connection: found });
        say(status, `${p} hasn't said yes yet. Finish there, then press I've said yes.`, "info");
      } catch (error) {
        if (error.status === 401) throw error;
        say(status, R.actionTrouble(error, provider), "danger");
      } finally {
        check.loading = false;
      }
    }
    sheet.show({
      heading: title,
      opener,
      children: [
        h("p", { text: `${p} opens in a new tab. Sign in there and say yes, then come back to this tab.` }),
        h("a", { class: "studio-open-link", href: url, target: "_blank", rel: "noopener noreferrer", "aria-label": `Open ${p}, in a new tab`, text: `Open ${p}` }),
        status,
        h("div", { class: "studio-sheet-actions" }, check),
        stopButton(connection, status),
        detailsBox(connectionLines(connection))],
      focus: focusOn(heading),
    });
    ctx.watch?.(connection.id, (found) => { if (found.status === "authorized" && !found.reauthAccountId && sheet.isOpen) openChoose(found, { opener }); });
  }

  /** "Don't connect": a quiet link-styled button on its own line, below the primary. */
  function stopButton(connection, status) {
    const label = connection.reauthAccountId ? "Don't reconnect" : "Don't connect";
    const button = h("button", { type: "button", class: "studio-link-button", "aria-label": `${label} ${providerName(connection.provider)}`, text: label,
      onClick: async () => {
        button.disabled = true;
        await stop(connection, status);
        button.disabled = false;
      } });
    return h("p", { class: "studio-account-stop-line" }, button);
  }

  /** Stop an attempt (no question: nothing was connected). A refusal is said where she is. */
  async function stop(connection, status = null) {
    try {
      await api.post(`social/connections/${connection.id}/cancel`, {});
    } catch (error) {
      if (error.status === 401) throw error;
      // Already ended or gone: stopped either way.
      if (error.status !== 404 && error.status !== 409) {
        if (status) say(status, R.actionTrouble(error, connection.provider), "danger");
        else ctx.done({ kind: "trouble", error, provider: connection.provider });
        return;
      }
    }
    ctx.links.delete(connection.id);
    sheet.close();
    ctx.done({ kind: "stopped" });
  }

  // ---- Connect: an OAuth provider -----------------------------------------------------------

  /** Step 1. `failure`: the attempt that came back failed or ran out, said at the top with Try again. */
  async function openConnect(provider, { opener = document.activeElement, failure = null, now = false } = {}) {
    await use("action-button", "alert-banner", "side-sheet");
    if (provider?.login === "app-password") return openBluesky(null, { opener });
    const name = provider.provider;
    const p = providerName(name);
    const title = `Connect ${p}`;
    const heading = headingOf(title);
    const status = statusBox();
    const extra = [];
    const go = h("action-button", { size: "lg", label: failure ? `Try connecting ${p} again` : undefined, onClick: () => continueOn() }, failure ? "Try again" : `Continue to ${p}`);
    async function continueOn() {
      if (go.loading) return;
      go.loading = true;
      say(status, "");
      try {
        const done = await startAt(name, () => api.post("social/connections", { provider: name }), {
          status, heading,
          onFallback: (url, connection) => fallback({ provider: name, url, connection, title, opener }),
        });
        if (done.refused) extra.push(...done.lines);
      } catch (error) {
        if (error.status === 401) throw error;
        say(status, R.actionTrouble(error, name), "danger");
        heading.focus();
      } finally {
        go.loading = false;
      }
    }
    const list = R.permissions(provider);
    sheet.show({
      heading: title,
      opener,
      children: [
        failure ? h("alert-banner", { variant: "warning" }, R.outcomeWords(failure.errorCode || failure.status, name)) : null,
        status,
        ...R.stepOneWords(provider).map((line) => h("p", { text: line })),
        list.length ? h("p", { text: `${p} will ask to let your site:` }) : null,
        list.length ? h("ul", { class: "studio-account-asks" }, ...list.map((s) => h("li", { text: s.words }))) : null,
        list.length ? h("p", { text: "Leave every box ticked." }) : null,
        h("p", { class: "studio-help", text: "Nothing is posted until you share a post yourself." }),
        go,
        detailsBox([...providerLines(provider), ...connectionLines(failure), ...extra], redirectRow(provider))],
      focus: focusOn(heading),
    });
    if (now) await continueOn();
  }

  // ---- Step 2: choose where posts go ---------------------------------------------------------

  async function openChoose(connection, { opener = document.activeElement } = {}) {
    await use("action-button", "alert-banner", "side-sheet");
    const name = connection.provider;
    const p = providerName(name);
    const title = `Where should ${p} posts go?`;
    const heading = headingOf(title);
    const status = statusBox();
    const group = `studio-choose-${++uid}`;
    const errorId = `${group}-error`;
    const groupError = h("p", { id: errorId, class: "studio-comment-trouble", tabindex: "-1", hidden: true });
    const options = connection.destinations || [];
    const eligible = options.filter((d) => d.eligible);
    let picked = eligible.length === 1 ? eligible[0] : null;
    const label = () => (picked ? `Connect ${picked.name}` : "Connect this one");
    const connect = h("action-button", { size: "lg", onClick: () => choose() }, label());
    const radios = options.map((d, i) => {
      const id = `${group}-${i}`;
      const why = d.eligible ? null : h("p", { id: `${id}-why`, class: "studio-help", text: R.reasonWords(d.reason, name) });
      const input = h("input", { type: "radio", name: group, id, value: d.id, class: "studio-radio", disabled: !d.eligible, "aria-describedby": why ? `${id}-why` : null,
        onChange: () => { picked = d; connect.textContent = label(); groupError.hidden = true; groupError.textContent = ""; fieldset.removeAttribute("aria-invalid"); } });
      if (picked === d) input.checked = true;
      return h("div", { class: "studio-choice" }, input, h("label", { for: id, text: R.destinationLabel(d) }), why);
    });
    const fieldset = h("fieldset", { class: "studio-field-group studio-choices", "aria-describedby": errorId }, h("legend", { text: title }), ...radios, groupError);
    const notes = (connection.notes || []).map(R.noteWords).filter((n) => n.first);
    const lead = name === "facebook" ? `${p} said yes. Pick the Facebook Page your posts go to.` : name === "linkedin" ? `${p} said yes. Pick where your posts go.` : `${p} said yes. Pick the account your posts go to.`;

    async function choose() {
      if (connect.loading) return false;
      if (!picked) {
        groupError.textContent = "Pick where your posts go.";
        groupError.hidden = false;
        fieldset.setAttribute("aria-invalid", "true");
        groupError.focus();
        return false;
      }
      connect.loading = true;
      say(status, "");
      try {
        const reply = await api.post(`social/connections/${connection.id}/select`, { destination: picked.id });
        sheet.close();
        ctx.done({ kind: "connected", account: reply.account });
        return true;
      } catch (error) {
        if (error.status === 401) throw error;
        const code = error.data?.code;
        if (code === "already-connected") {
          sheet.close();
          ctx.done({ kind: "already", name: picked.name, externalId: picked.id });
        } else if (code === "expired") {
          say(status, R.outcomeWords("expired", name));
          status.append(h("action-button", { variant: "secondary", onClick: () => openConnect(ctx.providerOf(name), { opener }) }, "Start again"));
        } else if (code === "not-authorized" || code === "conflict") {
          sheet.close();
          ctx.done({ kind: "refresh", words: "This changed in another tab. Here it is now." });
        } else if (code === "destination-not-eligible") {
          const at = options.indexOf(picked);
          const input = radios[at]?.querySelector("input");
          // The one she picked was allowed when the list came; the server's list now says why not.
          const fresh = await ctx.reread(connection.id).catch((trouble) => { if (trouble.status === 401) throw trouble; return null; });
          const now = fresh?.destinations?.find((d) => d.id === picked.id);
          const why = h("p", { id: `${group}-${at}-now`, class: "studio-help", text: R.reasonWords(now?.reason || picked.reason || "", name) });
          radios[at]?.append(why);
          if (input) { input.checked = false; input.disabled = true; input.setAttribute("aria-describedby", why.id); }
          picked = null;
          connect.textContent = label();
        } else if (code === "storage-failed" || error.status === 500 || error.status === 502) {
          say(status, "Your site couldn't save it. Press Connect again.", "danger");
        } else {
          say(status, R.actionTrouble(error, name), "danger");
        }
        return false;
      } finally {
        connect.loading = false;
      }
    }

    sheet.show({
      heading: title,
      opener,
      children: [status,
        h("p", { text: lead }),
        ...notes.map((n) => h("p", { class: "studio-help", text: n.text })),
        fieldset,
        connect,
        h("p", { class: "studio-help", text: R.untilWords(connection.expiresAt, { timeZone: ctx.timeZone }) }),
        stopButton(connection, status),
        detailsBox([...providerLines(ctx.providerOf(name)), ...connectionLines(connection), ...(connection.notes || []).map(R.noteWords).filter((n) => !n.first).map((n) => `note: ${n.text}`)])],
      focus: focusOn(heading),
    });
  }

  const openBluesky = (account = null, options = {}) => blueskySheet({ api, sheet, ctx, say, statusBox, headingOf, openChoose })(account, options);

  // ---- Reconnect -----------------------------------------------------------------------------

  async function openReconnect(account, { opener = document.activeElement, failure = null, now = false } = {}) {
    await use("action-button", "alert-banner", "side-sheet");
    const provider = ctx.providerOf(account.provider);
    if (provider?.login === "app-password" || account.provider === "bluesky") return openBluesky(account, { opener });
    const p = providerName(account.provider);
    const title = `Reconnect ${account.displayName}`;
    const heading = headingOf(title);
    const status = statusBox();
    const extra = [];
    const go = h("action-button", { size: "lg", label: failure ? `Try reconnecting ${account.displayName} again` : undefined, onClick: () => continueOn() }, failure ? "Try again" : `Continue to ${p}`);
    async function continueOn() {
      if (go.loading) return;
      go.loading = true;
      say(status, "");
      try {
        const done = await startAt(account.provider, () => api.post(`social/accounts/${account.id}/reconnect`, {}), {
          status, heading,
          onFallback: (url, connection) => fallback({ provider: account.provider, url, connection, title, opener }),
        });
        if (done.refused) extra.push(...done.lines);
      } catch (error) {
        if (error.status === 401) throw error;
        if (error.status === 404 || error.data?.code === "disconnected") {
          sheet.close();
          ctx.done({ kind: "gone", account });
          return;
        }
        say(status, R.actionTrouble(error, account.provider), "danger");
        heading.focus();
      } finally {
        go.loading = false;
      }
    }
    sheet.show({
      heading: title,
      opener,
      children: [
        failure ? h("alert-banner", { variant: "warning" }, R.outcomeWords(failure.errorCode || failure.status, account.provider, { reconnecting: true, name: account.displayName })) : null,
        status,
        h("p", { text: `${p} will ask you to sign in. Use the ${p} account you used the first time. If ${p} shows someone else's name, tell the person who set up your site.` }),
        go,
        detailsBox([`If ${p} signs you in by itself as someone else, log out of ${p} first, then press Continue to ${p} again.`, ...providerLines(provider), ...connectionLines(failure), ...extra], redirectRow(provider))],
      focus: focusOn(heading),
    });
    if (now) await continueOn();
  }

  /** Start again: one press cancels the old attempt (ignoring "already ended") and starts a new one. */
  async function startAgain(connection, account = null) {
    await api.post(`social/connections/${connection.id}/cancel`, {}).catch((error) => { if (error.status === 401) throw error; });
    ctx.links.delete(connection.id);
    if (account) return openReconnect(account, { now: true });
    const provider = ctx.providerOf(connection.provider);
    // The site stopped offering it since: said in her words, and nothing is started.
    if (!provider) return ctx.done({ kind: "trouble", error: { status: 409, data: { code: "provider-not-configured" } }, provider: connection.provider });
    return openConnect(provider, { now: true });
  }

  /** "Facebook said yes. Your blog is finishing up…": shown while the attempt is exchanging. */
  async function openFinishing(connection, { opener = document.activeElement } = {}) {
    await use("side-sheet");
    const p = providerName(connection.provider);
    const heading = headingOf(`${p} said yes`);
    sheet.show({ heading: `${p} said yes`, opener, focus: focusOn(heading),
      children: [h("p", { "data-finishing": connection.id, text: "Your blog is finishing up. This takes a few seconds." }), detailsBox(connectionLines(connection))] });
  }

  return { openConnect, openChoose, openBluesky, openReconnect, startAgain, openFinishing, stop, stopButton, errorText };
}
