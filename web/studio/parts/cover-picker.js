// The cover photo: add one from the phone or computer, or use a picture already on the site, then
// describe it for people who can't see it. Fires "change" with { cover, coverAlt }.
import { h } from "./dom.js";
import { use } from "../zubra.js";

export async function coverPicker({ api, cover = "", coverAlt = "", maxBytes = 0, onChange }) {
  await use("file-drop", "action-button", "text-field", "modal-dialog", "loading-spinner", "alert-banner");
  const state = { cover, coverAlt };
  const root = h("fieldset", { class: "studio-cover" }, h("legend", { text: "Cover photo" }));
  const body = h("div", { class: "studio-cover-body" });
  const problem = h("div", { "aria-live": "assertive" });
  root.append(problem, body);

  const changed = () => onChange?.({ ...state });

  function draw() {
    if (state.cover) {
      const alt = h("text-field", {
        label: "Describe the picture", value: state.coverAlt,
        description: "For people who can't see it, like “Pumpkin bread sliced on a board”.",
        onValuechange: (e) => { state.coverAlt = e.detail; changed(); },
      });
      body.replaceChildren(
        h("img", { class: "studio-cover-img", src: state.cover, alt: state.coverAlt || "The cover photo" }),
        alt,
        h("div", { class: "studio-row" },
          h("action-button", { variant: "secondary", onClick: () => { state.cover = ""; draw(); changed(); } }, "Change the photo"),
          h("action-button", { variant: "ghost", onClick: () => { state.cover = ""; state.coverAlt = ""; draw(); changed(); } }, "Remove it")));
    } else {
      const drop = h("file-drop", { label: "Add a photo", hint: "From your phone or computer.", accept: "image/*", multiple: false, "max-size": maxBytes ? Math.floor(maxBytes / 1048576) : 0 });
      drop.addEventListener("fileschange", (e) => { const [file] = e.detail || []; if (file) upload(file); });
      body.replaceChildren(drop, h("action-button", { variant: "secondary", onClick: chooseFromSite }, "Use a picture already on my site"));
    }
  }

  async function upload(file) {
    problem.replaceChildren();
    body.replaceChildren(h("loading-spinner", { label: "Adding your photo…", inline: true }), h("span", { text: " Adding your photo…" }));
    try {
      const reply = await api.call("POST", `upload?name=${encodeURIComponent(file.name || "photo.jpg")}`, {
        body: file, headers: { "Content-Type": "application/octet-stream" },
      });
      state.cover = reply.url;
      draw();
      changed();
      root.querySelector("text-field input")?.focus();
    } catch (error) {
      draw();
      problem.replaceChildren(h("alert-banner", { variant: "danger", heading: "That photo didn't go in" }, error.message));
    }
  }

  async function chooseFromSite() {
    const grid = h("ul", { class: "studio-picture-grid", "aria-label": "Pictures on your site" }, h("li", {}, h("loading-spinner", { label: "Loading your pictures" })));
    const dialog = h("modal-dialog", { label: "Pictures on your site", class: "studio-dialog studio-dialog-wide" },
      h("span", { slot: "heading", text: "Pictures on your site" }), grid,
      h("action-button", { slot: "actions", variant: "secondary", "data-close": true }, "Never mind"));
    dialog.addEventListener("openchange", (e) => { if (!e.detail) dialog.remove(); });
    document.body.append(dialog);
    dialog.open = true;
    try {
      const { images = [] } = await api.get("images");
      const usable = images.filter((img) => typeof img.url === "string" && img.url.startsWith("/images/"));
      if (!usable.length) {
        grid.replaceChildren(h("li", { text: "There are no pictures on your site yet. Close this and add one from your phone or computer." }));
        return;
      }
      grid.replaceChildren(...usable.map((img) => h("li", {},
        h("button", { type: "button", class: "studio-picture", onClick: () => { state.cover = img.url; dialog.open = false; draw(); changed(); } },
          h("img", { src: img.url, alt: "", loading: "lazy" }),
          h("span", { text: img.name || img.url.split("/").pop() })))));
    } catch (error) {
      grid.replaceChildren(h("li", { text: error.message }));
    }
  }

  draw();
  return { element: root, value: () => ({ ...state }) };
}
