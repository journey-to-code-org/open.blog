// The cover photo: add one from the phone or computer, or use a picture already on the site, then
// describe it for people who can't see it. Fires "change" with { cover, coverAlt }.
import { h } from "./dom.js";
import { use } from "../zubra.js";
import { choosePicture, photoProblem, uploadPhoto } from "./picture-picker.js";

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
          h("action-button", { variant: "secondary", onClick: () => { state.cover = ""; state.coverAlt = ""; draw(); changed(); body.querySelector("input[type=file]")?.focus(); } }, "Change the photo"),
          h("action-button", { variant: "ghost", onClick: () => { state.cover = ""; state.coverAlt = ""; draw(); changed(); } }, "Remove it")));
    } else {
      const drop = h("file-drop", { label: "Add a photo", hint: "From your phone or computer.", accept: "image/*", multiple: false, "max-size": maxBytes ? Math.floor(maxBytes / 1048576) : 0 });
      drop.addEventListener("fileschange", (e) => { const [file] = e.detail || []; if (file) upload(file); });
      body.replaceChildren(drop, h("action-button", { variant: "secondary", onClick: chooseFromSite }, "Use a photo already on my site"));
    }
  }

  async function upload(file) {
    problem.replaceChildren();
    body.replaceChildren(h("loading-spinner", { label: "Adding your photo…", inline: true }), h("span", { text: " Adding your photo…" }));
    try {
      state.cover = await uploadPhoto(api, file);
      draw();
      changed();
      root.querySelector("text-field input")?.focus();
    } catch (error) {
      draw();
      problem.replaceChildren(photoProblem(file, error));
    }
  }

  async function chooseFromSite() {
    const picked = await choosePicture(api, { heading: "Choose a cover photo", describe: false, maxBytes });
    if (!picked) return;
    state.cover = picked.url;
    state.coverAlt = "";
    draw();
    changed();
    setTimeout(() => root.querySelector("text-field input")?.focus(), 0);
  }

  draw();
  return { element: root, value: () => ({ ...state }) };
}
