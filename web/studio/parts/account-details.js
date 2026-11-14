// Mikey's layer on Your accounts (Studio R2): "Details for {helper}" with
// the permission codes, the redirect address and its Copy, versions, and what came back from an
// attempt. Text only. docs/specs/studio/r2/ux.md.
import { h } from "./dom.js";
import { providerName } from "./share-words.js";
import * as R from "./social-rules.js";
import { say } from "./words.js";

/** Mikey's details: lines of text, and optionally nodes (the redirect address with Copy). */
export function detailsBox(lines, ...nodes) {
  return h("details", { class: "studio-help" }, h("summary", { text: say("common.detailsFor") }),
    h("ul", { class: "studio-mono studio-account-details" }, ...lines.filter(Boolean).map((line) => h("li", { text: line }))), ...nodes);
}

/** A provider's settings, for details: permissions with codes, the redirect, version and the rest. */
export function providerLines(provider) {
  if (!provider) return [];
  return [
    ...R.permissions(provider).map((p) => `${p.scope}: ${p.words}${p.optional ? " (optional)" : ""}`),
    provider.version ? `API version ${provider.version}` : "",
    provider.login === "app-password" ? "Signs in with an app password; no redirect" : `PKCE ${provider.pkce ? "on" : "off"}`,
    provider.provider === "linkedin" ? `Company pages ${provider.organizations ? "asked for" : "not asked for"}` : "",
    provider.provider === "mastodon" ? `Instance ${provider.instance}; visibility ${provider.visibility}; media ${provider.media}` : "",
    provider.provider === "facebook" ? "App Review: until Meta grants Advanced access, Facebook offers Pages only to people with a role on the app. Studio can't read that status." : "",
  ];
}

/** What came back from an attempt, for details. */
export function connectionLines(connection) {
  if (!connection) return [];
  return [
    `connection ${connection.id} ${connection.status}${connection.errorCode ? ` (${connection.errorCode})` : ""}`,
    connection.message ? `message: ${connection.message}` : "",
    connection.grantedScopes?.length ? `granted: ${connection.grantedScopes.join(" ")}` : "",
    ...(connection.notes || []).map((note) => `note ${note.code}: ${note.text}`),
  ];
}

export function redirectRow(provider) {
  if (!provider?.redirectUri) return null;
  const copy = h("action-button", { variant: "secondary", size: "sm", label: `Copy the redirect address for ${providerName(provider.provider)}`,
    onClick: () => navigator.clipboard?.writeText(provider.redirectUri).then(() => { copy.textContent = "Copied"; }, () => { copy.textContent = "Select it and copy"; }) }, "Copy");
  return h("p", { class: "studio-account-redirect" }, h("span", { text: "Redirect address: " }), h("code", { class: "studio-mono", text: provider.redirectUri }), " ", copy);
}

