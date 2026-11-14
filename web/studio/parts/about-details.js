// "Details for the person who set up your site", at the end of About this post: the address
// (editable only while the post was never on the site), old addresses, first published elsewhere,
// the theme, a picture by web address, every kind, the technical facts of a video or research
// post, who wrote it in full (roles, name no one, repair), the keys Studio doesn't edit, and the
// raw truth about the file and how scheduled posts go up. Open or closed is kept for this visit.
import { h } from "./dom.js";
import { otherKeys, slugEditable, slugPreview } from "./about-rules.js";
import { PROFILE_GROUPS } from "./profile-words.js";
import { postDetails } from "./post-details.js";

const OPEN_KEY = "studio-about-details";

const session = {
  get() { try { return globalThis.sessionStorage?.getItem(OPEN_KEY) === "open"; } catch { return false; } },
  set(open) { try { globalThis.sessionStorage?.setItem(OPEN_KEY, open ? "open" : "closed"); } catch { /* not kept */ } },
};

const text = (value) => (Array.isArray(value) ? value.join(", ") : value == null ? "" : String(value));

/**
 * `post()` gives what Details shows of the post now: { state, wasPublished, path, fields, keys,
 * title, facts (postDetails' rows), schedule, publish }. `controls` from about-fields.js.
 */
export function createDetails({ meta, controls, credits, post, setCoverAddress, setKind }) {
  const body = h("div", { class: "studio-about-details-body" });
  const element = h("details", { class: "studio-about-details", open: session.get() },
    h("summary", { class: "studio-about-details-summary", text: "Details for the person who set up your site" }), body);
  element.addEventListener("toggle", () => session.set(element.open));

  function draw() {
    const p = post();
    const fields = p.fields || {};
    const open = slugEditable({ state: p.state, wasPublished: p.wasPublished });
    const preview = h("p", { class: "studio-help studio-mono", "aria-live": "polite" });
    const willBe = (slug) => { preview.textContent = `Will be: ${slugPreview({ siteUrl: meta.siteUrl, postPath: meta.postPath, slug, title: p.title, path: p.path })}`; };
    const address = controls.text("slug", {
      label: "Address on your site", mono: true, readonly: !open, maxlength: 120,
      help: open ? "Leave it empty to make it from the title." : "The address stays as it is once a post may have been on your site, so saved links keep working. It can be changed only in the file.",
      live: willBe,
    });
    willBe(String(address.value || ""));
    const aliases = [...[].concat(fields.aliases || []), ...[].concat(fields.redirectFrom || [])].map(text).filter(Boolean);
    const kinds = (meta.profiles || []).map((profile) => ({ value: profile.id, label: `${profile.label} (${profile.id})` }));
    const group = PROFILE_GROUPS[p.kind];
    const technical = (group?.details || []).map((spec) => controls.text(spec.key, {
      label: spec.label, help: spec.help, rows: spec.control === "rows" ? 3 : 0, maxlength: spec.max,
      inputmode: spec.control === "number" ? "numeric" : undefined, type: spec.control === "url" ? "url" : "text",
    }));
    const others = otherKeys(fields, p.keys);
    const zone = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return ""; } })();
    const serverNow = meta.now ? new Date(meta.now) : null;
    body.replaceChildren(
      h("div", { class: "studio-about-group" }, address, preview,
        aliases.length ? h("div", {}, h("p", { class: "studio-label", text: "Old addresses" }),
          h("ul", { class: "studio-mono studio-about-aliases" }, aliases.map((a) => h("li", { text: a }))),
          h("p", { class: "studio-help", text: "These redirect here. Change them in the file." })) : null),
      controls.text("canonical", { label: "First published somewhere else", type: "url", help: "Only if this post first appeared on another site. Search engines then credit that one." }),
      controls.select("theme", { label: "Theme", options: [{ value: "", label: "Your blog's usual look" }, ...(meta.themes || []).map((t) => ({ value: t.name, label: t.label || t.name }))] }),
      // Set when she leaves the field (the browser's change), not on every letter typed.
      h("text-field", { label: "Picture address", type: "url", description: "A cover photo from another website, by its web address.", value: /^https?:\/\//.test(text(p.cover)) ? text(p.cover) : "",
        onChange: (e) => { const typed = String(e.target?.value || "").trim(); if (!typed || /^https?:\/\/\S+$/i.test(typed)) setCoverAddress?.(typed); } }),
      meta.siteUses?.pinterest ? null : h("div", { class: "studio-about-group" },
        controls.text("cardTitle", { label: "Pin title", maxlength: 300 }),
        controls.text("cardDescription", { label: "Pin description", rows: 3 })),
      // Every kind, by the engine's name; changing it here is the same change as the choice above.
      h("select-field", { label: "Kind (profile)", options: kinds.some((k) => k.value === p.kind) ? kinds : [...kinds, { value: p.kind, label: `${p.kind} (as written)` }], value: p.kind,
        onValuechange: (e) => setKind?.(String(e.detail || "")) }),
      ...technical,
      h("div", { class: "studio-about-group" }, h("p", { class: "studio-label", text: "Who wrote it, in full" }), credits.rolesElement),
      others.length ? h("div", {}, h("p", { class: "studio-label", text: "Also in this post" }),
        h("dl", { class: "studio-details studio-about-others" }, others.flatMap((key) => [h("dt", { class: "studio-mono", text: key }), h("dd", { class: "studio-mono", text: text(fields[key]) })])),
        h("p", { class: "studio-help", text: "Kept exactly as written." })) : null,
      p.facts,
      h("dl", { class: "studio-details" },
        h("dt", { text: "Time zone" }),
        h("dd", { text: `Times are in ${zone || "this computer's time zone"} (this computer).${serverNow && !Number.isNaN(serverNow.getTime()) ? ` Your blog's server said it was ${serverNow.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} when Studio opened.` : ""}` }),
        h("dt", { text: "Search engines" }),
        h("dd", { text: "Only drafts are kept out of search engines. A post can't be hidden from them on its own." })));
  }

  return { element, draw, open() { element.open = true; session.set(true); } };
}

/** The file facts, with how the site goes out and when a scheduled post goes up (G37). */
export function factsFor({ path, link, words, savedAt, layout, publish, goesOut, schedule, nextDue }) {
  return postDetails({ path, link, words, savedAt, layout, publish, goesOut, schedule, nextDue });
}
