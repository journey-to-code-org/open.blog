// The quiet link under Comments' and Requests' lede (Studio R3): "Get a notification on this iPhone
// when someone comments". Only when notifications are set up, this phone can have them (or can once
// it's on the Home Screen), and it doesn't have them yet. Not a banner and nothing to dismiss: it
// goes once she turns them on. docs/specs/studio/r3/ux.md, "Where the need arises".
import { h } from "./dom.js";
import { deviceNoun, hereState, herePhone } from "./notification-rules.js";
import { createPushHere } from "./push-here.js";

/** Fills `slot` with the link, or leaves it empty. `what`: "someone comments" or "someone asks for a quote". */
export async function quietNotifyLink(slot, { meta, what }) {
  slot.replaceChildren();
  if (meta?.push !== true) return;
  const here = herePhone({ navigator, window: globalThis });
  const state = hereState(here, null, false);
  if (state !== "off" && state !== "home-screen-first") return;
  if (state === "off" && await createPushHere({ api: null, navigator, window: globalThis }).subscription()) return;
  slot.replaceChildren(h("a", { href: "#/notifications", text: `Get a notification on this ${deviceNoun(here)} when ${what}` }));
}
