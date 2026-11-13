// Earlier versions of the front page: each save is kept, and any one can be brought back (the one
// on the site now is kept too, so bringing one back can itself be undone). Studio slice 6.
import { h, toast } from "./dom.js";
import { sayWhen } from "./dates.js";

export function landingVersions({ api, getRevision, onRestored }) {
  const list = h("ul", { class: "studio-versions" });
  const element = h("details", { class: "studio-help studio-landing-versions" }, h("summary", { text: "Earlier versions" }), list);
  let busy = false;

  async function restore(version, button) {
    if (busy) return;
    busy = true;
    try {
      const reply = await api.post("landing/history/restore", { id: version.id, revision: getRevision() });
      onRestored(reply);
      toast(`Your front page is back to how it was ${sayWhen(version.savedAt)}. The version before is in the list too.`);
      await refresh();
    } catch (error) {
      toast(error.status === 409 ? "Your front page changed somewhere else, so nothing was brought back. Reload and try again." : "That version couldn't be brought back. Nothing changed.", { variant: "warning", duration: 0 });
      button?.focus();
    } finally {
      busy = false;
    }
  }

  async function refresh() {
    try {
      const reply = await api.get("landing/history");
      const versions = reply.versions || [];
      list.replaceChildren(...(versions.length ? versions.map((v) => h("li", {},
        h("span", { text: `${sayWhen(v.savedAt)}${v.sections ? `, ${v.sections} section${v.sections === 1 ? "" : "s"}` : ""}${v.current ? " (on your site now)" : ""}` }),
        v.current ? null : h("action-button", { variant: "secondary", size: "sm", onClick: (e) => restore(v, e.currentTarget) }, h("span", {}, "Bring this back", h("span", { class: "studio-visually-hidden", text: ` (${sayWhen(v.savedAt)})` }))))) : [h("li", { text: "None yet. Each save is kept here." })]));
    } catch {
      list.replaceChildren(h("li", { text: "The earlier versions didn't load." }));
    }
  }

  return { element, refresh };
}
