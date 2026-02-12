import { test, expect } from "@playwright/test";
import { loginAsAdmin } from "./helpers/auth";
import {
  closeDb,
  ensureActiveGroupMatchId,
  getDuplicateActiveAssignments,
  getGroupScheduleSnapshot,
  markAllActiveGroupAssignmentsCompleted,
} from "./helpers/db";

test.describe.configure({ mode: "serial" });

test.afterAll(async () => {
  await closeDb();
});

test("Admin auth + schedule load smoke @critical @smoke", async ({ page }) => {
  await loginAsAdmin(page);
  await expect(page.getByRole("heading", { name: "Schedule" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Auto Schedule/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Playing" })).toBeVisible();
});

test("Auto Schedule happy path @critical @smoke", async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto("/schedule");

  const autoButton = page.getByRole("button", { name: /Auto Schedule/i });
  const autoLabel = (await autoButton.textContent()) ?? "";
  if (autoLabel.includes("OFF")) {
    await autoButton.click();
    await expect(page.getByRole("button", { name: /Auto Schedule ON/i })).toBeVisible();
  }

  await markAllActiveGroupAssignmentsCompleted();
  await page.getByRole("button", { name: "Completed" }).first().click();
  await expect(page.getByText("Match not completed yet.")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Playing" })).toBeVisible();
});

test("No-disappearing-match guardrail @critical", async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto("/schedule");

  for (let i = 0; i < 3; i += 1) {
    await markAllActiveGroupAssignmentsCompleted();
    await page.reload();
    await page.waitForTimeout(300);
  }

  await page.getByRole("button", { name: "Queue", exact: true }).click();
  const queueCount = await page.getByRole("button", { name: "Force Next" }).count();
  const snapshot = await getGroupScheduleSnapshot();
  const expectedQueue = snapshot.scheduled - snapshot.active - snapshot.blocked;

  expect(queueCount).toBe(expectedQueue);
});

test("Concurrency UI race (two contexts) @critical", async ({ browser }) => {
  const ctx1 = await browser.newContext();
  const ctx2 = await browser.newContext();
  const page1 = await ctx1.newPage();
  const page2 = await ctx2.newPage();

  await loginAsAdmin(page1);
  await loginAsAdmin(page2);
  await page1.goto("/schedule");
  await page2.goto("/schedule");

  await markAllActiveGroupAssignmentsCompleted();

  await Promise.all([
    page1.reload(),
    page2.reload(),
  ]);

  const dupes = await getDuplicateActiveAssignments();
  expect(dupes.byCourt.length).toBe(0);
  expect(dupes.byGroup.length).toBe(0);
  expect(dupes.byKnockout.length).toBe(0);

  await ctx1.close();
  await ctx2.close();
});

test("Referee submit flow @critical @smoke", async ({ context, page }) => {
  await loginAsAdmin(page);
  const matchId = await ensureActiveGroupMatchId();
  expect(matchId).toBeTruthy();

  const passcode =
    process.env.E2E_REFEREE_CODE ??
    process.env.Referee_code ??
    process.env.REFEREE_CODE ??
    "1234";

  await context.addInitScript(
    ({ code }) => {
      window.localStorage.setItem("referee:passcode", code);
    },
    { code: passcode }
  );

  await page.goto("/referee");
  const matchTrigger = page.locator("label", { hasText: "Match" }).locator("..").locator('[role="combobox"]');
  await matchTrigger.click();
  await page.getByRole("option").first().click();
  await page.getByLabel("Home score").fill("21");
  await page.getByLabel("Away score").fill("19");
  await expect(page.getByRole("button", { name: "Lock" })).toBeEnabled();
  await page.getByRole("button", { name: "Lock" }).click();
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page.getByText("Submitted")).toBeVisible();
});

test("Utilities emergency tool @critical", async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto("/utilities");
  await page.getByRole("button", { name: "Check duplicate assignments" }).click();
  await expect(page.getByText("Check complete.")).toBeVisible();

  await page.getByRole("button", { name: "Clear duplicate assignments" }).click();
  await expect(page.getByText(/Cleanup complete\./)).toBeVisible();
  await expect(page.getByText("Duplicate buckets: 0")).toBeVisible();
});

test("Referee passcode persistence @critical", async ({ page }) => {
  const passcode =
    process.env.E2E_REFEREE_CODE ??
    process.env.Referee_code ??
    process.env.REFEREE_CODE ??
    "1234";

  await page.goto("/");
  await page.evaluate(() => window.localStorage.removeItem("referee:passcode"));
  await page.goto("/referee");
  await page.getByLabel("Referee passcode").fill(passcode);
  await page.getByRole("button", { name: "Enter" }).click();
  await expect(page.getByRole("heading", { name: "Referee Scoresheet" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: "Referee Scoresheet" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Referee Access" })).toHaveCount(0);
});
