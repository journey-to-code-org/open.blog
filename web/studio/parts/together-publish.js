// Publishing a reflection written together (Studio R14a), on the reflection page: Publish asks once
// and has no Undo (taking it off is done from Write); Publish on a day takes a day and a time (8 AM
// when only a day is chosen, shown so she can change it) and can be undone; Don't publish it then
// can be undone by putting the same time back; Put it away and Bring it back undo each other. Only
// an owner account in charge sees any of these (the server holds the same line, ⚑ 4).
import { h, toast } from "./dom.js";
import { use } from "../zubra.js";
import { say, sayParts, isolating } from "./words.js";
import { ask } from "./dialogs.js";
import { defaultTime, isFuture, joinInstant, sayWhen } from "./dates.js";
import { joinNames, togetherProblem } from "./together-rules.js";

export function createPublishing({ api, context, id, did, reload }) {
  const signers = (summary) => joinNames((summary.people || []).filter((p) => p.where !== "left" && p.where !== "reads").map((p) => p.displayName), isolating);
  const title = (summary) => summary.title || summary.guidingQuestion || say("together.untitled");
  const fail = (error, place = "publish") => {
    if (error.status === 401) throw error;
    did.tell(togetherProblem(error, place).words, { variant: "problem" });
  };

  async function publish(summary, button) {
    const choice = await ask({ heading: sayParts("together.publishAsk", { title: title(summary) }, ["title"]), text: sayParts("together.publishAskText", { names: signers(summary) }, ["names"]),
      choices: [{ label: say("together.publishGo"), value: "go" }, { label: say("together.publishNo"), value: "no", variant: "secondary" }] });
    if (choice !== "go") return;
    button.loading = true;
    try {
      const reply = await api.post("collaboration/publish", { publicationId: id });
      const open = reply?.path ? { label: say("together.doOpen"), href: `#/write/${encodeURIComponent(reply.path)}` } : null;
      did.tell(`${say("together.published")} ${say("together.takeOffHelp")}`, { link: open });
      toast(say("together.published"));
      await reload();
    } catch (error) {
      fail(error);
    } finally {
      button.loading = false;
    }
  }

  async function schedule(at, undo = null) {
    await api.post("collaboration/schedule", { publicationId: id, publishAt: at });
    const when = sayWhen(at);
    did.tell(say("together.scheduled", { when }), { undo: undo ?? (() => unscheduleAt(at, true)), undoLabel: say("part.undo") });
    await reload();
  }

  async function unscheduleAt(at, quiet = false) {
    await api.post("collaboration/schedule", { publicationId: id, publishAt: null });
    const when = sayWhen(at);
    did.tell(say("together.unscheduled", { when }), quiet ? {} : { undo: () => schedule(at, () => unscheduleAt(at, true)), undoLabel: say("part.undo") });
    await reload();
  }

  async function unschedule(summary, button) {
    button.loading = true;
    try {
      await unscheduleAt(summary.publishAt);
    } catch (error) {
      fail(error);
    } finally {
      button.loading = false;
    }
  }

  /** The day and time fields, under the buttons, with their own Publish on this day. */
  async function scheduleForm(summary, host, opener) {
    await use("date-field", "text-field", "action-button");
    host.querySelector(".studio-together-when")?.remove();
    const day = h("date-field", { label: say("together.scheduleDay") });
    const time = h("text-field", { label: say("together.scheduleTime"), type: "time" });
    const help = h("p", { class: "studio-help", role: "status", "aria-live": "polite" });
    day.addEventListener("valuechange", () => {
      const filled = defaultTime(String(day.value || ""), String(time.value || ""));
      if (filled && !String(time.value || "")) time.value = filled;
    });
    const go = h("action-button", { onClick: async () => {
      day.error = "";
      let at = "";
      try { at = joinInstant({ date: String(day.value || ""), time: String(time.value || "") || "08:00" }); } catch { at = ""; }
      if (!at || !isFuture(at)) {
        day.error = say("together.scheduleNeedDay");
        day.querySelector("input")?.focus();
        return;
      }
      go.loading = true;
      try {
        await schedule(at);
        form.remove();
      } catch (error) {
        fail(error);
      } finally {
        go.loading = false;
      }
    } }, say("together.scheduleGo"));
    const form = h("div", { class: "studio-together-when", role: "group", "aria-label": say("together.publishOnDay") }, day, time, help, go);
    host.after(form);
    requestAnimationFrame(() => day.querySelector("input")?.focus());
    return opener;
  }

  async function putAway(summary, archived, opener) {
    const put = (value) => api.post("collaboration/publications/archive", { publicationId: id, archived: value });
    if (opener) opener.loading = true;
    try {
      await put(archived);
      did.tell(archived ? say("together.putAway") : say("together.broughtBack"), { undo: async () => { await put(!archived); did.tell(archived ? say("together.broughtBack") : say("together.putAway")); await reload(); }, undoLabel: say("part.undo") });
      await reload();
    } catch (error) {
      fail(error, "page");
    } finally {
      if (opener) opener.loading = false;
    }
  }

  return { publish, unschedule, scheduleForm, putAway, context };
}
