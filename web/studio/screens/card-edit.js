// Write a card, or change one: who it's for, which card, the day and hour (or every year), the
// words with buttons for their name and age, how it will look, and a test to herself. Every change
// waits on this device until the card is scheduled, so nothing is lost. Studio slice 9;
// docs/specs/studio/slice-9/ux.md.
import { h, toast } from "../parts/dom.js";
import { use } from "../zubra.js";
import { ask } from "../parts/dialogs.js";
import { sayWhen, sayDay } from "../parts/dates.js";
import { createKept } from "../parts/kept.js";
import {
  HOURS, cardForm, cardLine, cardTitle, cardTrouble, hourLabel, newCard, nextYearly, REASONS, todayIn,
} from "../parts/card-words.js";

const SIGN_OFF = "studio:card:signoff";

function safeStorage() {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function takeCopy() {
  try {
    const raw = sessionStorage.getItem("studio:card:copy");
    sessionStorage.removeItem("studio:card:copy");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function createCardEdit({ api, go }, route) {
  await use("action-button", "alert-banner", "date-field", "empty-state", "select-field", "side-sheet", "skeleton-block", "text-field", "toggle-switch");
  const id = route.arg === "new" ? null : route.arg;
  const keptKey = `card:${id || "new"}`;
  const kept = createKept(safeStorage(), api.user);
  let state = null;
  let card = null; // the card as the server has it (changing one)
  let form = null;
  let dirty = false;
  let saving = false;

  const heading = h("h2", { id: "studio-card-edit-h", class: "studio-question", tabindex: "-1", text: id ? "Change this card" : "Write a card" });
  const status = h("p", { class: "studio-help", role: "status", "aria-live": "polite" });
  const banner = h("div", { class: "studio-banner" });
  const body = h("div", { class: "studio-card-form", "aria-busy": "true" }, h("skeleton-block", { lines: 6 }));
  const preview = h("div", { class: "studio-card-preview", "aria-live": "polite" });
  const element = h("section", { class: "studio-page studio-card-edit", "aria-labelledby": "studio-card-edit-h" },
    h("a", { class: "studio-more-link", href: "#/cards", text: "Back to your cards" }),
    heading, banner, status,
    h("div", { class: "studio-comment-columns" }, h("div", { class: "studio-comment-main" }, body), h("div", { class: "studio-comment-side" }, preview)));

  const person = (cid) => state?.contacts.find((c) => c.id === cid) || null;
  const zone = () => state?.overview.timeZone || "UTC";
  const designs = () => state?.overview.designs || [];
  const changed = () => {
    dirty = true;
    kept.keep(keptKey, "", form);
    preview.classList.add("studio-card-stale");
  };

  async function load() {
    try {
      const overview = await api.get("greetings/status");
      if (!overview.enabled) { go("#/cards"); return; }
      const contacts = await api.get("greetings/contacts");
      const cards = id ? await api.get("greetings/cards") : { cards: [] };
      state = { overview, contacts: contacts.contacts };
      card = id ? cards.cards.find((c) => c.id === id) || null : null;
      if (id && !card) {
        banner.replaceChildren(h("alert-banner", { variant: "warning", heading: "That card isn't there any more" },
          h("a", { href: "#/cards" }, "Back to your cards")));
        body.replaceChildren();
        return;
      }
    } catch (error) {
      if (error.status === 401) throw error;
      body.removeAttribute("aria-busy");
      body.replaceChildren();
      banner.replaceChildren(h("alert-banner", { variant: "danger", heading: "This card didn't open" }, cardTrouble(error, "load"), " ",
        h("action-button", { variant: "secondary", size: "sm", onClick: () => load() }, "Try again")));
      return;
    }
    let signOff = "";
    try { signOff = safeStorage()?.getItem(SIGN_OFF) || ""; } catch { /* the default */ }
    const start = card ? cardForm(card) : { ...newCard({ contacts: state.contacts, designs: designs(), forId: route.query.for, today: todayIn(zone()), signOff }), ...(route.query.copy ? takeCopy() || {} : {}) };
    form = start;
    const waiting = kept.get(keptKey);
    if (waiting && JSON.stringify(waiting.form) !== JSON.stringify(start)) {
      const who = person(waiting.form.contactId)?.name;
      const choice = await ask({
        heading: "Pick up where you left off?",
        text: `You were writing a card${who ? ` to ${who}` : ""}.`,
        choices: [{ label: "Pick up", value: "pick" }, { label: "Start fresh", value: "fresh", variant: "secondary" }],
      });
      if (choice === "pick") { form = { ...start, ...waiting.form }; dirty = true; } else kept.clear(keptKey);
    }
    if (card) heading.textContent = card.status === "failed" ? `Try ${person(card.contactId)?.name || "this"}'s card again` : `Change ${person(card.contactId)?.name || "this"}'s card`;
    draw();
  }

  function draw() {
    body.removeAttribute("aria-busy");
    banner.replaceChildren();
    if (!state.contacts.length) {
      body.replaceChildren(h("empty-state", { heading: "Add someone first" }, "Cards go to the people in your address book.",
        h("action-button", { slot: "actions", href: "#/cards" }, "Add someone")));
      return;
    }
    if (card?.status === "failed") {
      const who = person(card.contactId)?.name || "them";
      banner.append(h("alert-banner", { variant: "warning", heading: "This card didn't go out" },
        `It didn't go out: ${REASONS[card.error] || "something went wrong"}. Check ${who}'s address under Your people, pick a day, then Schedule it again.`));
    }
    const who = h("select-field", {
      label: "Who is it for?",
      options: state.contacts.map((c) => ({ value: c.id, label: c.name })),
      value: form.contactId,
      onValuechange: (e) => {
        form.contactId = e.detail;
        const p = person(form.contactId);
        if (form.design === "birthday" && p?.birthday) {
          form.sendOn = p.birthday;
          form.yearly = true;
          status.textContent = `Set to ${p.name}'s birthday, ${sayDay(`${p.birthday}`).replace(/^[A-Za-z]+, /, "")}, every year.`;
        }
        changed();
        draw();
      },
    });
    const design = h("select-field", {
      label: "Which card?",
      options: designs().map((d) => ({ value: d.id, label: d.label })),
      value: form.design,
      onValuechange: (e) => {
        form.design = e.detail;
        const p = person(form.contactId);
        if (form.design === "birthday" && p?.birthday) { form.sendOn = p.birthday; form.yearly = true; }
        changed();
        draw();
      },
    });
    const sendOn = h("date-field", { label: form.yearly ? "Which day?" : "Send it on", value: form.sendOn, description: form.yearly ? "The year doesn't matter; it goes out on that day each year." : "", onValuechange: (e) => { form.sendOn = e.detail; changed(); nextLine(); } });
    const hour = h("select-field", { label: "At", options: HOURS.map((x) => ({ value: String(x), label: hourLabel(x) })), value: String(form.hour), onValuechange: (e) => { form.hour = Number(e.detail); changed(); } });
    const yearly = h("toggle-switch", { label: "Send it every year", onCheckedchange: (e) => { form.yearly = e.detail; changed(); draw(); } });
    const next = h("p", { class: "studio-help" });
    const nextLine = () => { next.textContent = form.yearly && form.sendOn ? `Next one: ${sayDay(nextYearly(form.sendOn, todayIn(zone())))}.` : ""; };
    nextLine();
    const subjectFor = designs().find((d) => d.id === form.design)?.subject || "";
    const subject = h("text-field", { label: "Subject line", value: form.subject, maxlength: 150, placeholder: subjectFor, description: subjectFor ? `Leave it empty to use “${subjectFor}”.` : "", onValuechange: (e) => { form.subject = e.detail; changed(); } });
    const message = h("text-field", { label: "Your message", rows: 7, value: form.message, maxlength: 4000, description: "Add their name and age with the buttons; See the card shows how it reads.", onValuechange: (e) => { form.message = e.detail; changed(); } });
    const insert = (token) => {
      const box = message.querySelector("textarea");
      const at = box ? box.selectionStart ?? form.message.length : form.message.length;
      const end = box ? box.selectionEnd ?? at : at;
      form.message = `${form.message.slice(0, at)}${token}${form.message.slice(end)}`;
      message.value = form.message;
      changed();
      requestAnimationFrame(() => { box?.focus(); box?.setSelectionRange(at + token.length, at + token.length); });
    };
    const p = person(form.contactId);
    const tokens = h("div", { class: "studio-comment-actions" },
      h("action-button", { variant: "ghost", size: "sm", onClick: () => insert("{name}") }, "Add their name"),
      p?.birthday ? h("action-button", { variant: "ghost", size: "sm", onClick: () => insert("{age}") }, "Add their age") : null);
    const signOff = h("text-field", { label: "Sign it", value: form.signOff, maxlength: 80, onValuechange: (e) => { form.signOff = e.detail; changed(); } });
    const fields = { contactId: who, design, sendOn, hour, subject, message, signOff };
    const primaryWords = !card ? "Schedule this card" : card.status === "failed" ? "Schedule it again" : "Save changes";
    const primary = h("action-button", { size: "lg", onClick: () => save(fields, primary) }, primaryWords);
    const look = h("action-button", { variant: "secondary", onClick: () => showPreview(look) }, "See the card");
    const test = h("action-button", { variant: "secondary", onClick: () => sendTest(test, fields) }, "Send me a test");
    body.replaceChildren(who, design, sendOn, hour, yearly, next, subject, message, tokens, signOff,
      h("div", { class: "studio-comment-actions" }, primary),
      h("div", { class: "studio-comment-actions" }, look, test),
      h("details", { class: "studio-help" }, h("summary", { text: "For the person who set up your site" }),
        h("p", { class: "studio-mono", text: `zone ${zone()}${card ? `, id ${card.id}, status ${card.status}` : ""}` })));
    yearly.checked = Boolean(form.yearly);
  }

  const payload = () => ({ ...form, hour: Number(form.hour), timeZone: zone() });

  function fieldTrouble(fields, error) {
    const words = cardTrouble(error);
    const field = fields[error.data?.field];
    if (field && "error" in field) {
      field.error = words;
      (field.querySelector("input, textarea, select, button") || field).focus?.();
    }
    status.textContent = words;
  }

  async function save(fields, button) {
    if (saving) return;
    saving = true;
    button.loading = true;
    for (const f of Object.values(fields)) if ("error" in f) f.error = "";
    try {
      const reply = await api.post(card ? `greetings/cards/${card.id}` : "greetings/cards", payload());
      try { safeStorage()?.setItem(SIGN_OFF, form.signOff); } catch { /* remembered next time, or not */ }
      kept.clear(keptKey);
      dirty = false;
      const words = `Scheduled. ${cardTitle(reply.card, person(reply.card.contactId), designs())}: ${cardLine(reply.card, (iso) => sayWhen(iso, { timeZone: zone() }))}`;
      toast(words);
      go("#/cards");
    } catch (error) {
      if (error.status === 401) throw error;
      fieldTrouble(fields, error);
    } finally {
      saving = false;
      button.loading = false;
    }
  }

  async function showPreview(button) {
    button.loading = true;
    try {
      const reply = await api.post("greetings/preview", payload());
      const who = person(form.contactId)?.name || "their";
      preview.classList.remove("studio-card-stale");
      preview.replaceChildren(
        h("h3", { text: "How it will look" }),
        h("p", { class: "studio-help", text: `Subject: ${reply.subject}${/[.!?]$/.test(reply.subject) ? "" : "."} It goes out ${sayWhen(reply.sendsAt, { timeZone: zone() })}.` }),
        h("p", { class: "studio-help studio-card-stale-note", text: "This is before your last change. See the card again to update." }),
        // The Admin keeps the card's page and gives its address; a sandbox with nothing allowed.
        h("iframe", { class: "studio-card-frame", sandbox: "", ...(reply.previewUrl ? { src: reply.previewUrl } : { srcdoc: reply.html || "" }), title: `How ${who}'s card will look` }));
      status.textContent = "Here's how it will look.";
      preview.scrollIntoView?.({ block: "nearest" });
    } catch (error) {
      if (error.status === 401) throw error;
      status.textContent = cardTrouble(error);
    } finally {
      button.loading = false;
    }
  }

  async function sendTest(button, fields) {
    button.loading = true;
    try {
      const reply = await api.post("greetings/test", payload());
      status.textContent = `${reply.to ? `Sent a test to ${reply.to}.` : "Sent you a test."} Check your email. Your card isn't scheduled yet.`;
    } catch (error) {
      if (error.status === 401) throw error;
      if (error.data?.field) fieldTrouble(fields, error);
      else status.textContent = cardTrouble(error, "test");
    } finally {
      button.loading = false;
    }
  }

  async function leave() {
    if (!dirty) return true;
    const choice = await ask({
      heading: "Leave without scheduling this card?",
      text: "It waits on this device for next time.",
      choices: [{ label: "Keep writing", value: "stay" }, { label: "Leave for now", value: "go", variant: "secondary" }, { label: "Throw it away", value: "discard", variant: "destructive" }],
    });
    if (choice === "discard") { kept.clear(keptKey); return true; }
    return choice === "go";
  }

  return {
    title: id ? "Change a card" : "Write a card",
    element,
    load,
    leave,
    isDirty: () => dirty,
    focus: () => heading.focus(),
    get palette() {
      return [
        { id: "preview", label: "See the card", group: "Card" },
        { id: "test", label: "Send me a test", group: "Card" },
      ];
    },
    command(cmd) {
      const label = cmd === "preview" ? "See the card" : "Send me a test";
      [...body.querySelectorAll("action-button")].find((b) => b.textContent.trim() === label)?.click();
    },
  };
}

