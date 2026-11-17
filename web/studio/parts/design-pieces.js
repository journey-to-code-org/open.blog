// A new look on the page (Describe a new look): the front page in the look as it is being made,
// beside the things it hangs. Each switch or version changes the canvas and nothing else; the
// choices are kept for the new look when it is saved (PUT decorations, under its new name).
import { h } from "./dom.js";
import { use } from "../zubra.js";
import { say } from "./words.js";
import { createLookCanvas } from "./look-canvas.js";
import { pieceOptions, picksFor, withPick } from "./design-rules.js";

export async function createDesignPieces({ api }) {
  await use("toggle-switch", "select-field");
  const canvas = await createLookCanvas({ api });
  const list = h("ul", { class: "studio-deco-pieces", "aria-labelledby": "studio-design-pieces-h" });
  const hanging = h("section", { class: "studio-design-pieces", "aria-labelledby": "studio-design-pieces-h", hidden: true },
    h("h3", { id: "studio-design-pieces-h", text: say("design.piecesTitle") }),
    h("p", { class: "studio-help", text: say("design.piecesHelp") }), list);
  const element = h("div", { class: "studio-design-canvas" }, canvas.element);
  let saved = null; // GET decorations, or null when the site has none
  let base = "";
  let label = "";
  let picks = {};
  let drawing = null; // { draft, mode } while a draft is on screen

  const pieces = () => saved?.looks?.find((look) => look.name === base)?.pieces || [];

  function paint() {
    const request = drawing
      ? () => api.post("theme-draft/preview", { draft: drawing.draft, mode: drawing.mode, base: base || null, decorations: picks })
      : undefined;
    const key = JSON.stringify([base, picks, drawing]);
    canvas.show(base, drawing ? String(drawing.draft.label || label) : label, key, request ? { request } : {});
    // The pieces belong to a look being made: before a draft there is nothing to keep them for.
    hanging.hidden = !drawing || !pieces().length;
    if (hanging.hidden) return;
    list.replaceChildren(...pieces().map((piece) => {
      const up = picks[piece.id] !== false;
      const row = h("li", { class: "studio-deco-piece", "data-piece": piece.id },
        piece.canTakeDown
          ? h("toggle-switch", { label: piece.label, checked: up, description: up ? say("design.pieceUp") : say("design.pieceDown"), onCheckedchange: (e) => change(piece, e.detail ? null : false) })
          : h("p", { class: "studio-deco-fixed" }, h("strong", { text: piece.label }), h("span", { class: "studio-help", text: say("design.pieceStays") })));
      const versions = pieceOptions(piece, say("design.pieceUsual"));
      if (versions.length > 1) {
        row.append(h("select-field", { label: say("design.pieceWhich", { thing: piece.label }), disabled: !up, options: versions,
          value: typeof picks[piece.id] === "string" ? picks[piece.id] : versions[0].value,
          onValuechange: (e) => change(piece, e.detail === versions[0].value ? null : e.detail) }));
      }
      return row;
    }));
  }

  function change(piece, choice) {
    picks = withPick(picks, piece.id, choice);
    paint();
    requestAnimationFrame(() => list.querySelector(`[data-piece="${piece.id}"]`)?.querySelector("input, button, select")?.focus());
  }

  return {
    /** The canvas, for beside the form. */
    element,
    /** The things the look hangs, for among the draft's own settings. */
    hanging,
    async load() {
      saved = await api.get("decorations").catch(() => null);
    },
    /** The look a new one starts from: its pieces, as she has them now. */
    setBase(name, itsLabel) {
      if (name === base) return;
      base = name;
      label = itsLabel;
      picks = picksFor(saved, base);
      paint();
    },
    /** The draft on screen (or none), and light or dark. */
    setDraft(draft, mode) {
      drawing = draft ? { draft, mode } : null;
      paint();
    },
    /** What the new look keeps: `{ piece: false | "version" }`, empty when all is as it came. */
    picks: () => ({ ...picks }),
    /** Keep the choices under the saved look's name. False when they could not be kept. */
    async keep(name) {
      if (!Object.keys(picks).length) return true;
      try {
        const now = await api.get("decorations");
        saved = await api.put("decorations", { etag: now.etag, decorations: { ...(now.decorations || {}), [name]: picks } });
        return true;
      } catch (error) {
        if (error?.status === 401) throw error;
        return false;
      }
    },
    /** Forget the choices kept for a look that was taken back. Best effort: a build skips them anyway. */
    async forget(name) {
      try {
        const now = await api.get("decorations");
        if (!now.decorations?.[name]) return;
        const rest = { ...now.decorations };
        delete rest[name];
        saved = await api.put("decorations", { etag: now.etag, decorations: rest });
      } catch (error) {
        if (error?.status === 401) throw error;
      }
    },
  };
}
