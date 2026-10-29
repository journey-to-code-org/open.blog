let loading;
function loadProvider() {
  if (globalThis.turnstile) return Promise.resolve(globalThis.turnstile);
  if (!loading) loading = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    const timer = setTimeout(() => fail(), 15000);
    const fail = () => {
      clearTimeout(timer);
      script.remove();
      loading = undefined;
      reject(new Error("Verification could not load."));
    };
    script.onerror = fail;
    script.onload = () => {
      clearTimeout(timer);
      if (globalThis.turnstile) resolve(globalThis.turnstile);
      else fail();
    };
    document.head.append(script);
  });
  return loading;
}

export function commentCaptcha(host, form, status) {
  const key = `openblog-comment-pass:${host.getAttribute("captcha-scope") || host.getAttribute("endpoint")}:${host.getAttribute("captcha-site-key")}`;
  let session, token = "", widget, pending;
  try { session = JSON.parse(sessionStorage.getItem(key)); } catch { /* storage may be blocked */ }
  const pass = () => session?.expiresAt > Date.now() / 1000 && typeof session.pass === "string" ? session.pass : "";
  const container = document.createElement("div");
  container.setAttribute("aria-label", "Comment verification");
  container.setAttribute("tabindex", "-1");
  const disclosure = document.createElement("p");
  disclosure.textContent = "Cloudflare Turnstile verifies comments when you interact with this form. A successful verification lasts 30 minutes in this tab.";
  const retry = document.createElement("button");
  retry.type = "button";
  retry.textContent = "Retry verification";
  retry.hidden = true;
  form.append(disclosure, container, retry);
  const failed = () => {
    token = "";
    status.textContent = "Verification is unavailable or expired. Your text is kept. Retry verification, or copy your comment and return later.";
    retry.hidden = false;
  };
  const start = async () => {
    if (pass() || widget !== undefined || pending) return;
    status.textContent = "Loading comment verification…";
    retry.hidden = true;
    pending = loadProvider();
    try {
      const provider = await pending;
      if (!host.isConnected) return;
      widget = provider.render(container, {
        sitekey: host.getAttribute("captcha-site-key"), action: "comment",
        callback: (value) => { token = value; retry.hidden = true; status.textContent = "Verification complete. You can submit your comment."; },
        "error-callback": failed, "expired-callback": failed, "timeout-callback": failed,
      });
    } catch { failed(); } finally { pending = undefined; }
  };
  retry.addEventListener("click", () => {
    container.focus();
    token = "";
    if (widget !== undefined) {
      globalThis.turnstile?.remove(widget);
      widget = undefined;
    }
    void start();
  });
  form.addEventListener("focusin", () => { void start(); });
  form.addEventListener("input", () => { void start(); });
  return {
    async submission() {
      if (pass()) return { captchaPass: pass() };
      await start();
      if (!token) throw new Error("Complete comment verification before submitting. Your text is kept; use Retry verification if needed.");
      const value = token;
      token = "";
      return { captchaToken: value };
    },
    accepted(value) {
      if (value && typeof value.pass === "string" && Number.isFinite(value.expiresAt)) {
        session = value;
        try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* keep in memory for this page */ }
      }
      if (widget !== undefined) globalThis.turnstile?.remove(widget);
      widget = undefined;
    },
    rejected() {
      session = null;
      try { sessionStorage.removeItem(key); } catch { /* storage may be blocked */ }
      if (widget !== undefined) globalThis.turnstile?.remove(widget);
      widget = undefined;
      token = "";
      void start();
    },
    failed,
    destroy() { if (widget !== undefined) globalThis.turnstile?.remove(widget); },
  };
}
