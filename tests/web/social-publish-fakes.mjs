// A scripted provider for the social publishing adapter tests. It records every request and
// answers from a fixed reply, so no test that uses it can reach a real network.
import { socialProviders } from "../../netlify/lib/social-providers.mjs";
import { env } from "./social-oauth-fakes.mjs";

export const LI_TOKEN = "AQX-publish-access-token-0001";
export const PAGE_TOKEN = "EAApage-publish-token-0002";
export const providers = (overrides) => socialProviders(env(overrides));

export function scripted(reply) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method, headers: { ...init.headers }, body: init.body, redirect: init.redirect, hasSignal: Boolean(init.signal) });
    const next = typeof reply === "function" ? reply(calls.length, String(url), init) : reply;
    if (next instanceof Error) throw next;
    const body = next.body === undefined ? null : typeof next.body === "string" ? next.body : JSON.stringify(next.body);
    return new Response(body, { status: next.status, headers: next.headers });
  };
  return { fetchImpl, calls };
}

export const post = (overrides = {}) => ({
  provider: "linkedin",
  destination: { id: "urn:li:person:abc123", kind: "member" },
  caption: "A new post is up.",
  url: "https://blog.example.com/posts/hello/",
  title: "Hello",
  ...overrides,
});
