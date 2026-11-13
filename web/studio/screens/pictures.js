// Pictures: every photo on her site, newest first, and a place to add more. Tapping one shows it
// large with its address (for whoever set up the site).
import { h, toast } from "../parts/dom.js";
import { use } from "../zubra.js";
import { photoProblem, pictureName, pictureTile, sitePictures, uploadPhoto } from "../parts/picture-picker.js";

export async function createPictures({ api, meta }) {
  await use("file-drop", "auto-grid", "empty-state", "skeleton-block", "alert-banner", "side-sheet", "action-button", "loading-spinner");
  let images = [];
  let more = false;
  const maxBytes = meta.capture?.maxPhotoBytes || 0;
  const lede = h("p", { class: "studio-lede", role: "status" });
  const problems = h("div", { class: "studio-banner", "aria-live": "assertive" });
  const drop = () => {
    const zone = h("file-drop", { label: "Add photos", hint: "From your phone or computer. You can choose more than one.", accept: "image/*", multiple: true, "max-size": maxBytes ? Math.floor(maxBytes / 1048576) : 0 });
    zone.addEventListener("fileschange", (e) => add([...(e.detail || [])]));
    return zone;
  };
  const grid = h("ul", { class: "studio-picture-grid studio-picture-grid-page", "aria-label": "Photos on your site" });
  const list = h("div", { class: "studio-list", "aria-busy": "true" }, h("skeleton-block", { lines: 4 }));
  const sheet = h("side-sheet", { label: "Photo", side: "right" });
  const element = h("section", { class: "studio-page", "aria-labelledby": "studio-pictures-h" },
    h("h2", { id: "studio-pictures-h", class: "studio-visually-hidden", tabindex: "-1", text: "Pictures" }),
    lede, problems, h("div", { class: "studio-pictures-add" }, drop()), list, sheet);

  function draw() {
    list.removeAttribute("aria-busy");
    lede.textContent = more ? "Your newest 300 photos" : images.length === 1 ? "1 photo on your site" : `${images.length} photos on your site`;
    if (!images.length) {
      element.querySelector(".studio-pictures-add").hidden = true;
      list.replaceChildren(h("empty-state", { heading: "No photos yet" }, "Photos you add here or to a post will show up here.", h("div", { slot: "actions" }, drop())));
      return;
    }
    element.querySelector(".studio-pictures-add").hidden = false;
    grid.replaceChildren(...images.map((img) => pictureTile(img, show)));
    list.replaceChildren(grid, more ? h("p", { class: "studio-help", text: "Older photos are still on your site and in your posts." }) : null);
  }

  function show(img) {
    const address = new URL(img.url, location.origin).pathname;
    sheet.replaceChildren(
      h("span", { slot: "heading", text: pictureName(img) }),
      h("img", { class: "studio-sheet-img", src: img.url, alt: "" }),
      h("dl", { class: "studio-details" }, h("dt", { text: "Address" }), h("dd", { class: "studio-mono", text: address })),
      h("action-button", { variant: "secondary", onClick: async () => {
        try { await navigator.clipboard.writeText(address); toast("Copied the address."); } catch { toast("Select the address and copy it yourself.", { variant: "warning" }); }
      } }, "Copy the address"));
    sheet.open = true;
  }

  async function add(files) {
    if (!files.length) return;
    problems.replaceChildren();
    const pending = files.map((file) => {
      const tile = h("li", { class: "studio-picture studio-picture-pending" }, h("loading-spinner", { label: `Adding ${file.name}` }), h("span", { text: "Adding…" }));
      grid.prepend(tile);
      return tile;
    });
    if (!images.length) { images = []; list.replaceChildren(grid); }
    let added = 0;
    for (const [index, file] of files.entries()) {
      try {
        const url = await uploadPhoto(api, file);
        const img = { url, name: file.name };
        images.unshift(img);
        pending[index].replaceWith(pictureTile(img, show));
        added += 1;
      } catch (error) {
        pending[index].remove();
        problems.append(photoProblem(file, error));
      }
    }
    if (added) toast(added === 1 ? "Photo added." : `Added ${added} photos.`);
    draw();
  }

  async function load() {
    try {
      ({ images, more } = await sitePictures(api));
      draw();
    } catch (error) {
      list.removeAttribute("aria-busy");
      list.replaceChildren(h("alert-banner", { variant: "danger", heading: "Your photos didn't load" }, error.message,
        h("action-button", { variant: "secondary", onClick: load }, "Try again")));
    }
  }

  return {
    title: "Pictures",
    element,
    load,
    palette: [{ id: "add-photos", label: "Add photos", group: "Pictures" }],
    command(id) {
      if (id === "add-photos") element.querySelector(".studio-pictures-add input[type=file]")?.click();
    },
  };
}
