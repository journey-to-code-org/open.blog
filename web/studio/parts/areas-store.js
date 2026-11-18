// This login's areas, kept current for the whole window (ONB1): `meta.areas` is the one copy every
// screen reads (through area-rules.js), and this is the only code that changes it. A save goes to
// the server with the revision it started from; a newer one somewhere else is adopted and said.
// In a practice run (Getting started rehearsing) answers apply to this window only.
import { hiddenAfter } from "./area-rules.js";

export function createAreas({ api, meta, onChange = () => {} }) {
  let practice = false;

  function adopt(preferences, etag) {
    meta.areas = { ...(meta.areas || {}), ...(preferences || {}), etag: typeof etag === "string" ? etag : meta.areas?.etag || "" };
    onChange();
  }

  /**
   * Change this login's areas: `{ ok }`, or `{ ok: false, code }` with `stale` (the newer
   * preferences are now in place), `no-signal` or `other` (`error` for details).
   */
  async function save(patch) {
    if (practice) {
      const { onboarding, kind, answers, shown, hidden, showEverything, storyMarks } = patch;
      adopt({
        ...(onboarding ? { onboarding: { ...meta.areas?.onboarding, ...onboarding } } : {}),
        ...(kind !== undefined ? { kind } : {}),
        ...(answers ? { answers } : {}),
        ...(shown || hidden ? { areas: { shown: shown || meta.areas?.areas?.shown || [], hidden: hidden || meta.areas?.areas?.hidden || [] } } : {}),
        ...(showEverything !== undefined ? { showEverything } : {}),
        ...(storyMarks ? { storyMarks } : {}),
      }, meta.areas?.etag || "");
      return { ok: true, practice: true };
    }
    try {
      const reply = await api.put("areas", { etag: meta.areas?.etag || "", ...patch });
      adopt(reply.preferences, reply.etag);
      return { ok: true };
    } catch (error) {
      if (error?.status === 401) throw error;
      if (error?.status === 409 && error.data?.preferences) {
        adopt(error.data.preferences, error.data.etag);
        return { ok: false, code: "stale", error };
      }
      return { ok: false, code: error?.status === 0 ? "no-signal" : "other", error };
    }
  }

  return {
    save,
    /** Show an area again (from its turned-off page, Find or What you use). */
    turn: (id, on) => save({ hidden: hiddenAfter(meta.areas?.areas?.hidden, id, on) }),
    /** Read them again; a change made in another window shows here. Quiet when it fails. */
    async check() {
      if (practice) return false;
      try {
        const reply = await api.get("areas");
        if (reply.etag === (meta.areas?.etag || "") && JSON.stringify(reply.inUse) === JSON.stringify(meta.areas?.inUse)) return false;
        adopt({ ...reply.preferences, inUse: reply.inUse, hint: reply.hint }, reply.etag);
        return true;
      } catch (error) {
        if (error?.status === 401) throw error;
        return false;
      }
    },
    /** A practice run: from now on, answers apply to this window only. */
    rehearse() { practice = true; },
    get practice() { return practice; },
  };
}
