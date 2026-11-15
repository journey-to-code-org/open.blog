// Strangers' words on the screen: always text (never markup, never a link they chose, never
// autolinked), direction-isolated so a right-to-left or control character can't reorder Studio's own
// words, and clamped when long. A link a reader sent shows in full as text with Copy and Open; Open is
// a link only for http(s), with no referrer, and says nothing checked it. Studio R10.
import { h } from "./dom.js";
import { say } from "./words.js";

export const LONG = 600;

/** A stranger's name or short line as an isolated inline element. */
export function strangerInline(text, tag = "span") {
  return h(tag, { class: "studio-stranger", dir: "auto", text: String(text ?? "") });
}

/** A stranger's paragraphs; past `LONG` letters it is clamped with Read all. */
export function strangerBody(text) {
  const value = String(text ?? "");
  const body = h("div", { class: "studio-comment-body studio-stranger", dir: "auto" }, ...value.split(/\n{2,}/).map((p) => h("p", { text: p })));
  if (value.length <= LONG) return body;
  body.classList.add("studio-comment-clamped");
  const read = h("button", { type: "button", class: "studio-link-button", "aria-expanded": "false", text: say("readers.readAll") });
  read.addEventListener("click", () => {
    const clamped = body.classList.toggle("studio-comment-clamped");
    read.setAttribute("aria-expanded", String(!clamped));
    read.textContent = clamped ? say("readers.readAll") : say("readers.showLess");
  });
  return h("div", {}, body, read);
}

/** Only http and https may be opened. */
export const openable = (url) => {
  try {
    return ["http:", "https:"].includes(new URL(String(url)).protocol);
  } catch {
    return false;
  }
};

/** A cut for a label: names in `aria-label`s stop at 80 letters. */
export const cut80 = (value) => {
  const text = String(value ?? "");
  return text.length > 80 ? `${text.slice(0, 79)}…` : text;
};
