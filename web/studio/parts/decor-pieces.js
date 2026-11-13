// "What's hanging": the single decorations of one look (garland, banner, wreath, snow), each with
// a switch to take it down or put it back up, and, where the look has them, other versions to
// choose from. Each change saves straight away, like flipping a light switch, goes out like a
// post, and offers "Put it back" right where she made it. Studio slice 3b.
//
// The server owns the rules (GET/PUT decorations, its own etag, names only, never CSS); this part
// only says what's there in her words.
import { h, toast } from "./dom.js";
import { use } from "../zubra.js";
import { showPreview } from "./preview.js";
import { sendOut, wentOutWords } from "./publish.js";

// Version names are lowercase letters, digits and "-", so "_usual" can never be one.
const USUAL = "_usual";
const clone = (value) => JSON.parse(JSON.stringify(value ?? null));

/** The words for one change, so the status line and "Put it back" agree. Exported for tests. */
export function changeWords(piece, choice) {
  const name = piece.label;
  if (choice === false) return `${name} is down.`;
  if (choice === null || choice === undefined) return `${name} is up.`;
  const version = piece.variants.find((v) => v.id === choice);
  return `${name} is up: ${version ? version.label.charAt(0).toLowerCase() + version.label.slice(1) : choice}.`;
}

/** One look's choices with this piece changed. `null` means "as the look comes". Exported for tests. */
export function withChoice(all, look, piece, choice) {
  const next = clone(all) || {};
  const picks = { ...(next[look] || {}) };
  if (choice === null || choice === undefined) delete picks[piece];
  else picks[piece] = choice;
  if (Object.keys(picks).length) next[look] = picks;
  else delete next[look];
  return next;
}

export async function createDecorPieces({ api, meta }) {
  await use("toggle-switch", "select-field", "action-button", "alert-banner", "skeleton-block");
  let saved = null; // GET decorations
  let look = ""; // the look whose pieces are shown
  let busy = false;
  const status = h("div", { class: "studio-deco-status", role: "status", "aria-live": "polite" });
  const picker = h("select-field", { label: "Decorations for", onValuechange: (e) => { look = e.detail; draw(); } });
  const list = h("ul", { class: "studio-deco-pieces", "aria-labelledby": "studio-pieces-h" });
  const see = h("action-button", { variant: "secondary", onClick: (e) => preview(e.currentTarget) }, "See how it looks");
  const element = h("section", { class: "studio-section studio-deco-hanging", "aria-labelledby": "studio-pieces-h", hidden: true },
    h("h3", { id: "studio-pieces-h", text: "What's hanging" }),
    h("p", { class: "studio-help", text: "Take one decoration down, or choose a different one. Each change goes on your site straight away." }),
    picker, list, see, status);

  const current = () => saved.looks.find((l) => l.name === look);
  const choiceOf = (piece) => saved.decorations?.[look]?.[piece.id] ?? null;

  function draw() {
    const shown = current();
    element.hidden = !shown;
    if (!shown) return;
    picker.options = saved.looks.map((l) => ({ value: l.name, label: l.label || l.name }));
    picker.value = look;
    picker.hidden = saved.looks.length < 2;
    see.textContent = `See how ${shown.label || shown.name} looks`;
    list.replaceChildren(...shown.pieces.map((piece) => {
      const choice = choiceOf(piece);
      const up = choice !== false;
      const row = h("li", { class: "studio-deco-piece" },
        h("toggle-switch", {
          label: piece.label, checked: up, disabled: !piece.canTakeDown || busy,
          description: piece.canTakeDown ? (up ? "Up" : "Down") : "This one always stays up.",
          onCheckedchange: (e) => change(piece, e.detail ? null : false),
        }));
      if (piece.variants.length) {
        row.append(h("select-field", {
          label: `Which ${piece.label.toLowerCase()}`, disabled: !up || busy,
          options: [{ value: USUAL, label: `The usual ${piece.label.toLowerCase()}` }, ...piece.variants.map((v) => ({ value: v.id, label: v.label }))],
          value: up && choice ? choice : USUAL,
          onValuechange: (e) => change(piece, e.detail === USUAL ? null : e.detail),
        }));
      }
      return row;
    }));
  }

  async function change(piece, choice, { putBack = false } = {}) {
    if (busy) return;
    const before = choiceOf(piece);
    if (before === choice) return;
    busy = true;
    draw();
    let reply;
    try {
      reply = await api.put("decorations", { etag: saved.etag, decorations: withChoice(saved.decorations, look, piece.id, choice) });
    } catch (error) {
      busy = false;
      if (error.status === 409 && error.data?.etag) {
        // Someone changed decorations on another device: show theirs, and say so. Her one change is one
        // tap to make again, so nothing is merged behind her back.
        adopt(error.data);
        status.replaceChildren(h("alert-banner", { variant: "info", heading: "Your decorations changed on another device" }, "Here they are now. Make your change again if you still want it."));
        return;
      }
      draw();
      const words = error.status === 422 ? "That decoration isn't in this look anymore. Reload the page to see what's there now."
        : error.status ? "Something went wrong on your site. Nothing changed; try again in a moment." : "Check your connection and try again. Nothing changed.";
      status.replaceChildren(h("alert-banner", { variant: "danger", heading: `${piece.label} wasn't changed` }, words));
      return;
    }
    busy = false;
    adopt(reply);
    const said = changeWords(piece, choice);
    if (reply.buildError) {
      status.replaceChildren(h("alert-banner", { variant: "warning", heading: said }, "Saved, but your site couldn't be put together yet. The person who set up your site can see why in Details."));
      return;
    }
    const result = await sendOut(api, "Change the decorations");
    const out = wentOutWords(result, { meta, action: "saved" });
    const back = putBack ? null : h("action-button", { variant: "secondary", size: "sm", onClick: () => change(piece, before, { putBack: true }) }, "Put it back");
    status.replaceChildren(h("p", { class: "studio-help", text: `${said} ${out.words}` }), ...(back ? [back] : []));
    if (result.sent === "failed") toast(out.words, { variant: out.variant, duration: 0 });
    // Keep focus where she was: on the same piece's switch.
    requestAnimationFrame(() => {
      const index = current()?.pieces.findIndex((p) => p.id === piece.id) ?? -1;
      (putBack ? list.children[index]?.querySelector("input, button") : back?.querySelector("button"))?.focus();
    });
  }

  function preview(opener) {
    const shown = current();
    return showPreview(api, {
      opener, request: () => api.post("decorations/preview", { look, pieces: saved.decorations?.[look] || {} }),
      heading: `How ${shown.label || shown.name} looks`, backLabel: "Back to decorations",
      note: "Only you can see this. It shows the decorations as they're set here.", frameTitle: `Your front page decorated for ${shown.label || shown.name}`,
    });
  }

  function adopt(state) {
    saved = clone(state);
    saved.looks = saved.looks || [];
    saved.decorations = saved.decorations || {};
    if (!saved.looks.some((l) => l.name === look)) {
      look = (saved.looks.find((l) => l.name === saved.wearing) || saved.looks[0])?.name || "";
    }
    draw();
  }

  async function load({ wearing } = {}) {
    try {
      const state = await api.get("decorations");
      if (wearing && state.looks?.some((l) => l.name === wearing)) look = wearing;
      adopt(state);
    } catch (error) {
      // A site whose engine has no decorations yet just doesn't show this section.
      if (error.status === 404) { element.hidden = true; return; }
      element.hidden = false;
      list.replaceChildren();
      status.replaceChildren(h("alert-banner", { variant: "danger", heading: "Your decorations didn't load" }, error.message,
        h("action-button", { variant: "secondary", onClick: () => load() }, "Try again")));
    }
  }

  return {
    element,
    load,
    /** For Find anywhere: one entry per piece. */
    palette() {
      const shown = saved && current();
      if (!shown) return [];
      return shown.pieces.filter((p) => p.canTakeDown).map((piece) => {
        const up = choiceOf(piece) !== false;
        return { id: `piece:${piece.id}`, label: `${up ? "Take down" : "Put up"} the ${piece.label.toLowerCase()}`, group: "What's hanging" };
      });
    },
    command(id) {
      const piece = current()?.pieces.find((p) => `piece:${p.id}` === id);
      if (piece) change(piece, choiceOf(piece) === false ? null : false);
    },
  };
}
