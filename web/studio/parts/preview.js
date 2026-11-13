// See how it looks: the post as her readers will see it, built by the site's own theme from what's
// on screen now (saved or not). Nothing is written or published. The page runs in a sandboxed
// frame with no access to Studio (no same-origin), and the server sends it with its own sandbox.
import { h } from "./dom.js";
import { use } from "../zubra.js";

/**
 * Open the preview sheet. `problemsView(problems, close)` turns recipe problems into her words
 * (with "Go to it" buttons); `opener` gets focus back when it closes.
 */
export async function showPreview(api, { kind = "posts", path = "", fields, body, title, problemsView, opener }) {
  await use("side-sheet", "loading-spinner", "alert-banner", "segmented-control", "action-button");
  const sheet = h("side-sheet", { label: "How it looks", side: "right", class: "studio-preview-sheet" });
  const close = () => { sheet.open = false; };
  sheet.addEventListener("openchange", (e) => {
    if (e.detail) return;
    sheet.remove();
    opener?.focus?.();
  });
  const stage = h("div", { class: "studio-preview-stage", "data-device": "computer" });
  const notes = h("div", { "aria-live": "polite" });
  const device = h("segmented-control", { label: "Show it on", value: "computer", class: "studio-preview-device",
    options: [{ value: "computer", label: "Computer" }, { value: "phone", label: "Phone" }],
    onValuechange: (e) => stage.setAttribute("data-device", e.detail) });
  sheet.append(
    h("span", { slot: "heading", text: "How it looks" }),
    h("p", { class: "studio-help", text: "Only you can see this. Nothing is published." }),
    h("div", { class: "studio-row studio-preview-tools" }, device, h("action-button", { variant: "secondary", onClick: close }, "Back to writing")),
    notes, stage);
  document.body.append(sheet);
  sheet.open = true;

  async function build(retried = false) {
    const slow = setTimeout(() => stage.querySelector(".studio-preview-wait")?.replaceChildren(
      h("loading-spinner", { label: "Getting it ready", inline: true }), " Still working. Your whole site is being put together."), 8000);
    stage.replaceChildren(h("p", { class: "studio-preview-wait studio-row" }, h("loading-spinner", { label: "Getting it ready", inline: true }), " Getting it ready…"));
    try {
      const reply = await api.post("preview", { kind, path, fields, body });
      const problems = Array.isArray(reply.recipeProblems) ? reply.recipeProblems : [];
      notes.replaceChildren(problems.length && problemsView ? problemsView(problems, close) : "");
      const frame = h("iframe", { class: "studio-preview-frame", title: `How ${title || "this post"} will look` });
      frame.setAttribute("sandbox", "allow-scripts");
      frame.setAttribute("src", reply.previewUrl);
      frame.addEventListener("load", () => frame.focus(), { once: true });
      stage.replaceChildren(frame);
    } catch (error) {
      if (error.status === 404 && !retried) return build(true);
      stage.replaceChildren(h("alert-banner", { variant: "danger", heading: "The preview didn't open" }, error.message,
        h("action-button", { variant: "secondary", onClick: () => build() }, "Try again")));
    } finally {
      clearTimeout(slow);
    }
  }
  build();
  return { close };
}
