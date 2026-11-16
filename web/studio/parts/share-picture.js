// The picture that goes with a share (#656, ADRs 0426-0427): for each chosen Bluesky, LinkedIn or
// Facebook account, Show the picture asks the server for exactly what would go (the post's cover,
// made smaller for Bluesky) and its description, shows them, and only then offers "Send this picture".
// What she saw is what goes: the approval the server returned rides with the share, and the hosted
// function checks the picture again before it posts. Changing the post or what happens if it can't
// go takes the approval back. The picture comes as a data: image the page shows as a picture only.
import { h } from "./dom.js";
import { say } from "./words.js";
import { accountLabel } from "./share-words.js";

const WITH_PICTURE = ["bluesky", "linkedin", "facebook"];

/** What went wrong getting a picture, in her words. */
export function pictureTrouble(error) {
  const code = error?.data?.code || "";
  if (code === "media-too-large") return say("picture.tooBig");
  if (code === "invalid-media") return say("picture.none");
  if (error?.status === 404 || error?.status === 501 || code === "media-unavailable") return say("picture.notYet");
  return say("picture.trouble");
}

/** Whether a picture can go to this account at all. */
export const takesPicture = (destination) => WITH_PICTURE.includes(destination?.provider);

/**
 * `accounts()` is the chosen destinations, `work()` the chosen post. Returns `{ element, draw(),
 * media(accountId), reset() }`: `media` is the approval to send, or null.
 */
export function createSharePictures({ api, accounts, work }) {
  const element = h("section", { class: "studio-share-pictures", "aria-labelledby": "studio-share-pictures-h" });
  const state = new Map(); // account id → { fallback, preview, send, ticket }
  let forWork = null;

  function entry(id) {
    if (!state.has(id)) state.set(id, { fallback: "text", preview: null, send: false, ticket: 0, trouble: "" });
    return state.get(id);
  }

  function reset() {
    for (const one of state.values()) Object.assign(one, { preview: null, send: false, trouble: "", ticket: one.ticket + 1 });
  }

  function draw() {
    if (forWork !== work()) { forWork = work(); reset(); }
    const chosen = accounts().filter(takesPicture);
    element.hidden = !chosen.length;
    element.replaceChildren(
      h("h3", { id: "studio-share-pictures-h", class: "studio-label", text: say("picture.title") }),
      h("p", { class: "studio-help", text: say("picture.lede") }),
      ...chosen.map(row));
  }

  function row(destination) {
    const one = entry(destination.id);
    const name = accountLabel(destination);
    const bluesky = destination.provider === "bluesky";
    const ifNot = bluesky ? null : h("select-field", { label: say("picture.ifNot"), value: one.fallback,
      options: [{ value: "text", label: say("picture.ifNotText") }, { value: "stop", label: say("picture.ifNotStop") }],
      onValuechange: (e) => { one.fallback = String(e.detail || "text"); Object.assign(one, { preview: null, send: false, ticket: one.ticket + 1 }); draw(); } });
    const show = h("action-button", { variant: "secondary", label: say("picture.showLabel", { account: name }), onClick: (e) => look(destination, e.currentTarget) }, say("picture.show"));
    const seen = one.preview;
    const src = String(seen?.imageDataUrl || "");
    const description = String(seen?.media?.snapshot?.description || "");
    const shown = seen && /^data:image\/(png|jpeg|gif|webp);base64,/.test(src) ? [
      h("img", { class: "studio-share-picture", src, alt: description }),
      h("p", { class: "studio-help", text: say("picture.described", { description }) }),
      h("p", { class: "studio-help", text: bluesky ? say("picture.blueskyNoWords") : say("picture.wordsGo") }),
      bluesky && seen.media?.snapshot?.version === 2 ? h("p", { class: "studio-help", text: say("picture.blueskySmaller") }) : null,
      destination.provider === "facebook" ? h("p", { class: "studio-help", text: say("picture.facebookCheck") }) : null,
      h("toggle-switch", { label: say("picture.send", { account: name }), checked: one.send, onCheckedchange: (e) => { one.send = Boolean(e.target?.checked ?? e.detail); } }),
    ] : [];
    return h("div", { class: "studio-share-picture-row", "data-account": destination.id },
      h("p", { class: "studio-label", text: say("picture.for", { account: name }) }),
      ifNot, show, one.trouble ? h("p", { class: "studio-help", role: "status", text: one.trouble }) : null, ...shown);
  }

  async function look(destination, button) {
    const one = entry(destination.id);
    const ticket = ++one.ticket;
    Object.assign(one, { preview: null, send: false, trouble: "" });
    button.loading = true;
    try {
      const answer = await api.post("social/announcements/media-preview", { accountId: destination.id, work: work(), ...(destination.provider === "bluesky" ? {} : { fallback: one.fallback }) });
      if (ticket !== one.ticket) return;
      one.preview = answer;
    } catch (error) {
      if (error.status === 401) throw error;
      if (ticket === one.ticket) one.trouble = pictureTrouble(error);
    } finally {
      button.loading = false;
    }
    draw();
    element.querySelector(`[data-account="${CSS.escape(destination.id)}"] img`)?.scrollIntoView?.({ block: "nearest" });
  }

  return {
    element,
    draw,
    reset,
    /** The approval to send with this account's share, when she chose to send the picture she saw. */
    media: (accountId) => {
      const one = state.get(accountId);
      return one?.send && one.preview?.media && forWork === work() ? one.preview.media : null;
    },
  };
}
