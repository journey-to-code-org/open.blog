// Copy it for another blog: which words a destination takes (the preview's `portablePreview`), the
// differences there in her words, and what "Mark as checked" records. The first six are lifted
// from the old Admin's Site preview and keep their behaviour and tests. DOM-free.

/** Where she can copy a post to, in the order the sheet lists them. */
export const DESTINATIONS = Object.freeze([
  { value: "destination:medium", label: "Medium", name: "Medium" },
  { value: "destination:ghost", label: "Ghost", name: "Ghost" },
  { value: "destination:hashnode", label: "Hashnode", name: "Hashnode" },
  { value: "destination:dev", label: "DEV", name: "DEV" },
  { value: "destination:wordpress", label: "WordPress", name: "WordPress" },
  { value: "portable-html", label: "A web page (HTML)", name: "a web page" },
  { value: "portable-text", label: "Plain words", name: "anywhere that takes plain words" },
]);

export function previewDestinationPolicy(policies, mode) {
  return Array.isArray(policies)
    ? policies.find((policy) => policy?.version === 1 && `destination:${policy.provider}` === mode)
    : null;
}

export function portablePreviewArtifact(preview, mode) {
  const portable = preview?.portablePreview;
  if (!portable || mode === "site") return null;
  const representation = mode.startsWith("destination:")
    ? previewDestinationPolicy(portable.destinations, mode)?.representation
    : mode;
  const formats = {
    "portable-html": ["html", "text/html"],
    "portable-markdown": ["markdown", "text/markdown"],
    "manual-markdown": ["markdown", "text/markdown"],
    "portable-text": ["text", "text/plain"],
  };
  const format = formats[representation];
  if (!format || typeof portable[format[0]] !== "string") return null;
  return { content: portable[format[0]], extension: { html: "html", markdown: "md", text: "txt" }[format[0]], mime: `${format[1]};charset=utf-8` };
}

export function portabilityAcknowledgementScope(policies, mode) {
  if (mode === "portable-html" || mode === "portable-markdown" || mode === "portable-text") {
    return { destination: "portable-export", representation: mode };
  }
  if (!String(mode).startsWith("destination:")) return null;
  const provider = String(mode).slice("destination:".length);
  const policy = previewDestinationPolicy(policies, mode);
  if (!policy) return null;
  return {
    destination: provider,
    representation: policy.representation,
  };
}

export function portabilityGroups(preview, mode) {
  const portable = preview?.portablePreview;
  const scope = portabilityAcknowledgementScope(portable?.destinations, mode)
    || (mode === "site" ? { representation: "portable-html", destination: "portable-export" } : null);
  if (!scope) return [];
  const representation = scope.representation === "manual-markdown" ? "portable-markdown" : scope.representation;
  const diagnostics = portable?.diagnosticsByRepresentation?.[representation] || portable?.diagnostics || [];
  const groups = new Map();
  for (const diagnostic of diagnostics) {
    const key = diagnostic.capabilityId || "document";
    if (!groups.has(key)) groups.set(key, {
      capabilityId: key, representation: scope.representation, destination: scope.destination,
      level: diagnostic.portabilityLevel || "unclassified", diagnostics: [],
    });
    groups.get(key).diagnostics.push(diagnostic);
  }
  return [...groups.values()];
}

export function portabilitySourceSelection(body, range) {
  if (!range) return null;
  const lines = body.split("\n");
  const offset = (line, column) => {
    if (!Number.isInteger(line) || !Number.isInteger(column) || line < 1 || column < 1 || line > lines.length) return null;
    const characters = Array.from(lines[line - 1]);
    if (column > characters.length + 1) return null;
    return lines.slice(0, line - 1).reduce((length, text) => length + text.length + 1, 0)
      + characters.slice(0, column - 1).join("").length;
  };
  const start = offset(range.startLine, range.startColumn);
  const end = offset(range.endLine, range.endColumn);
  return start !== null && end !== null && end >= start ? { start, end } : null;
}

export function portableDiagnosticsForDisplay(diagnostics) {
  return Array.isArray(diagnostics)
    ? diagnostics
      .filter((diagnostic) => diagnostic && typeof diagnostic.message === "string" && diagnostic.message.trim())
      .map((diagnostic) => {
        const scope = diagnostic.sourcePath ? `${diagnostic.sourcePath}: ` : "";
        const repair = typeof diagnostic.recommendedAction === "string" && diagnostic.recommendedAction.trim()
          ? ` Action: ${diagnostic.recommendedAction}`
          : "";
        return `${scope}${diagnostic.severity || "warning"}: ${diagnostic.message}${repair}`;
      })
    : [];
}

/** Each part of a post that changes on the way, in her words, by what it is. */
const BY_CAPABILITY = {
  recipe: "The recipe card becomes a plain list.",
  "task-list": "The checklist's boxes can't be ticked there.",
  "knowledge-check": "The quiz becomes a plain question with its answer.",
  "runnable-code": "Code readers can run shows as plain code.",
  "web-sandbox": "Code readers can run shows as plain code.",
  "interactive-demo": "The demo becomes a few words about it, with a link back to your post.",
  "before-after": "The before and after slider becomes two pictures.",
  comments: "Comments stay on your blog.",
  citations: "Notes to your sources become a plain list.",
  "claim-evidence": "The evidence notes stay on your blog.",
  "guided-reading-supplements": "The reading helps stay on your blog.",
  "raw-html": "Some of the page's own code is left out.",
  "historical-timelines": "The timeline stays on your blog, with a link back to it.",
  diagrams: "The diagram stays on your blog, with a link back to it.",
};

/** …and by what happens to it, when the part isn't one Studio has words for. */
const BY_CODE = {
  "canonical-only-interaction": "Something readers can use on your blog only works there. The copy links back to it.",
  "graceful-transformation": "Something in it changes shape there.",
  "removed-markup": "Some of the page's own code is left out.",
  "destination-payload-limit": "It may be too long for that site.",
  "destination-tag-invalid": "Some of your tags can't go across.",
  "destination-tag-limit": "Only some of your tags go across.",
};

/** One difference in her words (G42: diagnostics carry `code`). */
export function differenceWords(diagnostic) {
  if (!diagnostic || typeof diagnostic !== "object") return "One thing looks different there.";
  return BY_CAPABILITY[diagnostic.capabilityId] || BY_CODE[diagnostic.code]
    || (String(diagnostic.code || "").startsWith("destination-tag") ? "Some of your tags can't go across." : "")
    || (String(diagnostic.code || "").startsWith("destination-") ? "That site handles part of it differently." : "")
    || "One thing looks different there.";
}

/**
 * The differences for a destination, one line each, with where it is in her words when the
 * engine says: [{ words, range, diagnostics }]. The same words twice are one line.
 */
export function differences(preview, mode) {
  const portable = preview?.portablePreview;
  const found = [];
  for (const group of portabilityGroups(preview, mode)) for (const diagnostic of group.diagnostics) found.push(diagnostic);
  const plan = (plans) => (Array.isArray(plans) ? plans.find((p) => p?.policy?.version === 1 && `destination:${p.policy.provider}` === mode) : null);
  for (const diagnostic of plan(portable?.destinationContentPlans)?.diagnostics || []) found.push(diagnostic);
  for (const diagnostic of plan(portable?.destinationTagPlans)?.diagnostics || []) found.push(diagnostic);
  const lines = new Map();
  for (const diagnostic of found) {
    const words = differenceWords(diagnostic);
    if (!lines.has(words)) lines.set(words, { words, range: diagnostic.sourceRange || diagnostic.context?.sourceRange || null, diagnostics: [] });
    lines.get(words).diagnostics.push(diagnostic);
  }
  return [...lines.values()];
}

/** "It goes across as it is." / "1 thing looks different there" / "2 things look different there". */
export function differenceHeading(count) {
  if (!count) return "It goes across as it is.";
  return count === 1 ? "1 thing looks different there" : `${count} things look different there`;
}

/** The file name a download gets: "pumpkin-bread.md". */
export function downloadName(slug, extension) {
  const base = String(slug || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "post";
  return `${base}.${extension}`;
}

/** Whether a warning was marked as checked for this version, for an earlier one, or not at all. */
export function checkedState(portable, scope, diagnostic) {
  const acknowledgements = Array.isArray(portable?.acknowledgements) ? portable.acknowledgements : [];
  const same = acknowledgements.filter((a) => a.capabilityId === diagnostic.capabilityId && a.representation === scope?.representation && a.destination === scope?.destination);
  if (same.some((a) => a.sourceRevision === portable?.sourceRevision)) return "checked";
  return same.length ? "stale" : "unchecked";
}

/** The HTML a sandboxed frame shows for a web-page copy: the title as text, the copy as it goes. */
export function htmlFrame(title, html) {
  const escape = (value) => String(value).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head><body><main><h1>${escape(title)}</h1>${html}</main></body></html>`;
}
