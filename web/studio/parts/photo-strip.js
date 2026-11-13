// The photos in a box of her words, shown as photos. In the box itself a photo is kept as a line
// like ![Pie cooling](/images/uploads/…): the strip says that's her photo, and lets her take one
// out without touching the code.
import { h } from "./dom.js";

const PHOTO = /^!\[((?:\\.|[^\]\\])*)\]\((\/images\/uploads\/[^)\s]+)\)[ \t]*$/;

/** The photos in some text, in order: { alt, url, line } (line counts from 0). DOM-free, tested. */
export function photosIn(text) {
  return String(text || "").split("\n").flatMap((line, index) => {
    const match = PHOTO.exec(line.trim());
    return match ? [{ alt: match[1].replace(/\\(.)/g, "$1"), url: match[2], line: index }] : [];
  });
}

/** The text without one photo's line (and the blank line it leaves). DOM-free, tested. */
export function withoutPhoto(text, line) {
  const lines = String(text || "").split("\n");
  lines.splice(line, 1);
  if (line > 0 && line < lines.length && !lines[line - 1].trim() && !lines[line].trim()) lines.splice(line, 1);
  // A photo at the very end leaves no blank line behind it.
  if (line === lines.length) while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return lines.join("\n");
}

/** A strip under a text box. Call `update(text)` after every change. */
export function photoStrip({ onRemove }) {
  const list = h("ul", { class: "studio-photo-strip", "aria-label": "Photos in this box" });
  const element = h("div", { class: "studio-photo-strip-wrap", hidden: true },
    h("p", { class: "studio-help", text: "Your photos. In the box above, each one is the line starting with ![ — leave it as it is, or take it out here." }),
    list);
  let shown = "";
  return {
    element,
    update(text) {
      const photos = photosIn(text);
      const key = JSON.stringify(photos);
      if (key === shown) return;
      shown = key;
      element.hidden = !photos.length;
      list.replaceChildren(...photos.map((photo) => h("li", { class: "studio-photo-chip" },
        h("img", { src: photo.url, alt: "" }),
        h("span", { text: photo.alt || "A photo" }),
        h("action-button", { variant: "ghost", size: "sm", onClick: () => onRemove(photo) },
          "Take it out", h("span", { class: "studio-visually-hidden", text: `: ${photo.alt || "this photo"}` })))));
    },
  };
}
