// Connected accounts as Admin sees them (epic #353, story #355, ADR 0300): list, reconnect and
// disconnect. Server-only, behind the site scope. What leaves this module is a status, dates,
// the provider's account id and name, and the scopes granted; never a token or ciphertext.
//
// "Health" is computed here from the plain credential columns, so Admin can say an account needs
// to be connected again without anything decrypting a token: the account was flagged, the
// credential was erased, or the last moment a token (or its refresh token) could work has passed.

import { scopedQuery } from "./social-scope.mjs";
import { SocialOAuthError } from "./social-oauth.mjs";
import { revokeAtProvider } from "./social-providers.mjs";

const ACCOUNTS = "openblog_social_accounts";
const CREDENTIALS = "openblog_social_credentials";
const POSTS = "openblog_social_posts";
const MAX_CANCEL = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const EXPIRING_SOON_MS = 7 * 24 * 3600 * 1000;
const CREDENTIAL_COLUMNS = "account_id,site_id,status,access_expires_at,refresh_expires_at,scopes,last_refreshed_at";

export function accountHealth(account, credential, at) {
  if (account.status === "disconnected") return "disconnected";
  if (account.status === "needs-reauth") return "needs-reauth";
  if (!credential || credential.status !== "active") return "needs-reauth";
  const access = credential.access_expires_at ? Date.parse(credential.access_expires_at) : Infinity;
  const refresh = credential.refresh_expires_at ? Date.parse(credential.refresh_expires_at) : -Infinity;
  const usableUntil = Math.max(access, refresh);
  if (usableUntil <= at) return "needs-reauth";
  return usableUntil - at < EXPIRING_SOON_MS ? "expiring" : "ok";
}

export function createAccounts({ connector, settings, providers, fetchImpl = globalThis.fetch, now = () => Date.now() }) {
  const { rest, accountOf } = connector;

  const view = (row, credential) =>
    Object.freeze({
      ...accountOf(row),
      health: accountHealth(row, credential, now()),
      credential: credential
        ? { status: credential.status, accessExpiresAt: credential.access_expires_at || null, refreshExpiresAt: credential.refresh_expires_at || null, scopes: credential.scopes ? credential.scopes.split(" ").filter(Boolean) : [], lastRefreshedAt: credential.last_refreshed_at || null }
        : null,
    });

  const credentialRows = async (ids) => {
    if (!ids.length) return new Map();
    const rows = await rest("GET", CREDENTIALS, scopedQuery(settings, { select: CREDENTIAL_COLUMNS, account_id: `in.(${ids.join(",")})` }).toString());
    return new Map(rows.filter((row) => row.site_id === settings.siteId).map((row) => [row.account_id, row]));
  };

  const readAccount = async (id) => {
    if (!UUID.test(String(id))) throw new SocialOAuthError(400, "invalid-account", "That is not an account id.");
    const [row] = await rest("GET", ACCOUNTS, scopedQuery(settings, { id: `eq.${id}`, select: "*" }).toString());
    if (!row) throw new SocialOAuthError(404, "not-found", "No such account.");
    if (row.site_id !== settings.siteId) throw new SocialOAuthError(500, "other-site", "A record belongs to another site.");
    return row;
  };

  const cancelScheduled = async (accountId) => {
    const waiting = await rest("GET", POSTS, scopedQuery(settings, { account_id: `eq.${accountId}`, status: "eq.scheduled", select: "id,site_id,version", order: "scheduled_for.asc", limit: String(MAX_CANCEL) }).toString());
    let canceled = 0;
    for (const post of waiting) {
      if (post.site_id !== settings.siteId || !UUID.test(String(post.id)) || !Number.isSafeInteger(post.version)) continue;
      const stamp = new Date(now()).toISOString();
      const changed = await rest("PATCH", POSTS, scopedQuery(settings, { id: `eq.${post.id}`, account_id: `eq.${accountId}`, version: `eq.${post.version}`, status: "eq.scheduled" }).toString(), {
        status: "canceled",
        canceled_at: stamp,
        last_error_code: "account-disconnected",
        version: post.version + 1,
        updated_at: stamp,
      });
      canceled += Array.isArray(changed) ? changed.length : 0;
    }
    return canceled;
  };

  return {
    readAccount,

    async list() {
      const rows = (await rest("GET", ACCOUNTS, scopedQuery(settings, { select: "*", order: "created_at.desc", limit: "100" }).toString())).filter((row) => row.site_id === settings.siteId);
      const credentials = await credentialRows(rows.map((row) => row.id));
      return rows.map((row) => view(row, credentials.get(row.id) || null));
    },

    async get(id) {
      const row = await readAccount(id);
      return view(row, (await credentialRows([row.id])).get(row.id) || null);
    },

    // Disconnect erases our copy of the tokens and keeps the account row for history. LinkedIn is
    // also asked to withdraw the grant, but only when no other live LinkedIn account could share
    // it; Facebook's grant is removed by the author in Facebook's settings (docs).
    //
    // A disconnected account can never post again (it is connected as a new account, ADR 0300), so
    // its scheduled announcements are canceled with the code `account-disconnected` (ADR 0701), each
    // fenced by its version and its status like an author's cancel: one a worker claimed meanwhile
    // is left to the worker, which fails it without sending because the tokens are gone. Anything
    // `unknown` stays for the author to check. Run again on a second disconnect, so none is missed.
    async disconnect(id) {
      const row = await readAccount(id);
      if (row.status !== "disconnected") {
        const others = (await rest("GET", ACCOUNTS, scopedQuery(settings, { provider: `eq.${row.provider}`, status: "neq.disconnected", id: `neq.${row.id}`, select: "id" }).toString())).length;
        const provider = providers?.[row.provider];
        const withdraw = provider && row.provider === "linkedin" && others === 0 ? (secrets) => revokeAtProvider(provider, secrets, fetchImpl) : undefined;
        await connector.credentials.revoke(row.id, { revokeAtProvider: withdraw });
        // A stuck handshake of this provider may still hold a sealed copy of these tokens: erase it.
        await rest("PATCH", "openblog_social_connections", scopedQuery(settings, { provider: `eq.${row.provider}`, status: "in.(exchanging,authorized)" }).toString(), { status: "expired", error_code: "expired", envelope: null, key_id: null, completed_at: new Date(now()).toISOString(), updated_at: new Date(now()).toISOString() });
      }
      // Best effort: the tokens are already gone, which is what the author asked for. Anything not
      // canceled here is failed without being sent by the worker, and a second disconnect retries.
      let canceled = null;
      try {
        canceled = await cancelScheduled(id);
      } catch {
        canceled = null;
      }
      const view = await this.get(id);
      return canceled === null ? view : Object.freeze({ ...view, canceledAnnouncements: canceled });
    },

    // Reconnect: a new handshake bound to this account. It can finish only for the same provider identity.
    async reconnect(id, actor) {
      const row = await readAccount(id);
      if (row.status === "disconnected") throw new SocialOAuthError(409, "disconnected", "This account was disconnected. Connect it as a new account.");
      return connector.start({ provider: row.provider, actor, reauthAccountId: row.id });
    },
  };
}
