// <ob-conversation> (ADR 0178): progressive enhancement for the conversation after an author's
// section. The page is complete without this script: the reader's reflections and the author's
// response are static, labelled HTML that follows the author's words, in order. With it, a long
// conversation (more than COLLAPSE_AFTER reflections) starts folded behind one native button, so a
// reader who only wants the article is not made to scroll past it. The button names what it shows,
// reports its state with `aria-expanded` and controls the list. A link to anything inside the
// conversation, such as an abuse-report page link or a shared address, opens it. Nothing is moved,
// removed, scored or fetched, and no animation runs.

export const COLLAPSE_AFTER = 3;

/** Whether a conversation of `count` reflections starts folded. */
export function startsFolded(count) {
  return Number.isInteger(count) && count > COLLAPSE_AFTER;
}

/** The toggle's visible name for a state: it says what it will do, and how many. */
export function toggleLabel(count, expanded) {
  return expanded
    ? `Hide the ${count} reader reflections on this section`
    : `Show the ${count} reader reflections on this section`;
}

class ObConversation extends HTMLElement {
  connectedCallback() {
    if (this.hasAttribute("data-enhanced")) return;
    const aside = this.querySelector(".ob-conversation");
    const list = this.querySelector(".ob-conversation-list");
    if (!aside || !list) return;
    const count = list.children.length;
    if (!startsFolded(count)) return;
    this.setAttribute("data-enhanced", "");
    if (!list.id) list.id = `${aside.id || "ob-conversation"}-list`;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ob-conversation-toggle";
    button.setAttribute("aria-controls", list.id);
    const set = (expanded) => {
      list.hidden = !expanded;
      button.setAttribute("aria-expanded", String(expanded));
      button.textContent = toggleLabel(count, expanded);
    };
    const targeted = () => {
      let id = "";
      try {
        id = decodeURIComponent(location.hash.slice(1));
      } catch {
        return null;
      }
      const target = id ? document.getElementById(id) : null;
      return target && list.contains(target) ? target : null;
    };
    // A link into the folded list opens it and brings the target into view, because the browser
    // could not scroll to something that was hidden when it followed the link.
    const reveal = () => {
      const target = targeted();
      if (!target) return false;
      set(true);
      target.scrollIntoView({ block: "start" });
      return true;
    };
    button.addEventListener("click", () => set(list.hidden));
    addEventListener("hashchange", reveal);
    list.before(button);
    set(false);
    reveal();
  }
}

if (!customElements.get("ob-conversation")) {
  customElements.define("ob-conversation", ObConversation);
}
