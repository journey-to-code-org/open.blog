// The last source library and passages loaded this visit (Studio R11), so Cited here chips and
// quotation cards say a source's name even with no signal; with none loaded yet, chips show the
// key. In memory only: nothing is written to storage. Pure, DOM-free.

let sources = [];
let passages = [];
let revision = "";

/** Keep what a reply carries: `sources` (and `revision`) from the library, `passages` from the notebook. */
export function remember(reply) {
  if (Array.isArray(reply?.sources)) sources = reply.sources;
  if (Array.isArray(reply?.library?.sources)) sources = reply.library.sources;
  if (typeof reply?.revision === "string" && Array.isArray(reply?.sources)) revision = reply.revision;
  if (Array.isArray(reply?.passages)) passages = reply.passages;
  if (Array.isArray(reply?.notebook?.passages)) passages = reply.notebook.passages;
}

export const cachedSources = () => sources;
export const cachedPassages = () => passages;
export const cachedRevision = () => revision;
