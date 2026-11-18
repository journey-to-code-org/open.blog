// The page a hidden area's address shows (ONB1): "<Area> is turned off for you", what it is, and
// Turn it on (which opens what was asked for) or Not now (Home). Never a dead end.
import { h, toast } from "./dom.js";
import { use } from "../zubra.js";
import { say } from "./words.js";
import { areaAbout, areaName } from "./area-rules.js";

export async function createTurnedOff(context, area) {
  await use("action-button");
  const name = areaName(area);
  const asked = location.hash || "#/";
  const status = h("p", { class: "studio-help", role: "status" });
  const on = h("action-button", { size: "lg", class: "studio-primary", onClick: async () => {
    on.loading = true;
    const saved = await context.areas.turn(area, true);
    on.loading = false;
    if (!saved.ok && saved.code !== "stale") {
      status.textContent = saved.code === "no-signal" ? say("area.noSignal") : say("area.turnOnFailed");
      return;
    }
    toast(say("area.turnedOn", { area: name }));
    context.reopen?.(asked);
  } }, say("area.turnOn"));
  const element = h("section", { class: "studio-page studio-turned-off", "aria-labelledby": "studio-off-h" },
    h("h2", { id: "studio-off-h", class: "studio-question", tabindex: "-1", text: say("area.offHeading", { area: name }) }),
    h("p", { class: "studio-lede", text: areaAbout(area) }),
    h("div", { class: "studio-row" }, on, h("action-button", { variant: "secondary", size: "lg", href: "#/" }, say("area.notNow"))),
    status);
  return { title: name, element };
}
