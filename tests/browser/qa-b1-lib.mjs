import { expect } from "@playwright/test";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
export const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
export const SHOTS = "/tmp/qa-b1-shots";
export function tree(dir, skip = () => false, base = dir, out = {}) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name); const rel = p.slice(base.length + 1);
    if (skip(rel)) continue;
    const s = statSync(p);
    if (s.isDirectory()) tree(p, skip, base, out); else out[rel] = createHash("sha1").update(readFileSync(p)).digest("hex").slice(0, 12);
  }
  return out;
}
export function diff(a, b) {
  const out = [];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (a[k] !== b[k]) out.push(`${a[k] ? (b[k] ? "changed" : "removed") : "added"} ${k}`);
  return out;
}
export async function login(site, user = "sam") {
  const r = await fetch(`${site.origin}/admin/api/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: user, password: site.password }) });
  const cookie = r.headers.get("set-cookie").split(";")[0];
  const token = (await r.json()).csrf;
  const call = async (method, path, body, headers = {}) => {
    const res = await fetch(`${site.origin}/admin/api/${path}`, { method, headers: { Cookie: cookie, "X-CSRF-Token": token, ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers }, body: body !== undefined ? JSON.stringify(body) : undefined });
    const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch {}
    return { status: res.status, text, json, headers: res.headers };
  };
  return { cookie, token, call };
}
/** axe on the whole page + sideways scroll; returns problems (never throws). */
export async function audit(page, label) {
  await page.evaluate(axeSource);
  const v = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] } })).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ") + (n.any?.[0]?.message ? ` [${n.any[0].message.slice(0, 90)}]` : "")).slice(0, 4).join(" | ")}`));
  const scroll = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const out = [...v.map((x) => `${label}: axe ${x}`)];
  if (scroll > 0) out.push(`${label}: sideways scroll by ${scroll}px at ${await page.evaluate(() => innerWidth)}`);
  if (out.length) await page.screenshot({ path: `${SHOTS}/${label.replace(/[^a-z0-9]+/gi, "-")}.png`, fullPage: true });
  return out;
}
/** Visible text of the page including shadow roots. */
export async function allText(page) {
  return page.evaluate(() => { const parts = []; const walk = (root) => { for (const n of root.querySelectorAll("*")) { if (n.shadowRoot) walk(n.shadowRoot); for (const a of ["aria-label", "title", "placeholder", "alt"]) if (n.hasAttribute(a)) parts.push(n.getAttribute(a)); } }; parts.push(document.body.innerText); walk(document); return parts.join("\n"); });
}
export const BANNED = /\b(Studio|Admin|deploy|upload|sync|offline|queue|storage|push|subscription|PWA|service worker|permission|endpoint|device|slug|front matter|metadata|canonical|noindex|SEO|markdown|shortcode|syntax|snippet|embed|iframe|HTML|callout|alt text|OpenGraph|readiness|audit|WCAG|GPX|validator|provider|model|API key|credential|token|completion|autocomplete|snapshot|severity|session|catalog|provenance|diff|revision|hex|contrast ratio|theme|onboarding|flag|environment|rehearse|transcribe|transcript|Grammi|Mikey|JSON|Git)\b/g;
/** Banned words on her layer: visible text with every <details> closed excluded. */
export async function herWords(page) {
  const text = await page.evaluate(() => { const clone = document.body.cloneNode(true); clone.querySelectorAll("details:not([open]) > :not(summary)").forEach((n) => n.remove()); return [document.body.innerText].join("\n"); });
  return [...new Set((text.match(BANNED) || []))];
}
