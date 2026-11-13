// Notifications' pieces (Studio R3): the "Tell me when" switches, another phone or computer's card
// with Remove and More (Send it a test, Change what it tells you, Rename), the Rename dialog and the
// Change sheet. Names are only ever text. docs/specs/studio/r3/ux.md, "Other phones and computers".
import { h } from "./dom.js";
import { KIND_WORDS, kindsSummary, lastToldWords } from "./notification-rules.js";
import { detailsBox } from "./account-details.js";
import { focusSheetHeading } from "./home-screen-sheet.js";

/**
 * The switches, one per offered kind, in a fieldset "Tell me when". `onChange(kinds)` with the
 * offered kinds now on. Returns { element, set(kinds), busy(on) }.
 */
export function kindSwitches({ offered, picked = [], onChange = null, legend = "Tell me when" }) {
  const on = new Set(picked);
  const switches = offered.map((kind) => {
    const toggle = h("toggle-switch", { label: KIND_WORDS[kind].switch, checked: on.has(kind), "data-kind": kind });
    toggle.addEventListener("checkedchange", (event) => {
      if (toggle.getAttribute("aria-disabled") === "true") { toggle.checked = on.has(kind); return; }
      if (event.detail) on.add(kind); else on.delete(kind);
      onChange?.(offered.filter((k) => on.has(k)), { kind, toggle });
    });
    return toggle;
  });
  const element = h("fieldset", { class: "studio-kinds" }, h("legend", { text: legend }), ...switches);
  return {
    element,
    picked: () => offered.filter((k) => on.has(k)),
    set(kinds) {
      on.clear();
      for (const k of kinds) on.add(k);
      for (const toggle of switches) toggle.checked = on.has(toggle.dataset.kind);
    },
    busy(state) {
      element.setAttribute("aria-busy", state ? "true" : "false");
      for (const toggle of switches) toggle.setAttribute("aria-disabled", state ? "true" : "false");
    },
  };
}

/** Rename: a modal-dialog with Name; resolves the new name, or null. `save(label)` throws words to show. */
export function renameDialog({ title, label, save }) {
  return new Promise((resolve) => {
    let done = false;
    const field = h("text-field", { label: "Name", value: label, maxlength: 60, description: "So you can tell them apart, like Kitchen iPad." });
    const finish = (value) => {
      if (done) return;
      done = true;
      dialog.open = false;
      dialog.remove();
      resolve(value);
    };
    const go = h("action-button", { slot: "actions", onClick: async () => {
      const value = String(field.value || "").replace(/\s+/g, " ").trim();
      if (!value) { field.error = "Give it a name, like Kitchen iPad."; field.querySelector("input")?.focus(); return; }
      go.loading = true;
      try {
        await save(value);
        finish(value);
      } catch (error) {
        go.loading = false;
        field.error = error.message;
        field.querySelector("input")?.focus();
      }
    } }, "Rename");
    const dialog = h("modal-dialog", { label: title, class: "studio-dialog" },
      h("span", { slot: "heading", text: title }), field, go,
      h("action-button", { slot: "actions", variant: "secondary", onClick: () => finish(null) }, "Cancel"));
    dialog.addEventListener("openchange", (event) => { if (!event.detail) finish(null); });
    field.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); go.querySelector("button")?.click(); } });
    document.body.append(dialog);
    dialog.open = true;
    requestAnimationFrame(() => field.querySelector("input")?.focus());
  });
}

/**
 * Change what another device tells her: a sheet with its switches and Save, guarded by the sheet's
 * leave question. `save(kinds)` resolves once saved.
 */
export function openChangeSheet({ sheet, device, offered, held, save, opener }) {
  const start = offered.filter((k) => held.includes(k));
  const switches = kindSwitches({ offered, picked: start });
  const status = h("p", { class: "studio-help studio-account-sheet-status", role: "status", "aria-live": "polite" });
  const dirty = () => switches.picked().join() !== start.join();
  const doSave = async () => {
    try {
      await save(switches.picked());
      return true;
    } catch (error) {
      status.textContent = error.message;
      return false;
    }
  };
  const button = h("action-button", { onClick: async () => {
    button.loading = true;
    const ok = await doSave();
    button.loading = false;
    if (ok) sheet.close();
  } }, "Save");
  sheet.show({
    heading: `What ${device.label} tells you`,
    opener,
    dirty,
    save: doSave,
    question: { heading: "Save these changes?", text: `You changed what ${device.label} tells you and didn't save it.`, save: "Save", leave: "Leave without saving" },
    children: [switches.element, status, h("div", { class: "studio-sheet-actions" }, button)],
    focus: () => focusSheetHeading(sheet),
  });
}

/**
 * Another phone or computer: name, what it tells her, when it last did, Remove and More.
 * `on`: { remove(device, button), test(device, menu), change(device, menu), rename(device, menu) }.
 */
export function deviceCard(device, { now = Date.now(), on }) {
  const id = `studio-device-${device.id}`;
  const menu = h("dropdown-menu", {
    class: "studio-row-menu",
    items: [
      { value: "test", label: "Send it a test" },
      { value: "change", label: "Change what it tells you…" },
      { value: "rename", label: "Rename…" },
    ],
    onItemselect: (event) => on[event.detail]?.(device, menu),
  }, h("span", { slot: "label" }, "More", h("span", { class: "studio-visually-hidden", text: ` for ${device.label}` })));
  return h("li", { class: "studio-comment studio-device", "data-device": device.id },
    h("h4", { id, class: "studio-comment-who", tabindex: "-1", text: device.label }),
    h("p", { class: "studio-help", text: kindsSummary(device.kinds) }),
    h("p", { class: "studio-help", text: lastToldWords(device.lastSentAt, now) }),
    h("div", { class: "studio-comment-actions" },
      h("action-button", { variant: "secondary", label: `Remove ${device.label}`, onClick: (event) => on.remove(device, event.currentTarget) }, "Remove"),
      menu),
    detailsBox([`id ${device.id}`, `hash ${device.device}`, `kinds ${(device.kinds || []).join(", ") || "none"}`, `created ${device.createdAt || "?"}`, `last sent ${device.lastSentAt || "never"}`]));
}
