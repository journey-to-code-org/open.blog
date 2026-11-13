// Look: how every page looks, whatever the season: a ready-made look, the main color, the lettering,
// the size of the writing, corners, spacing, page width, headings, and whether readers can switch to
// dark. Each choice can go back to the theme's own. See it, then Save. Studio slice 7. The words and
// rules are the old Admin's look model (/admin/look.js); the server owns every rule (it may soften a
// color so writing stays easy to read, and says so).
import { h, toast } from "../parts/dom.js";
import { use } from "../zubra.js";
import { ask } from "../parts/dialogs.js";
import { showPreview } from "../parts/preview.js";
import { sendOut, wentOutWords } from "../parts/publish.js";

const MODEL = "/admin/look.js";
const OWN = "";

export async function createLook({ api, meta }) {
  await use("select-field", "action-button", "alert-banner", "skeleton-block");
  const M = await import(MODEL);
  let reply = null; // GET look
  let saved = {};
  let draft = {};
  let dark = null; // GET appearance
  let darkDraft = null;

  const heading = h("h2", { id: "studio-look-h", class: "studio-question", tabindex: "-1", text: "How your site looks" });
  const lede = h("p", { class: "studio-lede" }, "These change every page, all year round. Any choice can go back to your theme's own. Christmas lights, trees and snow are in ", h("a", { href: "#/decorations" }, "Decorations"), ".");
  const banner = h("div", { class: "studio-banner", "aria-live": "polite" });
  const controls = h("div", { class: "studio-look-controls" }, h("skeleton-block", { lines: 6 }));
  const saveButton = h("action-button", { onClick: () => save() }, "Save");
  const see = h("action-button", { variant: "secondary", onClick: (e) => preview(e.currentTarget) }, "See how it looks");
  const reset = h("action-button", { variant: "ghost", onClick: () => { draft = {}; darkDraft = null; draw(); } }, "Use the theme's own for everything");
  const element = h("section", { class: "studio-page studio-look", "aria-labelledby": "studio-look-h" },
    heading, lede, banner, controls, reset, h("div", { class: "studio-write-bar" }, see, saveButton));

  const dirty = () => Boolean(reply) && (!M.lookSame(draft, saved) || darkDraft !== (dark?.colorSchemeToggle ?? null));
  const honored = (id) => !reply?.honored || reply.honored.includes(id);

  function choiceField(id) {
    const text = M.CONTROL_TEXT[id];
    const options = id === "palette"
      ? (reply.looks || []).map((l) => ({ value: l.id, label: l.name }))
      : (M.CHOICES[id] || []).map((c) => ({ value: c.id, label: `${c.label}: ${c.hint}` }));
    return h("select-field", {
      label: text.label,
      description: text.help,
      options: [{ value: OWN, label: id === "palette" ? "My theme's own colors" : `My theme's own ${text.label.toLowerCase()}` }, ...options],
      value: draft[id] || OWN,
      onValuechange: (e) => {
        const value = e.detail;
        if (id === "palette") {
          const curated = (reply.looks || []).find((l) => l.id === value);
          draft = curated ? M.applyCurated(draft, curated) : M.clearControl(draft, "palette");
          draw();
          controls.querySelector('[data-control="palette"] select')?.focus();
          return;
        }
        draft = value ? M.setControl(draft, id, value) : M.clearControl(draft, id);
        paintBar();
      },
    });
  }

  function accentField() {
    const text = M.CONTROL_TEXT.accent;
    const swatch = (hex, name) => h("button", {
      type: "button", class: "studio-swatch", style: `--swatch: ${hex}`, "aria-pressed": String(draft.accent === hex),
      "aria-label": name, onClick: () => { draft = M.setControl(draft, "accent", hex); draw(); controls.querySelector(`[aria-label="${name}"]`)?.focus(); },
    });
    const picker = h("input", { type: "color", id: "studio-accent-own", value: draft.accent || M.DEFAULT_PICKER_COLOR, onChange: (e) => { draft = M.setControl(draft, "accent", e.target.value.toLowerCase()); draw(); } });
    return h("fieldset", { class: "studio-look-accent" },
      h("legend", { text: text.label }),
      h("p", { class: "studio-help", text: text.help }),
      h("div", { class: "studio-swatches" },
        ...M.ACCENT_SWATCHES.map((s) => swatch(s.hex, s.name)),
        h("label", { class: "studio-swatch-own", for: "studio-accent-own" }, picker, h("span", { text: "Choose your own" }))),
      h("p", { class: "studio-help", role: "status", text: draft.accent ? `Chosen: ${M.valueWords("accent", draft.accent)}.` : "Using your theme's own color." }),
      draft.accent ? h("action-button", { variant: "ghost", size: "sm", onClick: () => { draft = M.clearControl(draft, "accent"); draw(); } }, "Use the theme's own color") : null);
  }

  function darkField() {
    const theme = dark?.themeColorSchemeToggle ? "Yes" : "No";
    return h("select-field", {
      label: "A light and dark button for readers",
      description: "Lets readers switch your site to dark, for reading at night.",
      options: [{ value: "theme", label: `Let my theme decide (now: ${theme})` }, { value: "yes", label: "Yes, show the button" }, { value: "no", label: "No button" }],
      value: darkDraft === null ? "theme" : darkDraft ? "yes" : "no",
      onValuechange: (e) => { darkDraft = e.detail === "theme" ? null : e.detail === "yes"; paintBar(); },
    });
  }

  function draw() {
    // Redrawing replaces the controls: keep her place.
    const at = document.activeElement?.closest?.("[data-control]")?.dataset.control;
    if (at) requestAnimationFrame(() => controls.querySelector(`[data-control="${at}"] select, [data-control="${at}"] input`)?.focus());
    const left = M.CONTROL_ORDER.filter((id) => !honored(id));
    controls.replaceChildren(
      ...M.CONTROL_ORDER.filter(honored).map((id) => h("div", { class: "studio-look-control", "data-control": id }, id === "accent" ? accentField() : choiceField(id))),
      dark ? h("div", { class: "studio-look-control" }, darkField()) : null,
      left.length ? h("p", { class: "studio-help", text: reply.note || `Your theme decides the rest itself.` }) : null);
    paintBar();
  }

  function paintBar() {
    reset.hidden = !Object.keys(draft).length;
    saveButton.textContent = dirty() ? "Save" : "Saved";
  }

  function preview(opener) {
    return showPreview(api, {
      opener, request: async () => {
        const result = await api.post("look/preview", { look: M.lookPayload(draft), mode: "light" });
        if (result.refused || (result.adjustments || []).length) say(result.adjustments, result.refused);
        return result;
      },
      heading: "How your site looks", backLabel: "Back to how your site looks",
      note: "Only you can see this. Nothing is saved yet.", frameTitle: "Your site with these choices",
    });
  }

  function say(adjustments = [], refused = false) {
    if (!adjustments.length && !refused) return;
    banner.replaceChildren(h("alert-banner", { variant: refused ? "warning" : "info", heading: refused ? "That color can't be used here" : "One small change, so it stays easy to read" },
      h("ul", {}, adjustments.map((line) => h("li", { text: String(line) })))));
  }

  async function save() {
    if (!dirty()) { toast("Nothing's changed. Your site already looks like this."); return true; }
    saveButton.loading = true;
    try {
      if (!M.lookSame(draft, saved)) {
        const result = await api.put("look", { etag: reply.etag, look: M.lookPayload(draft) });
        reply = { ...reply, ...result };
        saved = M.lookFrom(result.look);
        draft = { ...saved };
        say(result.adjustments, result.refused);
      }
      if (dark && darkDraft !== (dark.colorSchemeToggle ?? null)) {
        // Its version covers the whole settings file, which the look just changed: ask afresh.
        const fresh = await api.get("appearance");
        dark = await api.put("appearance", { etag: fresh.etag, colorSchemeToggle: darkDraft });
        darkDraft = dark.colorSchemeToggle ?? null;
      }
      const result = await sendOut(api, "Change how the site looks");
      const said = wentOutWords(result, { meta, action: "saved" });
      toast(said.words, { variant: said.variant, duration: result.sent === "failed" ? 0 : undefined });
      draw();
      return true;
    } catch (error) {
      if (error.status === 409) {
        const choice = await ask({ heading: "Changed somewhere else", text: "How your site looks was changed on another device while you had it open. Your choices are still here.", choices: [{ label: "Keep my choices", value: "mine" }, { label: "Show the other version", value: "theirs", variant: "secondary" }] });
        const fresh = await load({ keep: choice === "mine" });
        if (choice === "mine" && fresh) return save();
        return false;
      }
      banner.replaceChildren(h("alert-banner", { variant: "danger", heading: "Not saved" },
        error.status === 422 ? "Your site's settings didn't accept these choices. Your choices are still here; try a different one, or tell the person who set up your site."
          : error.status ? "Something went wrong on your site. Your choices are still here; try again in a moment." : "Check your connection and try again. Your choices are still here.",
        error.status ? h("details", { class: "studio-help" }, h("summary", { text: "For the person who set up your site" }), h("p", { class: "studio-mono", text: `${error.status}: ${error.message}` })) : null));
      return false;
    } finally {
      saveButton.loading = false;
    }
  }

  async function load({ keep = false } = {}) {
    try {
      const mine = { ...draft };
      // One after the other: both take the site's lock, and asked at once one of them is told "busy".
      const look = await api.get("look");
      const appearance = await api.get("appearance").catch(() => null);
      reply = look;
      saved = M.lookFrom(look.look);
      draft = keep ? mine : { ...saved };
      dark = appearance;
      if (!keep) darkDraft = appearance ? appearance.colorSchemeToggle ?? null : null;
      draw();
      return true;
    } catch (error) {
      controls.replaceChildren(h("alert-banner", { variant: "danger", heading: "How your site looks didn't load" }, "Check your connection and try again.", h("action-button", { variant: "secondary", onClick: () => load() }, "Try again")));
      return false;
    }
  }

  async function leave() {
    if (!dirty()) return true;
    const choice = await ask({ heading: "Save how your site looks?", text: "You changed some choices and didn't save.", choices: [{ label: "Save", value: "save" }, { label: "Leave without saving", value: "go", variant: "secondary" }] });
    if (choice === "save") return save();
    return choice === "go";
  }

  return {
    title: "Look",
    element,
    load: () => load(),
    leave,
    isDirty: dirty,
    focus: () => heading.focus(),
    get palette() {
      return [{ id: "save", label: "Save how my site looks", group: "Look", hint: "Ctrl S" }, { id: "preview", label: "See how my site looks", group: "Look" }];
    },
    keys: ["save", "publish"],
    command(id) {
      if (id === "save" || id === "publish") save();
      if (id === "preview") preview();
    },
  };
}
