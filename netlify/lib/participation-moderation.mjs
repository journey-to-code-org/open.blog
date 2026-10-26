// The one moderation state machine for every participation kind (ADRs 0101 to 0104), as the
// hosted function applies it: the same rules as `openblog_core::moderation`, held together by
// tests/fixtures/participation-transitions.json, which the Rust policy generates and this module
// must agree with case by case. Reasons are moderation grounds, never a verdict on facts.
//
// Admin decides first, with the viewer's role on the item's work; the function decides again here
// from the stored row before anything is written, and the database applies the change only while
// the row still has the state and version both saw.

export const MODERATION_STATES = Object.freeze(["pending", "clarification", "approved", "rejected", "removed", "withdrawn"]);
export const MODERATION_ACTIONS = Object.freeze(["approve", "reject", "request-clarification", "clarify", "remove", "reopen", "withdraw", "expire", "uphold-report"]);
// What the inbox asks the function to store; the rest belong to readers, retention and reports.
export const INBOX_ACTIONS = Object.freeze(["approve", "request-clarification", "reject", "remove", "reopen"]);
// The roles Admin may name for an inbox decision (ADR 0102). The token itself is the site Admin.
export const MODERATOR_ROLES = Object.freeze(["site-admin", "coordinator"]);

// The fixed rules of each kind (ADR 0100): whether an approved item may be shown, and whether a
// moderator may ask its submitter to clarify.
const KIND_RULES = Object.freeze({
  comment: { publishable: true, clarification: false },
  question: { publishable: true, clarification: true },
  "source-suggestion": { publishable: true, clarification: true },
  "correction-suggestion": { publishable: true, clarification: true },
  "alternative-interpretation": { publishable: true, clarification: true },
  "third-perspective": { publishable: true, clarification: true },
  "author-response": { publishable: true, clarification: false },
  "abuse-report": { publishable: false, clarification: false },
});
export const PARTICIPATION_KINDS = Object.freeze(Object.keys(KIND_RULES));

const DECLINE = Object.freeze(["spam", "abusive", "personal-data", "off-topic", "duplicate", "rights", "other"]);
const DISMISS_REPORT = Object.freeze(["no-action", "duplicate", "spam", "other"]);
const CLARIFY = Object.freeze(["unclear", "needs-source", "personal-data", "other"]);
const UPHOLD = Object.freeze(["spam", "abusive", "personal-data", "off-topic", "rights", "other"]);

/** The reasons a request may give for `action` on `kind`; empty means it must give none. */
export function allowedReasons(action, kind) {
  if (action === "reject") return kind === "abuse-report" ? DISMISS_REPORT : DECLINE;
  if (action === "remove") return DECLINE;
  if (action === "request-clarification") return CLARIFY;
  if (action === "uphold-report") return UPHOLD;
  return [];
}

const GRANTS = Object.freeze({
  "site-admin": ["approve", "reject", "request-clarification", "remove", "reopen", "uphold-report"],
  coordinator: ["approve", "reject", "request-clarification", "remove", "uphold-report"],
  submitter: ["clarify", "withdraw"],
  system: ["expire"],
});

function applies(kind, action) {
  const rules = KIND_RULES[kind];
  if (action === "approve") return kind !== "abuse-report";
  if (action === "uphold-report") return kind === "abuse-report";
  if (action === "request-clarification" || action === "clarify") return rules.clarification;
  if (action === "remove") return rules.publishable;
  return true;
}

/** The state machine: the next state, or null when the action does not apply from `from`. */
export function nextState(action, from) {
  if ((action === "approve" || action === "uphold-report") && from === "pending") return "approved";
  if ((action === "reject" || action === "expire") && (from === "pending" || from === "clarification")) return "rejected";
  if (action === "request-clarification" && from === "pending") return "clarification";
  if (action === "clarify" && from === "clarification") return "pending";
  if (action === "remove" && from === "approved") return "removed";
  if (action === "reopen" && (from === "rejected" || from === "removed")) return "pending";
  if (action === "withdraw" && (from === "pending" || from === "clarification" || from === "approved")) return "withdrawn";
  return null;
}

const refuse = (code) => ({ ok: false, code });

/**
 * Decide one request on a stored item, in the policy's fixed order: grant, kind, version, state
 * (with the clarification rule), reason, consent, retained text. `item` is `{kind, state, version,
 * revision, clarificationAsked, clarificationConsent, contentRetained}`; `request` is `{action,
 * expectedVersion, reason, role}`. On success the change names everything the row must become.
 */
export function planTransition(item, request) {
  const kind = Object.hasOwn(KIND_RULES, item?.kind) ? item.kind : null;
  const action = MODERATION_ACTIONS.includes(request?.action) ? request.action : null;
  if (!kind || !action || !MODERATION_STATES.includes(item.state)) return refuse("notAllowed");
  const grants = Object.hasOwn(GRANTS, request.role) ? GRANTS[request.role] : [];
  if (!grants.includes(action)) return refuse("denied");
  if (!applies(kind, action)) return refuse("notAllowed");
  if (request.expectedVersion !== item.version) return refuse("stale");
  let to = nextState(action, item.state);
  if (!to) return refuse("notAllowed");
  // The text a clarification asked about is never approved, whatever happened since (ADR 0101).
  const asked = item.clarificationAsked != null && item.clarificationAsked === item.revision;
  if (action === "approve" && asked) return refuse("notAllowed");
  if (action === "reopen" && asked) to = "clarification";
  const allowed = allowedReasons(action, kind);
  const reason = request.reason === undefined || request.reason === null || request.reason === "" ? null : request.reason;
  if (reason === null && allowed.length) return refuse("reasonRequired");
  if (reason !== null && !allowed.includes(reason)) return refuse("reasonNotAllowed");
  if (action === "request-clarification" && item.clarificationConsent !== true) return refuse("consentRequired");
  if (item.contentRetained === false) return refuse("contentPurged");
  const revision = action === "clarify" ? item.revision + 1 : item.revision;
  return {
    ok: true,
    change: {
      action,
      from: item.state,
      to,
      reason,
      version: item.version + 1,
      revision,
      approvedRevision: to === "approved" ? revision : null,
      clarificationAsked: action === "request-clarification" ? item.revision : item.clarificationAsked ?? null,
    },
  };
}

/** The value the existing `openblog_comments.status` column can hold for a state (ADR 0101). */
export function legacyCommentStatus(state) {
  if (state === "pending" || state === "clarification") return "pending";
  if (state === "approved") return "approved";
  return "rejected";
}

/**
 * Whether an older hosted schema can store `action` on `kind` (ADR 0105): comments can be approved,
 * rejected, removed (stored as rejected) and reopened; passage feedback approved, rejected and
 * removed (ADR 0083).
 */
export function legacySupports(kind, action) {
  if (kind === "comment") return ["approve", "reject", "remove", "reopen"].includes(action);
  return ["question", "source-suggestion", "correction-suggestion", "alternative-interpretation"].includes(kind)
    && ["approve", "reject", "remove"].includes(action);
}
