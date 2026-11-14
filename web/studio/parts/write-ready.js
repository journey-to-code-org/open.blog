// Write's side of Before you publish, Words for YouTube and Your route (Studio R7): the side card,
// the checks before a first Publish, the route file's token on a save, ?sheet=ready|youtube|route,
// and their More and Find entries. Write hands in what it has; this keeps write.js about writing.
import { say } from "./words.js";
import { createBeforePublish } from "./before-publish.js";
import { createYoutubeSheet } from "./youtube-sheet.js";
import { createRouteSheet } from "./route-sheet.js";
import { shouldOpenOnPublish } from "./ready-rules.js";
import { researchReviewApplies } from "./review-rules.js";
import { kitFromServer, releaseKit } from "./video-rules.js";
import { ROUTE_KEYS } from "./route-rules.js";
import { PROFILE_GROUPS } from "./profile-words.js";
import { deviceNoun, herePhone } from "./notification-rules.js";
import { siteLink } from "./publish.js";

/** The About this post fields that live only in its details. */
const DETAILS_FIELDS = new Set(["videoTitle", "videoDescription", "aiDisclosure", "videoFile", "captions", "slug", "canonical"]);

/**
 * `w` is Write: { api, meta, doc, read(), fieldsFor(values, intent), about, body, title, tags,
 * picker(), suggestions, job(), kind(), isDirty(), snapshot(), changed(), publish(), verb(),
 * recipeGoTo(target), primary, signedOut() }.
 */
export async function createWriteReady(w) {
  const { api, meta, doc, about } = w;
  let reopen = null; // a step sheet opened from Before you publish goes back to it

  const values = () => {
    const v = w.read();
    const out = { ...doc.fields };
    for (const key of [...ROUTE_KEYS, "location", "conditions", "activity", "title", "videoTitle", "description", "videoDescription", "aiDisclosure", "duration", "productionStatus", "citations", "profile"]) {
      const value = about.value(key);
      if (value !== "" || key in out) out[key] = value;
    }
    out.title = v.title;
    return out;
  };

  const form = () => {
    const v = w.read();
    return {
      title: v.title.trim(), subtitle: about.value("subtitle"), description: about.value("description"), tags: v.tags, cover: v.cover, coverAlt: v.coverAlt,
      body: v.body, fields: { ...values(), profile: w.kind() }, credited: about.names().length > 0,
    };
  };

  const request = () => {
    const v = w.read();
    return { kind: "posts", path: doc.path, fields: w.fieldsFor(v, "publish"), body: v.body, ...(about.credits() !== undefined ? { credits: about.credits() } : {}) };
  };

  const device = () => { try { return deviceNoun(herePhone({ navigator: globalThis.navigator, window: globalThis })); } catch { return "phone"; } };

  function stage() {
    const value = about.value("productionStatus");
    const field = PROFILE_GROUPS.video?.fields.find((f) => f.key === "productionStatus");
    return field?.choices?.[value] || value;
  }

  function kit(server) {
    const fields = values();
    const local = releaseKit(fields, w.read().body, {
      url: doc.url ? siteLink(meta, doc.url) : "", tags: w.read().tags, live: doc.state === "published" && !w.isDirty(), excerpt: doc.excerpt,
    });
    return server && doc.path ? kitFromServer(server, local) : local;
  }

  // ---- where Show me and Go to it go
  function goToLine(n) {
    const all = w.body.text();
    const lines = all.split("\n");
    const start = lines.slice(0, Math.max(0, n - 1)).reduce((sum, line) => sum + line.length + 1, 0);
    const end = start + (lines[n - 1] || "").length;
    for (const box of w.body.boxes()) {
      const at = box.value ? all.indexOf(box.value) : -1;
      if (at >= 0 && start >= at && start <= at + box.value.length) { box.reveal(start - at, Math.min(end, at + box.value.length) - at); return; }
    }
    w.body.focus();
  }

  function goTo(target = {}) {
    requestAnimationFrame(() => {
      if (target.kind === "line" || (target.line && !target.list)) return goToLine(target.line);
      if (target.job) return w.job()?.focusProblem(target.job);
      if (target.list || ["servings", "prep", "cook", "total", "course", "cuisine", "yield", "calories", "adaptedFrom"].includes(target.field)) return w.recipeGoTo(target);
      const field = target.field;
      if (field === "title") { const input = w.title.querySelector("input"); input?.focus(); input?.select?.(); return; }
      if (field === "tags") return w.tags.querySelector("input")?.focus();
      if (field === "cover" || field === "coverAlt") return w.picker()?.focus();
      if (field === "summary" || field === "description") return about.open({ group: "search", from: w.aboutButton });
      if (field === "route") return openSheet("route", w.primary);
      if (field) return about.open({ group: DETAILS_FIELDS.has(field) ? "details" : "", focusName: field, from: w.aboutButton });
      return w.body.focus();
    });
  }

  const back = () => sheet.open({ from: reopen || w.primary });
  const closed = () => {};

  const sheet = await createBeforePublish({
    api, meta,
    write: {
      state: () => doc.state, kind: () => w.kind(), request, form, suggestions: w.suggestions, dirty: () => w.isDirty(),
      jobCheck: (fields) => w.job()?.checkProblems(fields) ?? Promise.resolve(null),
      publish: () => w.publish(), verb: () => w.verb(), goTo, roughCard: () => about.roughCard(),
      describeCover: (text) => w.picker()?.setAlt(text), changed: () => w.changed(),
      openSheet: (name, from) => { reopen = from; sheet.close(); openSheet(name, from, true); },
      device, kit, stage, exactWaiting: () => route.waiting(), snapshot: () => w.snapshot(), signedOut: () => w.signedOut(), closed,
    },
  });
  const youtube = await createYoutubeSheet({ api, write: { kit, request, goTo, stage, state: () => doc.state, back, closed } });
  const route = await createRouteSheet({
    api,
    write: {
      path: () => doc.path, state: () => doc.state, device, back, closed,
      values: () => Object.fromEntries(ROUTE_KEYS.map((key) => [key, values()[key] ?? ""])),
      apply: (next) => { for (const [key, value] of Object.entries(next)) about.setValue(key, value); w.changed(); },
    },
  });

  function openSheet(name, from = w.primary, ready = false) {
    const kind = w.kind();
    if (name === "youtube" && kind === "video") return youtube.open({ from, ready });
    if (name === "route" && kind === "field-journal") return route.open({ from, ready });
    return sheet.open({ from });
  }

  const research = () => researchReviewApplies(w.fieldsFor(w.read(), "publish"), w.kind() === "research" ? "research" : "");

  return {
    card: sheet.card,
    /** Before a Publish, Schedule or Update from Write: true to go on, false when the sheet opened instead. */
    async gate(button) {
      const label = button.querySelector("span");
      const was = label?.textContent;
      button.loading = true;
      if (label) label.textContent = say("ready.checkingShort");
      if (w.status) w.status.textContent = say("ready.checking");
      let result;
      try {
        result = await sheet.check();
      } catch (error) {
        if (error?.status === 401) { w.signedOut(); return false; }
        return true;
      } finally {
        button.loading = false;
        if (label) label.textContent = was;
        w.paint?.();
      }
      if (!shouldOpenOnPublish({ state: doc.state, intent: "publish", result, research: research() })) return true;
      sheet.show({ from: button });
      return false;
    },
    /** What a save sends beside the fields: the staged route file, on any save (G47). */
    track() {
      const staged = route.token();
      return staged?.token && w.kind() === "field-journal" && about.value("locationPrivacy") === "exact" ? { trackToken: staged.token, trackName: staged.name } : {};
    },
    /** After a save: a route file that went with it is spent, and the post names it. */
    saved(reply) {
      if (!reply?.trackUrl) return;
      route.spent();
      doc.fields.route = reply.trackUrl;
      about.setValue("route", reply.trackUrl);
      about.saved({ fields: doc.fields });
    },
    changed() { sheet.changed(); youtube.changed(); },
    open: (name, from) => openSheet(name, from),
    /** ?sheet=ready|youtube|route: a video sheet on a post that isn't one opens Before you publish. */
    fromRoute: (name, closedFn) => { openSheet(name, w.primary); return closedFn; },
    isSheet: (name) => name === "ready" || name === "youtube" || name === "route",
    lastSuggestions: () => sheet.lastSuggestions(),
    async leave() { sheet.close(); youtube.close(); return route.leave(); },
    commands() {
      const kind = w.kind();
      const published = doc.state === "published";
      const hasRoute = Boolean(String(about.value("distanceKm") || about.value("routeShape") || "").trim());
      return [
        { id: "ready", label: published ? say("ready.openPublished") : say("ready.open") },
        { id: "ready-again", label: say("ready.checkAgain"), more: false },
        { id: "youtube", label: say("youtube.sheet"), when: kind === "video" },
        { id: "youtube-copy", label: say("youtube.copyFind"), when: kind === "video", more: false },
        { id: "route", label: hasRoute ? say("route.changeRoute") : say("route.addRoute"), when: kind === "field-journal" },
        { id: "route-choice", label: say("route.howMuch"), when: kind === "field-journal", more: false },
        { id: "route-off", label: say("route.takeOff"), when: kind === "field-journal" && hasRoute, palette: false },
        { id: "research", label: say("review.heading"), when: research(), more: false },
      ].filter((c) => c.when !== false);
    },
    run(id, from) {
      if (id === "ready" || id === "ready-again" || id === "research") { sheet.open({ from }); return true; }
      if (id === "youtube") { openSheet("youtube", from); return true; }
      if (id === "youtube-copy") { youtube.copyDescription(); return true; }
      if (id === "route") { openSheet("route", from); return true; }
      if (id === "route-choice") { route.open({ from, focusChoice: true }); return true; }
      if (id === "route-off") { route.takeOff(from); return true; }
      return false;
    },
  };
}
