// <ob-quote> enhances the quote form. The form is complete without it: a plain post to the hosted
// function, which answers with a page. With JavaScript this adds the single-use form token, checks
// before sending, photo shrinking and upload progress, and a confirmation in place. It sends only
// to its own `endpoint` and keeps nothing in the browser.
import { SHRINK_STEPS, MAX_PHOTO_BYTES, fieldErrors, fitSize, photoError, photosFit, serverMessage } from "./ob-quote-model.js";

const FIELDS = ["name", "phone", "email", "town", "service", "description"];

async function shrink(file) {
  if (file.size <= MAX_PHOTO_BYTES) return file;
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }
  for (const edge of SHRINK_STEPS) {
    const { width, height } = fitSize(bitmap.width, bitmap.height, edge);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d").drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise((done) => canvas.toBlob(done, "image/jpeg", 0.8));
    if (blob && blob.size <= MAX_PHOTO_BYTES) return new File([blob], "photo.jpg", { type: "image/jpeg" });
  }
  return file;
}

class ObQuote extends HTMLElement {
  #form = null;
  #token = "";

  connectedCallback() {
    this.#form = this.querySelector("form");
    if (!this.#form || this.#form.dataset.enhanced) return;
    this.#form.dataset.enhanced = "true";
    this.#form.noValidate = true;
    this.#form.elements.page.value = location.pathname;
    this.#form.addEventListener("submit", (event) => this.#submit(event));
    this.#fetchToken();
  }

  get #base() {
    return (this.getAttribute("endpoint") || "").replace(/\/$/, "");
  }

  async #fetchToken() {
    try {
      const response = await fetch(`${this.#base}/token`, { credentials: "omit", headers: { accept: "application/json" } });
      if (response.ok) this.#token = (await response.json()).token || "";
    } catch {
      this.#token = "";
    }
  }

  #status(text) {
    const status = this.#form.querySelector(".ob-quote-status");
    if (status) status.textContent = text;
  }

  #showErrors(errors) {
    let first = null;
    for (const name of [...FIELDS, "photos"]) {
      const input = this.#form.elements[name];
      const slot = input ? this.#form.querySelector(`[id="${input.id}-error"]`) : null;
      if (!input || !slot) continue;
      const message = errors[name] || "";
      slot.textContent = message;
      if (message) {
        input.setAttribute("aria-invalid", "true");
        first ||= input;
      } else {
        input.removeAttribute("aria-invalid");
      }
    }
    return first;
  }

  async #submit(event) {
    // No token yet (offline, or the function is off): let the browser post the form as it is.
    if (!this.#token) return;
    event.preventDefault();
    const values = Object.fromEntries(FIELDS.map((name) => [name, this.#form.elements[name].value]));
    const errors = fieldErrors(values);
    const files = [...this.#form.elements.photos.files];
    const photoProblem = photoError(files);
    if (photoProblem) errors.photos = photoProblem;
    const first = this.#showErrors(errors);
    if (first) {
      this.#status("Some details need fixing. The fields are marked below.");
      first.focus();
      return;
    }
    const button = this.#form.querySelector(".ob-quote-send");
    const progress = this.#form.querySelector(".ob-quote-progress");
    button.disabled = true;
    this.#status("Sending your request.");
    const data = new FormData();
    for (const name of [...FIELDS, "website", "page"]) data.set(name, this.#form.elements[name].value);
    data.set("token", this.#token);
    const photos = await Promise.all(files.map(shrink));
    if (!photosFit(photos.map((photo) => photo.size))) {
      this.#showErrors({ photos: "These photos are too large. Choose fewer or smaller photos." });
      this.#status("Your photos are too large.");
      button.disabled = false;
      return;
    }
    photos.forEach((photo) => data.append("photos", photo));
    const result = await new Promise((done) => {
      const request = new XMLHttpRequest();
      request.open("POST", `${this.#base}/submit`);
      request.setRequestHeader("accept", "application/json");
      request.upload.onprogress = (progressEvent) => {
        if (!progressEvent.lengthComputable) return;
        progress.hidden = false;
        progress.value = Math.round((progressEvent.loaded / progressEvent.total) * 100);
      };
      request.onload = () => {
        let body = {};
        try {
          body = JSON.parse(request.responseText);
        } catch {
          // A plain page: the status decides.
        }
        done({ status: request.status, body });
      };
      request.onerror = () => done({ status: 0, body: {} });
      request.send(data);
    });
    progress.hidden = true;
    if (result.status === 200 || result.status === 201) {
      const done = document.createElement("p");
      done.className = "ob-quote-done";
      done.setAttribute("role", "status");
      done.tabIndex = -1;
      done.textContent = "Thank you. We have your request and will get back to you.";
      this.#form.replaceWith(done);
      done.focus();
      return;
    }
    // A token sends one request: fetch a fresh one before the next try.
    this.#token = "";
    this.#fetchToken();
    const fields = Object.fromEntries((result.body.fields || []).map((item) => [item.field, "Please check this field."]));
    const firstBad = this.#showErrors(fields);
    this.#status(serverMessage(result.status, result.body.error));
    button.disabled = false;
    firstBad?.focus();
  }
}

if (!customElements.get("ob-quote")) customElements.define("ob-quote", ObQuote);
