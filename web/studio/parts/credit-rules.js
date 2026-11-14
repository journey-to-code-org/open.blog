// Who wrote a post: its credit list (`<post>.credits.json`, ADR 0030), as Write's About this post
// edits it. Lifted from the old Admin (normalizeCreditDraft ... creditHasAuthor keep their
// behaviour and their tests), plus what Studio adds: the state a post's credits are in, and what a
// save sends (only a change, so a save of the title never touches the credit file). DOM-free.

/** The role a new line gets: the person wrote it. */
export const AUTHOR_ROLE = Object.freeze({ vocabulary: "crossref", role: "author" });

export function normalizeCreditDraft(value) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((credit) => {
    if (!credit || typeof credit !== "object" || typeof credit.contributor !== "string") return [];
    const roles = Array.isArray(credit.roles)
      ? credit.roles.flatMap((role) =>
          role && typeof role === "object" && typeof role.vocabulary === "string" && typeof role.role === "string"
            ? [{ vocabulary: role.vocabulary, role: role.role }]
            : [],
        )
      : [];
    const seenRoles = new Set();
    return [
      {
        contributor: credit.contributor,
        roles: roles.filter((role) => {
          const key = `${role.vocabulary}:${role.role}`;
          if (seenRoles.has(key)) return false;
          seenRoles.add(key);
          return true;
        }),
      },
    ];
  });
}

/** What a mode sends: nothing (unresolved), the blog's usual name (null), or the list. */
export function creditPayload(mode, credits) {
  if (mode === "unresolved") return undefined;
  if (mode === "inherited") return null;
  return normalizeCreditDraft(credits);
}

export function moveCredit(credits, from, to) {
  const next = normalizeCreditDraft(credits);
  if (from < 0 || from >= next.length || to < 0 || to >= next.length || from === to) return next;
  const [credit] = next.splice(from, 1);
  next.splice(to, 0, credit);
  return next;
}

export function toggleCreditRole(credit, role, checked) {
  const next = normalizeCreditDraft([credit])[0] || { contributor: "", roles: [] };
  const same = (candidate) => candidate.vocabulary === role.vocabulary && candidate.role === role.role;
  next.roles = checked ? [...next.roles.filter((candidate) => !same(candidate)), { vocabulary: role.vocabulary, role: role.role }] : next.roles.filter((candidate) => !same(candidate));
  return next;
}

export function validateCreditDraft(mode, credits) {
  if (mode === "unresolved") return "Choose how to repair the malformed contributor credits.";
  if (mode !== "explicit") return "";
  const normalized = normalizeCreditDraft(credits);
  const contributors = normalized.map((credit) => credit.contributor);
  if (contributors.some((contributor) => !contributor)) return "Choose a contributor for every credit.";
  if (new Set(contributors).size !== contributors.length) return "Each contributor can appear only once. Combine their roles in one credit.";
  if (normalized.some((credit) => credit.roles.length === 0)) return "Give every contributor at least one role.";
  return "";
}

export function creditHasAuthor(credits, contributors = {}) {
  return normalizeCreditDraft(credits).some(
    (credit) =>
      Boolean(contributors[credit.contributor]?.name) &&
      credit.roles.some((role) => role.vocabulary === "crossref" && role.role === "author"),
  );
}

/**
 * Which state a post's credits are in, from `GET document`: "broken" (the file can't be read:
 * `creditError`), "inherited" (no file: the blog's usual name), "empty" (a file naming no one),
 * or "explicit" (a list).
 */
export function creditState({ credits, creditError } = {}) {
  if (creditError) return "broken";
  if (credits === null || credits === undefined) return "inherited";
  return Array.isArray(credits) && credits.length === 0 ? "empty" : "explicit";
}

const sameList = (a, b) => JSON.stringify(normalizeCreditDraft(a)) === JSON.stringify(normalizeCreditDraft(b));

/**
 * What a save sends as `credits`: `undefined` when nothing changed (the key is left out, so the
 * credit file is never touched), `null` for "the blog's usual name", else the list.
 * @param {Array|null|undefined} before what the post had (`null`: no file)
 * @param {Array|null|undefined} after what she has now (`undefined`: not edited)
 */
export function creditsToSend(before, after) {
  if (after === undefined) return undefined;
  if (after === null) return before === null || before === undefined ? undefined : null;
  if (Array.isArray(before) && sameList(before, after)) return undefined;
  return normalizeCreditDraft(after);
}

/** The names on a post in order, for her layer and the About this post line. */
export function creditNames(credits, registry = {}, author = {}) {
  if (credits === null || credits === undefined) return author?.name ? [author.name] : [];
  return normalizeCreditDraft(credits).map((credit) => registry[credit.contributor]?.name || credit.contributor);
}

/** "By Grammi", "By Grammi and Ruth", "By Grammi, Ruth and Ann", or "No one named". */
export function byLine(names) {
  const list = (names || []).filter(Boolean);
  if (!list.length) return "No one named";
  if (list.length === 1) return `By ${list[0]}`;
  return `By ${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

/** Her line-by-line check before a save: each line names someone, once. Index → words. */
export function creditLineProblems(credits) {
  const seen = new Set();
  const out = new Map();
  normalizeCreditDraft(credits).forEach((credit, index) => {
    if (!credit.contributor) out.set(index, "Choose who, or remove this line.");
    else if (seen.has(credit.contributor)) out.set(index, "This person is listed already. Remove this line.");
    seen.add(credit.contributor);
  });
  return out;
}

/** Roles on a line the blog doesn't know, as "credit:foo". */
export function unknownRoles(credit, catalog = []) {
  const known = new Set(catalog.map((role) => `${role.vocabulary}:${role.role}`));
  return normalizeCreditDraft([credit])[0]?.roles.filter((role) => !known.has(`${role.vocabulary}:${role.role}`)).map((role) => `${role.vocabulary}:${role.role}`) || [];
}

/** A new line for the first person not yet listed, as an author; null when everyone is. */
export function nextCredit(credits, people) {
  const listed = new Set(normalizeCreditDraft(credits).map((credit) => credit.contributor));
  const id = people.find((person) => !listed.has(person));
  return id ? { contributor: id, roles: [{ ...AUTHOR_ROLE }] } : null;
}
