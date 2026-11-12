// <ob-greeting-cards>: the Greeting cards screen (ADR 0411). The owner keeps a small address book
// and writes cards that go out by email on a day she picks, once or every year (a birthday). She
// sees the card as it will arrive before it's scheduled, can send herself a test, and sees what's
// coming up, what went out, and anything that didn't, in plain words.
//
// Everything here is a request to the Admin server, which holds the key to the hosted function:
// this page never sees a key, the database or the email service. Every control is a native button,
// input, select or checkbox with a visible label; status is words, never colour alone; the layout is
// one column that holds at 400 px.

import { el } from "./block-forms.js";

let uid = 0;

export const OFF_TEXT = Object.freeze({
  off: "Greeting cards are not set up. They're optional; the site works the same without them. To turn them on, follow docs/greeting-cards.md, then set OPENBLOG_GREETINGS_ENDPOINT and OPENBLOG_GREETINGS_ADMIN_KEY where Admin runs.",
  invalid: "Admin's greeting card settings are not valid, so the feature stays off. Fix these settings, then reload:",
  unavailable: "Admin reached the greetings function, but greeting cards aren't switched on there. Set OPENBLOG_GREETINGS_ENABLED=true and the other settings in its environment.",
});

/** Why a card didn't go out, in plain words (the sender's fixed codes). */
export const REASONS = Object.freeze({
  "refused-key": "the email service didn't accept its key",
  rejected: "the email service turned it down; the address may be wrong",
  "rate-limited": "the email service was too busy",
  "provider-error": "the email service had a problem",
  timeout: "the email service didn't answer in time",
  network: "the email service couldn't be reached",
  "no-contact": "the person it was for was removed",
});

const ICONS = Object.freeze({ birthday: "🎂", christmas: "🎄", thanksgiving: "🦃", easter: "🐣", valentine: "💌", anniversary: "💐", congratulations: "🎉", "thinking-of-you": "🌼", "just-because": "☀️" });
const HOURS = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];

export const hourLabel = (hour) => `${hour % 12 || 12} ${hour < 12 ? "AM" : "PM"}`;

/** "Friday, November 27 at 8 AM", in the owner's time zone. */
export function when(iso, timeZone) {
  if (!iso) return "";
  const at = new Date(iso);
  const day = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long", month: "long", day: "numeric", year: at.getUTCFullYear() !== new Date().getUTCFullYear() ? "numeric" : undefined }).format(at);
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23" }).format(at));
  return `${day} at ${hourLabel(hour)}`;
}

/** The next time `birthday` (YYYY-MM-DD) comes round, as YYYY-MM-DD, from `today` (YYYY-MM-DD). */
export function nextBirthday(birthday, today) {
  const [, month, day] = birthday.split("-");
  const year = Number(today.slice(0, 4));
  const thisYear = `${year}-${month}-${day}`;
  return thisYear >= today ? thisYear : `${year + 1}-${month}-${day}`;
}

/** What a card's line in the list says about it. */
export function cardSummary(card, person, timeZone) {
  const name = person?.name || "someone who was removed";
  const words = card.design.replace(/-/g, " ");
  const design = words.charAt(0).toUpperCase() + words.slice(1);
  if (card.status === "failed") return `${design} card to ${name} didn't go out: ${REASONS[card.error] || "something went wrong"}. Open it and schedule it again.`;
  if (card.status === "sent") return `${design} card to ${name} went out ${when(card.lastSentAt, timeZone)}.`;
  if (card.status === "sending") return `${design} card to ${name} is going out now.`;
  const again = card.yearly ? ", and every year after" : "";
  return `${design} card to ${name} goes out ${when(card.nextSendAt, timeZone)}${again}.`;
}

export function createGreetingCards({ api, now = () => Date.now() }) {
  const root = el("ob-greeting-cards", { class: "oba-greetings", "data-greeting-cards": "true" });
  const ids = `oba-greetings-${++uid}`;
  let state = null;
  let editing = null;
  let busy = false;
  let dirty = false;

  const status = el("p", { class: "oba-small", role: "status", "aria-live": "polite", tabindex: "-1" });
  const say = (text, error = false) => {
    status.className = `oba-small${error ? " oba-error" : ""}`;
    status.setAttribute("role", error ? "alert" : "status");
    status.textContent = text;
  };
  const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: state?.overview?.timeZone || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now()));
  const person = (id) => state?.contacts.find((c) => c.id === id) || null;
  const fieldNamed = (name) => [...root.querySelectorAll("[data-field]")].find((node) => node.getAttribute("data-field") === name) || null;

  async function load() {
    root.replaceChildren(el("h2", { id: `${ids}-title`, tabindex: "-1" }, "Greeting cards"), el("p", { class: "oba-small", role: "status" }, "Loading your cards…"));
    try {
      const overview = await api.call("GET", "greetings/status");
      if (!overview.enabled) {
        state = { overview, contacts: [], cards: [] };
      } else {
        const [contacts, cards] = await Promise.all([api.call("GET", "greetings/contacts"), api.call("GET", "greetings/cards")]);
        state = { overview, contacts: contacts.contacts, cards: cards.cards };
      }
    } catch (error) {
      state = null;
      root.replaceChildren(el("h2", {}, "Greeting cards"), el("p", { class: "oba-error", role: "alert" }, error.message || "Couldn't load your cards. Try again in a moment."));
      return;
    }
    render();
  }

  async function act(label, work, done) {
    if (busy) return;
    busy = true;
    say(`${label}…`);
    try {
      const result = await work();
      busy = false;
      await done?.(result);
    } catch (error) {
      busy = false;
      say(error.message || "That didn't work. Try again.", true);
      const field = error.data?.field;
      if (field) fieldNamed(field)?.focus();
    }
  }

  function render() {
    const overview = state.overview;
    const title = el("h2", { id: `${ids}-title`, tabindex: "-1" }, "Greeting cards");
    if (!overview.enabled) {
      const problems = overview.problems?.length ? el("ul", {}, overview.problems.map((p) => el("li", {}, el("code", {}, p)))) : null;
      root.replaceChildren(...[title, el("p", {}, OFF_TEXT[overview.state] || OFF_TEXT.off), problems].filter(Boolean));
      return;
    }
    root.replaceChildren(
      title,
      el("p", { class: "oba-small" }, `Cards go out by email from ${overview.from.name ? `${overview.from.name} <${overview.from.email}>` : overview.from.email}, at the time you pick where you live (${overview.timeZone.replace(/_/g, " ")}).`),
      status,
      editing ? editor() : el("button", { class: "oba-btn oba-btn-primary", type: "button", "data-action": "new-card", onClick: () => openEditor(null) }, "Write a card"),
      upcoming(),
      addressBook(),
    );
  }

  function upcoming() {
    const cards = [...state.cards].sort((a, b) => String(a.nextSendAt).localeCompare(String(b.nextSendAt)));
    const zone = state.overview.timeZone;
    return el("section", { "aria-labelledby": `${ids}-upcoming` },
      el("h3", { id: `${ids}-upcoming` }, "Your cards"),
      cards.length ? el("ul", { class: "oba-greetings-list" }, cards.map((card) => el("li", { class: "oba-greetings-card", "data-card": card.id, "data-status": card.status },
        el("p", {}, el("span", { "aria-hidden": "true" }, `${ICONS[card.design] || "✉️"} `), cardSummary(card, person(card.contactId), zone)),
        el("p", { class: "oba-small" }, `“${card.subject}”`),
        card.status === "sending" ? null : el("div", { class: "oba-toolbar" },
          el("button", { class: "oba-btn", type: "button", "data-action": "edit-card", onClick: () => openEditor(card) }, card.status === "failed" ? "Open and try again" : "Change"),
          el("button", { class: "oba-btn", type: "button", "data-action": "cancel-card", onClick: () => {
            if (!globalThis.confirm?.(`Stop this card to ${person(card.contactId)?.name || "them"}? It won't be sent.`)) return;
            act("Stopping the card", () => api.call("POST", `greetings/cards/${card.id}/cancel`, { json: {} }), async () => { await load(); say("Stopped. That card won't be sent."); });
          } }, card.yearly ? "Stop sending it" : "Don't send it"),
        ),
      ))) : el("p", { class: "oba-small" }, "No cards yet. Write one, and it goes out on the day you pick."),
    );
  }

  function addressBook() {
    const form = { name: "", email: "", birthday: "" };
    const field = (key, label, type = "text") => {
      const id = `${ids}-new-${key}`;
      return el("div", { class: "oba-field" }, el("label", { for: id }, label), el("input", { id, type, "data-field": key, autocomplete: "off", onInput: (e) => { form[key] = e.target.value; dirty = true; } }));
    };
    return el("section", { "aria-labelledby": `${ids}-book` },
      el("h3", { id: `${ids}-book` }, "Address book"),
      state.contacts.length ? el("ul", { class: "oba-greetings-people" }, state.contacts.map((c) => el("li", { "data-contact": c.id },
        `${c.name}, ${c.email}${c.birthday ? `, birthday ${new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(`${c.birthday}T00:00:00Z`))}` : ""} `,
        el("button", { class: "oba-btn oba-btn-small", type: "button", "data-action": "remove-contact", onClick: () => {
          if (!globalThis.confirm?.(`Remove ${c.name}? Their cards are removed too.`)) return;
          act(`Removing ${c.name}`, () => api.call("POST", `greetings/contacts/${c.id}/remove`, { json: {} }), async () => { await load(); say(`Removed ${c.name}.`); });
        } }, `Remove ${c.name}`),
      ))) : el("p", { class: "oba-small" }, "Nobody here yet. Add the people you send cards to."),
      el("details", {}, el("summary", {}, "Add someone"),
        field("name", "Name"), field("email", "Email address", "email"), field("birthday", "Birthday (optional)", "date"),
        el("button", { class: "oba-btn", type: "button", "data-action": "add-contact", onClick: () => act(`Adding ${form.name || "them"}`, () => api.call("POST", "greetings/contacts", { json: { name: form.name, email: form.email, birthday: form.birthday || null } }), async (reply) => { dirty = false; await load(); say(`Added ${reply.contact.name}.`); }) }, "Add to address book"),
      ),
    );
  }

  function openEditor(card) {
    const first = state.contacts[0];
    const birthday = first?.birthday;
    editing = card
      ? { id: card.id, contactId: card.contactId, design: card.design, subject: card.subject, message: card.message, signOff: card.signOff, sendOn: card.sendOn, hour: card.hour, yearly: card.yearly }
      : { id: null, contactId: first?.id || "", design: birthday ? "birthday" : "just-because", subject: "", message: "", signOff: "Love, Grammi", sendOn: birthday ? birthday : today(), hour: 8, yearly: Boolean(birthday) };
    render();
    fieldNamed("contactId")?.focus();
  }

  function editor() {
    const card = editing;
    const zone = state.overview.timeZone;
    const id = (name) => `${ids}-card-${name}`;
    const changed = () => { dirty = true; };
    const preview = el("div", { class: "oba-greetings-preview", "data-preview": "true" });
    const designs = state.overview.designs;
    const subjectFor = (design) => designs.find((d) => d.id === design)?.subject || "";
    const subject = el("input", { id: id("subject"), type: "text", "data-field": "subject", maxlength: "150", value: card.subject, placeholder: subjectFor(card.design), onInput: (e) => { card.subject = e.target.value; changed(); } });

    // Picking someone with a birthday for a birthday card sets the day, every year.
    const onPerson = (contactId) => {
      card.contactId = contactId;
      const who = person(contactId);
      if (card.design === "birthday" && who?.birthday) {
        card.sendOn = who.birthday;
        card.yearly = true;
        render();
      }
      changed();
    };
    const payload = () => ({ contactId: card.contactId, design: card.design, subject: card.subject, message: card.message, signOff: card.signOff, sendOn: card.sendOn, hour: Number(card.hour), timeZone: zone, yearly: card.yearly });
    const nextDay = card.yearly && card.sendOn ? nextBirthday(card.sendOn, today()) : card.sendOn;

    return el("section", { class: "oba-greetings-editor", "aria-labelledby": id("title") },
      el("h3", { id: id("title") }, card.id ? "Change this card" : "Write a card"),
      state.contacts.length ? null : el("p", { class: "oba-error", role: "alert" }, "Add someone to the address book first (below), then write their card."),
      el("div", { class: "oba-field" }, el("label", { for: id("contactId") }, "Who is it for?"),
        el("select", { id: id("contactId"), "data-field": "contactId", onChange: (e) => onPerson(e.target.value) },
          state.contacts.map((c) => el("option", { value: c.id, selected: c.id === card.contactId }, c.name)))),
      el("fieldset", { class: "oba-greetings-designs" }, el("legend", {}, "Which card?"),
        designs.map((d) => el("label", { class: "oba-greetings-design" },
          el("input", { type: "radio", name: id("design"), value: d.id, checked: d.id === card.design, "data-field": d.id === card.design ? "design" : null, onChange: () => {
            card.design = d.id;
            subject.placeholder = subjectFor(d.id);
            if (d.id === "birthday" && person(card.contactId)?.birthday) {
              card.sendOn = person(card.contactId).birthday;
              card.yearly = true;
              render();
            }
            changed();
          } }),
          ` ${ICONS[d.id] || ""} ${d.label}`))),
      el("div", { class: "oba-field" }, el("label", { for: id("subject") }, "Subject line"), subject,
        el("p", { class: "oba-small" }, "Leave it empty for the card's own: ", el("q", {}, subjectFor(card.design)))),
      el("div", { class: "oba-field" }, el("label", { for: id("message") }, "Your message"),
        el("textarea", { id: id("message"), rows: "7", "data-field": "message", maxlength: "4000", onInput: (e) => { card.message = e.target.value; changed(); } }, card.message),
        el("p", { class: "oba-small" }, "Write {name} where their first name goes, and {age} for how old they're turning (it needs their birthday in the address book).")),
      el("div", { class: "oba-field" }, el("label", { for: id("signOff") }, "Sign it"),
        el("input", { id: id("signOff"), type: "text", "data-field": "signOff", maxlength: "80", value: card.signOff, onInput: (e) => { card.signOff = e.target.value; changed(); } })),
      el("div", { class: "oba-field" }, el("label", { for: id("sendOn") }, card.yearly ? "Which day? (the year doesn't matter)" : "Send it on"),
        el("input", { id: id("sendOn"), type: "date", "data-field": "sendOn", value: card.sendOn, onInput: (e) => { card.sendOn = e.target.value; changed(); } })),
      el("div", { class: "oba-field" }, el("label", { for: id("hour") }, "At"),
        el("select", { id: id("hour"), "data-field": "hour", onChange: (e) => { card.hour = Number(e.target.value); changed(); } },
          HOURS.map((h) => el("option", { value: String(h), selected: h === Number(card.hour) }, hourLabel(h))))),
      el("div", { class: "oba-field oba-capture-check" },
        el("input", { id: id("yearly"), type: "checkbox", checked: card.yearly, "data-field": "yearly", onChange: (e) => { card.yearly = e.target.checked; changed(); render(); } }),
        el("label", { for: id("yearly") }, "Send it every year on that day")),
      card.sendOn ? el("p", { class: "oba-small" }, card.yearly ? `Next one: ${nextDay}.` : "") : null,
      el("div", { class: "oba-toolbar" },
        el("button", { class: "oba-btn", type: "button", "data-action": "preview-card", onClick: () => act("Making the preview", () => api.call("POST", "greetings/preview", { json: payload() }), (reply) => {
          preview.replaceChildren(
            el("p", { class: "oba-small" }, `Subject: ${reply.subject}. It goes out ${when(reply.sendsAt, zone)}.`),
            el("iframe", { src: reply.previewUrl, title: `Preview of the card: ${reply.subject}`, sandbox: "", class: "oba-greetings-frame", loading: "lazy" }),
          );
          say("Here's how it will look.");
        }) }, "See the card"),
        el("button", { class: "oba-btn", type: "button", "data-action": "test-card", onClick: () => act("Sending you a test", () => api.call("POST", "greetings/test", { json: payload() }), (reply) => say(`Sent a test to ${reply.to}. Check your email.`)) }, "Send me a test"),
        el("button", { class: "oba-btn oba-btn-primary", type: "button", "data-action": "save-card", onClick: () => act(card.id ? "Saving" : "Scheduling", () => api.call("POST", card.id ? `greetings/cards/${card.id}` : "greetings/cards", { json: payload() }), async (reply) => {
          dirty = false;
          editing = null;
          await load();
          say(`Scheduled. ${cardSummary(reply.card, person(reply.card.contactId), zone)}`);
          status.focus();
        }) }, card.id ? "Save changes" : "Schedule this card"),
        el("button", { class: "oba-btn", type: "button", "data-action": "close-editor", onClick: () => { editing = null; dirty = false; render(); } }, "Never mind"),
      ),
      preview,
    );
  }

  return {
    element: root,
    load,
    isDirty: () => dirty,
    isBusy: () => busy,
    destroy: () => {},
  };
}
