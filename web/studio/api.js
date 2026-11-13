// The only code that talks to the server: Admin's own /admin/api/* routes, with the session cookie
// and the CSRF token. A request answered "not signed in" waits while the person signs in again
// (`onSignedOut` returns once they have), then runs once more with the new token, so nothing they
// were saving is lost.

export class ApiError extends Error {
  constructor(message, status, data = null) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

const PLAIN = {
  0: "Studio can't reach your site right now. Check your connection, then try again.",
  413: "That's too big to save.",
  415: "That kind of file can't be used here.",
  429: "Too many tries. Wait a minute, then try again.",
  500: "Something went wrong on your site's server. Try again in a moment.",
  503: "Your site's server is busy. Try again in a moment.",
};

export function createApi({ base = "/admin/api/", fetchImpl = (...args) => globalThis.fetch(...args) } = {}) {
  const api = {
    csrf: "",
    user: "",
    /** Set by the shell: resolves once the person has signed in again, or rejects if they gave up. */
    onSignedOut: null,

    async call(method, path, { json, body, headers = {}, retry = true } = {}) {
      const init = { method, credentials: "same-origin", headers: { ...headers } };
      if (method !== "GET" && method !== "HEAD") init.headers["X-CSRF-Token"] = api.csrf;
      if (json !== undefined) {
        init.headers["Content-Type"] = "application/json";
        init.body = JSON.stringify(json);
      } else if (body !== undefined) {
        init.body = body;
      }
      let response;
      try {
        response = await fetchImpl(base + path, init);
      } catch {
        throw new ApiError(PLAIN[0], 0);
      }
      const data = await response.json().catch(() => null);
      if (response.ok) return data;
      if (response.status === 401 && retry && path !== "login" && api.onSignedOut) {
        await api.onSignedOut(data?.error);
        return api.call(method, path, { json, body, headers, retry: false });
      }
      const message = (data && typeof data.error === "string" && data.error) || PLAIN[response.status] || PLAIN[500];
      throw new ApiError(message, response.status, data);
    },

    get: (path) => api.call("GET", path),
    post: (path, json) => api.call("POST", path, { json }),
    put: (path, json) => api.call("PUT", path, { json }),

    async signIn(username, password) {
      const reply = await api.call("POST", "login", { json: { username, password }, retry: false });
      api.csrf = reply.csrf;
      api.user = reply.user;
      return reply;
    },
    async session() {
      const reply = await api.call("GET", "session", { retry: false });
      api.csrf = reply.csrf;
      api.user = reply.user;
      return reply;
    },
    async signOut() {
      try {
        await api.call("POST", "logout", { json: {}, retry: false });
      } catch {
        // Already signed out is signed out.
      }
      api.csrf = "";
      api.user = "";
    },
  };
  return api;
}
