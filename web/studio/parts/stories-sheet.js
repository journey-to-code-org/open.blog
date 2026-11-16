// Write's Stories you could tell (ONB1.7.4): her stories in a side sheet beside the post. Choosing
// one shows its words there to draw on; nothing is put in the post. Start a post from this goes
// through Write's leave-guard first. Offered (More and Find) once she has a story.
import { h } from "./dom.js";
import { say } from "./words.js";
import { createSheet } from "./sheet.js";
import { loadStories, postFromStory, storyRow, storyText } from "./story-list.js";
import { storyTitle } from "./story-list-rules.js";

export async function createStoriesSheet({ api, meta, context }) {
  const sheet = await createSheet({ label: say("stories.sheetHeading"), wide: false });
  let found = null;
  let has = false;

  async function refresh() {
    try {
      found = await loadStories(api, api.user, meta.areas?.storyMarks || []);
      has = found.stories.length > 0;
    } catch (error) {
      if (error?.status === 401) throw error;
      found = null;
    }
    return has;
  }

  function list(opener) {
    const said = h("p", { class: "studio-help", role: "status" });
    const rows = (found?.stories || []).map((story) => storyRow(story, {
      onRead: (s) => one(s, opener),
      onStart: async (s, button, line) => {
        button.loading = true;
        try {
          const href = await postFromStory(api, s, found.samples);
          line.textContent = say("stories.made");
          sheet.close();
          context.go(href); // Write's leave-guard saves her post first
        } catch (error) {
          if (error?.status === 401) throw error;
          line.textContent = say("stories.makeFailed");
        } finally {
          button.loading = false;
        }
      },
    }));
    sheet.show({ heading: say("stories.sheetHeading"), opener, focus: () => sheet.element.querySelector("button")?.focus(),
      children: [h("p", { class: "studio-help", text: say("stories.sheetLede") }), h("ul", { class: "studio-story-list" }, rows), said,
        h("a", { class: "studio-more-link", href: "#/voice/write?pack=stories", text: say("stories.another") })] });
  }

  function one(story, opener) {
    const back = h("action-button", { variant: "ghost", onClick: () => list(opener) }, say("stories.backToList"));
    sheet.show({ heading: storyTitle(story), opener, focus: () => sheet.element.querySelector(".studio-story-text")?.focus(),
      children: [h("p", { class: "studio-help", text: say("stories.besideNote") }), storyText(story), back] });
  }

  return {
    refresh,
    commands: () => (has ? [{ id: "stories", label: say("stories.findWrite") }] : []),
    /** Run a More or Find item; true when it was this part's. */
    run(value, opener) {
      if (value !== "stories") return false;
      if (found) list(opener);
      else refresh().then(() => list(opener));
      return true;
    },
    leave: () => sheet.leave(),
    element: sheet.element,
  };
}

