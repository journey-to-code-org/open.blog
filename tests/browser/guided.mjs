import { expect } from "@playwright/test";

/**
 * Save the Guided workspace for the signed-in writer and reload so Admin reads it. Simple keeps
 * research formatting out of an ordinary post (#559), so specs of those tools run in Guided.
 */
export async function useGuided(page) {
  await expect(page.locator('[data-action="logout"]')).toBeVisible();
  await page.evaluate(async () => {
    const session = await (await fetch("/admin/api/session")).json();
    const stored = await (await fetch("/admin/api/preferences")).json();
    await fetch("/admin/api/preferences", {
      method: "PUT",
      headers: { "content-type": "application/json", "x-csrf-token": session.csrf },
      body: JSON.stringify({ etag: stored.etag, preferences: { ...stored.preferences, preset: "guided" } }),
    });
  });
  await page.reload();
}
