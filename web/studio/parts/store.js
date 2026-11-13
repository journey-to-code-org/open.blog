// One list of posts for every screen (Home, Posts, Find), fetched once and shared. A save anywhere
// marks it stale; the next reader fetches again. Readers that arrive together share one request.

const FRESH_MS = 15000;

export function createPostsStore(api, { now = () => Date.now() } = {}) {
  let items = null;
  let at = 0;
  let inFlight = null;
  return {
    /** The posts-list items; fetched when stale or when `fresh` is asked for. */
    async list({ fresh = false } = {}) {
      if (!fresh && items && now() - at < FRESH_MS) return items;
      if (!inFlight) {
        inFlight = api.get("documents?kind=posts")
          .then((reply) => {
            items = reply?.items || [];
            at = now();
            return items;
          })
          .finally(() => { inFlight = null; });
      }
      return inFlight;
    },
    /** Something changed on the server: the next list() asks again. */
    stale() {
      at = 0;
    },
  };
}
