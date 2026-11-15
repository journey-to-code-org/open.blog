// Things it can read (Studio R8), under For {helper} on the Writing helper screen: where her notes
// are kept (and Move), text {helper} adds, and a web page fetched once. Removing has Undo (the
// same text added again, from this page's memory).
//
// Text from a web page is someone else's words: it is fetched only on an explicit, confirmed Get
// it once, shown read-only before it is kept, and never fetched again. Everything is shown as text.
import { fill, h, toast } from "./dom.js";
import { say } from "./words.js";
import { ask } from "./dialogs.js";
import { NOTE_MAX_BYTES, pageAddressOk, pageFileId, referenceNameOk, utf8Length } from "./helper-context-rules.js";

const whereOptions = () => [{ value: "private", label: say("hsetup.private") }, { value: "portable", label: say("hsetup.shared") }];
const item = (id) => `assistant/context/item?id=${encodeURIComponent(id)}`;

/** `notes()` gives the screen's note fields (`{ type, label, field }`), for Where it's kept and Move. */
export function createReads({ api, notes, onChanged }) {
  const status = h("div", { class: "studio-help studio-row-note studio-row", role: "status", "aria-live": "polite" });
  const kept = h("ul", { class: "studio-ready-list" });
  const texts = h("ul", { class: "studio-ready-list studio-reads-list" });
  const name = h("text-field", { label: say("hsetup.textName"), "data-read": "name", maxlength: 100, autocomplete: "off" });
  const where = h("select-field", { label: say("hsetup.where"), options: whereOptions(), value: "private" });
  const text = h("text-field", { label: say("hsetup.text"), rows: 6, "data-read": "text" });
  const add = h("action-button", { variant: "secondary", onClick: () => addText() }, say("hsetup.add"));
  const address = h("text-field", { label: say("hsetup.pageAddress"), type: "url", inputmode: "url", "data-read": "address", autocomplete: "off" });
  const get = h("action-button", { variant: "secondary", onClick: () => getPage() }, say("hsetup.getOnce"));
  const page = h("div", { class: "studio-form-fields", "aria-live": "polite" });
  const element = h("section", { class: "studio-helper-section", "aria-labelledby": "studio-reads-h" },
    h("h3", { id: "studio-reads-h", text: say("hsetup.reads") }), kept, status,
    h("h4", { text: say("hsetup.texts") }), texts, h("div", { class: "studio-form-fields" }, name, where, text, h("div", {}, add)),
    h("h4", { text: say("hsetup.page") }), h("p", { class: "studio-help", text: say("hsetup.pageHelp") }), h("div", { class: "studio-form-fields" }, address, h("div", {}, get)), page);
  let catalog = {};

  const tell = (words, undo = null) => fill(status, h("span", { text: words }), undo ? h("action-button", { variant: "secondary", size: "sm", onClick: undo }, say("found.undo")) : "");
  const failed = (error) => tell(say("hsetup.notDone", { why: String(error?.data?.error || error?.message || "").slice(0, 160) }));

  async function load() {
    try {
      catalog = await api.get("assistant/context?content=none");
    } catch {
      tell(say("hsetup.cantLoad"));
      return;
    }
    draw();
  }

  function draw() {
    fill(kept, ...notes().map(({ label, field }) => {
      const doc = field.doc();
      if (!doc?.exists) return null;
      return h("li", { class: "studio-ready-item" }, h("strong", { text: label }), h("span", { class: "studio-help studio-mono", text: field.kept() }),
        h("div", {}, h("action-button", { variant: "secondary", size: "sm", label: say("hsetup.moveName", { name: label }), onClick: () => move(field) }, say("hsetup.move"))));
    }));
    // A kept web page is a text in the same place: each is listed once.
    const seen = new Set();
    const all = [...(catalog.references || []), ...(catalog.documents || []).filter((doc) => doc.contextType === "reference")]
      .filter((doc) => doc.exists && !seen.has(`${doc.visibility}:${doc.name}`) && seen.add(`${doc.visibility}:${doc.name}`));
    fill(texts, ...all.map((doc) => h("li", { class: "studio-ready-item", "data-read-id": String(doc.id) },
      h("strong", { text: String(doc.name).slice(0, 100) }),
      h("span", { class: "studio-help", text: say("hsetup.readLine", { where: doc.visibility === "private" ? say("hsetup.private") : say("hsetup.shared"), letters: Number(doc.characters || 0).toLocaleString("en-US") }) }),
      h("div", {}, h("action-button", { variant: "secondary", size: "sm", label: say("hsetup.removeName", { name: String(doc.name).slice(0, 100) }), onClick: () => removeText(doc) }, say("hsetup.remove"))))));
  }

  /** Move a note between private and shared: written to the other place first, then removed here. */
  async function move(field) {
    await field.flush();
    const doc = field.doc();
    if (!doc?.exists) return;
    const to = doc.visibility === "private" ? "portable" : "private";
    try {
      const content = String((await api.get(item(doc.id)))?.content ?? "");
      await api.call("PUT", "assistant/context", { json: { contextType: doc.contextType, visibility: to, content, etag: null } });
      await api.call("DELETE", "assistant/context", { json: { contextType: doc.contextType, visibility: doc.visibility, etag: doc.etag } });
      await field.load();
      await load();
      tell(say("hsetup.moved"));
      onChanged?.();
    } catch (error) {
      if (error?.status === 409) tell(say("hsetup.moveTaken")); else failed(error);
    }
  }

  async function addText() {
    const file = String(name.value || "").trim();
    const content = String(text.value || "");
    name.error = "";
    text.error = "";
    if (!referenceNameOk(file)) { name.error = say("hsetup.nameBad"); name.querySelector("input")?.focus(); return; }
    if (!content.trim()) { text.error = say("hsetup.textEmpty"); text.querySelector("textarea")?.focus(); return; }
    if (utf8Length(content) > NOTE_MAX_BYTES) { text.error = say("hsetup.textTooLong"); text.querySelector("textarea")?.focus(); return; }
    add.loading = true;
    try {
      await api.call("POST", "assistant/reference", { json: { name: file, visibility: String(where.value || "private"), content } });
      name.value = "";
      text.value = "";
      await load();
      tell(say("hsetup.added"));
      onChanged?.();
    } catch (error) {
      if (error?.status === 409) name.error = say("hsetup.nameTaken");
      else if (error?.status === 413) text.error = say("hsetup.textTooLong");
      else failed(error);
    } finally {
      add.loading = false;
    }
  }

  async function removeText(doc) {
    try {
      // Its words first, kept only in this page's memory, so Undo can add the same text again.
      const content = String((await api.get(item(doc.id)))?.content ?? "");
      await api.call("DELETE", "assistant/reference", { json: { name: doc.name, visibility: doc.visibility, etag: doc.etag } });
      await load();
      toast(say("hsetup.removed"));
      tell(say("hsetup.removed"), async () => {
        try {
          await api.call("POST", "assistant/reference", { json: { name: doc.name, visibility: doc.visibility, content } });
          await load();
          tell(say("hsetup.backAgain"));
        } catch (error) { failed(error); }
      });
      onChanged?.();
    } catch (error) {
      failed(error);
    }
  }

  async function getPage() {
    const url = String(address.value || "").trim();
    address.error = "";
    if (!pageAddressOk(url)) { address.error = say("hsetup.pageBad"); address.querySelector("input")?.focus(); return; }
    const choice = await ask({ heading: say("hsetup.getHeading"), text: [url, say("hsetup.getText")], choices: [{ label: say("hsetup.getIt"), value: "get" }, { label: say("hsetup.notNow"), value: "no", variant: "secondary" }], focus: 1 });
    if (choice !== "get") { get.querySelector("button")?.focus(); return; }
    get.loading = true;
    fill(page, h("p", { class: "studio-help", text: say("hsetup.getting") }));
    try {
      const { snapshot } = await api.call("POST", "assistant/context/url/retrieve", { json: { url, confirmed: true } });
      const fileId = h("text-field", { label: say("hsetup.pageName"), value: pageFileId(snapshot.canonicalUrl), maxlength: 60, autocomplete: "off" });
      const keepWhere = h("select-field", { label: say("hsetup.where"), options: whereOptions(), value: "private" });
      const keep = h("action-button", { onClick: async () => {
        keep.loading = true;
        try {
          await api.call("POST", "assistant/context/url/save", { json: { confirmed: true, visibility: String(keepWhere.value || "private"), fileId: String(fileId.value || "").trim(), snapshot } });
          page.replaceChildren();
          address.value = "";
          await load();
          tell(say("hsetup.kept"));
          onChanged?.();
        } catch (error) {
          fileId.error = error?.status === 409 ? say("hsetup.nameTaken") : say("hsetup.notDone", { why: String(error?.data?.error || error?.message || "").slice(0, 160) });
        } finally {
          keep.loading = false;
        }
      } }, say("hsetup.keepIt2"));
      fill(page, 
        h("p", { class: "studio-help", role: "status", text: say("hsetup.got") }),
        h("p", { class: "studio-help studio-mono", text: say("hsetup.pageFacts", { source: String(snapshot.sourceUrl).slice(0, 70), final: String(snapshot.canonicalUrl).slice(0, 70), when: String(snapshot.retrievedAt).slice(0, 30), type: String(snapshot.contentType).slice(0, 30) }) }),
        h("h4", { text: say("hsetup.pageText") }),
        h("pre", { class: "studio-goes-exact", tabindex: "0", "aria-label": say("hsetup.pageText"), text: String(snapshot.text ?? "") }),
        fileId, keepWhere, h("div", {}, keep));
      fileId.querySelector("input")?.focus();
    } catch (error) {
      fill(page, h("p", { class: "studio-help studio-row-note", role: "status", text: say("hsetup.notDone", { why: String(error?.data?.error || error?.message || "").slice(0, 160) }) }));
    } finally {
      get.loading = false;
    }
  }

  return { element, load, dirty: () => Boolean(String(text.value || "").trim()) };
}
