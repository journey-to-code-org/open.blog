// Decorations: when the house changes for the seasons, and to what. Today's look and the next
// change in her words; put a look up now; see any look on her front page; and the calendar, one
// season per line, changed one at a time. Every save goes out like a post and leaves openblog.json
// as it was written except the values that changed.
import { h, toast } from "../parts/dom.js";
import { use } from "../zubra.js";
import { ask } from "../parts/dialogs.js";
import { askWhichToKeep } from "../parts/conflict.js";
import { showPreview } from "../parts/preview.js";
import { sendOut, servedHere, wentOutWords } from "../parts/publish.js";
import { editSeason } from "../parts/season-sheet.js";
import { askPutUpNow } from "../parts/put-up-now.js";
import { dayAfter, sayLongDate, todaySentence } from "../parts/season-words.js";
import { MAX_WINDOWS, nextChange, problems, sayRange, switchTimeWords, toStored, upNowUntil, wearingOn, windowHolds as windowHoldsDay } from "../parts/season-windows.js";

const clone = (value) => JSON.parse(JSON.stringify(value ?? null));
const todayUtc = () => new Date().toISOString().slice(0, 10);
const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export async function createDecorations({ api, meta }) {
  await use("toggle-switch", "select-field", "action-button", "dropdown-menu", "alert-banner", "side-sheet", "status-badge", "skeleton-block", "cluster-layout", "empty-state");
  let saved = null; // GET seasons, as on the server
  let draft = null; // { theme, seasons } she's changing
  let looks = []; // [{ value, label }] by label
  const card = h("div", { class: "studio-today" });
  const banner = h("div", { class: "studio-banner", "aria-live": "polite" });
  const live = h("p", { class: "studio-help studio-row-note", "aria-live": "polite" });
  const toggle = h("toggle-switch", { label: "Change by itself with the calendar", onCheckedchange: (e) => { draft.seasons.enabled = e.detail; changed(); } });
  const rows = h("ol", { class: "studio-season-list", "aria-label": "Your seasons", "aria-describedby": "studio-season-help" });
  const between = h("select-field", { label: "Between seasons", onValuechange: (e) => { draft.theme = e.detail; changed(); } });
  const add = h("action-button", { variant: "secondary", onClick: () => addSeason() }, "Add a season");
  const barWords = h("p", { class: "studio-save-words", role: "status" });
  const saveButton = h("action-button", { onClick: () => save() }, "Save");
  const bar = h("div", { class: "studio-write-bar studio-deco-bar", hidden: true }, barWords, saveButton);
  const details = h("side-sheet", { label: "For the person who set up your site", side: "right" });
  const element = h("section", { class: "studio-page studio-decorations", "aria-labelledby": "studio-deco-h" },
    banner, card,
    h("section", { class: "studio-section", "aria-labelledby": "studio-cal-h" },
      h("h3", { id: "studio-cal-h", text: "Your calendar" }),
      toggle,
      h("p", { id: "studio-season-help", class: "studio-help", text: "If two seasons share a day, the one higher up wins." }),
      rows, live, add, between),
    bar, details);

  const label = (name) => looks.find((look) => look.value === name)?.label || name;
  const windows = () => draft.seasons.windows || [];
  const say = (text) => { live.textContent = ""; requestAnimationFrame(() => { live.textContent = text; }); };
  const stored = (state) => JSON.stringify({ theme: state.theme, seasons: toStored(state.seasons) });
  const isDirty = () => Boolean(saved && draft) && stored(draft) !== stored(saved);

  // ---- the top card: today in her words, and the one thing to do now
  function drawCard() {
    const today = todayUtc();
    const lines = todaySentence(saved, label, { today });
    if (saved.next) lines.push(`The change reaches your site ${switchTimeWords(saved.next.day, { timeZone: zone() })}.`);
    const up = saved.seasons?.upNow && saved.seasons.upNow.until >= today ? saved.seasons.upNow : null;
    const nextLook = saved.next?.theme || windows()[0]?.theme || saved.theme;
    card.replaceChildren(
      h("h2", { id: "studio-deco-h", class: "studio-question", tabindex: "-1", text: lines[0] }),
      ...lines.slice(1).map((line) => h("p", { class: "studio-lede", text: line })),
      h("cluster-layout", { gap: "0.75rem" },
        up ? h("action-button", { variant: "secondary", onClick: () => backToCalendar() }, `Take ${label(up.theme)} down early`)
          : h("action-button", { size: "lg", onClick: () => putUp(nextLook) }, `Put ${label(nextLook)} up now`),
        h("action-button", { variant: "secondary", onClick: (e) => preview(up ? up.theme : nextLook, e.currentTarget) }, `See how ${label(up ? up.theme : nextLook)} looks`)));
  }

  // ---- the calendar
  function drawList() {
    toggle.checked = draft.seasons.enabled === true;
    between.options = looks;
    between.value = draft.theme;
    between.label = draft.seasons.enabled ? "Between seasons" : "Every day";
    const covered = coversEveryDay();
    between.description = !draft.seasons.enabled ? "The look your house wears while the calendar is off."
      : covered ? "Your seasons cover every day, so this only shows when the calendar is off." : "Shows on days no season covers.";
    const found = problems(draft.seasons, looks.map((look) => ({ name: look.value, label: look.label })));
    const today = todayUtc();
    const wornIndex = wearingOn(draft.seasons, draft.theme, today.slice(5), { date: today }).index;
    const nextTheme = nextChange(draft.seasons, draft.theme, today)?.theme;
    const list = windows();
    rows.replaceChildren(...list.map((season, index) => {
      const notes = found.filter((problem) => problem.index === index);
      const badges = [
        index === wornIndex ? h("status-badge", { variant: "success" }, "Up now") : null,
        season.theme === nextTheme && index !== wornIndex ? h("status-badge", { variant: "neutral" }, "Next") : null,
        notes.length ? h("status-badge", { variant: "warning" }, notes.every((n) => /overlaps/.test(n.words)) ? "Shares days" : "Check this") : null,
      ];
      const name = `Season ${index + 1} of ${list.length}: ${label(season.theme)}, ${sayRange(season)}`;
      const open = h("button", { type: "button", class: "studio-season-open", "aria-label": name, onClick: () => change(index) },
        h("span", { class: "studio-season-name", text: label(season.theme) }),
        h("span", { class: "studio-season-dates", text: sayRange(season) }));
      open.addEventListener("keydown", (event) => {
        if (event.altKey && event.shiftKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) { event.preventDefault(); move(index, event.key === "ArrowUp" ? -1 : 1, true); }
      });
      const menu = h("dropdown-menu", {
        class: "studio-row-menu",
        items: [
          { value: "change", label: "Change it" },
          { value: "look", label: "See how it looks" },
          { value: "up", label: "Move up", disabled: index === 0 },
          { value: "down", label: "Move down", disabled: index === list.length - 1 },
          { value: "remove", label: "Remove this season" },
        ],
        onItemselect: (e) => {
          if (e.detail === "change") change(index);
          if (e.detail === "look") preview(season.theme, menu.querySelector("button"));
          if (e.detail === "up") move(index, -1);
          if (e.detail === "down") move(index, 1);
          if (e.detail === "remove") remove(index);
        },
      }, h("span", { slot: "label" }, "Move or remove", h("span", { class: "studio-visually-hidden", text: ` ${label(season.theme)}` })));
      return h("li", { class: "studio-season-row" }, open, h("span", { class: "studio-season-badges" }, ...badges.filter(Boolean)), menu,
        ...notes.map((problem) => h("p", { class: "studio-help studio-season-problem", text: problem.words })),
        ...overlapFix(index));
    }));
    if (!list.length) rows.replaceChildren(h("li", {}, h("empty-state", { heading: "No seasons yet" }, "Add one, like Christmas from December 1 to January 6, and your house changes by itself.")));
    add.disabled = list.length >= MAX_WINDOWS;
  }

  // When a season runs into the next one, offer to start the next one the day after it ends.
  function overlapFix(index) {
    const list = windows();
    const season = list[index];
    const after = list.findIndex((other, i) => i !== index && other.start !== season.start && windowHoldsDay(season, other.start));
    if (after < 0) return [];
    const start = dayAfter(`2028-${season.end}`).slice(5);
    return [h("action-button", { variant: "secondary", size: "sm", class: "studio-season-fix", onClick: () => {
      list[after] = { ...list[after], start };
      changed();
      say(`${label(list[after].theme)} now starts ${sayRange({ start, end: start }).split(" to ")[0]}. Not saved yet.`);
    } }, `Start ${label(list[after].theme)} on ${sayRange({ start, end: start }).split(" to ")[0]} instead`)];
  }

  function coversEveryDay() {
    for (let day = 0; day < 366; day += 1) {
      const date = new Date(Date.UTC(2028, 0, 1) + day * 86400000).toISOString().slice(5, 10);
      if (wearingOn(draft.seasons, "", date).index < 0) return false;
    }
    return true;
  }

  function changed() {
    toggle.description = draft.seasons.enabled ? "Your house changes by itself on the days below."
      : saved.seasons?.enabled ? `When you save, your house wears ${label(draft.theme)} every day. Your seasons are kept for when you turn this back on.`
        : `Your house wears ${label(draft.theme)} every day.`;
    drawList();
    const dirty = isDirty();
    bar.hidden = !dirty;
    barWords.textContent = dirty ? "Not saved yet." : "";
  }

  async function change(index) {
    const season = windows()[index];
    const result = await editSeason({ season, looks, number: index + 1, count: windows().length, onPreview: (look, opener) => preview(look, opener) });
    if (result) {
      windows()[index] = { theme: result.theme, start: result.start, end: result.end };
      changed();
      say(`${label(result.theme)}: ${sayRange(result)}. Not saved yet.`);
      if (result.andSave) save();
    } else if (season.fresh) {
      windows().splice(index, 1);
      changed();
    }
    requestAnimationFrame(() => rows.children[Math.min(index, windows().length - 1)]?.querySelector(".studio-season-open")?.focus());
  }

  function addSeason() {
    const list = windows();
    const last = list[list.length - 1];
    const start = last ? dayAfter(`2028-${last.end}`).slice(5) : "12-01";
    list.push({ theme: draft.theme, start, end: start, fresh: true });
    draft.seasons.windows = list;
    changed();
    say(`Season ${list.length} of ${list.length} added. Not saved yet.`);
    change(list.length - 1);
  }

  function move(index, by, fromKeys = false) {
    const list = windows();
    const to = index + by;
    if (to < 0 || to >= list.length) { say(`Can't move ${by < 0 ? "up" : "down"}: this is the ${by < 0 ? "first" : "last"} season.`); return; }
    [list[index], list[to]] = [list[to], list[index]];
    changed();
    say(`${label(list[to].theme)} moved to season ${to + 1} of ${list.length}.`);
    requestAnimationFrame(() => rows.children[to]?.querySelector(fromKeys ? ".studio-season-open" : "dropdown-menu button")?.focus());
  }

  function remove(index) {
    const [gone] = windows().splice(index, 1);
    changed();
    say(`Removed ${label(gone.theme)}. Not saved yet.`);
    requestAnimationFrame(() => (rows.children[Math.max(0, index - 1)]?.querySelector(".studio-season-open") || add.querySelector("button"))?.focus());
  }

  // ---- see a look on her front page
  function preview(look, opener) {
    return showPreview(api, {
      opener, request: () => api.post("seasons/preview", { look }),
      heading: `How ${label(look)} looks`, backLabel: "Back to decorations",
      note: "Only you can see this. Nothing is saved or put up. This shows the decorations; your front page's own words change with the date.", frameTitle: `Your front page decorated for ${label(look)}`,
    });
  }

  // ---- saving
  // `upNowOnly`: putting a look up (or taking it down) changes only `upNow`, so on a conflict it's
  // put on top of the other device's calendar instead of asking, and never undoes their changes.
  // Her own unsaved calendar edits stay on screen either way.
  async function send(next, { quiet = false, upNowOnly = false } = {}) {
    const pending = upNowOnly && isDirty() ? clone(draft) : null;
    const put = (base, etag) => api.put("seasons", { etag, theme: base.theme, seasons: toStored(base.seasons) });
    let reply;
    try {
      reply = await put(next, saved.etag);
    } catch (error) {
      if (error.status === 409 && error.data?.etag && upNowOnly) {
        const fresh = error.data;
        const seasons = { ...clone(fresh.seasons), upNow: next.seasons.upNow };
        if (!next.seasons.upNow) delete seasons.upNow;
        try {
          reply = await put({ theme: fresh.theme, seasons }, fresh.etag);
        } catch (again) {
          banner.replaceChildren(h("alert-banner", { variant: "danger", heading: "Your decorations weren't saved" }, again.message));
          return null;
        }
      } else if (error.status === 409 && error.data?.etag) {
        return conflict(error.data, next);
      } else {
        // Her words, not the server's: a 422 names what to fix; anything else says try again.
        const words = error.status === 422 ? error.message.replace(/There is no theme called `([^`]+)` in your themes folder/g, "The look $1 isn't on your site anymore. Choose another.")
          : error.status ? "Something went wrong on your site. Your changes are still here; try again in a moment." : "Check your connection and try again. Your changes are still here.";
        banner.replaceChildren(h("alert-banner", { variant: "danger", heading: "Your decorations weren't saved" }, words));
        return null;
      }
    }
    adopt(reply);
    if (pending) {
      draft = { ...pending, seasons: { ...pending.seasons, upNow: reply.seasons?.upNow } };
      if (!reply.seasons?.upNow) delete draft.seasons.upNow;
      changed();
    }
    if (!quiet) {
      await announce(reply, "Saved.");
      requestAnimationFrame(() => card.querySelector("h2")?.focus());
    }
    return reply;
  }

  async function announce(reply, lead, { toast: say = true } = {}) {
    lastBuildError = reply.buildError || "";
    if (reply.changed === false) { toast("Nothing's changed. Your site already has this."); return null; }
    if (reply.buildError) { toast("Saved, but your site couldn't be put together yet. The person who set up your site can see why in Details.", { variant: "warning", duration: 0 }); return null; }
    const result = await sendOut(api, "Change the decorations");
    lastPublish = result;
    if (!say) return result;
    const said = wentOutWords(result, { meta, action: "saved" });
    toast(`${lead === "Saved." ? "" : `${lead} `}${said.words}`, { variant: said.variant, duration: result.sent === "failed" ? 0 : undefined });
    return result;
  }

  let lastPublish = null;
  let lastBuildError = "";

  async function save() {
    const found = problems(draft.seasons, looks.map((look) => ({ name: look.value, label: look.label })));
    const blocking = found.filter((problem) => !/overlaps/.test(problem.words));
    if (draft.seasons.enabled && !windows().length) blocking.push({ index: -1, words: "Add a season, or turn off Change by itself." });
    if (blocking.length) {
      banner.replaceChildren(h("alert-banner", { variant: "danger", heading: "Not saved yet" }, h("ul", {}, blocking.map((problem) => h("li", { text: problem.words })))));
      return false;
    }
    saveButton.loading = true;
    try {
      return Boolean(await send(draft));
    } finally {
      saveButton.loading = false;
    }
  }

  async function conflict(fresh, mine) {
    const choice = await askWhichToKeep({ name: "Your decorations", were: true, theirState: "", myState: "", what: "changes", them: "them" });
    if (choice === "mine") { saved.etag = fresh.etag; return send(mine); }
    if (choice === "theirs") {
      const kept = clone(mine);
      adopt(fresh);
      banner.replaceChildren(h("alert-banner", { variant: "info", heading: "Your changes" }, "Here are the decorations from the other device. ",
        h("action-button", { variant: "secondary", onClick: () => { draft = kept; banner.replaceChildren(); changed(); } }, "Put my changes back")));
    }
    return null;
  }

  function adopt(state) {
    saved = clone(state);
    saved.seasons = saved.seasons && Object.keys(saved.seasons).length ? saved.seasons : { version: 1, enabled: false, windows: [] };
    draft = { theme: saved.theme, seasons: clone(saved.seasons) };
    looks = (state.themes || []).map((theme) => ({ value: theme.name, label: theme.label || theme.name })).sort((a, b) => a.label.localeCompare(b.label));
    drawCard();
    changed();
  }

  // ---- put it up now, and Undo
  async function putUp(look) {
    const today = todayUtc();
    const choice = await askPutUpNow({
      looks, look, unsaved: isDirty(),
      untilFor: (name) => upNowUntil(saved.seasons, name, today),
      words: ({ look: name, until }) => {
        const down = saved.wearing !== name ? `${label(saved.wearing)} comes down today, and ${label(name)} goes up.` : `${label(name)} stays up.`;
        const after = nextChange({ ...saved.seasons, upNow: { theme: name, until } }, saved.theme, until);
        const then = after ? `Then your calendar takes over again, starting with ${label(after.theme)} on ${sayLongDate(after.day)}.` : "Then your calendar takes over again.";
        return [down, `It stays up through ${sayLongDate(until)}. ${then}`, "Next year's dates don't change."];
      },
    });
    if (!choice) return;
    const before = clone(saved);
    const reply = await send({ theme: saved.theme, seasons: { ...clone(saved.seasons), upNow: choice } }, { quiet: true, upNowOnly: true });
    if (!reply) return;
    const undo = h("action-button", { onClick: () => undoPutUp(before) }, "Undo");
    const result = await announce(reply, `${label(choice.theme)} is up.`, { toast: false });
    // Honest about where: "up" on the public site only when it really went out.
    const here = result && result.sent === "none" && !servedHere(meta);
    const heading = `${label(choice.theme)} is up${here ? " here" : ""}.${before.wearing !== choice.theme ? ` ${label(before.wearing)} came down.` : ""}`;
    banner.replaceChildren(h("alert-banner", { variant: "success", dismissible: true, heading },
      here ? "Your public site catches up when the person who set it up sends it out. " : "",
      h("cluster-layout", { gap: "0.5rem" }, undo)));
    requestAnimationFrame(() => { element.scrollIntoView?.({ block: "start" }); undo.querySelector("button")?.focus({ preventScroll: true }); });
  }

  async function undoPutUp(before) {
    const seasons = clone(saved.seasons);
    if (before.seasons?.upNow) seasons.upNow = before.seasons.upNow;
    else delete seasons.upNow;
    const reply = await send({ theme: saved.theme, seasons }, { quiet: true, upNowOnly: true });
    if (!reply) return;
    banner.replaceChildren();
    toast(`Undone. ${label(reply.wearing)} is back up.`);
    card.querySelector("h2")?.focus();
  }

  async function backToCalendar() {
    const seasons = clone(saved.seasons);
    delete seasons.upNow;
    const reply = await send({ theme: saved.theme, seasons }, { quiet: true, upNowOnly: true });
    if (reply) await announce(reply, `Back to your calendar. ${label(reply.wearing)} is up again.`);
    requestAnimationFrame(() => card.querySelector("h2")?.focus());
  }

  // ---- details, for the person who set up the site
  function showDetails() {
    const row = (name, value) => [h("dt", { text: name }), h("dd", { class: "studio-mono", text: value })];
    details.replaceChildren(
      h("span", { slot: "heading", text: "For the person who set up your site" }),
      h("dl", { class: "studio-details" },
        ...row("File", "openblog.json (members theme and seasons)"),
        ...row("Between seasons", saved.theme),
        ...row("Up early", saved.seasons?.upNow ? JSON.stringify(saved.seasons.upNow) : "none"),
        ...row("Today (UTC)", `${saved.today}, wearing ${saved.wearing}`),
        ...row("Next change", saved.next ? `${saved.next.day} ${saved.next.theme} (first build after ${saved.next.day}T00:00Z)` : "none"),
        ...row("How it's written", "Only members that changed are written. A changed seasons block is written in its documented key order (version, enabled, windows, upNow), so one written in another order is reordered on its first change."),
        ...row("Last build", lastBuildError || "Fine"),
        ...row("Last send-out", lastPublish ? [lastPublish.message, lastPublish.commit ? `commit ${String(lastPublish.commit).slice(0, 12)}` : ""].filter(Boolean).join(" · ") : "Not in this visit")),
      h("table", { class: "studio-season-table" },
        h("thead", {}, h("tr", {}, ...["#", "Look", "Theme", "Start", "End"].map((text) => h("th", { text })))),
        h("tbody", {}, ...(saved.seasons?.windows || []).map((w, i) => h("tr", {}, ...[String(i + 1), label(w.theme), w.theme, w.start, w.end].map((text) => h("td", { text })))))),
      h("action-button", { variant: "secondary", onClick: async () => {
        try { await navigator.clipboard.writeText(JSON.stringify(toStored(saved.seasons), null, 2)); toast("Copied the stored seasons."); } catch { toast("Couldn't copy here.", { variant: "warning" }); }
      } }, "Copy the stored seasons"));
    details.open = true;
  }

  async function load() {
    card.replaceChildren(h("skeleton-block", { lines: 3 }));
    try {
      adopt(await api.get("seasons"));
      // From Find anywhere: "Put a look up now" lands here and asks straight away.
      if (new URLSearchParams(location.hash.split("?")[1] || "").get("do") === "putup") {
        history.replaceState(null, "", "#/decorations");
        putUp(saved.next?.theme || saved.wearing);
      }
    } catch (error) {
      card.replaceChildren(h("alert-banner", { variant: "danger", heading: "Your decorations didn't load" }, error.message,
        h("action-button", { variant: "secondary", onClick: load }, "Try again")));
    }
  }

  async function leave() {
    if (!isDirty()) return true;
    const choice = await ask({ heading: "Save your decorations?", text: "You changed your calendar and didn't save it.", choices: [{ label: "Save", value: "save" }, { label: "Leave without saving", value: "go", variant: "secondary" }] });
    if (choice === "save") return save();
    return choice === "go";
  }

  return {
    title: "Decorations",
    element,
    load,
    leave,
    isDirty,
    focus: () => card.querySelector("h2")?.focus(),
    get palette() {
      if (!saved) return [];
      return [
        { id: "save", label: "Save decorations", group: "Decorations", hint: "Ctrl Enter" },
        { id: "add", label: "Add a season", group: "Decorations" },
        { id: "details", label: "Show decorations details", group: "Decorations" },
        ...looks.map((look) => ({ id: `up:${look.value}`, label: `Put up ${look.label}`, group: "Put up now" })),
        ...looks.map((look) => ({ id: `see:${look.value}`, label: `See how it looks in ${look.label}`, group: "See how it looks" })),
      ];
    },
    keys: ["save", "publish"], // Ctrl/⌘ S and Ctrl/⌘ Enter both save here
    command(id) {
      if (id === "save" || id === "publish") save();
      if (id === "add") addSeason();
      if (id === "details") showDetails();
      if (id.startsWith("up:")) putUp(id.slice(3));
      if (id.startsWith("see:")) preview(id.slice(4));
    },
    reload: load,
  };
}
