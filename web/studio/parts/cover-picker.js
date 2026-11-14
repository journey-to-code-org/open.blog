// The cover photo: add one from the phone or computer, or use a picture already on the site, then
// describe it for people who can't see it, and say who took it (Photo by, R5). Calls `onChange`
// with { cover, coverAlt, coverCredit }. Changing or removing the photo clears both.
import { h } from "./dom.js";
import { use } from "../zubra.js";
import { choosePicture, photoProblem, uploadPhoto } from "./picture-picker.js";

export async function coverPicker({ api, cover = "", coverAlt = "", coverCredit = "", maxBytes = 0, onChange }) {
  await use("file-drop", "action-button", "text-field", "modal-dialog", "loading-spinner", "alert-banner");
  const state = { cover, coverAlt, coverCredit };
  const clear = () => { state.cover = ""; state.coverAlt = ""; state.coverCredit = ""; };
  const root = h("fieldset", { class: "studio-cover" }, h("legend", { text: "Cover photo" }));
  const body = h("div", { class: "studio-cover-body" });
  const problem = h("div", { "aria-live": "assertive" });
  root.append(problem, body);

  const changed = () => onChange?.({ ...state });

  function draw() {
    if (state.cover) {
      const notYet = h("p", { class: "studio-help", text: "Not described yet. A few words let everyone enjoy it, including people who use a screen reader.", hidden: Boolean(String(state.coverAlt || "").trim()) });
      const alt = h("text-field", {
        label: "Describe the picture", value: state.coverAlt,
        description: "For people who can't see it, like “Pumpkin bread sliced on a board”.",
        onValuechange: (e) => { state.coverAlt = e.detail; notYet.hidden = Boolean(String(e.detail || "").trim()); changed(); },
      });
      const credit = h("text-field", {
        label: "Photo by", value: state.coverCredit, maxlength: 200,
        description: "If someone else took it, their name. Leave empty if you did.",
        onValuechange: (e) => { state.coverCredit = String(e.detail || ""); changed(); },
      });
      const elsewhere = /^https?:\/\//i.test(state.cover) && !state.cover.startsWith(globalThis.location?.origin || "-");
      body.replaceChildren(
        h("img", { class: "studio-cover-img", src: state.cover, alt: state.coverAlt || "The cover photo" }),
        elsewhere ? h("p", { class: "studio-help", text: "This photo is on another website." }) : null,
        alt, notYet, credit,
        h("div", { class: "studio-row" },
          h("action-button", { variant: "secondary", onClick: () => { clear(); draw(); changed(); body.querySelector("input[type=file]")?.focus(); } }, "Change the photo"),
          h("action-button", { variant: "ghost", onClick: () => { clear(); draw(); changed(); } }, "Remove it")));
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
    state.coverCredit = "";
    draw();
    changed();
    setTimeout(() => root.querySelector("text-field input")?.focus(), 0);
  }

  draw();
  return {
    element: root,
    value: () => ({ ...state }),
    /** A cover by web address (Details): shown at once, words and Photo by kept. */
    setAddress(url) { if (url === state.cover) return; state.cover = url; draw(); changed(); },
    focusCredit: () => root.querySelectorAll("text-field")[1]?.querySelector("input")?.focus(),
  };
}
