import { expect, type Locator, type Page, test } from "@playwright/test";
import { loginAsAdmin } from "./helpers/auth";
import {
  closeDb,
  deleteTestRefereeAccountsByPrefix,
  ensureActiveGroupMatchId,
  ensureActiveKnockoutMatchId,
  getActiveGroupAssignmentSnapshot,
  getActiveKnockoutAssignmentSnapshot,
} from "./helpers/db";
import {
  createRefereeCredentials,
  signInReferee,
  submitRefereeScoreForCourt,
} from "./helpers/referee";

test.describe.configure({ mode: "serial" });

const TEST_REF_PREFIX = `schedule_ref_${Date.now()}`;

test.afterAll(async () => {
  await deleteTestRefereeAccountsByPrefix(TEST_REF_PREFIX);
  await closeDb();
});

test.afterEach(async () => {
  await deleteTestRefereeAccountsByPrefix(TEST_REF_PREFIX);
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

function parseAssignedTeams(rawText: string) {
  const lines = rawText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const direct = lines.find((line) => /\s+vs\s+/i.test(line));
  if (direct) {
    const [home, away] = direct.split(/\s+vs\s+/i);
    if (home && away) return { home: home.trim(), away: away.trim() };
  }
  const vsIndex = lines.findIndex((line) => line.toLowerCase() === "vs.");
  if (vsIndex > 0 && (vsIndex + 1) < lines.length) {
    return {
      home: lines[vsIndex - 1] ?? "",
      away: lines[vsIndex + 1] ?? "",
    };
  }
  throw new Error(`Unable to parse assigned teams from court card text: ${rawText}`);
}

async function assignNextOnCourt(page: Page, label: string) {
  const card = courtCard(page, label);
  const assignButton = card.getByRole("button", { name: "Assign Next" });
  if (!(await assignButton.isEnabled())) {
    throw new Error(`No assignable match available on ${label}.`);
  }

  await assignButton.click();

  const modal = page
    .locator("div.fixed.inset-0")
    .filter({ hasText: `Assign match to ${label}` })
    .first();
  await expect(modal).toBeVisible();

  const select = modal.locator("select").first();
  await expect(select).toBeVisible();

  const options = select.locator("option:not([disabled])");
  const optionCount = await options.count();
  if (optionCount === 0) {
    await modal.getByRole("button", { name: "Close" }).click();
    throw new Error(`No assignable match available on ${label}.`);
  }

  let assignedMatchId: string | null = null;
  for (let index = 0; index < optionCount; index += 1) {
    const option = options.nth(index);
    const optionValue = await option.getAttribute("value");
    if (!optionValue) continue;
    await select.selectOption(optionValue);
    const confirmButton = modal.getByRole("button", { name: "Confirm assignment" });
    if (!(await confirmButton.isEnabled())) continue;
    await confirmButton.click();
    try {
      await expect(modal).toBeHidden({ timeout: 2_000 });
      assignedMatchId = optionValue;
      break;
    } catch {
      // The candidate may have become invalid between modal open and confirm; try the next one.
    }
  }

  if (!assignedMatchId) {
    throw new Error(`No assignable match available on ${label}.`);
  }

  await expect(card.getByText("No match assigned.")).toHaveCount(0, { timeout: 5_000 });
  const teams = parseAssignedTeams(await card.innerText());
  return { matchId: assignedMatchId, homeTeamName: teams.home, awayTeamName: teams.away };
}

async function ensureVisibleAssignmentOnCourt(
  page: Page,
  snapshot: {
    courtId: string;
    matchId: string;
    homeTeamName: string;
    awayTeamName: string;
  }
) {
  const label = courtLabel(snapshot.courtId);
  const card = courtCard(page, label);
  const homeTeam = card.getByText(snapshot.homeTeamName, { exact: false });
  const awayTeam = card.getByText(snapshot.awayTeamName, { exact: false });

  if ((await homeTeam.count()) > 0 && (await awayTeam.count()) > 0) {
    await expect(homeTeam).toBeVisible();
    await expect(awayTeam).toBeVisible();
    return { label, matchId: snapshot.matchId, homeTeamName: snapshot.homeTeamName, awayTeamName: snapshot.awayTeamName };
  }

  const assigned = await assignNextOnCourt(page, label);
  await expect(card.getByText(assigned.homeTeamName, { exact: false })).toBeVisible();
  await expect(card.getByText(assigned.awayTeamName, { exact: false })).toBeVisible();
  return { label, ...assigned };
}

async function setAutoSchedule(page: Page, enabled: boolean) {
  const button = page.getByRole("button", { name: /Auto Schedule/i }).first();
  if ((await button.count()) === 0) {
    expect(enabled).toBe(false);
    return;
  }
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

test("Schedule realtime refreshes on GROUP completion with Auto Schedule disabled @regression", async ({
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
  await setAutoSchedule(observerPage, false);

  const assignment = await ensureVisibleAssignmentOnCourt(observerPage, snapshot);
  const targetCourt = courtCard(observerPage, assignment.label);

  const submitted = await submitGroupMatchFromMatches(operatorPage, assignment.matchId);
  if (!submitted) {
    await operatorContext.close();
    await observerContext.close();
    test.skip(true, "Could not submit group score for active match in /matches.");
    return;
  }

  await expect(targetCourt.getByText(assignment.homeTeamName, { exact: false })).toHaveCount(0, {
    timeout: 20_000,
  });
  await expect(targetCourt.getByText(assignment.awayTeamName, { exact: false })).toHaveCount(0, {
    timeout: 20_000,
  });
  await expect(targetCourt.getByText("No match assigned.")).toBeVisible({
    timeout: 20_000,
  });

  await operatorContext.close();
  await observerContext.close();
});

test("Schedule realtime refreshes on KNOCKOUT completion with Auto Schedule disabled @regression", async ({
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
  await setAutoSchedule(observerPage, false);

  const assignment = await ensureVisibleAssignmentOnCourt(observerPage, snapshot);
  const targetCourt = courtCard(observerPage, assignment.label);

  const submitted = await submitKnockoutMatchFromMatches(operatorPage, assignment.matchId);
  if (!submitted) {
    await operatorContext.close();
    await observerContext.close();
    test.skip(true, "Could not submit knockout score for active match in /matches.");
    return;
  }

  await expect(targetCourt.getByText(assignment.homeTeamName, { exact: false })).toHaveCount(0, {
    timeout: 20_000,
  });
  await expect(targetCourt.getByText(assignment.awayTeamName, { exact: false })).toHaveCount(0, {
    timeout: 20_000,
  });
  await expect(targetCourt.getByText("No match assigned.")).toBeVisible({
    timeout: 20_000,
  });

  await operatorContext.close();
  await observerContext.close();
});

test("Schedule realtime refreshes on GROUP completion when Auto Schedule is OFF and referee submits @regression", async ({
  browser,
}) => {
  await ensureActiveGroupMatchId();
  const snapshot = await getActiveGroupAssignmentSnapshot();
  test.skip(!snapshot, "No active group-stage assignment available.");
  if (!snapshot) return;

  const observerContext = await browser.newContext();
  const refereeContext = await browser.newContext();
  const observerPage = await observerContext.newPage();
  const refereePage = await refereeContext.newPage();

  await loginAsAdmin(observerPage);
  const credentials = await createRefereeCredentials(TEST_REF_PREFIX);
  await signInReferee(refereePage, credentials);

  await observerPage.goto("/schedule?stage=group");
  await setAutoSchedule(observerPage, false);

  const assignment = await ensureVisibleAssignmentOnCourt(observerPage, snapshot);
  const targetCourt = courtCard(observerPage, assignment.label);

  const submitted = await submitRefereeScoreForCourt(refereePage, {
    stage: "GROUP",
    court: assignment.label,
  });
  if (!submitted) {
    await observerContext.close();
    await refereeContext.close();
    test.skip(true, "Could not submit referee group score for active court.");
    return;
  }

  await expect(targetCourt.getByText(assignment.homeTeamName, { exact: false })).toHaveCount(0, {
    timeout: 20_000,
  });
  await expect(targetCourt.getByText(assignment.awayTeamName, { exact: false })).toHaveCount(0, {
    timeout: 20_000,
  });
  await expect(targetCourt.getByText("No match assigned.")).toBeVisible({
    timeout: 20_000,
  });

  await observerPage.waitForTimeout(2000);
  await expect(targetCourt.getByText("No match assigned.")).toBeVisible();

  await observerContext.close();
  await refereeContext.close();
});

test("Schedule realtime refreshes on KNOCKOUT completion when Auto Schedule is OFF and referee submits @regression", async ({
  browser,
}) => {
  await ensureActiveKnockoutMatchId();
  const snapshot = await getActiveKnockoutAssignmentSnapshot();
  test.skip(!snapshot, "No active knockout assignment available.");
  if (!snapshot) return;

  const observerContext = await browser.newContext();
  const refereeContext = await browser.newContext();
  const observerPage = await observerContext.newPage();
  const refereePage = await refereeContext.newPage();

  await loginAsAdmin(observerPage);
  const credentials = await createRefereeCredentials(TEST_REF_PREFIX);
  await signInReferee(refereePage, credentials);

  await observerPage.goto("/schedule?stage=ko");
  await setAutoSchedule(observerPage, false);

  const assignment = await ensureVisibleAssignmentOnCourt(observerPage, snapshot);
  const targetCourt = courtCard(observerPage, assignment.label);

  const submitted = await submitRefereeScoreForCourt(refereePage, {
    stage: "KNOCKOUT",
    court: assignment.label,
  });
  if (!submitted) {
    await observerContext.close();
    await refereeContext.close();
    test.skip(true, "Could not submit referee knockout score for active court.");
    return;
  }

  await expect(targetCourt.getByText(assignment.homeTeamName, { exact: false })).toHaveCount(0, {
    timeout: 20_000,
  });
  await expect(targetCourt.getByText(assignment.awayTeamName, { exact: false })).toHaveCount(0, {
    timeout: 20_000,
  });
  await expect(targetCourt.getByText("No match assigned.")).toBeVisible({
    timeout: 20_000,
  });

  await observerPage.waitForTimeout(2000);
  await expect(targetCourt.getByText("No match assigned.")).toBeVisible();

  await observerContext.close();
  await refereeContext.close();
});
