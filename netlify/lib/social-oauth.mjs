// The OAuth authorization-code handshake of optional social publishing (epic #353, story #355,
// ADR 0460). Server-only, behind the site scope of ADR 0293.
//
// An author asks Admin to connect LinkedIn or Facebook. `start` makes a connection row holding a
// hash of a single-use `state` (and, where the deployer turned it on, a PKCE verifier sealed like a
// credential) and returns the provider's authorization URL. The provider sends the browser back to
// the one exact callback registered for it. `callback` trusts nothing in that request except what
// the stored state proves: it claims the row with a version-checked write (so a replay or a second
// tab finds it spent), exchanges the code, verifies the scopes the author really granted, and keeps
// the tokens sealed until the author picks a destination. The callback needs no Admin key because
// the state is the proof, but it can only finish a connection an authorized Admin started.
//
// Errors are SocialOAuthError with fixed messages. A provider reply, code, state or token is never
// put in an error, a log line or anything returned to Admin.

import { SocialScopeError, scopedQuery } from "./social-scope.mjs";
import { SocialTokenError, openCredential, sealCredential } from "./social-tokens.mjs";
import { ProviderError, authorizationUrl, checkScopes, exchangeCode, pkceChallenge, randomToken, revokeAtProvider, sha256Hex, validProvider } from "./social-providers.mjs";

export const PENDING_TTL_MS = 10 * 60 * 1000;
export const AUTHORIZED_TTL_MS = 30 * 60 * 1000;
export const MAX_OPEN_CONNECTIONS = 10;
const CONNECTIONS = "openblog_social_connections";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const STATE = /^[A-Za-z0-9_-]{43}$/;
const CODE = /^[\x21-\x7e]{1,2048}$/;

export class SocialOAuthError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "SocialOAuthError";
    this.status = status;
    this.code = code;
  }
}

// What the callback page and Admin say for each way a handshake can end. Fixed text only.
export const OUTCOMES = Object.freeze({
  authorized: "Authorized. Return to Admin to choose where to post.",
  denied: "The authorization was declined, so nothing was connected.",
  "invalid-state": "This link is not valid or was already used. Start again from Admin.",
  expired: "This connection attempt expired. Start again from Admin.",
  "invalid-request": "The provider's reply was not valid. Start again from Admin.",
  "scopes-missing": "A permission this feature needs was not granted. Start again and allow every permission requested.",
  "code-rejected": "The provider did not accept the authorization. Start again from Admin.",
  "provider-error": "The provider reported a problem. Start again from Admin.",
  "provider-unavailable": "The provider could not be reached. Try again shortly.",
  "identity-mismatch": "That is a different account from the one being reconnected. Sign in as the original account.",
  "no-destination": "Nothing this app may post to was found for that account.",
  "storage-failed": "The connection could not be saved. Try again.",
});

const iso = (ms) => new Date(ms).toISOString();

export function createConnector({ settings, providers, fetchImpl = globalThis.fetch, now = () => Date.now(), random } = {}) {
  if (!settings || settings.enabled !== true || !settings.tokenKeys) throw new SocialScopeError(404, "not-enabled", "Social publishing is not enabled.");
  const keyring = settings.tokenKeys;

  const rest = async (method, table, query, body) => {
    let response;
    try {
      response = await fetchImpl(`${settings.url}/rest/v1/${table}?${query}`, {
        method,
        headers: { apikey: settings.key, authorization: `Bearer ${settings.key}`, "content-type": "application/json", prefer: "return=representation" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new SocialOAuthError(503, "storage-unavailable", "The connection store could not be reached.");
    }
    if (!response.ok) throw new SocialOAuthError(response.status >= 500 ? 503 : 500, "storage-failed", "The connection store refused the request.");
    const rows = await response.json();
    return Array.isArray(rows) ? rows : [];
  };

  const owned = (rows) => {
    for (const row of rows) if (row.site_id !== settings.siteId) throw new SocialScopeError(500, "other-site", "A record belongs to another site.");
    return rows;
  };

  const read = async (filters) => owned(await rest("GET", CONNECTIONS, scopedQuery(settings, { select: "*", ...filters }).toString()));

  // A write that applies only to the version (and, where given, the state) the caller read.
  const write = async (row, patch, extra = {}) => {
    const query = scopedQuery(settings, { id: `eq.${row.id}`, version: `eq.${row.version}`, ...extra }).toString();
    const rows = owned(await rest("PATCH", CONNECTIONS, query, { ...patch, version: row.version + 1, updated_at: iso(now()) }));
    return rows[0] || null;
  };

  const seal = async (row, secrets) => {
    const { keyId, envelope } = await sealCredential(keyring, { siteId: settings.siteId, accountId: row.id }, secrets);
    return { key_id: keyId, envelope };
  };
  const open = (row) => openCredential(keyring, { siteId: settings.siteId, accountId: row.id }, row.key_id, row.envelope);

  const finish = (row, status, code, extra = {}) =>
    write(row, { status, error_code: code, envelope: null, key_id: null, completed_at: iso(now()), ...extra }, { status: "in.(pending,exchanging,authorized)" });

  // Past-due open rows become expired and lose their sealed material. Version is not raised: a
  // concurrent claim still filters on its status and version, so it cannot win after this.
  const expireDue = () =>
    rest("PATCH", CONNECTIONS, scopedQuery(settings, { status: "in.(pending,authorized)", expires_at: `lt.${iso(now())}` }).toString(), { status: "expired", error_code: "expired", envelope: null, key_id: null, completed_at: iso(now()), updated_at: iso(now()) });

  const connectionOf = (row) => {
    const granted = row.granted_scopes ? row.granted_scopes.split(" ").filter(Boolean) : [];
    return Object.freeze({
      id: row.id,
      provider: row.provider,
      status: row.status,
      expiresAt: row.expires_at,
      requestedScopes: row.requested_scopes.split(" ").filter(Boolean),
      grantedScopes: granted,
      createdBy: row.created_by,
      createdAt: row.created_at,
      reauthAccountId: row.reauth_account_id || null,
      errorCode: row.error_code || null,
      message: row.error_code ? OUTCOMES[row.error_code] || null : null,
      destinations: Array.isArray(row.destinations) ? row.destinations : [],
    });
  };

  const providerOf = (name) => {
    const provider = validProvider(name) ? providers?.[name] : null;
    if (!provider) throw new SocialOAuthError(409, "provider-not-configured", "That provider is not set up on the server.");
    return provider;
  };

  const failureFor = (error) => (error instanceof ProviderError ? (error.code === "code-rejected" ? "code-rejected" : error.retryable || error.code === "provider-unreachable" ? "provider-unavailable" : "provider-error") : "storage-failed");

  // After a verified exchange: keep the tokens sealed under the connection and wait for the author
  // to choose a destination.
  const authorize = async ({ connection, tokens }) => {
    const secrets = { accessToken: tokens.accessToken };
    if (tokens.refreshToken) secrets.refreshToken = tokens.refreshToken;
    const row = await write(
      connection,
      {
        status: "authorized",
        granted_scopes: tokens.granted.join(" ").slice(0, 1000),
        access_expires_at: Number.isFinite(tokens.expiresIn) ? iso(now() + tokens.expiresIn * 1000) : null,
        refresh_expires_at: Number.isFinite(tokens.refreshExpiresIn) ? iso(now() + tokens.refreshExpiresIn * 1000) : null,
        expires_at: iso(now() + AUTHORIZED_TTL_MS),
        destinations: [],
        error_code: null,
        ...(await seal(connection, secrets)),
      },
      { status: "eq.exchanging" },
    );
    return row ? { ok: true } : { ok: false, code: "storage-failed" };
  };

  const self = {
    connectionOf,
    providerOf,
    rest,
    read,
    write,
    seal,
    open,
    finish,
    expireDue,
    now,

    // Begins a handshake. Returns what Admin may show and the URL to send the author's browser to.
    async start({ provider: name, actor, reauthAccountId = null }) {
      const provider = providerOf(name);
      if (reauthAccountId !== null && !UUID.test(String(reauthAccountId))) throw new SocialOAuthError(400, "invalid-account", "That is not an account id.");
      await expireDue();
      const openRows = await read({ status: "in.(pending,exchanging)", expires_at: `gt.${iso(now())}`, select: "id" });
      if (openRows.length >= MAX_OPEN_CONNECTIONS) throw new SocialOAuthError(429, "too-many-attempts", "Too many connection attempts are open. Finish or cancel one, or wait ten minutes.");
      const state = randomToken(random);
      const id = crypto.randomUUID();
      const verifier = provider.pkce ? randomToken(random) : null;
      const sealedVerifier = verifier ? await seal({ id }, { verifier }) : { key_id: null, envelope: null };
      const row = {
        id,
        site_id: settings.siteId,
        provider: provider.provider,
        status: "pending",
        state_hash: await sha256Hex(state),
        redirect_uri: provider.redirectUri,
        requested_scopes: provider.scopes.join(" "),
        pkce: provider.pkce,
        reauth_account_id: reauthAccountId,
        created_by: actor,
        expires_at: iso(now() + PENDING_TTL_MS),
        ...sealedVerifier,
      };
      const [created] = owned(await rest("POST", CONNECTIONS, "", row));
      return {
        connection: connectionOf(created),
        authorizeUrl: authorizationUrl(provider, { state, challenge: verifier ? await pkceChallenge(verifier) : null, reauthorize: reauthAccountId !== null }),
      };
    },

    // Finishes a handshake from the provider's redirect. It never throws for what a stranger can
    // send: every refusal is { ok: false, code } with a code from OUTCOMES, and the caller shows
    // the fixed text. `params` is the callback's URLSearchParams.
    async callback({ provider: name, params }) {
      const refused = (code) => ({ ok: false, code, text: OUTCOMES[code] });
      const provider = validProvider(name) ? providers?.[name] : null;
      if (!provider) return refused("invalid-request");
      // One value for each name we read. A repeated `state` or `code` is an attack or a bug, not a choice.
      for (const key of ["state", "code", "error"]) if (params.getAll(key).length > 1) return refused("invalid-request");
      const state = params.get("state") || "";
      if (!STATE.test(state)) return refused("invalid-state");
      let row;
      try {
        [row] = await read({ state_hash: `eq.${await sha256Hex(state)}` });
      } catch {
        return refused("storage-failed");
      }
      // Wrong provider, already used, canceled or unknown all look the same to the caller.
      if (!row || row.provider !== provider.provider || row.status !== "pending") return refused("invalid-state");
      try {
        if (Date.parse(row.expires_at) <= now()) {
          await finish(row, "expired", "expired");
          return refused("expired");
        }
        // The claim: only one callback can move this row from pending to exchanging.
        const claimed = await write(row, { status: "exchanging" }, { status: "eq.pending" });
        if (!claimed) return refused("invalid-state");
        const error = params.get("error");
        if (error) {
          const denied = ["access_denied", "user_cancelled_login", "user_cancelled_authorize"].includes(error);
          await finish(claimed, "failed", denied ? "denied" : "provider-error");
          return refused(denied ? "denied" : "provider-error");
        }
        const code = params.get("code") || "";
        if (!CODE.test(code)) {
          await finish(claimed, "failed", "invalid-request");
          return refused("invalid-request");
        }
        let verifier;
        if (claimed.pkce) {
          try {
            verifier = (await open(claimed)).verifier;
          } catch {
            await finish(claimed, "failed", "storage-failed");
            return refused("storage-failed");
          }
        }
        let tokens;
        try {
          tokens = await exchangeCode(provider, { code, verifier }, fetchImpl);
        } catch (failure) {
          const reason = failureFor(failure);
          await finish(claimed, "failed", reason);
          return refused(reason);
        }
        // The scopes the author actually granted, not the ones we asked for.
        const verdict = checkScopes(provider, tokens.granted);
        if (verdict.missingRequired.length) {
          await revokeAtProvider(provider, tokens, fetchImpl);
          await finish(claimed, "failed", "scopes-missing", { granted_scopes: tokens.granted.join(" ").slice(0, 1000) });
          return refused("scopes-missing");
        }
        const next = await authorize({ connection: claimed, provider, tokens });
        return next.ok ? { ok: true, code: "authorized", text: OUTCOMES.authorized, connectionId: claimed.id } : refused(next.code);
      } catch {
        // Storage failed part-way. The row stays `exchanging` until it expires; it cannot be reused.
        return refused("storage-failed");
      }
    },

    // Cancels an open connection and erases whatever it sealed.
    async cancel(id) {
      if (!UUID.test(String(id))) throw new SocialOAuthError(400, "invalid-connection", "That is not a connection id.");
      const [row] = await read({ id: `eq.${id}` });
      if (!row) throw new SocialOAuthError(404, "not-found", "No such connection.");
      if (!["pending", "authorized", "exchanging"].includes(row.status)) return connectionOf(row);
      const done = await finish(row, "canceled", "canceled");
      if (!done) throw new SocialOAuthError(409, "conflict", "The connection changed; try again.");
      return connectionOf(done);
    },

    async list() {
      await expireDue();
      const rows = await read({ order: "created_at.desc", limit: "20" });
      return rows.map(connectionOf);
    },
  };
  return self;
}

export { SocialTokenError };
