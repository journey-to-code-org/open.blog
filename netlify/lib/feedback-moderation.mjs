// The moderation rules for passage feedback (ADR 0095): the same table as
// `openblog_core::feedback_moderation`, held together by
// tests/fixtures/feedback-moderation.json. The state names are those of the
// participation and moderation policy (RD12, #211); B5 offers only approve,
// reject and remove. Reasons are moderation grounds, never a verdict on facts.

export const MODERATION_STATES = Object.freeze(["pending", "clarification", "approved", "rejected", "removed", "withdrawn"]);

const DECLINE_REASONS = Object.freeze(["spam", "abusive", "personal-data", "off-topic", "duplicate", "rights", "other"]);

export const MODERATION_ACTIONS = Object.freeze({
  approve: Object.freeze({ from: Object.freeze(["pending"]), to: "approved", reasons: Object.freeze([]) }),
  reject: Object.freeze({ from: Object.freeze(["pending", "clarification"]), to: "rejected", reasons: DECLINE_REASONS }),
  remove: Object.freeze({ from: Object.freeze(["approved"]), to: "removed", reasons: DECLINE_REASONS }),
});

/**
 * An Admin account name the audit trail may record, or the token's own name. Account names follow
 * `openblog_core::collaboration::valid_admin_username`: 1 to 32 of `a-z`, `0-9`, `_`, `.` and `-`.
 */
export const MODERATION_TOKEN_ACTOR = "@moderation-token";
export const auditActor = (value) => {
  const actor = typeof value === "string" ? value : "";
  return /^[a-z0-9_.-]{1,32}$/.test(actor) ? actor : MODERATION_TOKEN_ACTOR;
};

/**
 * Check one requested change against the item's current state. Every
 * combination the table does not list is refused; nothing is guessed.
 */
export function planModeration(current, action, reason) {
  const rule = Object.hasOwn(MODERATION_ACTIONS, action) ? MODERATION_ACTIONS[action] : null;
  if (!rule) return { ok: false, code: "unknownAction", message: "Choose approve, reject or remove." };
  if (!rule.from.includes(current)) return { ok: false, code: "notAllowed", message: `An item that is ${current} cannot be changed with ${action}.` };
  const given = reason === undefined || reason === null || reason === "" ? null : reason;
  if (!rule.reasons.length) {
    if (given !== null) return { ok: false, code: "reasonNotAllowed", message: `${action} takes no reason.` };
    return { ok: true, change: { action, from: current, to: rule.to, reason: null } };
  }
  if (given === null) return { ok: false, code: "reasonRequired", message: `Choose a reason to ${action}.` };
  if (typeof given !== "string" || !rule.reasons.includes(given)) return { ok: false, code: "unknownReason", message: "Choose one of the listed reasons." };
  return { ok: true, change: { action, from: current, to: rule.to, reason: given } };
}
