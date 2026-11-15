// A page or a collection: its title (or name), one line about it, whether it's in the site's menu
// (pages), its look, and its words. Pages and collections are on the site as soon as they're saved,
// so there's one button, Save, and it says where the change went. Leaving with changes asks first;
// a change made on another device is never overwritten without asking. Studio slice 4.
import { h, toast } from "../parts/dom.js";
import { use } from "../zubra.js";
import { ask } from "../parts/dialogs.js";
import { createBodyHost } from "../parts/body-host.js";
import { showPreview } from "../parts/preview.js";
import { onlyChanges } from "../parts/post-fields.js";
import { sendOut, siteLink, wentOutWords } from "../parts/publish.js";
import { editHref, isOn, kindFields, nameKeyOf } from "../parts/doc-kinds.js";
import { askWhichToKeep } from "../parts/conflict.js";

const SAME = "";

export async function createPageEdit(context, k, arg) {
  const { api, meta } = context;
  await use("text-field", "toggle-switch", "select-field", "action-button", "dropdown-menu", "breadcrumb-trail", "alert-banner", "side-sheet");
  let path = arg && arg !== "new" ? arg : "";
  const doc = { etag: "", fields: {}, url: "" };
  let baseline = "";
  let busy = false;
  let menuWas = false; // the menu switch as the file has it
  let lastSaid = ""; // what the last save really did, in her words

  const trail = h("breadcrumb-trail", { items: [{ label: "Home", href: "#/" }, { label: k.heading.replace("Your ", "").replace(/^./, (c) => c.toUpperCase()), href: `#/${k.list}` }, { label: k.newTitle, href: "" }] });
  const status = h("p", { class: "studio-status", role: "status" });
  const banner = h("div", { class: "studio-banner", "aria-live": "polite" });
  const name = h("text-field", { label: k.nameLabel, class: "studio-writing studio-writing-title", maxlength: 200, onValuechange: () => changed() });
  const description = h("text-field", { label: "About it, in one line", description: k.describe, maxlength: 300, onValuechange: () => changed() });
  const inMenu = k.menu ? h("toggle-switch", { label: "Show it in your site's menu", description: "A link to it at the top of every page.", onCheckedchange: () => changed() }) : null;
  const looks = [{ value: SAME, label: "The same as the rest of your site" }, ...(meta.themes || []).map((t) => ({ value: t.name, label: t.label || t.name })).sort((a, b) => a.label.localeCompare(b.label))];
  const look = h("select-field", { label: "Look", options: looks, value: SAME, description: "A look of its own stays the same whatever the season.", onValuechange: () => changed() });
  const body = await createBodyHost({ api, maxBytes: meta.capture?.maxPhotoBytes || 0, onChange: () => changed() });
  const save = h("action-button", { onClick: () => saveNow() }, "Save");
  const see = h("action-button", { variant: "secondary", onClick: (e) => preview(e.currentTarget) }, "See how it looks");
  const more = h("dropdown-menu", { label: "More", items: [], onItemselect: (e) => run(e.detail) });
  const details = h("side-sheet", { label: `About this ${k.one}`, side: "right" });
  const heading = h("h2", { id: "studio-page-edit-h", class: "studio-visually-hidden", tabindex: "-1", text: k.newTitle });
  const element = h("section", { class: "studio-page studio-write", "aria-labelledby": "studio-page-edit-h" },
    h("div", { class: "studio-write-top" }, trail, more), heading, status, banner,
    h("div", { class: "studio-write-grid" },
      h("div", { class: "studio-write-main" }, name, body.element),
      h("div", { class: "studio-write-side" }, description, inMenu, look)),
    h("div", { class: "studio-write-bar" }, see, save), details);

  const read = () => ({ name: String(name.value || ""), description: String(description.value || ""), inMenu: Boolean(inMenu?.checked), look: look.value || SAME, body: body.text() });
  const snapshot = () => JSON.stringify(read());
  const isDirty = () => Boolean(baseline) && snapshot() !== baseline;
  const label = () => read().name.trim() || k.newTitle;

  function paint() {
    trail.items = [...trail.items.slice(0, 2), { label: label(), href: "" }];
    heading.textContent = label();
    context.setTitle?.(label());
    status.replaceChildren(!path ? `A new ${k.one}. Give it a ${k.nameLabel.toLowerCase()}, then Save.`
      : isDirty() ? "Changes not saved yet." : lastSaid || "Changes you make go on your site when you Save.");
    if (path && doc.url && !isDirty() && !lastSaid) status.append(" ", h("a", { href: siteLink(meta, doc.url), target: "_blank", rel: "noopener", text: "See it on your site" }));
    more.items = [
      ...(path ? [{ value: "delete", label: `Delete this ${k.one}` }] : []),
      { value: "details", label: "Show details" },
    ];
  }

  function changed() { banner.replaceChildren(); paint(); }

  async function fill(reply) {
    const f = reply.fields || {};
    name.value = String(f[nameKeyOf(k, f)] ?? "");
    description.value = String(f.description ?? "");
    menuWas = isOn(f.nav);
    if (inMenu) inMenu.checked = menuWas;
    // A look Studio doesn't list (a theme added by hand) is kept, not cleared.
    if (f.theme && !looks.some((l) => l.value === f.theme)) look.options = [...looks, { value: String(f.theme), label: `${f.theme} (its own look)` }];
    look.value = f.theme ? String(f.theme) : SAME;
    await body.set(String(reply.body ?? ""), { boxes: false });
    doc.etag = reply.etag || "";
    doc.fields = { ...f };
    doc.url = reply.url || doc.url;
    baseline = snapshot();
    paint();
  }

  async function saveNow({ force = false } = {}) {
    if (busy) return false;
    const values = read();
    if (values.name.trim().length < 2) {
      name.error = `Give it a ${k.nameLabel.toLowerCase()} first.`;
      name.querySelector("input")?.focus();
      return false;
    }
    name.error = "";
    if (path && !isDirty() && !force) { toast("Nothing's changed. Your site already has this."); return true; }
    busy = true;
    save.loading = true;
    const fields = kindFields(k, values, { nameKey: nameKeyOf(k, doc.fields), menuWas });
    try {
      const reply = path
        ? await api.call("PUT", `document?path=${encodeURIComponent(path)}`, { json: { fields: onlyChanges(doc.fields, fields), body: values.body, etag: doc.etag, frontMatter: "keep" } })
        : await api.call("POST", "document", { json: { kind: k.kind, fields: Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== null && v !== "")), body: values.body } });
      const wasNew = !path;
      path = reply.path;
      doc.etag = reply.etag;
      doc.url = reply.url || doc.url;
      doc.fields = Object.fromEntries(Object.entries({ ...doc.fields, ...fields }).filter(([, v]) => v !== null && v !== ""));
      menuWas = values.inMenu;
      baseline = snapshot();
      if (wasNew) context.replaceRoute?.(editHref(k, path));
      const result = await sendOut(api, `${wasNew ? "Add" : "Change"} the ${k.one} ${values.name.trim()}`);
      const said = wentOutWords(result, { meta, action: "saved" });
      lastSaid = said.words;
      toast(said.words, { variant: said.variant, duration: result.sent === "failed" ? 0 : undefined });
      paint();
      return true;
    } catch (error) {
      if (error.status === 409 && path) return conflict();
      if (error.status === 409) {
        name.error = `There's already a ${k.one} called that. Change it a little.`;
        name.querySelector("input")?.focus();
        return false;
      }
      if (error.status === 401 || error.data?.signedOut) {
        banner.replaceChildren(h("alert-banner", { variant: "warning", heading: "Not saved" }, "You're signed out. Your words are still here; press Save to sign in and save them."));
        return false;
      }
      // A name with nothing to make an address from (only emoji, say) is said on the name itself.
      if (error.status === 422 && /title|slug|name/i.test(error.message || "")) {
        name.error = `Use some letters or numbers in the ${k.nameLabel.toLowerCase()}, so it can have an address.`;
        name.querySelector("input")?.focus();
        return false;
      }
      const lines = Array.isArray(error.data?.problems) ? error.data.problems : [];
      banner.replaceChildren(h("alert-banner", { variant: "danger", heading: "Not saved" },
        !error.status ? "Check your connection and try again. Your words are still here." : error.status === 413 ? "It's too long to save. Shorten it a little; your words are still here." : `${error.message || "Something in it needs fixing."} Your words are still here.`,
        lines.length ? h("ul", {}, lines.map((line) => h("li", { text: String(line) }))) : null));
      banner.scrollIntoView?.({ block: "nearest" });
      return false;
    } finally {
      busy = false;
      save.loading = false;
    }
  }

  // Changed on another device while she had it open: she chooses, and nothing is lost either way.
  async function conflict() {
    const theirs = await api.get(`document?path=${encodeURIComponent(path)}`).catch(() => null);
    if (!theirs) { banner.replaceChildren(h("alert-banner", { variant: "danger", heading: "Not saved" }, "Check your connection and try again.")); return false; }
    const choice = await askWhichToKeep({ name: label(), what: "changes", them: "it", were: false });
    if (choice === "mine") { doc.etag = theirs.etag; doc.fields = { ...theirs.fields }; return saveNow({ force: true }); }
    if (choice === "theirs") { await fill(theirs); heading.focus(); toast("Here's the version from the other device."); }
    return false;
  }

  function preview(opener) {
    const values = read();
    return showPreview(api, { kind: k.kind, path, title: values.name.trim(), fields: kindFields(k, values), body: values.body, opener });
  }

  async function run(value) {
    if (value === "details") {
      details.replaceChildren(h("span", { slot: "heading", text: `About this ${k.one}` }),
        h("dl", { class: "studio-details" },
          h("dt", { text: "File" }), h("dd", { class: "studio-mono", text: path ? `content/${path}` : "Not saved yet" }),
          h("dt", { text: "Address" }), h("dd", { class: "studio-mono", text: doc.url || "After it's saved" })));
      details.open = true;
    }
    if (value === "delete") {
      const done = await context.undo.deletePost({ path, etag: doc.etag, title: label(), state: "published", ask, list: k.many, one: k.one,
        note: [k.kind === "series" ? "Its posts stay; they just aren't gathered on one page." : "", isDirty() ? "Changes you haven't saved go with it." : ""].filter(Boolean).join(" ") });
      if (done) { baseline = ""; context.go(`#/${k.list}`); }
    }
  }

  async function leave() {
    if (!isDirty()) return true;
    const choice = await ask({ heading: `Save this ${k.one}?`, text: "You changed it and didn't save.", choices: [{ label: "Save", value: "save" }, { label: "Leave without saving", value: "go", variant: "secondary" }] });
    if (choice === "save") return saveNow();
    return choice === "go";
  }

  async function load() {
    if (!path) { await fill({ fields: {}, body: "" }); return; }
    try {
      await fill(await api.get(`document?path=${encodeURIComponent(path)}`));
    } catch {
      banner.replaceChildren(h("alert-banner", { variant: "danger", heading: `This ${k.one} didn't open` }, "Check your connection and try again.",
        h("action-button", { variant: "secondary", href: `#/${k.list}` }, `Back to your ${k.many}`)));
      element.querySelector(".studio-write-grid").hidden = true;
      element.querySelector(".studio-write-bar").hidden = true;
    }
  }

  return {
    title: k.newTitle,
    element,
    load,
    leave,
    isDirty,
    focus: () => (path ? heading.focus() : name.querySelector("input")?.focus()),
    get palette() {
      return [{ id: "save", label: `Save this ${k.one}`, group: `This ${k.one}`, hint: "Ctrl S" }, { id: "preview", label: "See how it looks", group: `This ${k.one}` }];
    },
    keys: ["save", "publish"],
    command(id) {
      if (id === "save" || id === "publish") saveNow();
      if (id === "preview") preview();
    },
  };
}
