// New job's trade, service and town (Studio R4), remembered on this phone: one summary line once
// remembered ("Roofing · Roof repair · Elkins" and Change), the fields on first use. The trade isn't
// asked when the site has one; a service can be "Something else"; the last five towns are a tap away.
import { h } from "./dom.js";
import { tradeLabel } from "./job-rules.js";
import { serviceTitle } from "./new-job-rules.js";

const OTHER = "__other";
const slug = (text) => String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);

/** `{ meta, services, prefs(), onChange() }`. Returns `{ element, values(), set(fields), reset(), open(focus), isOpen(), draw() }`. */
export function createPicks({ meta, services, prefs, onChange }) {
  const siteTrade = String(meta.job?.siteTrade || "");
  const known = (value) => services.some((s) => s.id === value);
  const start = prefs();
  const trades = [...new Set([...(meta.job?.trades || []), start.trade].filter(Boolean))];
  const trade = h("select-field", { label: "Trade", options: [{ value: "", label: "Choose your trade" }, ...trades.map((t) => ({ value: t, label: tradeLabel(t) }))], value: siteTrade || start.trade, hidden: Boolean(siteTrade) });
  const service = h("select-field", {
    label: "Service",
    options: [{ value: "", label: "Choose a service" }, ...services.map((s) => ({ value: s.id, label: s.title })), { value: OTHER, label: "Something else" }],
    value: known(start.service) ? start.service : start.service ? OTHER : "",
  });
  const other = h("text-field", { label: "What service?", description: "Add it under Services later so it shows on your site.", value: known(start.service) ? "" : serviceTitle(start.service), hidden: service.value !== OTHER });
  const town = h("text-field", { label: "Town", description: "Just the town, never the street. Customers see it.", value: start.towns[0] || "", autocomplete: "off" });
  const towns = h("div", { class: "studio-row", role: "group", "aria-label": "Recent towns" });
  const fields = h("div", { class: "studio-picks" }, trade, service, other, town, towns);
  const summary = h("p", { class: "studio-picks-summary" });
  const change = h("action-button", { variant: "link", onClick: () => open(true) }, "Change");
  const element = h("div", { class: "studio-picks-box" }, h("div", { class: "studio-row studio-picks-line" }, summary, change), fields);

  const values = () => ({
    trade: String(siteTrade || trade.value || ""),
    service: service.value === OTHER ? slug(other.value) : String(service.value || ""),
    town: String(town.value || "").trim(),
  });

  function draw() {
    const now = values();
    summary.textContent = [tradeLabel(now.trade), now.service ? serviceTitle(now.service, services) : "", now.town].filter(Boolean).join(" · ") || "No trade, service or town yet";
    const recent = prefs().towns;
    towns.replaceChildren(...recent.slice(0, 5).map((name) => h("action-button", { variant: "link", label: `Use ${name}`, onClick: () => { town.value = name; draw(); onChange(); town.querySelector("input")?.focus(); } }, name)));
    towns.hidden = recent.length === 0;
  }

  function open(focus) {
    fields.hidden = false;
    change.hidden = true;
    if (focus) requestAnimationFrame(() => [...fields.querySelectorAll("select-field")].find((field) => !field.hidden)?.querySelector("select")?.focus());
  }

  service.addEventListener("valuechange", () => {
    other.hidden = service.value !== OTHER;
    if (!other.hidden) requestAnimationFrame(() => other.querySelector("input")?.focus());
    draw();
    onChange();
  });
  for (const field of [trade, other, town]) field.addEventListener("valuechange", () => { draw(); onChange(); });

  // Remembered: the line; first use: the fields.
  const remembered = start.trade || start.service || start.towns.length;
  fields.hidden = Boolean(remembered);
  change.hidden = !remembered;
  draw();

  return {
    element,
    values,
    /** Put back what was kept (the page reloaded). */
    set(kept = {}) {
      if (kept.trade && !siteTrade) trade.value = kept.trade;
      if (kept.service) {
        service.value = known(kept.service) ? kept.service : OTHER;
        other.hidden = service.value !== OTHER;
        if (service.value === OTHER) other.value = serviceTitle(kept.service);
      }
      town.value = kept.town || "";
      draw();
    },
    /** After a save: the next job starts in the last town. */
    reset() {
      town.value = prefs().towns[0] || "";
      draw();
    },
    open,
    isOpen: () => !fields.hidden,
    draw,
  };
}
