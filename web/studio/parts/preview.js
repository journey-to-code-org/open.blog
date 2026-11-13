// See how it looks: the post as her readers will see it, built by the site's own theme from what's
// on screen now (saved or not). Nothing is written or published. The page runs in a sandboxed
// frame with no access to Studio (no same-origin), and the server sends it with its own sandbox.
import { h } from "./dom.js";
import { use } from "../zubra.js";

/**
 * Open the preview sheet. `problemsView(problems, close)` turns recipe problems into her words
 * (with "Go to it" buttons); `opener` gets focus back when it closes.
 */
export async function showPreview(api, {
  kind = "posts", path = "", fields, body, title, problemsView, opener,
  // Another screen can ask for its own preview (Decorations: the front page in a look).
  request = () => api.post("preview", { kind, path, fields, body }),
  heading = "How it looks", backLabel = "Back to writing", note = "Only you can see this. Nothing is published.",
  frameTitle = `How ${title || "this post"} will look`,
}) {
  await use("side-sheet", "loading-spinner", "alert-banner", "segmented-control", "action-button");
  const sheet = h("side-sheet", { label: heading, side: "right", class: "studio-preview-sheet" });
  const close = () => { sheet.open = false; };
  sheet.addEventListener("openchange", (e) => {
    if (e.detail) return;
    sheet.remove();
    opener?.focus?.();
  });
  const stage = h("div", { class: "studio-preview-stage", "data-device": "computer" });
  // Focus starts on Back to writing, never inside the frame, so Escape and Tab always work.
  const back = h("action-button", { variant: "secondary", onClick: close }, backLabel);
  const notes = h("div", { "aria-live": "polite" });
  const device = h("segmented-control", { label: "Show it on", value: "computer", class: "studio-preview-device",
    options: [{ value: "computer", label: "Computer" }, { value: "phone", label: "Phone" }],
    onValuechange: (e) => stage.setAttribute("data-device", e.detail) });
  sheet.append(
    h("span", { slot: "heading", text: heading }),
    h("p", { class: "studio-help", text: note }),
    h("div", { class: "studio-row studio-preview-tools" }, device, back),
    notes, stage);
  document.body.append(sheet);
  sheet.open = true;
  requestAnimationFrame(() => back.querySelector("button")?.focus());

  async function build(retried = false) {
    const slow = setTimeout(() => stage.querySelector(".studio-preview-wait")?.replaceChildren(
      h("loading-spinner", { label: "Getting it ready", inline: true }), " Still working. Your whole site is being put together."), 8000);
    stage.replaceChildren(h("p", { class: "studio-preview-wait studio-row" }, h("loading-spinner", { label: "Getting it ready", inline: true }), " Getting it ready…"));
    try {
      const reply = await request();
      const problems = Array.isArray(reply.recipeProblems) ? reply.recipeProblems : [];
      notes.replaceChildren(problems.length && problemsView ? problemsView(problems, close) : "");
      const frame = h("iframe", { class: "studio-preview-frame", title: frameTitle });
      frame.setAttribute("sandbox", "allow-scripts");
      frame.setAttribute("src", reply.previewUrl);
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
