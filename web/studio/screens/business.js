// Business facts: the name, phone, hours, license and payments a trade site says once and uses at
// the bottom of every page, on the front page and for search engines. The rules are the old Admin's
// (/admin/business.js), so a fact can never pass here and fail there; Studio draws its own fields.
// Studio slice 10a; docs/specs/studio/slice-10a/ux.md.
import { h, toast } from "../parts/dom.js";
import { use } from "../zubra.js";
import { ask } from "../parts/dialogs.js";
import { askWhichToKeep } from "../parts/conflict.js";
import { sendOut, wentOutWords } from "../parts/publish.js";
import * as M from "../parts/business-rules.js";

const WEEKDAYS_AFTER_MONDAY = ["tuesday", "wednesday", "thursday", "friday"];

/** "7 AM", "5:30 PM" from "07:00", "17:30". */
const clock = (hhmm) => {
  const [hour, minute] = String(hhmm || "").split(":").map(Number);
  if (!Number.isFinite(hour)) return "";
  return `${hour % 12 || 12}${minute ? `:${String(minute).padStart(2, "0")}` : ""} ${hour < 12 ? "AM" : "PM"}`;
};

export async function createBusiness(context) {
  const { api, meta } = context;
  await use("text-field", "select-field", "toggle-switch", "action-button", "alert-banner", "skeleton-block");
  let reply = null; // GET business
  let saved = null; // the form as stored
  let form = null; // the form as she has it
  let busy = false;
  const fields = {}; // name → element, for problems

  const heading = h("h2", { id: "studio-business-h", class: "studio-question", tabindex: "-1", text: "What should customers know about you?" });
  const lede = h("p", { class: "studio-lede", text: "Say it once here. Your name, phone and hours go at the bottom of every page and on your front page, and Google and other search engines use them, so people looking for you find the right number. Everything here is public." });
  const banner = h("div", { class: "studio-banner", "aria-live": "polite" });
  const status = h("p", { class: "studio-help", role: "status", "aria-live": "polite" });
  const body = h("div", { class: "studio-card-form", "aria-busy": "true" }, h("skeleton-block", { lines: 8 }));
  const footer = h("p", { class: "studio-business-footer" });
  const barWords = h("span", { class: "studio-help" });
  const save = h("action-button", { onClick: () => saveNow() }, "Save");
  const details = h("details", { class: "studio-help" });
  // A site that isn't a business yet (a recipe blog) is told what naming a trade does before it does it.
  const notTrade = meta.siteUses?.trade !== true;
  const forBusiness = notTrade ? h("alert-banner", { variant: "info", heading: "This is for a business site" },
    "Your site isn't one yet. Naming a trade here adds Services, Reviews and Reminders to your menu. A blog doesn't need any of this.") : null;
  const element = h("section", { class: "studio-page studio-business", "aria-labelledby": "studio-business-h" },
    heading, lede, forBusiness, banner, status,
    h("div", { class: "studio-comment-columns" },
      h("div", { class: "studio-comment-main" }, body),
      h("div", { class: "studio-comment-side" }, h("section", { class: "studio-section", "aria-labelledby": "studio-business-looks" },
        h("h3", { id: "studio-business-looks", text: "How it looks" }), footer), details)),
    h("div", { class: "studio-write-bar" }, barWords, save));

  const dirty = () => Boolean(form && saved) && !M.sameBusiness(form, saved);

  function paintBar() {
    barWords.textContent = dirty() ? "You have changes." : "Everything's saved.";
    footer.textContent = footerLine();
  }

  function footerLine() {
    const b = M.businessFromForm(form || {});
    const parts = [b.displayName || "Your name"];
    if (b.phone) parts.push(M.formatPhone(b.phone));
    const open = M.WEEKDAYS.filter(([d]) => b.hours?.[d] && !b.hours[d].closed);
    if (open.length) {
      const first = b.hours[open[0][0]];
      const same = open.every(([d]) => b.hours[d].open === first.open && b.hours[d].close === first.close);
      const days = open.length === 1 ? open[0][1] : `${open[0][1]} to ${open[open.length - 1][1]}`;
      parts.push(same ? `Open ${days}, ${first.open === "00:00" && first.close === "24:00" ? "24 hours" : `${clock(first.open)} to ${clock(first.close)}`}` : `Open ${days}`);
    }
    if (b.licenseNumber && b.insured) parts.push("Licensed and insured");
    else if (b.licenseNumber) parts.push("Licensed");
    return parts.join(" · ");
  }

  const changed = () => { banner.replaceChildren(); paintBar(); };

  function text(name, label, { hint, type = "text", inputmode, placeholder, max } = {}) {
    const el = h("text-field", {
      label, value: form[name] || "", type, ...(hint ? { description: hint } : {}), ...(inputmode ? { inputmode } : {}), ...(placeholder ? { placeholder } : {}), ...(max ? { maxlength: max } : {}),
      onValuechange: (e) => { form[name] = e.detail; el.error = ""; changed(); },
    });
    fields[name] = el;
    return el;
  }

  function dayRow([day, label]) {
    const row = form.hours[day];
    const opens = h("text-field", { label: `${label} opens`, type: "time", value: row.open, onValuechange: (e) => { row.open = e.detail; changed(); } });
    const closes = h("text-field", { label: `${label} closes`, type: "time", value: row.close, onValuechange: (e) => { row.close = e.detail; changed(); } });
    const times = h("div", { class: "studio-business-times", hidden: row.mode !== "open" }, opens, closes);
    const mode = h("select-field", {
      label, options: M.DAY_MODES.map(([value, words]) => ({ value, label: words })), value: row.mode,
      onValuechange: (e) => { row.mode = e.detail; times.hidden = row.mode !== "open"; mode.error = ""; changed(); if (day === "monday") copy.disabled = row.mode === "unset"; },
    });
    fields[`hours:${day}`] = mode;
    return h("fieldset", { class: "studio-business-day" }, h("legend", { class: "studio-visually-hidden", text: label }), mode, times);
  }

  let copy = null;

  function draw() {
    body.removeAttribute("aria-busy");
    for (const key of Object.keys(fields)) delete fields[key];
    const trades = (reply.trades || []).map((t) => (typeof t === "string" ? t : t.id)).filter(Boolean);
    const tradeOptions = [{ value: "", label: "Choose your trade" }, ...trades.map((t) => ({ value: t, label: t.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase()) }))];
    if (form.trade && !trades.includes(form.trade)) tradeOptions.push({ value: form.trade, label: form.trade });
    const trade = h("select-field", { label: "Your trade", options: tradeOptions, value: form.trade || "", description: "Search engines use it to describe you, like a roofing contractor.", onValuechange: (e) => { form.trade = e.detail; trade.error = ""; changed(); } });
    fields.trade = trade;
    copy = h("action-button", { variant: "secondary", size: "sm", disabled: form.hours.monday.mode === "unset", onClick: () => {
      form = M.copyDay(form, "monday", WEEKDAYS_AFTER_MONDAY);
      draw();
      status.textContent = "Monday's hours are on Tuesday to Friday now. Save to keep them.";
      changed();
    } }, "Copy Monday to Tuesday–Friday");
    const insured = h("toggle-switch", { label: "We're insured", description: "With a license number, your site shows a Licensed and insured badge. It's your word; nobody checks it.", onCheckedchange: (e) => { form.insured = e.detail; changed(); } });
    const pays = M.PAYMENT_METHODS.map(([id, label]) => {
      const t = h("toggle-switch", { label, onCheckedchange: (e) => {
        form.paymentMethods = e.detail ? [...new Set([...form.paymentMethods, id])] : form.paymentMethods.filter((x) => x !== id);
        changed();
      } });
      requestAnimationFrame(() => { t.checked = form.paymentMethods.includes(id); });
      return t;
    });
    const phone = text("phone", "Phone", { type: "tel", hint: "Type it the way you'd say it." });
    phone.addEventListener("focusout", () => {
      const shown = M.formatPhone(M.normalizePhone(form.phone));
      if (shown && shown !== form.phone) { form.phone = shown; phone.value = shown; paintBar(); }
    });
    body.replaceChildren(
      h("fieldset", { class: "studio-field-group" }, h("legend", { text: "Who you are" }),
        text("displayName", "Name customers know you by", { hint: "Shown at the bottom of every page and in search results.", max: 120 }), trade,
        text("foundedYear", "Year you started", { inputmode: "numeric", placeholder: "1998", max: 4 })),
      h("fieldset", { class: "studio-field-group" }, h("legend", { text: "How to reach you" }), phone, text("email", "Email", { type: "email" })),
      h("fieldset", { class: "studio-field-group" }, h("legend", { text: "Opening hours" }),
        h("p", { class: "studio-help", text: "Leave a day as Not shown if you'd rather not say." }), copy, ...M.WEEKDAYS.map(dayRow)),
      h("fieldset", { class: "studio-field-group" }, h("legend", { text: "License and insurance" }),
        text("licenseNumber", "License number", { max: 40 }), text("licenseIssuer", "Who issued it", { hint: "Like your state's contractor licensing board.", max: 80 }), insured),
      h("fieldset", { class: "studio-field-group studio-business-pays" }, h("legend", { text: "Ways customers can pay" }), ...pays),
      h("details", { class: "studio-help" }, h("summary", { text: "More about your business" }),
        text("legalName", "Legal name", { hint: "Only if it's different, like Ridgeline Roofing LLC.", max: 120 })));
    requestAnimationFrame(() => { insured.checked = form.insured; });
    drawDetails();
    paintBar();
  }

  function drawDetails(serverText = "") {
    details.replaceChildren(h("summary", { text: "For the person who set up your site" }),
      h("pre", { class: "studio-mono", text: JSON.stringify(reply?.business || {}, null, 2) }),
      h("p", { class: "studio-mono", text: `etag ${reply?.etag || ""}${reply?.buildError ? `; build: ${reply.buildError}` : ""}${serverText ? `; server: ${serverText}` : ""}` }),
      h("p", {}, h("a", { href: "/admin/#/business", target: "_blank", rel: "noopener" }, "Business facts in the old Admin")));
  }

  // The server's problems are the engine's words: say the model's own sentence for that field, or a
  // plain one. The engine's words go in the details.
  function plainProblem(p) {
    const own = M.validateForm(form).find((q) => q.field === p.field && (!p.day || q.day === p.day));
    if (own) return own.message;
    return p.field ? "This doesn't look right. Check it, then Save." : "Something in your business facts needs fixing. Tell the person who set up your site.";
  }

  /** Each problem on its field; the rest in the banner. Returns how many. */
  function showProblems(problems, { serverText = "" } = {}) {
    const loose = [];
    let first = null;
    for (const p of problems) {
      const el = p.field === "hours" && p.day ? fields[`hours:${p.day}`] : fields[p.field];
      const words = p.field === "trade" ? "Choose your trade from the list." : p.message;
      if (el && "error" in el) { el.error = words; first ||= el; } else loose.push(words);
    }
    if (loose.length) banner.replaceChildren(h("alert-banner", { variant: "danger", heading: "Not saved" }, h("ul", {}, loose.map((m) => h("li", { text: m })))));
    if (serverText) drawDetails(serverText);
    (first?.querySelector("input, select") || first)?.focus?.();
    const n = problems.length;
    status.textContent = n === 1 ? "1 thing needs fixing before this can be saved." : `${n} things need fixing before this can be saved.`;
    return n;
  }

  async function saveNow({ force = false } = {}) {
    if (busy || !form) return false;
    for (const el of Object.values(fields)) if ("error" in el) el.error = "";
    const problems = M.validateForm(form);
    if (problems.length) { showProblems(problems); return false; }
    if (!dirty() && !force) { toast("Nothing's changed. Your site already has this."); return true; }
    if (notTrade && form.trade && !reply.business?.trade && !force) {
      const choice = await ask({
        heading: "Make this a business site?",
        text: "Naming a trade adds Services, Reviews and Reminders to your menu. You can take the trade off later.",
        choices: [{ label: "Not now", value: "no" }, { label: "Make it a business site", value: "yes", variant: "secondary" }],
      });
      if (choice !== "yes") return false;
    }
    busy = true;
    save.loading = true;
    const sent = JSON.stringify(form);
    try {
      const result = await api.put("business", { etag: reply.etag, business: M.businessFromForm(form) });
      const tradeWas = reply.business?.trade || "";
      reply = result;
      if ((result.business?.trade || "") !== tradeWas) context.refreshMeta?.();
      saved = M.formFromBusiness(result.business);
      if (saved.phone) saved.phone = M.formatPhone(saved.phone);
      if (JSON.stringify(form) === sent) form = { ...saved, hours: structuredClone(saved.hours), paymentMethods: [...saved.paymentMethods] };
      if (result.buildError) {
        banner.replaceChildren(h("alert-banner", { variant: "warning", heading: "Saved, but your site didn't update yet" }, "Something elsewhere on your site needs fixing first. Tell the person who set up your site."));
        drawDetails();
      } else {
        const out = await sendOut(api, "Change the business facts");
        const said = wentOutWords(out, { meta, action: "saved" });
        status.textContent = said.words;
        toast(said.words, { variant: said.variant });
      }
      draw();
      return true;
    } catch (error) {
      if (error.status === 401) throw error;
      if (error.status === 409) {
        const theirs = await api.get("business").catch(() => null);
        const choice = theirs && await askWhichToKeep({ name: "Your business facts", what: "changes", them: "them", were: true });
        if (choice === "mine") { reply = { ...reply, etag: theirs.etag }; busy = false; save.loading = false; return saveNow({ force: true }); }
        if (choice === "theirs") {
          reply = theirs;
          saved = M.formFromBusiness(theirs.business);
          if (saved.phone) saved.phone = M.formatPhone(saved.phone);
          form = { ...saved, hours: structuredClone(saved.hours), paymentMethods: [...saved.paymentMethods] };
          draw();
          status.textContent = "Here are the facts from the other device.";
        }
        return false;
      }
      if (error.status === 422 && Array.isArray(error.data?.problems)) {
        showProblems(error.data.problems.map((p) => ({ field: p.field || "", message: plainProblem(p), day: p.day })), { serverText: error.message });
        return false;
      }
      const words = error.status ? M.businessErrorText(error).replace(/^The facts were not saved\. .*$/, "The facts were not saved. Your changes are still here; try again in a moment.") : "Studio couldn't reach your site's server. Your changes are still here.";
      banner.replaceChildren(h("alert-banner", { variant: "danger", heading: "Not saved" }, words));
      // Said beside Save too, where she is.
      barWords.textContent = "Not saved. Your changes are still here.";
      status.textContent = words;
      return false;
    } finally {
      busy = false;
      save.loading = false;
    }
  }

  async function load() {
    try {
      reply = await api.get("business");
    } catch (error) {
      if (error.status === 401) throw error;
      body.removeAttribute("aria-busy");
      body.replaceChildren(h("alert-banner", { variant: "danger", heading: "Your business facts didn't load" }, "Check your connection and try again. ",
        h("action-button", { variant: "secondary", size: "sm", onClick: () => load() }, "Try again")));
      return;
    }
    saved = M.formFromBusiness(reply.business);
    form = M.formFromBusiness(reply.business);
    if (form.phone) form.phone = M.formatPhone(form.phone);
    if (saved.phone) saved.phone = M.formatPhone(saved.phone);
    draw();
    if ((reply.problems || []).length) {
      banner.replaceChildren(h("alert-banner", { variant: "warning", heading: "Something here needs fixing" }, "Your site is using the facts as they were. Fix the marked line, then Save."));
      showProblems(reply.problems.map((p) => ({ field: p.field || "", message: plainProblem(p), day: p.day })), { serverText: reply.problems.map((p) => p.message).join("; ") });
    }
  }

  async function leave() {
    if (!dirty()) return true;
    const choice = await ask({ heading: "Save your business facts?", text: "You changed them and didn't save.", choices: [{ label: "Save", value: "save" }, { label: "Leave without saving", value: "go", variant: "secondary" }] });
    if (choice === "save") return saveNow();
    return choice === "go";
  }

  return {
    title: "Business facts",
    element,
    load,
    leave,
    isDirty: dirty,
    focus: () => heading.focus(),
    keys: ["save"],
    get palette() {
      return [{ id: "save", label: "Save business facts", group: "Business", hint: "Ctrl S" }, { id: "copy", label: "Copy Monday to weekdays", group: "Business" }];
    },
    command(id) {
      if (id === "save") saveNow();
      if (id === "copy") copy?.click();
    },
  };
}
