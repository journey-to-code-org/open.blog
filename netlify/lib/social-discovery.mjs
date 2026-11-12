// Finding where an authorized account may post (epic #353, story #355, ADR 0300). Server-only.
//
// After the handshake the function asks the provider what the grant can reach: the member and the
// organizations they administer on LinkedIn, the Pages they manage on Facebook. Eligibility is
// never guessed. A destination is `eligible` only when the provider said so: the permission was
// granted AND, for a Page, the person's role on it includes content creation; for an organization,
// the person is an approved administrator. Where the provider cannot say (Facebook's App Review
// status; a Page whose roles it did not report) the destination is not offered and the reason
// says what could not be verified. A provider refusing the organization lookup is reported as its
// own state, not as "no organizations".
//
// Secrets: Page access tokens come back in the same reply as the Page list. They are returned in
// `secrets` (to be sealed) and never in `destinations`, which is stored plain and shown to Admin.

import { ProviderError, providerJson } from "./social-providers.mjs";

export const MAX_DESTINATIONS = 50;
// A Mastodon account id: opaque, but Mastodon and its forks use short ids of these characters.
export const MASTODON_ACCOUNT_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_ORGANIZATIONS = 25;

// Reasons a destination is not offered, and the notes about what could not be checked. Fixed text.
export const REASONS = Object.freeze({
  "missing-scope": "A permission needed to post here was not granted.",
  "not-administrator": "LinkedIn did not list you as an approved administrator of this organization.",
  "no-posting-role": "Your role on this Page does not let you create posts.",
  "role-unverified": "Facebook did not say what you may do on this Page, so it cannot be offered.",
  "no-page-token": "Facebook gave no access for this Page.",
  "account-inactive": "Bluesky says this account is not active (deactivated, suspended or taken down), so it cannot post.",
  "account-suspended": "Mastodon says this account is suspended, so it cannot post.",
});

export const NOTES = Object.freeze({
  "organizations-not-requested": "Organizations were not requested. Set OPENBLOG_SOCIAL_LINKEDIN_ORGANIZATIONS=true to ask for them; LinkedIn must have approved the Community Management API for the app.",
  "organizations-not-granted": "LinkedIn did not grant the organization permissions, so no organization is offered.",
  "organizations-not-approved": "LinkedIn refused the organization lookup. The app is probably not approved for the Community Management API; no organization is offered.",
  "organizations-unavailable": "LinkedIn could not list organizations just now. Reconnect to try again.",
  "organizations-truncated": "More organizations exist than are shown.",
  "no-organizations": "LinkedIn lists no organization that you administer.",
  "no-pages": "Facebook lists no Page that you manage.",
  "pages-truncated": "More Pages exist than are shown.",
  "instance-unavailable": "The Mastodon instance did not say what it accepts just now. Its limits are read again before every post.",
  "instance-limit-low": "This Mastodon instance takes fewer than 500 characters per post, so a long caption will be refused when it is sent.",
  "statuses-not-readable": "Reading statuses was not granted, so a post whose outcome was not seen cannot be looked up and goes to you to check.",
  "media-not-granted": "Uploading media was not granted, so the cover image is not attached; Mastodon shows its own link preview instead.",
  "app-review-unverified": "Meta's App Review status cannot be read from the API. Until the app has Advanced access for these permissions, only people with a role on the app can post to Pages; confirm in the Meta app dashboard.",
});

// Provider names are shown in Admin. Strip control and bidirectional-override characters and bound the length.
export function cleanName(value, fallback) {
  const name = String(value ?? "").replace(/[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g, "").replace(/\s+/g, " ").trim().slice(0, 200);
  return name || fallback;
}

const headers = (token, extra = {}) => ({ authorization: `Bearer ${token}`, accept: "application/json", ...extra });

async function linkedin(settings, tokens, fetchImpl) {
  const granted = new Set(tokens.granted);
  const me = await providerJson(fetchImpl, `${settings.apiBase}/v2/userinfo`, { headers: headers(tokens.accessToken) });
  if (typeof me.sub !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(me.sub)) throw new ProviderError("provider-invalid");
  const destinations = [{ id: `urn:li:person:${me.sub}`, kind: "member", name: cleanName(me.name, "LinkedIn member"), eligible: granted.has("w_member_social"), reason: granted.has("w_member_social") ? null : "missing-scope" }];
  const notes = [];
  if (!settings.scopes.includes("r_organization_admin")) {
    notes.push("organizations-not-requested");
  } else if (!granted.has("r_organization_admin")) {
    notes.push("organizations-not-granted");
  } else {
    const version = { "linkedin-version": settings.version, "x-restli-protocol-version": "2.0.0" };
    let acls;
    try {
      acls = await providerJson(fetchImpl, `${settings.apiBase}/rest/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED&count=${MAX_ORGANIZATIONS + 1}`, { headers: headers(tokens.accessToken, version) });
    } catch (error) {
      if (!(error instanceof ProviderError)) throw error;
      // 401/403 is the provider saying this app or grant may not ask. Anything else is "try later".
      notes.push(error.status === 401 || error.status === 403 ? "organizations-not-approved" : "organizations-unavailable");
      return { destinations, notes, secrets: {} };
    }
    const urns = [...new Set((Array.isArray(acls.elements) ? acls.elements : []).map((element) => element?.organization).filter((urn) => typeof urn === "string" && /^urn:li:organization:\d{1,20}$/.test(urn)))];
    if (!urns.length) notes.push("no-organizations");
    if (urns.length > MAX_ORGANIZATIONS) notes.push("organizations-truncated");
    for (const urn of urns.slice(0, MAX_ORGANIZATIONS)) {
      const organizationId = urn.split(":").pop();
      let name = null;
      try {
        const organization = await providerJson(fetchImpl, `${settings.apiBase}/rest/organizations/${organizationId}`, { headers: headers(tokens.accessToken, version) });
        name = organization.localizedName;
      } catch (error) {
        if (!(error instanceof ProviderError)) throw error;
      }
      const canPost = granted.has("w_organization_social");
      destinations.push({ id: urn, kind: "organization", name: cleanName(name, `Organization ${organizationId}`), eligible: canPost, reason: canPost ? null : "missing-scope" });
    }
  }
  return { destinations, notes, secrets: {} };
}

async function facebook(settings, tokens, fetchImpl) {
  const granted = new Set(tokens.granted);
  const reply = await providerJson(fetchImpl, `${settings.apiBase}/me/accounts?fields=id,name,tasks,access_token&limit=100`, { headers: headers(tokens.accessToken) });
  const pages = Array.isArray(reply.data) ? reply.data : [];
  const notes = ["app-review-unverified"];
  const secrets = {};
  const destinations = [];
  for (const page of pages.slice(0, MAX_DESTINATIONS)) {
    if (!page || typeof page.id !== "string" || !/^\d{1,30}$/.test(page.id)) continue;
    let reason = null;
    if (!granted.has("pages_manage_posts")) reason = "missing-scope";
    else if (!Array.isArray(page.tasks)) reason = "role-unverified";
    else if (!page.tasks.includes("CREATE_CONTENT")) reason = "no-posting-role";
    else if (typeof page.access_token !== "string" || !page.access_token) reason = "no-page-token";
    if (!reason) secrets[page.id] = page.access_token;
    destinations.push({ id: page.id, kind: "page", name: cleanName(page.name, `Page ${page.id}`), eligible: reason === null, reason });
  }
  if (!destinations.length) notes.push("no-pages");
  if (reply.paging?.next || pages.length > MAX_DESTINATIONS) notes.push("pages-truncated");
  return { destinations, notes, secrets };
}

// A Bluesky session belongs to exactly one account, which createSession named and the service
// vouched for: that account is the only destination, offered only while the service says it is active.
function bluesky(tokens) {
  const name = tokens.handle ? `@${tokens.handle}` : tokens.did;
  return { destinations: [{ id: tokens.did, kind: "account", name: cleanName(name, "Bluesky account"), eligible: tokens.active, reason: tokens.active ? null : "account-inactive" }], notes: [], secrets: {} };
}

// A Mastodon token belongs to the one account that signed in at the instance (verify_credentials
// needs read:accounts): that account is the only destination, offered unless Mastodon says it is
// suspended. The instance's public configuration (GET /api/v2/instance, Mastodon 4.0+) is read only
// for what the author should know now; the adapter reads it again before every post.
async function mastodon(settings, tokens, fetchImpl) {
  const me = await providerJson(fetchImpl, `${settings.apiBase}/api/v1/accounts/verify_credentials`, { headers: headers(tokens.accessToken) });
  if (typeof me.id !== "string" || !MASTODON_ACCOUNT_ID.test(me.id)) throw new ProviderError("provider-invalid");
  const username = typeof me.username === "string" && /^[A-Za-z0-9_]{1,64}$/.test(me.username) ? me.username : null;
  const host = new URL(settings.instance).host;
  const suspended = me.suspended === true;
  const notes = [];
  const granted = new Set(tokens.granted);
  const has = (scope) => granted.has(scope) || granted.has(scope.split(":")[0]);
  if (!has("read:statuses")) notes.push("statuses-not-readable");
  if (settings.media === "cover" && !has("write:media")) notes.push("media-not-granted");
  try {
    const instance = await providerJson(fetchImpl, `${settings.apiBase}/api/v2/instance`, { headers: { accept: "application/json" } });
    const max = Number(instance?.configuration?.statuses?.max_characters);
    if (Number.isInteger(max) && max > 0 && max < 500) notes.push("instance-limit-low");
  } catch (error) {
    if (!(error instanceof ProviderError)) throw error;
    notes.push("instance-unavailable");
  }
  const name = username ? `@${username}@${host}` : `Mastodon account on ${host}`;
  return { destinations: [{ id: me.id, kind: "account", name: cleanName(name, "Mastodon account"), eligible: !suspended, reason: suspended ? "account-suspended" : null }], notes, secrets: {} };
}

// Lists the destinations a grant can reach. Resolves to { destinations, notes, secrets } or throws a ProviderError.
export function discover(settings, tokens, fetchImpl) {
  if (settings.provider === "bluesky") return Promise.resolve(bluesky(tokens));
  if (settings.provider === "mastodon") return mastodon(settings, tokens, fetchImpl);
  return settings.provider === "linkedin" ? linkedin(settings, tokens, fetchImpl) : facebook(settings, tokens, fetchImpl);
}
