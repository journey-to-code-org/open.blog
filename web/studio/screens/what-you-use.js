// What you use (ONB1, #/what-you-use): "What does my blog show me, and can I change it?" Every
// part that can be tucked away, with its one line and a switch that saves by itself; parts the
// site uses stay on and say so. Show everything turns hiding off without losing the choices, and
// Ask me the questions again opens About your blog with her answers. Reached from the account
// menu and Find.
import { fill, h } from "../parts/dom.js";
import { use } from "../zubra.js";
import { say } from "../parts/words.js";
import { AREA_IDS, areaAbout, areaInUse, areaName, hiddenAfter } from "../parts/area-rules.js";
import { welcomeHash } from "../parts/welcome-rules.js";

export async function createWhatYouUse(context) {
  const { meta } = context;
  await use("action-button", "toggle-switch", "status-badge", "alert-banner");
  const heading = h("h2", { id: "studio-use-h", class: "studio-question", tabindex: "-1", text: say("area.useHeading") });
  const status = h("p", { class: "studio-help", role: "status", "aria-live": "polite" });
  const everythingNote = h("p", { class: "studio-help" });
  const list = h("ul", { class: "studio-use-list", "aria-labelledby": "studio-use-list-h" });
  const forHelper = h("p", { class: "studio-mono" });
  const everything = h("toggle-switch", { label: say("area.everything"), description: say("area.everythingAbout"), onCheckedchange: (event) => change({ showEverything: Boolean(event.detail ?? everything.checked) }, () => paint()) });
  const element = h("section", { class: "studio-page studio-use", "aria-labelledby": "studio-use-h" },
    heading,
    h("p", { class: "studio-lede", text: say("area.useLede") }),
    everything, everythingNote,
    h("h3", { id: "studio-use-list-h", text: say("area.listHeading") }),
    list,
    status,
    h("div", { class: "studio-row" }, h("action-button", { variant: "secondary", href: welcomeHash("kind", meta.areas?.answers || {}) }, say("area.askAgain"))),
    h("p", { class: "studio-help", text: say("area.always") }),
    h("details", { class: "studio-help" }, h("summary", { text: say("common.forHelper") }), forHelper, h("p", { class: "studio-mono", text: say("area.forHelperFile") })));

  /** Save one change; the switch goes back when it couldn't be saved. */
  async function change(patch, undo) {
    const saved = await context.areas.save(patch);
    if (saved.ok) { status.textContent = say("area.saved"); paint(); return; }
    if (saved.code === "stale") { status.textContent = say("area.changedElsewhere"); paint(); return; }
    status.textContent = saved.code === "no-signal" ? say("area.noSignal") : say("area.notSaved");
    undo();
  }

  function paint() {
    const areas = meta.areas || {};
    const hidden = areas.areas?.hidden || [];
    everything.checked = areas.showEverything === true;
    everythingNote.textContent = areas.showEverything === true ? say("area.everythingOn") : "";
    fill(list, AREA_IDS.map((id) => {
      const name = areaName(id);
      if (areaInUse(meta, id)) {
        return h("li", { class: "studio-use-row studio-use-used" },
          h("div", { class: "studio-use-text" }, h("strong", { text: name }), h("span", { class: "studio-help", text: areaAbout(id) }), h("span", { class: "studio-help", text: say("area.inUse") })),
          h("status-badge", { variant: "success" }, say("welcome.markShown")));
      }
      const toggle = h("toggle-switch", { label: name, description: areaAbout(id), checked: !hidden.includes(id) });
      toggle.addEventListener("checkedchange", (event) => {
        const on = Boolean(event.detail ?? toggle.checked);
        change({ hidden: hiddenAfter(meta.areas?.areas?.hidden, id, on) }, () => { toggle.checked = !on; });
      });
      return h("li", { class: "studio-use-row" }, toggle);
    }));
    forHelper.textContent = say("area.forHelperIds", { hidden: hidden.join(", ") || "none", everything: String(areas.showEverything === true), state: String(areas.onboarding?.state || "pending"), kind: String(areas.kind || "none") });
  }

  return {
    title: say("area.useTitle"),
    element,
    async load() {
      // Another window may have changed them.
      await context.areas.check();
      paint();
    },
    focus: () => heading.focus(),
  };
}
