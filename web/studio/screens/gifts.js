// Gifts: what the family left under her tree. Before Christmas each one is a wrapped box with who
// it's from; on Christmas morning she opens them one at a time and reads the note or sees the card.
// She chooses whether the tree shows givers' names (only theirs who said yes). A gift can be taken
// off the tree; it's kept here, never deleted. Studio slice 3b.
import { fill, h, toast } from "../parts/dom.js";
import { use } from "../zubra.js";
import { ask } from "../parts/dialogs.js";
import { drawCard } from "../parts/gift-card.js";

const DAY = 24 * 60 * 60 * 1000;
const WRAP_WORDS = { red: "red paper", green: "green paper", gold: "gold paper", blue: "blue paper", plaid: "plaid paper", stripes: "striped paper" };

/** The top line, in her words. Exported for tests. */
export function giftsHeadline(gifts, opensAt, now = Date.now()) {
  const waiting = gifts.filter((g) => !g.opened);
  const count = (n) => (n === 1 ? "1 gift" : `${n} gifts`);
  if (!gifts.length) return "No gifts under your tree yet";
  if (!waiting.length) return gifts.length === 1 ? "You've opened your gift" : `You've opened all ${gifts.length} gifts`;
  if (waiting.some((g) => g.canOpen)) return `Merry Christmas! ${count(waiting.filter((g) => g.canOpen).length)} to open`;
  const days = Math.ceil((Date.parse(opensAt) - now) / DAY);
  const when = days <= 1 ? "tomorrow morning" : `in ${days} days`;
  return `${count(waiting.length)} waiting under your tree. You can open ${waiting.length === 1 ? "it" : "them"} Christmas morning, ${when}.`;
}

/** Whose gift it is and how the tree shows it. Exported for tests. */
export function fromWords(gift, showNames) {
  if (!gift.showName) return "Only you see this name";
  return showNames ? "Their name shows on your tree" : "Their name would show on your tree, but names are off";
}

export async function createGifts({ api }) {
  await use("toggle-switch", "action-button", "alert-banner", "empty-state", "skeleton-block", "status-badge");
  let state = null;
  const heading = h("h2", { id: "studio-gifts-h", class: "studio-question", tabindex: "-1" });
  const banner = h("div", { class: "studio-banner", "aria-live": "polite" });
  const names = h("toggle-switch", {
    label: "Show who each gift is from on your tree",
    description: "Only for people who said that's OK. You always see every name here.",
    onCheckedchange: (e) => setNames(e.detail),
  });
  const list = h("ul", { class: "studio-gift-list", "aria-labelledby": "studio-gifts-h", "aria-busy": "true" }, h("li", {}, h("skeleton-block", { lines: 3 })));
  const element = h("section", { class: "studio-page studio-gifts", "aria-labelledby": "studio-gifts-h" },
    h("div", { class: "studio-today" }, heading, h("p", { class: "studio-lede", text: "The family leaves these on your site. Everything in them stays private until you open it." }), names),
    banner, list);

  const label = (gift) => `${gift.kind === "card" ? "A card" : "A note"} from ${gift.from}`;

  function giftRow(gift) {
    const box = h("span", { class: `studio-gift-box studio-wrap-${gift.wrap}`, "aria-hidden": "true" });
    const title = h("h3", { class: "studio-gift-from", text: gift.from });
    const facts = h("p", { class: "studio-help", text: `${gift.kind === "card" ? "A card" : "A note"}, wrapped in ${WRAP_WORDS[gift.wrap] || "paper"}. ${fromWords(gift, state.showNames)}.` });
    const row = h("li", { class: "studio-gift", "data-id": gift.id }, box, h("div", { class: "studio-gift-body" }, title, facts));
    const body = row.querySelector(".studio-gift-body");
    if (gift.opened) {
      box.classList.add("studio-gift-open");
      if (gift.kind === "note") body.append(h("blockquote", { class: "studio-gift-note", text: gift.note }));
      else body.append(drawCard(gift.card, { label: `${label(gift)}: ${gift.card.message}${gift.card.signOff ? `, signed ${gift.card.signOff}` : ""}` }));
    } else if (gift.canOpen) {
      body.append(h("action-button", { onClick: () => open(gift) }, `Open ${gift.from}'s gift`));
    } else {
      body.append(h("status-badge", { variant: "neutral" }, "Wrapped until Christmas"));
    }
    if (gift.onTree) {
      body.append(h("action-button", { variant: "ghost", size: "sm", class: "studio-gift-hide", onClick: () => hide(gift) }, "Take it off the tree"));
    } else {
      body.append(h("p", { class: "studio-help", text: "Not on your tree. It's kept here." }));
    }
    return row;
  }

  function draw() {
    heading.textContent = giftsHeadline(state.gifts, state.opensAt);
    names.checked = state.showNames;
    list.removeAttribute("aria-busy");
    if (!state.gifts.length) {
      fill(list, h("li", {}, h("empty-state", { heading: "Nothing yet" }, "When someone in the family leaves you a gift on your site, it shows up here, wrapped.")));
      return;
    }
    // Ready to open first, then still wrapped, then opened.
    const order = (g) => (g.opened ? 2 : g.canOpen ? 0 : 1);
    fill(list, ...[...state.gifts].sort((a, b) => order(a) - order(b) || a.createdAt.localeCompare(b.createdAt)).map(giftRow));
  }

  const trouble = (heading, error) => banner.replaceChildren(h("alert-banner", { variant: "danger", heading }, error.status ? error.message : "Check your connection and try again."));

  async function open(gift) {
    try {
      const { gift: opened } = await api.post(`gifts/${gift.id}/open`, {});
      state.gifts = state.gifts.map((g) => (g.id === opened.id ? opened : g));
      banner.replaceChildren();
      draw();
      requestAnimationFrame(() => list.querySelector(`[data-id="${opened.id}"] .studio-gift-from`)?.focus?.());
      toast(`You opened ${opened.from}'s gift.`);
    } catch (error) {
      if (error.status === 423) return trouble("Not yet", { status: 423, message: "It's still wrapped. Gifts open on Christmas morning." });
      trouble(`${gift.from}'s gift didn't open`, error);
    }
  }

  async function hide(gift) {
    const choice = await ask({
      heading: `Take ${gift.from}'s gift off the tree?`,
      text: "Nobody will see it under your tree anymore. It stays here, and you can still open it on Christmas.",
      choices: [{ label: "Take it off the tree", value: "hide" }, { label: "Leave it there", value: "keep", variant: "secondary" }],
    });
    if (choice !== "hide") return;
    try {
      const { gift: hidden } = await api.post(`gifts/${gift.id}/hide`, {});
      state.gifts = state.gifts.map((g) => (g.id === hidden.id ? hidden : g));
      draw();
      toast(`${gift.from}'s gift is off the tree. It's still here.`);
    } catch (error) {
      trouble("That didn't work", error);
    }
  }

  async function setNames(show) {
    try {
      state.showNames = (await api.post("gifts/settings", { showNames: show })).showNames;
      draw();
      toast(show ? "Names show on your tree for people who said OK." : "Your tree doesn't show names now.");
    } catch (error) {
      names.checked = state.showNames;
      trouble("That didn't change", error);
    }
  }

  async function load() {
    try {
      state = await api.get("gifts/list");
      banner.replaceChildren();
      draw();
    } catch (error) {
      list.removeAttribute("aria-busy");
      fill(list);
      banner.replaceChildren(h("alert-banner", { variant: "danger", heading: "Your gifts didn't load" }, error.status ? error.message : "Check your connection.",
        h("action-button", { variant: "secondary", onClick: load }, "Try again")));
    }
  }

  return {
    title: "Gifts",
    element,
    load,
    reload: load,
    focus: () => heading.focus(),
    get palette() {
      if (!state) return [];
      return [
        { id: "names", label: state.showNames ? "Stop showing names on my tree" : "Show names on my tree", group: "Gifts" },
        ...state.gifts.filter((g) => g.canOpen && !g.opened).map((g) => ({ id: `open:${g.id}`, label: `Open ${g.from}'s gift`, group: "Gifts" })),
      ];
    },
    command(id) {
      if (id === "names") setNames(!state.showNames);
      const gift = id.startsWith("open:") && state.gifts.find((g) => g.id === id.slice(5));
      if (gift) open(gift);
    },
  };
}
