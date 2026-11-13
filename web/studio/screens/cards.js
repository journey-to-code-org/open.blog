// Cards: the greeting cards she sends by email (birthdays every year, Christmas, just because) and
// the people she sends them to. The list says what didn't go out first, then what's coming up, then
// what went out. Writing or changing a card is its own screen (card-edit.js). Studio slice 9;
// docs/specs/studio/slice-9/ux.md.
import { h, toast } from "../parts/dom.js";
import { use } from "../zubra.js";
import { ask } from "../parts/dialogs.js";
import { sayWhen } from "../parts/dates.js";
import { cardTitle, cardLine, cardTrouble, cardForm, designLabel, sections } from "../parts/card-words.js";

const OFF = {
  off: "Greeting cards are not set up (OPENBLOG_GREETINGS_ENDPOINT and OPENBLOG_GREETINGS_ADMIN_KEY where Admin runs; docs/greeting-cards.md).",
  invalid: "Admin's greeting card settings are not valid, so the feature stays off:",
  unavailable: "Admin reached the greetings function, but greeting cards aren't switched on there (OPENBLOG_GREETINGS_ENABLED=true).",
};

/** "September 7", for a birthday (the year is left out). */
const birthdayWords = (day) => new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));

export async function createCards({ api, go }) {
  await use("action-button", "alert-banner", "content-card", "date-field", "dropdown-menu", "empty-state", "side-sheet", "skeleton-block", "status-badge", "text-field");
  let state = null;
  let stopped = null; // the last card she stopped, for Undo

  const heading = h("h2", { id: "studio-cards-h", class: "studio-question", tabindex: "-1", text: "Who gets a card?" });
  const lede = h("p", { class: "studio-lede" });
  const write = h("action-button", { size: "lg", class: "studio-primary", href: "#/cards/new", hidden: true }, "Write a card");
  const status = h("p", { class: "studio-help", role: "status", "aria-live": "polite" });
  const banner = h("div", { class: "studio-banner" });
  const list = h("div", { class: "studio-card-sections", "aria-busy": "true" }, ...[1, 2, 3].map(() => h("skeleton-block", { shape: "card" })));
  const people = h("section", { class: "studio-section studio-card-people", "aria-labelledby": "studio-people-h", hidden: true });
  const details = h("details", { class: "studio-help" });
  const sheet = h("side-sheet", { label: "Someone", side: "right" });
  const element = h("section", { class: "studio-page studio-cards", "aria-labelledby": "studio-cards-h" },
    h("div", { class: "studio-today" }, heading, lede, write),
    banner, status,
    h("div", { class: "studio-comment-columns" }, h("div", { class: "studio-comment-main" }, list), h("div", { class: "studio-comment-side" }, people, details)),
    sheet);

  const person = (id) => state?.contacts.find((c) => c.id === id) || null;
  const designs = () => state?.overview.designs || [];
  const zone = () => state?.overview.timeZone || "UTC";
  const when = (iso) => sayWhen(iso, { timeZone: zone() });

  async function load() {
    list.setAttribute("aria-busy", "true");
    try {
      const overview = await api.get("greetings/status");
      if (!overview.enabled) {
        state = { overview, contacts: [], cards: [] };
      } else {
        const contacts = await api.get("greetings/contacts");
        const cards = await api.get("greetings/cards");
        state = { overview, contacts: contacts.contacts, cards: cards.cards };
      }
      banner.replaceChildren();
      draw();
    } catch (error) {
      if (error.status === 401) throw error;
      list.removeAttribute("aria-busy");
      list.replaceChildren();
      banner.replaceChildren(h("alert-banner", { variant: "danger", heading: "Your cards didn't load" },
        cardTrouble(error, "load"), " ", h("action-button", { variant: "secondary", size: "sm", onClick: () => load() }, "Try again")));
    }
  }

  function draw() {
    list.removeAttribute("aria-busy");
    const { overview } = state;
    drawDetails();
    if (!overview.enabled) {
      write.hidden = true;
      people.hidden = true;
      lede.textContent = "";
      list.replaceChildren(h("alert-banner", { variant: "info", heading: "Cards aren't ready yet" },
        "The person who set up your site needs to finish setting them up. Your site works the same without them."));
      return;
    }
    write.hidden = false;
    lede.textContent = `Cards go out by email from ${overview.from?.name || "you"}, at the time you pick.`;
    const groups = sections(state.cards);
    const failedCount = state.cards.filter((c) => c.status === "failed").length;
    banner.replaceChildren(...(failedCount ? [h("alert-banner", { variant: "warning", heading: failedCount === 1 ? "1 card didn't go out" : `${failedCount} cards didn't go out` }, "They're at the top of your list, with what went wrong.")] : []));
    if (!groups.length) {
      list.replaceChildren(state.contacts.length
        ? h("empty-state", { heading: "No cards yet" }, "Write one and it goes out on the day you pick. Birthdays can go every year.",
          h("action-button", { slot: "actions", href: "#/cards/new" }, "Write a card"))
        : h("p", { class: "studio-help", text: "Add the people you send cards to, then write them a card." }));
    } else {
      list.replaceChildren(...groups.map((g) => h("section", { class: "studio-section", "aria-labelledby": `studio-cards-${g.id}` },
        h("h3", { id: `studio-cards-${g.id}`, text: g.heading }),
        h("ul", { class: "studio-comment-list" }, ...g.cards.map(cardRow)))));
    }
    drawPeople();
  }

  function cardRow(card) {
    const who = person(card.contactId);
    const title = cardTitle(card, who, designs());
    const headingId = `studio-card-${card.id}`;
    const row = h("li", { class: "studio-comment", "data-id": card.id, "aria-label": title },
      h("div", { class: "studio-comment-head" },
        h("h4", { id: headingId, class: "studio-comment-who", tabindex: "-1", text: `${who?.name || "Someone you removed"} · ${designLabel(card.design, designs())}` }),
        card.yearly ? h("status-badge", { variant: "neutral" }, "Every year") : null,
        card.status === "sending" ? h("status-badge", { variant: "info" }, "Going out now") : null),
      h("p", { text: cardLine(card, when) }),
      card.subject ? h("p", { class: "studio-help", text: `“${card.subject}”` }) : null);
    const buttons = [];
    if (card.status === "failed") {
      buttons.push(h("action-button", { href: `#/cards/${card.id}`, "aria-describedby": headingId }, "Open and try again"));
      buttons.push(h("action-button", { variant: "secondary", "aria-describedby": headingId, onClick: () => stop(card) }, "Don't send it"));
    } else if (card.status === "scheduled") {
      buttons.push(h("action-button", { variant: "secondary", href: `#/cards/${card.id}`, "aria-describedby": headingId }, "Change"));
      buttons.push(h("action-button", { variant: "secondary", "aria-describedby": headingId, onClick: () => stop(card) }, card.yearly ? "Stop sending it" : "Don't send it"));
    } else if (card.status === "sent") {
      buttons.push(h("action-button", { variant: "ghost", "aria-describedby": headingId, onClick: () => sendAgain(card) }, "Send it again"));
    }
    if (buttons.length) row.append(h("div", { class: "studio-comment-actions" }, ...buttons));
    row.append(h("details", { class: "studio-help studio-comment-details" }, h("summary", { text: "For the person who set up your site" }),
      h("ul", { class: "studio-mono" }, ...[`id ${card.id}`, `status ${card.status}${card.error ? ` (${card.error})` : ""}, attempts ${card.attempts ?? 0}`,
        `next ${card.nextSendAt || "none"}`, `last ${card.lastSentAt || "none"}`, `zone ${card.timeZone}`].map((t) => h("li", { text: t })))));
    return row;
  }

  function sendAgain(card) {
    try {
      sessionStorage.setItem("studio:card:copy", JSON.stringify({ ...cardForm(card), yearly: false }));
    } catch {
      // Without storage the editor starts fresh for the same person.
    }
    go(`#/cards/new?for=${encodeURIComponent(card.contactId)}&copy=1`);
  }

  async function stop(card) {
    const title = cardTitle(card, person(card.contactId), designs());
    const verb = card.yearly ? "Stop sending it" : "Don't send it";
    const choice = await ask({
      heading: card.yearly ? `Stop sending ${title} every year?` : `Stop ${title}?`,
      text: "It won't be sent. You can bring it back right after.",
      choices: [{ label: "Keep it", value: "keep" }, { label: verb, value: "stop", variant: "destructive" }],
    });
    if (choice !== "stop") return;
    try {
      await api.post(`greetings/cards/${card.id}/cancel`, {});
      stopped = card;
      await load();
      const undo = h("action-button", { size: "sm", onClick: () => bringBack() }, "Undo");
      const alert = h("alert-banner", { variant: "info", dismissible: true, heading: "Stopped. That card won't be sent." }, undo);
      alert.addEventListener("close", () => { stopped = null; });
      banner.prepend(alert);
      status.textContent = "Stopped. That card won't be sent.";
      requestAnimationFrame(() => undo.querySelector("button")?.focus());
    } catch (error) {
      if (error.status === 401) throw error;
      status.textContent = cardTrouble(error);
      if (error.status === 404) await load();
    }
  }

  async function bringBack() {
    if (!stopped) return;
    const card = stopped;
    stopped = null;
    const today = new Date().toISOString().slice(0, 10);
    if (!card.yearly && card.sendOn < today) {
      try { sessionStorage.setItem("studio:card:copy", JSON.stringify(cardForm(card))); } catch { /* starts fresh */ }
      status.textContent = "Pick a new day, then Schedule this card.";
      go(`#/cards/new?for=${encodeURIComponent(card.contactId)}&copy=1`);
      return;
    }
    try {
      const reply = await api.post("greetings/cards", { ...cardForm(card), timeZone: card.timeZone || zone() });
      await load();
      const said = `Back on. ${cardLine(reply.card, when)}`;
      status.textContent = said;
      toast(said);
    } catch (error) {
      if (error.status === 401) throw error;
      status.textContent = cardTrouble(error);
    }
  }

  // ---- your people ----------------------------------------------------------------------------

  function drawPeople() {
    people.hidden = false;
    const add = h("action-button", { variant: "secondary", onClick: () => editPerson(null) }, "Add someone");
    people.replaceChildren(h("h3", { id: "studio-people-h", text: "Your people" }));
    if (!state.contacts.length) {
      people.append(h("empty-state", { heading: "Nobody here yet" }, "Add the people you send cards to, with their birthdays.",
        h("action-button", { slot: "actions", onClick: () => editPerson(null) }, "Add someone")));
      return;
    }
    people.append(h("ul", { class: "studio-comment-list" }, ...state.contacts.map((c) => h("li", { class: "studio-comment", "data-person": c.id },
      h("div", { class: "studio-comment-head" },
        h("h4", { class: "studio-comment-who", tabindex: "-1", text: c.name }),
        h("dropdown-menu", {
          class: "studio-row-menu",
          items: [{ value: "change", label: "Change" }, { value: "remove", label: "Remove" }],
          onItemselect: (e) => (e.detail === "change" ? editPerson(c) : removePerson(c)),
        }, h("span", { slot: "label" }, "More", h("span", { class: "studio-visually-hidden", text: ` for ${c.name}` })))),
      h("p", { class: "studio-help", text: c.email }),
      h("p", { class: "studio-help", text: c.birthday ? `Birthday ${birthdayWords(c.birthday)}` : "No birthday added" }),
      h("action-button", { variant: "secondary", href: `#/cards/new?for=${encodeURIComponent(c.id)}` }, `Write to ${c.name}`)))), add);
  }

  function editPerson(contact) {
    const form = { name: contact?.name || "", email: contact?.email || "", birthday: contact?.birthday || "" };
    const name = h("text-field", { label: "Name", value: form.name, maxlength: 80, onValuechange: (e) => { form.name = e.detail; } });
    const email = h("text-field", { label: "Email address", type: "email", value: form.email, autocomplete: "off", onValuechange: (e) => { form.email = e.detail; } });
    const birthday = h("date-field", { label: "Birthday (optional)", value: form.birthday, description: "Add it and you can send a birthday card every year.", onValuechange: (e) => { form.birthday = e.detail; } });
    const fields = { name, email, birthday };
    const problem = h("p", { class: "studio-comment-trouble", role: "alert", hidden: true });
    const save = h("action-button", { onClick: async () => {
      if (save.loading) return;
      save.loading = true;
      problem.hidden = true;
      for (const f of Object.values(fields)) if ("error" in f) f.error = "";
      try {
        const body = { name: form.name, email: form.email, birthday: form.birthday || null };
        const reply = await api.post(contact ? `greetings/contacts/${contact.id}` : "greetings/contacts", body);
        sheet.open = false;
        await load();
        const said = `${contact ? "Saved" : "Added"} ${reply.contact.name}.`;
        status.textContent = said;
        toast(said);
        requestAnimationFrame(() => people.querySelector(`[data-person="${reply.contact.id}"] .studio-comment-who`)?.focus());
      } catch (error) {
        if (error.status === 401) throw error;
        const field = fields[error.data?.field];
        if (field && "error" in field) field.error = cardTrouble(error, "person");
        problem.textContent = cardTrouble(error, "person");
        problem.hidden = false;
        (field?.querySelector("input") || problem).focus?.();
      } finally {
        save.loading = false;
      }
    } }, contact ? "Save" : "Add to your people");
    sheet.label = contact ? `Change ${contact.name}` : "Add someone";
    sheet.replaceChildren(h("span", { slot: "heading", text: contact ? `Change ${contact.name}` : "Add someone" }),
      name, email, birthday, problem,
      h("div", { class: "studio-sheet-actions" }, save, h("action-button", { variant: "secondary", onClick: () => { sheet.open = false; } }, "Cancel")));
    sheet.open = true;
    requestAnimationFrame(() => name.querySelector("input")?.focus());
  }

  async function removePerson(contact) {
    const count = state.cards.filter((c) => c.contactId === contact.id && c.status !== "cancelled").length;
    const choice = await ask({
      heading: `Remove ${contact.name}?`,
      text: count ? `${contact.name}'s ${count === 1 ? "card is" : `${count} cards are`} stopped and removed too. This can't be undone.` : `${contact.name} leaves your people. This can't be undone.`,
      choices: [{ label: `Keep ${contact.name}`, value: "keep" }, { label: `Remove ${contact.name}`, value: "remove", variant: "destructive" }],
    });
    if (choice !== "remove") return;
    try {
      await api.post(`greetings/contacts/${contact.id}/remove`, {});
      await load();
      status.textContent = `Removed ${contact.name}.`;
      toast(`Removed ${contact.name}.`);
      heading.focus();
    } catch (error) {
      if (error.status === 401) throw error;
      status.textContent = cardTrouble(error, "person");
    }
  }

  function drawDetails() {
    const o = state.overview;
    const count = (s) => state.cards.filter((c) => c.status === s).length;
    details.replaceChildren(h("summary", { text: "For the person who set up your site" }),
      h("ul", { class: "studio-mono" }, ...[
        `state ${o.state || (o.enabled ? "on" : "off")}`,
        o.enabled ? `from ${o.from?.name || ""} <${o.from?.email || ""}>, zone ${o.timeZone}` : OFF[o.state] || OFF.off,
        ...(o.problems || []).map((p) => `problem: ${p}`),
        o.enabled ? `designs ${(o.designs || []).map((d) => d.id).join(", ")}` : null,
        o.enabled ? `cards: ${["scheduled", "sending", "sent", "failed", "cancelled"].map((s) => `${s} ${count(s)}`).join(", ")}` : null,
      ].filter(Boolean).map((t) => h("li", { text: t }))),
      h("p", {}, h("a", { href: "/admin/#/greetings", target: "_blank", rel: "noopener" }, "Greeting cards in the old Admin")));
  }

  return {
    title: "Cards",
    element,
    load,
    reload: load,
    focus: () => heading.focus(),
    get palette() {
      if (!state?.overview.enabled) return [];
      return [
        { id: "write", label: "Write a card", group: "Cards" },
        { id: "add", label: "Add someone", group: "Cards" },
        ...state.contacts.map((c) => ({ id: `to:${c.id}`, label: `Write to ${c.name}`, group: "Cards" })),
      ];
    },
    command(id) {
      if (id === "write") go("#/cards/new");
      else if (id === "add") editPerson(null);
      else if (id.startsWith("to:")) go(`#/cards/new?for=${encodeURIComponent(id.slice(3))}`);
    },
  };
}
