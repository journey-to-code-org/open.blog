// When it's shared (Studio R7): the real card Facebook, text messages and other apps show for a
// post, drawn from the server's `preview.social` as text in a figure, with its notes (no summary,
// a long summary, no picture). Without a signal it is R5's rough card, said to be rough. Used by
// Before you publish and by About this post. Every value is text; the picture loads only from the
// blog itself or an https address, with no referrer.
import { h } from "./dom.js";
import { say } from "./words.js";
import { cardAddress, cardImageSrc, cardNotes } from "./ready-rules.js";

let made = 0;

/** `onNote(target)` runs a note's button ("summary" or "cover"). */
export function createShareCard({ meta, onNote = () => {} }) {
  const id = `studio-share-card-${++made}`;
  const image = h("img", { class: "studio-share-card-img", alt: "", referrerpolicy: "no-referrer", hidden: true });
  const site = h("p", { class: "studio-share-card-site" });
  const title = h("p", { class: "studio-share-card-title" });
  const description = h("p", { class: "studio-share-card-description" });
  const address = h("p", { class: "studio-share-card-address" });
  const caption = h("figcaption", { class: "studio-visually-hidden", text: say("ready.cardCaption") });
  const figure = h("figure", { class: "studio-share-card", "aria-labelledby": `${id}-caption` },
    image, h("div", { class: "studio-share-card-text" }, site, title, description, address), caption);
  caption.id = `${id}-caption`;
  const roughHeading = h("p", { class: "studio-label", hidden: true, text: say("ready.cardRoughHeading") });
  const help = h("p", { class: "studio-help" });
  const notes = h("ul", { class: "studio-share-notes" });
  const failed = h("p", { class: "studio-help", hidden: true, text: say("ready.cardPictureFailed") });
  const element = h("div", { class: "studio-share" }, roughHeading, figure, failed, help, notes);
  let loading = false;

  image.addEventListener("error", () => {
    image.hidden = true;
    failed.hidden = false;
  });

  function picture(src, alt) {
    failed.hidden = true;
    if (!src) { image.hidden = true; image.removeAttribute("src"); return; }
    image.alt = String(alt || "");
    if (image.getAttribute("src") !== src) image.src = src;
    image.hidden = false;
  }

  function drawNotes(list) {
    notes.replaceChildren(...list.map((note) => h("li", {}, h("span", { text: note.words }), " ",
      note.button ? h("action-button", { variant: "link", label: note.button, onClick: () => onNote(note.target) }, note.button) : null)));
    notes.hidden = !list.length;
  }

  return {
    element,
    /** The real card from `preview.social`; `fields` are the post's summary and cover as they stand. */
    show(social, fields = {}) {
      loading = false;
      figure.classList.remove("studio-share-card-rough", "studio-share-card-loading");
      roughHeading.hidden = true;
      site.textContent = String(social?.siteName || "");
      site.hidden = !site.textContent;
      title.textContent = String(social?.title || "");
      description.textContent = String(social?.description || "");
      address.textContent = cardAddress(social?.url || "");
      picture(cardImageSrc(social?.image, meta?.siteUrl), social?.imageAlt);
      help.textContent = say("ready.cardHelp");
      drawNotes(cardNotes(social, fields));
    },
    /** R5's rough card, from what Write has, said to be rough. */
    rough({ title: name = "", summary = "", address: where = "", cover = "", coverAlt = "", auto = false } = {}, { blocked = false } = {}) {
      loading = false;
      figure.classList.remove("studio-share-card-loading");
      figure.classList.add("studio-share-card-rough");
      roughHeading.hidden = false;
      site.hidden = true;
      title.textContent = name || say("ready.cardYourTitle");
      description.textContent = summary || say("ready.cardFirstLines");
      description.classList.toggle("studio-share-card-auto", auto || !summary);
      address.textContent = where;
      picture(cardImageSrc(cover, meta?.siteUrl) || (String(cover).startsWith("blob:") ? cover : ""), coverAlt);
      help.textContent = blocked ? say("ready.cardRoughFixFirst") : say("ready.cardRough");
      drawNotes([]);
    },
    /** While the server is asked: the card stays, dimmed, until the answer. */
    loading() { loading = true; figure.classList.add("studio-share-card-loading"); },
    get isLoading() { return loading; },
  };
}
