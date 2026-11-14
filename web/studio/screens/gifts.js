// Gifts: what the family left under her tree. Before Christmas each one is a wrapped box with who
// it's from; on Christmas morning she opens them one at a time and reads the note or sees the card.
// She chooses whether the tree shows givers' names (only theirs who said yes). A gift can be taken
// off the tree; it's kept here, never deleted. Studio slice 3b.
import { fill, h, toast } from "../parts/dom.js";
import { use } from "../zubra.js";
import { ask } from "../parts/dialogs.js";
import { drawCard } from "../parts/gift-card.js";
import { say } from "../parts/words.js";

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
  const when = days <= 0 ? "any minute now" : days === 1 ? "tomorrow morning" : `in ${days} days`;
  return `${count(waiting.length)} waiting under your tree. You can open ${waiting.length === 1 ? "it" : "them"} from midnight on Christmas morning, ${when}.`;
}

/** Whose gift it is and how the tree shows it. Exported for tests. */
export function fromWords(gift, showNames) {
  if (!gift.showName) return "This name is hidden on your tree";
  return showNames ? "Their name shows on your tree" : "Names are turned off on your tree";
}

export async function createGifts({ api }) {
  await use("toggle-switch", "action-button", "alert-banner", "empty-state", "skeleton-block", "status-badge", "text-field");
  let state = null;
  const heading = h("h2", { id: "studio-gifts-h", class: "studio-question", tabindex: "-1" });
  const banner = h("div", { class: "studio-banner", "aria-live": "polite" });
  const names = h("toggle-switch", {
    label: "Show who each gift is from on your tree",
    description: "Only for people who said that's OK. You always see every name here.",
    onCheckedchange: (e) => setNames(e.detail),
  });
  const codeWords = h("p", { class: "studio-help" });
  const details = h("details", { class: "studio-help studio-gift-details" });
  const nextButton = h("action-button", { size: "lg", hidden: true, onClick: () => { const next = nextToOpen(); if (next) open(next); } }, "Open the next gift");
  const codeField = h("text-field", { label: "New family password", hidden: true, maxlength: 80, description: "At least 6 letters or numbers. Capital letters and spaces don't matter." });
  const codeSave = h("action-button", { hidden: true, onClick: () => saveCode() }, "Save the new password");
  const codeChange = h("action-button", { variant: "secondary", onClick: () => { codeField.hidden = false; codeSave.hidden = false; codeChange.hidden = true; codeField.querySelector("input")?.focus(); } }, "Change it");
  const code = h("section", { class: "studio-section", "aria-labelledby": "studio-code-h" },
    h("h3", { id: "studio-code-h", text: "The family password" }), codeWords, codeChange, codeField, codeSave);
  const list = h("ul", { class: "studio-gift-list", "aria-labelledby": "studio-gifts-h", "aria-busy": "true" }, h("li", {}, h("skeleton-block", { lines: 3 })));
  const element = h("section", { class: "studio-page studio-gifts", "aria-labelledby": "studio-gifts-h" },
    h("div", { class: "studio-today" }, heading, h("p", { class: "studio-lede", text: "The family leaves these on your site. Everything in them stays private until you open it." }), nextButton, names),
    banner, list, code, details);

  const label = (gift) => `${gift.kind === "card" ? "A card" : "A note"} from ${gift.from}`;

  function giftRow(gift) {
    const box = h("span", { class: `studio-gift-box studio-wrap-${gift.wrap}`, "aria-hidden": "true" });
    const title = h("h3", { class: "studio-gift-from", tabindex: "-1", text: gift.from });
    const facts = h("p", { class: "studio-help", text: `${gift.kind === "card" ? "A card" : "A note"}, wrapped in ${WRAP_WORDS[gift.wrap] || "paper"}. ${fromWords(gift, state.showNames)}.` });
    const row = h("li", { class: "studio-gift", "data-id": gift.id }, box, h("div", { class: "studio-gift-body" }, title, facts));
    const body = row.querySelector(".studio-gift-body");
    if (gift.opened && gift.unreadable) {
      body.append(h("p", { class: "studio-help", text: `Studio can't show this one, but it's safe. ${say("common.letKnow")}` }));
    } else if (gift.opened) {
      box.classList.add("studio-gift-open");
      if (gift.kind === "note") body.append(h("blockquote", { class: "studio-gift-note", text: gift.note }));
      else body.append(drawCard(gift.card, { label: `${label(gift)}: ${gift.card.message}${gift.card.signOff ? `, signed ${gift.card.signOff}` : ""}` }));
    } else if (gift.canOpen) {
      body.append(h("action-button", { onClick: () => open(gift) }, `Open ${gift.from}'s gift`));
    } else {
      body.append(h("status-badge", { variant: "neutral" }, "Wrapped until Christmas"));
    }
    if (gift.onTree) {
      if (gift.opened) body.append(h("p", { class: "studio-help", text: "The family still sees it wrapped under your tree until January 6." }));
      body.append(h("action-button", { variant: "ghost", size: "sm", class: "studio-gift-hide", onClick: () => hide(gift) }, "Take it off the tree"));
    } else {
      body.append(h("p", { class: "studio-help", text: "Not on your tree. It's kept here." }),
        h("action-button", { variant: "secondary", size: "sm", onClick: () => putBack(gift) }, "Put it back on the tree"));
    }
    return row;
  }

  function draw() {
    heading.textContent = giftsHeadline(state.gifts, state.opensAt);
    const next = nextToOpen();
    nextButton.hidden = !next;
    if (next) nextButton.textContent = `Open the next gift (from ${next.from})`;
    details.replaceChildren(h("summary", { text: say("common.forHelper") }),
      h("p", { class: "studio-mono", text: `${state.gifts.length} gifts. Next opening: ${state.opensAt} (UTC), ${new Date(state.opensAt).toLocaleString()} here.` }),
      h("ul", { class: "studio-mono" }, ...state.gifts.map((g) => h("li", { text: `${g.createdAt.slice(0, 16).replace("T", " ")}  ${g.from}  ${g.kind}  ${g.opened ? "opened" : "wrapped"}${g.onTree ? "" : "  (off the tree)"}` }))));
    codeWords.replaceChildren(state.familyCode
      ? h("span", {}, "The family types this to leave you a gift: ", h("strong", { text: state.familyCode }), ". Capital letters and spaces don't matter.")
      : "Nobody has set one yet, so nobody can leave a gift. Choose one below.");
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

  // Her words first; what the server said is kept for whoever set up the site.
  const trouble = (heading, error) => banner.replaceChildren(h("alert-banner", { variant: "danger", heading },
    error.status === 0 || !error.status ? "Check your connection and try again. Nothing is lost." : "Your gifts couldn't be reached just now. Nothing is lost; try again in a minute.",
    error.status ? h("details", { class: "studio-help" }, h("summary", { text: say("common.forHelper") }), h("p", { class: "studio-mono", text: `${error.status}: ${error.message}` })) : null));
  const focusGift = (id) => requestAnimationFrame(() => list.querySelector(`[data-id="${id}"] .studio-gift-from`)?.focus());
  const busy = new Set();

  async function open(gift) {
    if (busy.has(gift.id)) return;
    busy.add(gift.id);
    try {
      const { gift: opened } = await api.post(`gifts/${gift.id}/open`, {});
      state.gifts = state.gifts.map((g) => (g.id === opened.id ? opened : g));
      banner.replaceChildren();
      draw();
      focusGift(opened.id);
      toast(`You opened ${opened.from}'s gift.`);
    } catch (error) {
      if (error.status === 423) {
        banner.replaceChildren(h("alert-banner", { variant: "info", heading: "Not yet" }, "It's still wrapped. Gifts open at midnight on Christmas morning."));
        return;
      }
      trouble(`${gift.from}'s gift didn't open`, error);
    } finally {
      busy.delete(gift.id);
    }
  }

  const nextToOpen = () => state.gifts.filter((g) => g.canOpen && !g.opened).sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];

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
      focusGift(gift.id);
      toast(`${gift.from}'s gift is off the tree. It's still here.`);
    } catch (error) {
      trouble("That didn't work", error);
    }
  }

  async function putBack(gift) {
    try {
      const { gift: shown } = await api.post(`gifts/${gift.id}/show`, {});
      state.gifts = state.gifts.map((g) => (g.id === shown.id ? shown : g));
      draw();
      focusGift(gift.id);
      toast(`${gift.from}'s gift is back under your tree.`);
    } catch (error) {
      trouble("That didn't work", error);
    }
  }

  async function saveCode() {
    const value = String(codeField.value || "").trim();
    if (value.replace(/[^\p{L}\p{N}]+/gu, "").length < 6) {
      codeField.error = "Use at least 6 letters or numbers.";
      codeField.querySelector("input")?.focus();
      return;
    }
    try {
      state.familyCode = (await api.post("gifts/settings", { familyCode: value })).familyCode;
      codeField.value = "";
      codeField.error = "";
      codeField.hidden = true;
      codeSave.hidden = true;
      codeChange.hidden = false;
      draw();
      codeChange.querySelector("button")?.focus();
      toast("The family password is changed. Tell the family the new one.");
    } catch (error) {
      trouble("The password didn't change", error);
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

  let wake = 0;
  async function load() {
    try {
      state = await api.get("gifts/list");
      banner.replaceChildren();
      draw();
      // Left open overnight: Open appears by itself at midnight on Christmas morning.
      clearTimeout(wake);
      const until = Date.parse(state.opensAt) - Date.now();
      if (until > 0 && until < 24 * 60 * 60 * 1000) wake = setTimeout(load, until + 2000);
    } catch (error) {
      list.removeAttribute("aria-busy");
      fill(list);
      trouble("Your gifts didn't load", error);
      banner.firstChild?.append(h("action-button", { variant: "secondary", onClick: load }, "Try again"));
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
