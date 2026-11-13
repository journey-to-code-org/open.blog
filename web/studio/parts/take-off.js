// Take it off my site: a published or scheduled post becomes a draft again, with nothing else
// in it changed, and the site goes out so readers stop seeing it.
import { fieldsToSend, formFromDocument } from "./post-fields.js";
import { sendOut } from "./publish.js";

/** The question, in her words. */
export function takeOffQuestion(title) {
  return {
    heading: `Take “${title}” off your site?`,
    text: "Readers stop seeing it in about a minute. It stays here as a draft with your latest changes, and you can publish it again any time.",
    choices: [{ label: "Take it off my site", value: "yes" }, { label: "Keep it up", value: "no", variant: "secondary" }],
  };
}

/** Turn a post back into a draft on the server; resolves to { reply, sent }. */
export async function takeOffSite(api, path) {
  const doc = await api.get(`document?path=${encodeURIComponent(path)}`);
  const fields = fieldsToSend(doc.fields, formFromDocument(doc), "draft");
  const reply = await api.call("PUT", `document?path=${encodeURIComponent(path)}`, { json: { fields, body: doc.body, etag: doc.etag, frontMatter: "keep" } });
  const sent = await sendOut(api, `Take ${doc.fields?.title || path} off the site`);
  return { reply, sent };
}

/** The toast after taking it off. */
export function takenOffWords(sent) {
  return sent.sent === "failed" ? "It's a draft again here, but your site hasn't been sent out yet, so readers may still see it."
    : sent.sent === "none" ? "Taken off your site's server. It's a draft again."
      : "Taken off your site. It's a draft again.";
}
