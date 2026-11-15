// Choosing a photo: add one from the phone or computer, or use one already on the site, and (when it
// goes into her words) describe it. Shared by the cover photo, "Put a photo in" and Pictures.
import { h } from "./dom.js";
import { say } from "./words.js";
import { use } from "../zubra.js";

/** Upload one photo; resolves to its address. Throws an ApiError with the server's plain sentence. */
export async function uploadPhoto(api, file) {
  const reply = await api.call("POST", `upload?name=${encodeURIComponent(file.name || "photo.jpg")}`, {
    body: file, headers: { "Content-Type": "application/octet-stream" },
  });
  return reply.url;
}

/** The pictures on the site, newest first: { images: [{ url, name }], more }. */
export async function sitePictures(api) {
  const { images = [], more = false } = await api.get("images");
  return { images: images.filter((img) => typeof img.url === "string" && img.url.startsWith("/images/")), more };
}

/** A readable name for a picture: "pumpkin-pie-2.jpg" → "pumpkin pie 2". */
export function pictureName(img) {
  const base = String(img.name || img.url.split("/").pop() || "picture").replace(/\.[a-z0-9]+$/i, "");
  return base.replace(/[-_]+/g, " ").trim() || "picture";
}

/** A tile button for one picture. */
export function pictureTile(img, onChoose) {
  return h("li", {},
    h("button", { type: "button", class: "studio-picture", onClick: () => onChoose(img) },
      h("img", { src: img.url, alt: "", loading: "lazy" }),
      h("span", { text: pictureName(img) })));
}

/** "This photo didn't go in" and the server's reason. (Studio's policy has no blob: images, so no thumbnail.) */
export function photoProblem(file, error) {
  return h("alert-banner", { variant: "danger", heading: "This photo didn't go in" }, error.message);
}

/**
 * Ask for a photo in a dialog. With `describe`, a second step asks her to describe it (required).
 * Resolves to { url, description } or null if she closes it.
 */
export async function choosePicture(api, { heading = "Put a photo in", describe = true, maxBytes = 0 } = {}) {
  await use("modal-dialog", "file-drop", "action-button", "text-field", "loading-spinner", "alert-banner");
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      dialog.open = false;
      dialog.remove();
      resolve(value);
    };
    const body = h("div", { class: "studio-picker" });
    const close = h("action-button", { slot: "actions", variant: "secondary", onClick: () => finish(null) }, "Never mind");
    const dialog = h("modal-dialog", { label: heading, class: "studio-dialog studio-dialog-wide" },
      h("span", { slot: "heading", text: heading }), body, close);
    dialog.addEventListener("openchange", (e) => { if (!e.detail) finish(null); });

    function stepOne() {
      const problem = h("div", { "aria-live": "assertive" });
      const drop = h("file-drop", { label: "Add a photo", hint: "From your phone or computer.", accept: "image/*", multiple: false, "max-size": maxBytes ? Math.floor(maxBytes / 1048576) : 0 });
      drop.addEventListener("fileschange", async (e) => {
        const [file] = e.detail || [];
        if (!file) return;
        body.replaceChildren(h("p", { class: "studio-row" }, h("loading-spinner", { label: "Adding your photo…", inline: true }), " Adding your photo…"));
        try {
          const url = await uploadPhoto(api, file);
          chosen({ url, name: file.name });
        } catch (error) {
          stepOne();
          body.querySelector("[aria-live]")?.replaceChildren(photoProblem(file, error));
        }
      });
      const grid = h("ul", { class: "studio-picture-grid", "aria-label": "Photos already on your site" }, h("li", {}, h("loading-spinner", { label: "Loading your photos" })));
      body.replaceChildren(problem, drop, h("h3", { class: "studio-label", text: "Or use one already on your site" }), grid);
      sitePictures(api).then(({ images }) => {
        grid.replaceChildren(...(images.length ? images.map((img) => pictureTile(img, chosen)) : [h("li", { text: "There are no photos on your site yet. Add one above." })]));
      }).catch((error) => grid.replaceChildren(h("li", { text: error.message })));
      requestAnimationFrame(() => body.querySelector("input[type=file], button")?.focus());
    }

    function chosen(img) {
      if (!describe) return finish({ url: img.url, description: "" });
      const field = h("text-field", { label: "Describe the photo", description: say("photo.altHelp") });
      const put = h("action-button", { onClick: () => {
        const description = String(field.value || "").trim();
        if (!description) {
          field.error = "Describe the photo first, so everyone can enjoy it.";
          field.querySelector("input")?.focus();
          return;
        }
        finish({ url: img.url, description });
      } }, "Put it in");
      body.replaceChildren(
        h("img", { class: "studio-cover-img", src: img.url, alt: "" }),
        field,
        h("cluster-layout", { gap: "0.5rem" }, put, h("action-button", { variant: "secondary", onClick: stepOne }, "Choose another")));
      requestAnimationFrame(() => field.querySelector("input")?.focus());
    }

    document.body.append(dialog);
    dialog.open = true;
    stepOne();
  });
}
