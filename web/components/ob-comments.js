// Progressive comments for a hosted open.blog engagement endpoint. Untrusted
// comment content is assigned only through textContent.

export class ObComments extends HTMLElement {
  async connectedCallback() {
    const path = this.getAttribute("path");
    const endpoint = (this.getAttribute("endpoint") || "").replace(/\/$/, "");
    if (!path || !endpoint) return;
    this.replaceChildren();
    const heading = document.createElement("h2");
    heading.textContent = "Comments";
    const status = document.createElement("p");
    status.className = "ob-comments-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    const list = document.createElement("ol");
    list.className = "ob-comments-list";
    const form = document.createElement("form");
    form.className = "ob-comments-form";
    form.append(this.field("Name", "text", 80), this.field("Comment", "textarea", 4000));
    const submit = document.createElement("button");
    submit.type = "submit";
    submit.textContent = "Submit for review";
    form.append(submit);
    this.append(heading, status, list, form);

    const render = (comments) => {
      list.replaceChildren();
      for (const comment of comments) {
        const item = document.createElement("li");
        const meta = document.createElement("p");
        const name = document.createElement("strong");
        name.textContent = comment.authorName;
        const time = document.createElement("time");
        time.dateTime = comment.createdAt;
        time.textContent = new Date(comment.createdAt).toLocaleDateString();
        meta.append(name, " · ", time);
        const body = document.createElement("p");
        body.textContent = comment.body;
        item.append(meta, body);
        list.append(item);
      }
      if (!comments.length) status.textContent = "No approved comments yet.";
    };

    const load = async () => {
      const response = await fetch(`${endpoint}/comments?path=${encodeURIComponent(path)}`, { credentials: "omit" });
      if (!response.ok) throw new Error("Comments are unavailable.");
      render((await response.json()).comments || []);
    };
    try {
      await load();
    } catch (error) {
      status.textContent = error.message;
    }
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const controls = form.querySelectorAll("input,textarea,button");
      controls.forEach((control) => { control.disabled = true; });
      status.textContent = "Submitting…";
      try {
        const response = await fetch(`${endpoint}/comments`, {
          method: "POST",
          credentials: "omit",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path, authorName: form.elements.authorName.value, body: form.elements.body.value }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || "The comment could not be submitted.");
        form.reset();
        status.textContent = result.status === "approved" ? "Comment published." : "Comment submitted for moderation.";
      } catch (error) {
        status.textContent = error.message;
      } finally {
        controls.forEach((control) => { control.disabled = false; });
      }
    });
  }

  field(labelText, kind, maximum) {
    const label = document.createElement("label");
    const labelCopy = document.createElement("span");
    labelCopy.textContent = labelText;
    const control = document.createElement(kind === "textarea" ? "textarea" : "input");
    control.name = kind === "textarea" ? "body" : "authorName";
    control.required = true;
    control.maxLength = maximum;
    if (kind === "textarea") control.rows = 5;
    else control.autocomplete = "name";
    label.append(labelCopy, control);
    return label;
  }
}

if (!customElements.get("ob-comments")) customElements.define("ob-comments", ObComments);
