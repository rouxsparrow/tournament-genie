import { expect, test } from "@playwright/test";
import { loginAsAdmin } from "./helpers/auth";

test("Schedule and referee controls are usable on mobile @regression @mobile", async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto("/schedule");

  await expect(page.getByRole("heading", { name: "Schedule" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Live Courts/i })).toBeVisible();
  await expect(page.getByRole("button", { name: "Queue", exact: true })).toBeVisible();

  const passcode =
    process.env.E2E_REFEREE_CODE ??
    process.env.Referee_code ??
    process.env.REFEREE_CODE ??
    "1234";

  await page.goto("/");
  await page.evaluate((code) => window.localStorage.setItem("referee:passcode", code), passcode);
  await page.goto("/referee");

  await expect(page.getByRole("heading", { name: "Referee Scoresheet" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Lock" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Submit" })).toBeVisible();
});
