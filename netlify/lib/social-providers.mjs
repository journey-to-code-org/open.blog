// Provider adapters for optional social publishing (epic #353, story #355, ADR 0299): the
// LinkedIn and Facebook settings, the authorization URL, the code exchange and the scope check.
// Server-only. Every provider call goes through an injected `fetchImpl`, so tests run against fakes
// and no real network call is ever made by this repository's tests.
//
// Nothing here is guessed from memory at run time. The API versions and scopes are settings, with
// defaults that docs/social-publishing.md tells the deployer to verify at setup. A provider reply
// is read for the few fields named below; its text is never put in an error, so a token, a code or
// a client secret cannot reach a log, and nothing a provider says can inject text into a page.

import { ProviderTokenError } from "./social-credentials.mjs";
import { DID, HANDLE, SESSION_TOKEN, appPassword, blueskyIdentifier, tokenSecondsLeft, validAppPassword, xrpcError } from "./social-atproto.mjs";
import { deliveryPolicy } from "./social-delivery.mjs";

export class ProviderError extends Error {
  // `code` is a fixed slug; `status` is the provider's HTTP status when there was one.
  constructor(code, { status = 0, retryable = false } = {}) {
    super(MESSAGES[code] || MESSAGES["provider-failed"]);
    this.name = "ProviderError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

const MESSAGES = {
  "provider-unreachable": "The provider could not be reached.",
  "provider-rejected": "The provider refused the request.",
  "provider-invalid": "The provider sent a reply that could not be read.",
  "code-rejected": "The provider did not accept the authorization code.",
  "provider-failed": "The provider request failed.",
  "credentials-rejected": "The provider did not accept that sign-in.",
  "rate-limited": "The provider asked us to slow down.",
};

export const PROVIDERS = Object.freeze(["linkedin", "facebook", "bluesky", "mastodon"]);
export const validProvider = (value) => typeof value === "string" && PROVIDERS.includes(value);

// The provider endpoints and defaults. Versions and scopes are overridable; hosts are not, so a
// misconfigured environment cannot send a client secret anywhere but the provider.
const DEFINITIONS = Object.freeze({
  linkedin: Object.freeze({
    label: "LinkedIn",
    authorizeUrl: "https://www.linkedin.com/oauth/v2/authorization",
    tokenUrl: "https://www.linkedin.com/oauth/v2/accessToken",
    revokeUrl: "https://www.linkedin.com/oauth/v2/revoke",
    apiBase: "https://api.linkedin.com",
    versionPattern: /^\d{6}$/,
    // Checked 2026-10-29 against LinkedIn's migration table: 202510 was sunset on 2026-10-15, so the
    // default moved to 202610 (Active, sunset 2027-10-15). See SUPPORT below and ADR 0332.
    defaultVersion: "202610",
    // The member scopes every connection needs. `openid profile` name the member; `w_member_social` posts as them.
    baseScopes: Object.freeze(["openid", "profile", "w_member_social"]),
    // Only requested when OPENBLOG_SOCIAL_LINKEDIN_ORGANIZATIONS=true: they need the Community
    // Management API, which LinkedIn approves per app.
    organizationScopes: Object.freeze(["r_organization_admin", "w_organization_social"]),
    optionalScopes: Object.freeze(["r_organization_admin", "w_organization_social"]),
    scopeSeparator: " ",
  }),
  facebook: Object.freeze({
    label: "Facebook",
    authorizeUrl: "https://www.facebook.com/{version}/dialog/oauth",
    tokenUrl: "https://graph.facebook.com/{version}/oauth/access_token",
    apiBase: "https://graph.facebook.com/{version}",
    versionPattern: /^v\d{2}\.\d$/,
    defaultVersion: "v23.0",
    baseScopes: Object.freeze(["pages_show_list", "pages_manage_posts"]),
    organizationScopes: Object.freeze([]),
    // Reading engagement is nice to have; posting is not possible without the first two.
    optionalScopes: Object.freeze(["pages_read_engagement"]),
    extraScopes: Object.freeze(["pages_read_engagement"]),
    scopeSeparator: ",",
  }),
  // Bluesky (story #391, ADR 0760): an AT Protocol session made from an app password, not OAuth.
  // There is no client id or secret; the deployer turns it on and may name the service that signs
  // the author in (the bsky.social entryway by default, or their own PDS).
  bluesky: Object.freeze({
    label: "Bluesky",
    login: "app-password",
    defaultService: "https://bsky.social",
    // The XRPC API is not versioned by date; this names the protocol so Admin has something to show.
    version: "atproto",
    baseScopes: Object.freeze([]),
    organizationScopes: Object.freeze([]),
    optionalScopes: Object.freeze([]),
  }),
  // Mastodon (story #392, ADR 0762): OAuth 2 against one instance the deployer names, with an
  // application the deployer registered there. Every endpoint is derived from that instance's
  // https origin, so a client secret can only ever be sent to it. Granular scopes (Mastodon 2.4.3+):
  // reading the account and writing statuses are required; reading statuses (to look an uncertain
  // attempt up) and uploading media (the cover image) only narrow what the connection can do.
  mastodon: Object.freeze({
    label: "Mastodon",
    authorizeUrl: "{instance}/oauth/authorize",
    tokenUrl: "{instance}/oauth/token",
    revokeUrl: "{instance}/oauth/revoke",
    apiBase: "{instance}",
    // The REST API is versioned by path (/api/v1, /api/v2), not by a setting.
    versionPattern: /^v1$/,
    defaultVersion: "v1",
    baseScopes: Object.freeze(["read:accounts", "write:statuses"]),
    organizationScopes: Object.freeze([]),
    optionalScopes: Object.freeze(["read:statuses", "write:media"]),
    extraScopes: Object.freeze(["read:statuses", "write:media"]),
    scopeSeparator: " ",
  }),
});

// Who may see a Mastodon announcement. `direct` is never offered: it would message every person the
// caption mentions instead of announcing anything.
export const MASTODON_VISIBILITIES = Object.freeze(["public", "unlisted", "private"]);
// Attaching the post's cover image takes several provider calls in one delivery, so it is refused
// unless each delivery may take at least this long (OPENBLOG_SOCIAL_PROVIDER_TIMEOUT_SECONDS).
export const MASTODON_MEDIA_MIN_TIMEOUT_SECONDS = 15;

// Whether one connection's credential is its own and shared with no other account, so it is always
// withdrawn at the provider on disconnect or a failed attempt: a Bluesky session (ADR 0760) and a
// Mastodon token, which the instance issues per authorization (ADR 0762).
export const ownsGrant = (settings) => settings?.login === "app-password" || settings?.provider === "mastodon";

// When each default API version stops being served, as the provider's own documentation said on the
// date it was checked (ADR 0332). A release gate test fails once a default's date has passed, so the
// default is re-verified instead of silently breaking every post. A deployer's own
// OPENBLOG_SOCIAL_<PROVIDER>_API_VERSION is not checked against this: it is theirs to keep current.
export const VERSION_SUPPORT = Object.freeze({
  linkedin: Object.freeze({
    version: "202610",
    supportedUntil: "2027-10-15",
    checkedOn: "2026-10-29",
    source: "https://learn.microsoft.com/en-us/linkedin/marketing/integrations/migrations",
  }),
  facebook: Object.freeze({
    version: "v23.0",
    supportedUntil: "2027-10-08",
    checkedOn: "2026-10-29",
    source: "https://developers.facebook.com/docs/graph-api/changelog/versions/",
  }),
  // Bluesky and Mastodon have no dated API versions to retire: XRPC methods are named, not dated, and
  // Mastodon versions its REST API by path. `undated` says why, so the release gate checks the source
  // instead of an end date.
  bluesky: Object.freeze({
    version: "atproto",
    undated: "XRPC methods are versioned by name, not by date",
    checkedOn: "2026-10-29",
    source: "https://docs.bsky.app/docs/advanced-guides/api-directory",
  }),
  mastodon: Object.freeze({
    version: "v1",
    undated: "the REST API is versioned by path, not by date",
    checkedOn: "2026-10-29",
    source: "https://docs.joinmastodon.org/api/",
  }),
});

export const providerLabel = (provider) => DEFINITIONS[provider]?.label || "Provider";
export const providerDefinition = (provider) => DEFINITIONS[provider];

const text = (value) => String(value ?? "").trim();
const SCOPE = /^[A-Za-z0-9_.:-]{1,80}$/;
const CLIENT_ID = /^[\x21-\x7e]{1,200}$/;
const CLIENT_SECRET = /^[\x21-\x7e]{8,300}$/;

export function parseScopes(value) {
  const list = text(value).split(/[\s,]+/).filter(Boolean);
  if (!list.length || list.length > 20 || list.some((scope) => !SCOPE.test(scope))) return null;
  return [...new Set(list)];
}

// A callback base is the https URL the hosted function is reachable at, such as
// https://blog.example.com/api/social. No credentials, query or fragment; the exact callback for a
// provider is `${base}/callback/${provider}` and is the only redirect URI this code ever sends.
export function callbackBase(value) {
  try {
    const url = new URL(text(value));
    const clean = url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash && !url.hostname.endsWith(".") && url.href.length <= 400;
    if (!clean) return null;
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

// The configured providers. A provider with no client id is simply not offered. One with a client
// id but something wrong is also not offered, and `problems` names the settings (never values).
export function socialProviders(env = {}) {
  const base = callbackBase(env.OPENBLOG_SOCIAL_CALLBACK_BASE);
  const problems = [];
  const providers = {};
  for (const provider of PROVIDERS) {
    const upper = provider.toUpperCase();
    const definition = DEFINITIONS[provider];
    const name = (suffix) => `OPENBLOG_SOCIAL_${upper}_${suffix}`;
    if (definition.login === "app-password") {
      const settings = appPasswordProvider(provider, definition, env, name, problems);
      if (settings) providers[provider] = settings;
      continue;
    }
    const clientId = text(env[name("CLIENT_ID")]);
    const clientSecret = text(env[name("CLIENT_SECRET")]);
    if (!clientId && !clientSecret) continue;
    const bad = [];
    // Mastodon has no fixed host: the deployer names the instance the application is registered on.
    const mastodon = provider === "mastodon";
    const instance = mastodon ? serviceOrigin(text(env[name("INSTANCE")])) : null;
    if (mastodon && !instance) bad.push(name("INSTANCE"));
    const options = mastodon ? mastodonOptions(env, name, bad, problems) : {};
    if (!CLIENT_ID.test(clientId)) bad.push(name("CLIENT_ID"));
    if (!CLIENT_SECRET.test(clientSecret)) bad.push(name("CLIENT_SECRET"));
    if (!base) bad.push("OPENBLOG_SOCIAL_CALLBACK_BASE");
    const version = text(env[name("API_VERSION")]) || definition.defaultVersion;
    if (!definition.versionPattern.test(version)) bad.push(name("API_VERSION"));
    const organizations = provider === "linkedin" && text(env[name("ORGANIZATIONS")]) === "true";
    let scopes = [...definition.baseScopes, ...(organizations ? definition.organizationScopes : []), ...(definition.extraScopes || [])];
    if (text(env[name("SCOPES")])) {
      scopes = parseScopes(env[name("SCOPES")]);
      if (!scopes) bad.push(name("SCOPES"));
    }
    const pkceSetting = text(env[name("PKCE")]);
    if (pkceSetting && !["true", "false"].includes(pkceSetting)) bad.push(name("PKCE"));
    if (bad.length) {
      problems.push(...bad);
      continue;
    }
    const resolve = (template) => template.replace("{version}", version).replace("{instance}", instance ?? "");
    const secretFields = { clientSecret };
    const publicFields = {
      provider,
      label: definition.label,
      login: "oauth",
      clientId,
      redirectUri: `${base}/callback/${provider}`,
      version,
      scopes: Object.freeze(scopes),
      requiredScopes: Object.freeze(scopes.filter((scope) => !definition.optionalScopes.includes(scope))),
      organizations,
      // PKCE is sent only where the deployer has confirmed the provider app supports it.
      pkce: pkceSetting === "true",
      authorizeUrl: resolve(definition.authorizeUrl),
      tokenUrl: resolve(definition.tokenUrl),
      revokeUrl: definition.revokeUrl ? resolve(definition.revokeUrl) : null,
      apiBase: resolve(definition.apiBase),
      ...(mastodon ? { instance, ...options } : {}),
    };
    providers[provider] = hideSecrets(publicFields, secretFields);
  }
  Object.defineProperty(providers, "problems", { value: Object.freeze([...new Set(problems)]), enumerable: false });
  return Object.freeze(providers);
}

// Mastodon's two posting choices. Visibility defaults to public. Attaching the cover image is off
// unless OPENBLOG_SOCIAL_MASTODON_MEDIA=cover and each delivery may take long enough for the extra
// calls; otherwise media stays off and the settings are named as problems, but Mastodon is offered.
function mastodonOptions(env, name, bad, problems) {
  const visibility = text(env[name("VISIBILITY")]) || "public";
  if (!MASTODON_VISIBILITIES.includes(visibility)) bad.push(name("VISIBILITY"));
  const setting = text(env[name("MEDIA")]);
  let media = "none";
  if (setting && !["none", "cover"].includes(setting)) problems.push(name("MEDIA"));
  else if (setting === "cover") {
    if (deliveryPolicy(env).providerTimeoutSeconds < MASTODON_MEDIA_MIN_TIMEOUT_SECONDS) problems.push(name("MEDIA"), "OPENBLOG_SOCIAL_PROVIDER_TIMEOUT_SECONDS");
    else media = "cover";
  }
  return { visibility, media };
}

// An app-password provider is offered only when the deployer turns it on with
// OPENBLOG_SOCIAL_<PROVIDER>_ENABLED=true. Its one other setting is the service that signs the
// author in: an https origin with nothing else in it, so a misconfiguration cannot send an app
// password to a path, a query or a host with credentials in it.
function appPasswordProvider(provider, definition, env, name, problems) {
  const enabled = text(env[name("ENABLED")]);
  if (!enabled) return null;
  const bad = [];
  if (enabled !== "true") bad.push(name("ENABLED"));
  const service = serviceOrigin(text(env[name("SERVICE")]) || definition.defaultService);
  if (!service) bad.push(name("SERVICE"));
  if (bad.length) {
    problems.push(...bad);
    return null;
  }
  return hideSecrets(
    {
      provider,
      label: definition.label,
      login: "app-password",
      redirectUri: null,
      version: definition.version,
      scopes: Object.freeze([]),
      requiredScopes: Object.freeze([]),
      organizations: false,
      pkce: false,
      authorizeUrl: null,
      tokenUrl: null,
      revokeUrl: null,
      apiBase: service,
    },
    {},
  );
}

// An https origin and nothing more (no credentials, path, query or fragment), without a trailing slash.
export function serviceOrigin(value) {
  try {
    const url = new URL(value);
    const clean = url.protocol === "https:" && !url.username && !url.password && (url.pathname === "/" || url.pathname === "") && !url.search && !url.hash && !url.hostname.endsWith(".") && url.hostname.includes(".");
    return clean && value.length <= 200 ? url.origin : null;
  } catch {
    return null;
  }
}

function hideSecrets(publicFields, secrets) {
  const settings = { ...publicFields };
  for (const [name, value] of Object.entries(secrets)) Object.defineProperty(settings, name, { value, enumerable: false });
  Object.defineProperty(settings, "toJSON", { value: () => ({ ...publicFields }), enumerable: false });
  Object.defineProperty(settings, Symbol.for("nodejs.util.inspect.custom"), { value: () => `SocialProvider ${JSON.stringify(publicFields)}`, enumerable: false });
  return Object.freeze(settings);
}

// What Admin may be told about a provider's setup: nothing secret, the exact redirect to register.
export function describeProvider(settings) {
  return Object.freeze({
    provider: settings.provider,
    label: settings.label,
    login: settings.login,
    redirectUri: settings.redirectUri,
    version: settings.version,
    scopes: [...settings.scopes],
    requiredScopes: [...settings.requiredScopes],
    organizations: settings.organizations,
    pkce: settings.pkce,
    // Mastodon only: the instance the author signs in at, and what the deployer chose to post.
    ...(settings.provider === "mastodon" ? { instance: settings.instance, visibility: settings.visibility, media: settings.media } : {}),
  });
}

const encoder = new TextEncoder();
export const base64url = (bytes) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
export const randomToken = (random = (n) => crypto.getRandomValues(new Uint8Array(n))) => base64url(random(32));
export const sha256Hex = async (value) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
export const pkceChallenge = async (verifier) => base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(verifier))));

// The URL the author's browser is sent to. Built only from settings and fixed fields; `state` and
// the PKCE challenge are the only per-attempt values, and both are server-made.
export function authorizationUrl(settings, { state, challenge, reauthorize = false }) {
  const url = new URL(settings.authorizeUrl);
  const params = url.searchParams;
  params.set("response_type", "code");
  params.set("client_id", settings.clientId);
  params.set("redirect_uri", settings.redirectUri);
  params.set("state", state);
  params.set("scope", settings.scopes.join(DEFINITIONS[settings.provider].scopeSeparator));
  if (challenge) {
    params.set("code_challenge", challenge);
    params.set("code_challenge_method", "S256");
  }
  // Facebook remembers a declined permission and does not ask again unless told to.
  if (settings.provider === "facebook" && reauthorize) params.set("auth_type", "rerequest");
  // Mastodon signs in whoever is already signed in at the instance; reconnecting asks again, so
  // the author signs in as the account the connection belongs to.
  if (settings.provider === "mastodon" && reauthorize) params.set("force_login", "true");
  return url.toString();
}

const MAX_REPLY_CHARS = 512 * 1024;
const TIMEOUT_MS = 10_000;

// One provider call. Network failure, a non-2xx status and an unreadable body are three fixed
// errors; the reply is parsed but never quoted.
export async function providerJson(fetchImpl, url, init = {}) {
  let response;
  try {
    response = await fetchImpl(url, { redirect: "manual", ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new ProviderError("provider-unreachable", { retryable: true });
  }
  const status = Number(response.status) || 0;
  let body = null;
  try {
    const raw = await response.text();
    if (raw.length > MAX_REPLY_CHARS) throw new Error("large");
    body = raw ? JSON.parse(raw) : null;
  } catch {
    if (response.ok) throw new ProviderError("provider-invalid", { status });
  }
  if (!response.ok) throw new ProviderError(status === 400 || status === 401 ? "provider-rejected" : "provider-failed", { status, retryable: status >= 500 || status === 429 });
  if (!body || typeof body !== "object") throw new ProviderError("provider-invalid", { status });
  return body;
}

const form = (fields) => ({ method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body: new URLSearchParams(fields).toString() });

const seconds = (value) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Math.floor(Number(value)) : undefined);

export const splitScopes = (value) => [...new Set(text(value).split(/[\s,]+/).filter(Boolean))];

// Exchanges the one-time code for tokens and returns the scopes the author actually granted.
// Client credentials travel in the POST body, never in a URL, so a proxy or access log cannot keep them.
export async function exchangeCode(settings, { code, verifier }, fetchImpl) {
  const fields = { grant_type: "authorization_code", code, redirect_uri: settings.redirectUri, client_id: settings.clientId, client_secret: settings.clientSecret };
  if (verifier) fields.code_verifier = verifier;
  // LinkedIn and Mastodon: one token request, whose `scope` says what the author granted.
  if (settings.provider === "linkedin" || settings.provider === "mastodon") {
    let reply;
    try {
      reply = await providerJson(fetchImpl, settings.tokenUrl, form(fields));
    } catch (error) {
      throw error instanceof ProviderError && error.code === "provider-rejected" ? new ProviderError("code-rejected", { status: error.status }) : error;
    }
    if (typeof reply.access_token !== "string" || !reply.access_token) throw new ProviderError("provider-invalid");
    return {
      accessToken: reply.access_token,
      refreshToken: typeof reply.refresh_token === "string" && reply.refresh_token ? reply.refresh_token : undefined,
      expiresIn: seconds(reply.expires_in),
      refreshExpiresIn: seconds(reply.refresh_token_expires_in),
      granted: splitScopes(reply.scope),
    };
  }
  // Facebook: a short-lived user token, exchanged for a long-lived one, whose Page tokens do not expire.
  let short;
  try {
    short = await providerJson(fetchImpl, settings.tokenUrl, form(fields));
  } catch (error) {
    throw error instanceof ProviderError && error.code === "provider-rejected" ? new ProviderError("code-rejected", { status: error.status }) : error;
  }
  if (typeof short.access_token !== "string" || !short.access_token) throw new ProviderError("provider-invalid");
  const long = await providerJson(fetchImpl, settings.tokenUrl, form({ grant_type: "fb_exchange_token", client_id: settings.clientId, client_secret: settings.clientSecret, fb_exchange_token: short.access_token }));
  if (typeof long.access_token !== "string" || !long.access_token) throw new ProviderError("provider-invalid");
  const permissions = await providerJson(fetchImpl, `${settings.apiBase}/me/permissions`, { headers: { authorization: `Bearer ${long.access_token}`, accept: "application/json" } });
  const granted = (Array.isArray(permissions.data) ? permissions.data : []).filter((entry) => entry && entry.status === "granted" && typeof entry.permission === "string").map((entry) => entry.permission);
  return { accessToken: long.access_token, expiresIn: seconds(long.expires_in), granted: [...new Set(granted)] };
}

// Requested scopes the provider did not grant, split into those a connection cannot work without
// and those that only narrow what it can reach.
export function checkScopes(settings, granted) {
  const have = new Set(granted);
  // On Mastodon a broad scope grants its granular ones: `write` covers `write:statuses`.
  const covered = (scope) => have.has(scope) || (settings.provider === "mastodon" && scope.includes(":") && have.has(scope.split(":")[0]));
  return {
    missingRequired: settings.requiredScopes.filter((scope) => !covered(scope)),
    missingOptional: settings.scopes.filter((scope) => !settings.requiredScopes.includes(scope) && !covered(scope)),
  };
}

// Best-effort revocation of a LinkedIn grant at LinkedIn. Facebook has none to offer a single Page:
// a Page token cannot withdraw the user's grant, and withdrawing it would cut off every other Page
// that shares it, so the author removes the app in Facebook's settings (docs/social-publishing.md).
// Failure is a boolean, never detail.
export async function revokeAtProvider(settings, secrets, fetchImpl) {
  if (settings.provider === "bluesky") return deleteBlueskySession(settings, secrets, fetchImpl);
  // A Mastodon token is this connection's own, so revoking it (client credentials and the token,
  // POST /oauth/revoke) cuts off nothing else.
  if (!["linkedin", "mastodon"].includes(settings.provider) || !settings.revokeUrl) return false;
  try {
    const response = await fetchImpl(settings.revokeUrl, { ...form({ client_id: settings.clientId, client_secret: settings.clientSecret, token: secrets.refreshToken || secrets.accessToken }), redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
    return Boolean(response.ok);
  } catch {
    return false;
  }
}

// The provider's refresh, in the shape createCredentialStore's `refresh` expects, or undefined for
// a provider whose tokens are not refreshed (a Facebook Page token does not expire).
export function refreshWith(settings, fetchImpl, now = () => Date.now()) {
  if (settings?.provider === "bluesky") return refreshBlueskySession(settings, fetchImpl, now);
  // Mastodon tokens do not expire today; one that comes with a refresh token is refreshed the same way.
  if (settings?.provider !== "linkedin" && settings?.provider !== "mastodon") return undefined;
  return async (refreshToken) => {
    let reply;
    try {
      reply = await providerJson(fetchImpl, settings.tokenUrl, form({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: settings.clientId, client_secret: settings.clientSecret }));
    } catch (error) {
      throw new ProviderTokenError(error instanceof ProviderError && error.code === "provider-rejected");
    }
    if (typeof reply.access_token !== "string" || !reply.access_token) throw new ProviderTokenError(false);
    return {
      accessToken: reply.access_token,
      refreshToken: typeof reply.refresh_token === "string" && reply.refresh_token ? reply.refresh_token : undefined,
      expiresIn: seconds(reply.expires_in),
      refreshExpiresIn: seconds(reply.refresh_token_expires_in),
    };
  };
}

// ---- Bluesky: an AT Protocol session made from an app password (story #391, ADR 0760)
//
// The author gives Admin a handle and an app password once. The function opens a session with
// com.atproto.server.createSession and keeps only the session's two tokens, sealed like any other
// credential; the app password itself is never stored, logged or sent anywhere but the service.
// The access token is short-lived and is refreshed with com.atproto.server.refreshSession, which
// also rotates the refresh token (single-flight, ADR 0295). Disconnecting ends the session with
// com.atproto.server.deleteSession. A refresh token the service no longer honours makes the
// account "needs reconnecting", like any other provider.

// If a token's expiry cannot be read, it is treated as short, so it is refreshed early, not late.
const FALLBACK_ACCESS_SECONDS = 15 * 60;
// Bluesky's InvalidToken, ExpiredToken and AccountTakedown mean the session is over for good.
const SESSION_OVER = new Set(["InvalidToken", "ExpiredToken", "AccountTakedown", "AuthenticationRequired"]);

const xrpc = (settings, method) => `${settings.apiBase}/xrpc/${method}`;

// One XRPC call: { status, body, retryAfter } or a ProviderError for a network failure. The body
// is parsed for its fields and never quoted.
async function xrpcCall(fetchImpl, url, init) {
  let response;
  try {
    response = await fetchImpl(url, { redirect: "manual", ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new ProviderError("provider-unreachable", { retryable: true });
  }
  const status = Number(response.status) || 0;
  let body = null;
  try {
    const raw = await response.text();
    body = raw && raw.length <= MAX_REPLY_CHARS ? JSON.parse(raw) : null;
  } catch {
    body = null;
  }
  return { status, body: body && typeof body === "object" ? body : null };
}

// The session's tokens and identity, checked for shape. Anything missing is "provider-invalid".
function readSession(body, now) {
  if (!body || typeof body.accessJwt !== "string" || typeof body.refreshJwt !== "string") throw new ProviderError("provider-invalid");
  if (!SESSION_TOKEN.test(body.accessJwt) || !SESSION_TOKEN.test(body.refreshJwt) || body.accessJwt.length > 4096 || body.refreshJwt.length > 4096) throw new ProviderError("provider-invalid");
  if (typeof body.did !== "string" || !DID.test(body.did)) throw new ProviderError("provider-invalid");
  const handle = typeof body.handle === "string" && HANDLE.test(body.handle) ? body.handle : null;
  return {
    accessToken: body.accessJwt,
    refreshToken: body.refreshJwt,
    expiresIn: tokenSecondsLeft(body.accessJwt, now()) ?? FALLBACK_ACCESS_SECONDS,
    refreshExpiresIn: tokenSecondsLeft(body.refreshJwt, now()),
    did: body.did,
    handle,
    // A takendown, suspended or deactivated account says active: false and cannot post.
    active: body.active !== false,
    granted: [],
  };
}

// Opens a session from a handle (or DID) and an app password. Refuses, before any call, an
// identifier that is not one and a password that is not an app password.
export async function openBlueskySession(settings, { identifier, password }, fetchImpl, now = () => Date.now()) {
  const who = blueskyIdentifier(identifier);
  if (!who || !validAppPassword(password)) throw new ProviderError("credentials-rejected");
  const { status, body } = await xrpcCall(fetchImpl, xrpc(settings, "com.atproto.server.createSession"), {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ identifier: who, password: appPassword(password) }),
  });
  if (status === 200) return readSession(body, now);
  if (status === 429) throw new ProviderError("rate-limited", { status, retryable: true });
  if (status === 401 || status === 400 || status === 403) throw new ProviderError("credentials-rejected", { status });
  throw new ProviderError(status >= 500 ? "provider-unreachable" : "provider-failed", { status, retryable: status >= 500 });
}

function refreshBlueskySession(settings, fetchImpl, now) {
  return async (refreshToken) => {
    let reply;
    try {
      reply = await xrpcCall(fetchImpl, xrpc(settings, "com.atproto.server.refreshSession"), { method: "POST", headers: { authorization: `Bearer ${refreshToken}`, accept: "application/json" } });
    } catch {
      throw new ProviderTokenError(false);
    }
    const { status, body } = reply;
    if (status === 200) {
      try {
        const session = readSession(body, now);
        return { accessToken: session.accessToken, refreshToken: session.refreshToken, expiresIn: session.expiresIn, refreshExpiresIn: session.refreshExpiresIn };
      } catch {
        throw new ProviderTokenError(false);
      }
    }
    // Only the service's own word that the session is over ends it; anything else is tried again.
    throw new ProviderTokenError((status === 400 || status === 401) && SESSION_OVER.has(xrpcError(body)));
  };
}

async function deleteBlueskySession(settings, secrets, fetchImpl) {
  if (typeof secrets?.refreshToken !== "string" || !secrets.refreshToken) return false;
  try {
    const response = await fetchImpl(xrpc(settings, "com.atproto.server.deleteSession"), { method: "POST", headers: { authorization: `Bearer ${secrets.refreshToken}`, accept: "application/json" }, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
    return Boolean(response.ok);
  } catch {
    return false;
  }
}
