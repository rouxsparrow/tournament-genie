import { test, expect, type Page } from "@playwright/test";
import { loginAsAdmin } from "./helpers/auth";
import {
  clearActiveGroupAssignments,
  closeDb,
  countActiveGroupAssignmentsWithUncheckedPlayers,
} from "./helpers/db";

test.describe.configure({ mode: "serial" });

test.afterAll(async () => {
  await closeDb();
});

async function clickUtilitiesButton(page: Page, name: string) {
  await page.goto("/utilities");
  const checkinSection = page
    .locator("details")
    .filter({ has: page.getByRole("heading", { name: "Player Check-in" }) });
  if ((await checkinSection.getAttribute("open")) === null) {
    await checkinSection.locator("summary").click();
  }
  await page.getByRole("button", { name }).click();
}

async function setAutoSchedule(page: Page, enabled: boolean) {
  const button = page.getByRole("button", { name: /Auto Schedule/i }).first();
  if ((await button.count()) === 0) {
    expect(enabled).toBe(false);
    return;
  }
  await expect(button).toBeVisible();
  const label = (await button.textContent()) ?? "";
  const isOn = label.includes("ON");
  if (isOn !== enabled) {
    await button.click();
    await expect(
      page.getByRole("button", { name: enabled ? /Auto Schedule ON/i : /Auto Schedule OFF/i })
    ).toBeVisible();
  }
}

test("Player check-in blocks queue until arrival @regression", async ({ page }) => {
  await loginAsAdmin(page);

  try {
    await clickUtilitiesButton(page, "Un checkin all players");
    await expect(page.getByText(/All players unchecked:/)).toBeVisible();

    await page.goto("/schedule?stage=group&view=queue");
    await page.locator("select").nth(1).selectOption("BLOCKED");

    const pendingBadge = page.getByText("pending checked in").first();
    await expect(pendingBadge).toBeVisible();

    const pendingCard = pendingBadge.locator("xpath=ancestor::div[contains(@class,'rounded-lg')][1]");
    await expect(pendingCard.getByRole("button", { name: "Unblock" })).toHaveCount(0);

    await clickUtilitiesButton(page, "Check in all players");
    await expect(page.getByText(/All players checked in:/)).toBeVisible();

    await page.goto("/schedule?stage=group&view=queue");
    await page.locator("select").nth(1).selectOption("BLOCKED");
    await expect(page.getByText("pending checked in")).toHaveCount(0);

    await page.locator("select").nth(1).selectOption("ELIGIBLE");
    await expect(page.getByRole("button", { name: "Force Next" }).first()).toBeVisible();
  } finally {
    if (!page.isClosed()) {
      await clickUtilitiesButton(page, "Check in all players");
    }
  }
});

test("Manual schedule does not assign pending check-in matches @regression", async ({ page }) => {
  await loginAsAdmin(page);

  try {
    await clickUtilitiesButton(page, "Un checkin all players");
    await expect(page.getByText(/All players unchecked:/)).toBeVisible();
    await clearActiveGroupAssignments();

    await page.goto("/schedule?stage=group");
    await setAutoSchedule(page, false);
    await page.reload();

    await expect
      .poll(async () => countActiveGroupAssignmentsWithUncheckedPlayers(), { timeout: 15_000 })
      .toBe(0);

    await page.goto("/schedule?stage=group&view=queue");
    await page.locator("select").nth(1).selectOption("ELIGIBLE");
    await expect(page.getByRole("button", { name: "Force Next" })).toHaveCount(0);
    await page.locator("select").nth(1).selectOption("BLOCKED");
    await expect(page.getByText("pending checked in").first()).toBeVisible();
  } finally {
    if (!page.isClosed()) {
      await clickUtilitiesButton(page, "Check in all players");
    }
  }
});
