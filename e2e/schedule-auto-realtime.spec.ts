import { expect, type Locator, type Page, test } from "@playwright/test";
import { loginAsAdmin } from "./helpers/auth";
import {
  closeDb,
  ensureActiveGroupMatchId,
  ensureActiveKnockoutMatchId,
  getActiveGroupAssignmentSnapshot,
  getActiveKnockoutAssignmentSnapshot,
} from "./helpers/db";

test.describe.configure({ mode: "serial" });

test.afterAll(async () => {
  await closeDb();
});

const COURT_LABELS: Record<string, string> = {
  C1: "P5",
  C2: "P6",
  C3: "P7",
  C4: "P8",
  C5: "P9",
};

function courtLabel(courtId: string) {
  return COURT_LABELS[courtId] ?? courtId;
}

function courtCard(page: Page, label: string): Locator {
  const heading = page.getByRole("heading", { name: label, exact: true }).first();
  return heading.locator("xpath=ancestor::div[contains(@class,'rounded-xl')][1]");
}

async function setAutoSchedule(page: Page, enabled: boolean) {
  const button = page.getByRole("button", { name: /Auto Schedule/i }).first();
  await expect(button).toBeVisible();
  const text = (await button.textContent()) ?? "";
  const isOn = text.includes("ON");
  if (enabled !== isOn) {
    await button.click();
    await expect(
      page.getByRole("button", {
        name: enabled ? /Auto Schedule ON/i : /Auto Schedule OFF/i,
      })
    ).toBeVisible();
  }
}

async function submitGroupMatchFromMatches(page: Page, matchId: string) {
  await page.goto("/matches?view=group");
  const form = page.locator(`form:has(input[name="matchId"][value="${matchId}"])`).first();
  if ((await form.count()) === 0) return false;

  const game1Home = form.locator('input[name="game1Home"]').first();
  const game1Away = form.locator('input[name="game1Away"]').first();
  if ((await game1Home.count()) === 0 || (await game1Away.count()) === 0) return false;
  if ((await game1Home.isDisabled()) || (await game1Away.isDisabled())) return false;

  await game1Home.fill("21");
  await game1Away.fill("19");

  const game2Home = form.locator('input[name="game2Home"]').first();
  const game2Away = form.locator('input[name="game2Away"]').first();
  if ((await game2Home.count()) > 0 && (await game2Away.count()) > 0) {
    await game2Home.fill("21");
    await game2Away.fill("18");
  }

  await form.getByRole("button", { name: "Save result" }).first().click();
  await expect(page.getByRole("heading", { name: "Matches" })).toBeVisible();
  return true;
}

async function submitKnockoutMatchFromMatches(page: Page, matchId: string) {
  await page.goto("/matches?view=knockout");
  const form = page.locator(`form:has(input[name="matchId"][value="${matchId}"])`).first();
  if ((await form.count()) === 0) return false;

  const game1Home = form.locator('input[name="game1Home"]').first();
  const game1Away = form.locator('input[name="game1Away"]').first();
  if ((await game1Home.count()) === 0 || (await game1Away.count()) === 0) return false;
  if ((await game1Home.isDisabled()) || (await game1Away.isDisabled())) return false;

  await game1Home.fill("21");
  await game1Away.fill("19");

  const game2Home = form.locator('input[name="game2Home"]').first();
  const game2Away = form.locator('input[name="game2Away"]').first();
  if ((await game2Home.count()) > 0 && (await game2Away.count()) > 0) {
    await game2Home.fill("21");
    await game2Away.fill("18");
  }

  await form.getByRole("button", { name: "Save result" }).first().click();
  await expect(page.getByRole("heading", { name: "Matches" })).toBeVisible();
  return true;
}

test("Schedule realtime refreshes on GROUP completion when Auto Schedule is ON @regression", async ({
  browser,
}) => {
  await ensureActiveGroupMatchId();
  const snapshot = await getActiveGroupAssignmentSnapshot();
  test.skip(!snapshot, "No active group-stage assignment available.");
  if (!snapshot) return;

  const operatorContext = await browser.newContext();
  const observerContext = await browser.newContext();
  const operatorPage = await operatorContext.newPage();
  const observerPage = await observerContext.newPage();

  await loginAsAdmin(operatorPage);
  await loginAsAdmin(observerPage);

  await observerPage.goto("/schedule?stage=group");
  await setAutoSchedule(observerPage, true);

  const targetCourt = courtCard(observerPage, courtLabel(snapshot.courtId));
  await expect(targetCourt.getByText(snapshot.homeTeamName, { exact: false })).toBeVisible();
  await expect(targetCourt.getByText(snapshot.awayTeamName, { exact: false })).toBeVisible();

  const submitted = await submitGroupMatchFromMatches(operatorPage, snapshot.matchId);
  if (!submitted) {
    await operatorContext.close();
    await observerContext.close();
    test.skip(true, "Could not submit group score for active match in /matches.");
    return;
  }

  await expect(targetCourt.getByText(snapshot.homeTeamName, { exact: false })).toHaveCount(0, {
    timeout: 20_000,
  });
  await expect(targetCourt.getByText(snapshot.awayTeamName, { exact: false })).toHaveCount(0, {
    timeout: 20_000,
  });

  await operatorContext.close();
  await observerContext.close();
});

test("Schedule realtime refreshes on KNOCKOUT completion when Auto Schedule is ON @regression", async ({
  browser,
}) => {
  await ensureActiveKnockoutMatchId();
  const snapshot = await getActiveKnockoutAssignmentSnapshot();
  test.skip(!snapshot, "No active knockout assignment available.");
  if (!snapshot) return;

  const operatorContext = await browser.newContext();
  const observerContext = await browser.newContext();
  const operatorPage = await operatorContext.newPage();
  const observerPage = await observerContext.newPage();

  await loginAsAdmin(operatorPage);
  await loginAsAdmin(observerPage);

  await observerPage.goto("/schedule?stage=ko");
  await setAutoSchedule(observerPage, true);

  const targetCourt = courtCard(observerPage, courtLabel(snapshot.courtId));
  await expect(targetCourt.getByText(snapshot.homeTeamName, { exact: false })).toBeVisible();
  await expect(targetCourt.getByText(snapshot.awayTeamName, { exact: false })).toBeVisible();

  const submitted = await submitKnockoutMatchFromMatches(operatorPage, snapshot.matchId);
  if (!submitted) {
    await operatorContext.close();
    await observerContext.close();
    test.skip(true, "Could not submit knockout score for active match in /matches.");
    return;
  }

  await expect(targetCourt.getByText(snapshot.homeTeamName, { exact: false })).toHaveCount(0, {
    timeout: 20_000,
  });
  await expect(targetCourt.getByText(snapshot.awayTeamName, { exact: false })).toHaveCount(0, {
    timeout: 20_000,
  });

  await operatorContext.close();
  await observerContext.close();
});

test("Schedule does not realtime-refresh when Auto Schedule is OFF @regression", async ({ browser }) => {
  await ensureActiveGroupMatchId();
  const snapshot = await getActiveGroupAssignmentSnapshot();
  test.skip(!snapshot, "No active group-stage assignment available.");
  if (!snapshot) return;

  const operatorContext = await browser.newContext();
  const observerContext = await browser.newContext();
  const operatorPage = await operatorContext.newPage();
  const observerPage = await observerContext.newPage();

  await loginAsAdmin(operatorPage);
  await loginAsAdmin(observerPage);

  await observerPage.goto("/schedule?stage=group");
  await setAutoSchedule(observerPage, false);

  const targetCourt = courtCard(observerPage, courtLabel(snapshot.courtId));
  await expect(targetCourt.getByText(snapshot.homeTeamName, { exact: false })).toBeVisible();
  await expect(targetCourt.getByText(snapshot.awayTeamName, { exact: false })).toBeVisible();

  const submitted = await submitGroupMatchFromMatches(operatorPage, snapshot.matchId);
  if (!submitted) {
    await operatorContext.close();
    await observerContext.close();
    test.skip(true, "Could not submit group score for active match in /matches.");
    return;
  }

  await observerPage.waitForTimeout(4000);
  await expect(targetCourt.getByText(snapshot.homeTeamName, { exact: false })).toBeVisible();
  await expect(targetCourt.getByText(snapshot.awayTeamName, { exact: false })).toBeVisible();

  await observerPage.reload();
  await expect(targetCourt.getByText(snapshot.homeTeamName, { exact: false })).toHaveCount(0, {
    timeout: 20_000,
  });

  await operatorContext.close();
  await observerContext.close();
});
