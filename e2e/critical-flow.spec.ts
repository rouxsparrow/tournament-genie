import { test, expect, Page } from "@playwright/test";
import { loginAsAdmin } from "./helpers/auth";
import {
  closeDb,
  countTestRefereeAccountsByPrefix,
  createTestRefereeAccount,
  deleteRefereeSessionsByAccountIds,
  deleteTestRefereeAccountsByPrefix,
  ensureActiveGroupMatchId,
  getDuplicateActiveAssignments,
  getGroupScheduleSnapshot,
  markAllActiveGroupAssignmentsCompleted,
  setRefereeAccountActive,
} from "./helpers/db";

test.describe.configure({ mode: "serial" });

const TEST_REF_PREFIX = `test_ref_${Date.now()}`;
const TEST_REF_PASSWORD = "TestRefPass123!";

async function createRefereeCredentials() {
  const account = await createTestRefereeAccount({
    prefix: TEST_REF_PREFIX,
    password: TEST_REF_PASSWORD,
  });
  return {
    ...account,
    password: TEST_REF_PASSWORD,
  };
}

async function signInReferee(page: Page, credentials: { username: string; password: string }) {
  await page.goto("/referee");
  await expect(page.getByRole("heading", { name: "Referee Login" })).toBeVisible();
  await page.getByLabel("Username").fill(credentials.username);
  await page.getByLabel("Password").fill(credentials.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Referee Scoresheet" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Referee Login" })).toHaveCount(0);
}

function normalizeText(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function getRefereeMatchTrigger(page: Page) {
  return page
    .locator("label", { hasText: "Match" })
    .locator("..")
    .locator('[role="combobox"]');
}

async function selectRefereeMatchByIndex(page: Page, index: number) {
  const trigger = getRefereeMatchTrigger(page);
  if (!(await trigger.isEnabled())) {
    return { selected: false, optionCount: 0 };
  }
  await trigger.click();
  const options = page.getByRole("option");
  const optionCount = await options.count();
  if (optionCount === 0 || index >= optionCount) {
    await page.keyboard.press("Escape");
    return { selected: false, optionCount };
  }
  await options.nth(index).click();
  return { selected: true, optionCount };
}

test.afterEach(async () => {
  await deleteTestRefereeAccountsByPrefix(TEST_REF_PREFIX);
  const remaining = await countTestRefereeAccountsByPrefix(TEST_REF_PREFIX);
  expect(remaining).toBe(0);
});

test.afterAll(async () => {
  await deleteTestRefereeAccountsByPrefix(TEST_REF_PREFIX);
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

  await Promise.all([page1.reload(), page2.reload()]);

  const dupes = await getDuplicateActiveAssignments();
  expect(dupes.byCourt.length).toBe(0);
  expect(dupes.byGroup.length).toBe(0);
  expect(dupes.byKnockout.length).toBe(0);

  await ctx1.close();
  await ctx2.close();
});

test("Referee unauthenticated access shows blocking login modal @critical", async ({ page }) => {
  await page.goto("/referee");
  await expect(page.getByRole("heading", { name: "Referee Login" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await expect(page.getByLabel("Home score")).toBeDisabled();
});

test("Referee submit flow with account login @critical @smoke", async ({ page }) => {
  await loginAsAdmin(page);
  const matchId = await ensureActiveGroupMatchId();
  expect(matchId).toBeTruthy();

  const credentials = await createRefereeCredentials();
  await signInReferee(page, credentials);

  const matchTrigger = page
    .locator("label", { hasText: "Match" })
    .locator("..")
    .locator('[role="combobox"]');
  const triggerDisabled = await matchTrigger.isDisabled();
  test.skip(triggerDisabled, "existing-group dataset needs at least one selectable referee match.");

  await matchTrigger.click();
  await page.getByRole("option").first().click();
  const homeScoreInput = page.getByLabel("Home score");
  const isGroupStageLocked = await homeScoreInput.isDisabled();
  test.skip(isGroupStageLocked, "existing-group dataset selected a locked group-stage match for referee flow.");

  await homeScoreInput.fill("21");
  await page.getByLabel("Away score").fill("19");
  await page.getByRole("button", { name: "Lock" }).click();
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page.getByText("Submitted")).toBeVisible();
});

test("Referee can swap display sides and keep it after refresh @critical", async ({ page }) => {
  await loginAsAdmin(page);
  const matchId = await ensureActiveGroupMatchId();
  expect(matchId).toBeTruthy();

  const credentials = await createRefereeCredentials();
  await signInReferee(page, credentials);

  const selection = await selectRefereeMatchByIndex(page, 0);
  test.skip(!selection.selected, "existing-group dataset needs at least one selectable referee match.");

  const leftTeam = page.getByTestId("left-team-name");
  const rightTeam = page.getByTestId("right-team-name");
  const homeScoreInput = page.getByLabel("Home score");
  const isGroupStageLocked = await homeScoreInput.isDisabled();
  test.skip(isGroupStageLocked, "existing-group dataset selected a locked group-stage match for referee flow.");

  const initialLeft = normalizeText(await leftTeam.textContent());
  const initialRight = normalizeText(await rightTeam.textContent());

  const swapButton = page.getByTestId("swap-sides-button");
  await expect(swapButton).toHaveText("Swap Sides");
  await swapButton.click();
  await expect(swapButton).toHaveText("Reset Sides");
  await expect(page.getByText("Display: Swapped")).toBeVisible();
  expect(normalizeText(await leftTeam.textContent())).toBe(initialRight);
  expect(normalizeText(await rightTeam.textContent())).toBe(initialLeft);

  await page.reload();
  await expect(page.getByRole("heading", { name: "Referee Scoresheet" })).toBeVisible();
  await expect(page.getByTestId("swap-sides-button")).toHaveText("Reset Sides");
  expect(normalizeText(await page.getByTestId("left-team-name").textContent())).toBe(initialRight);
  expect(normalizeText(await page.getByTestId("right-team-name").textContent())).toBe(initialLeft);

  await page.getByTestId("score-left-column").locator("input").fill("21");
  await page.getByTestId("score-right-column").locator("input").fill("19");
  await page.getByRole("button", { name: "Lock" }).click();
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page.getByText("Submitted")).toBeVisible();
});

test("Referee side swap persists per match only @critical", async ({ page }) => {
  await loginAsAdmin(page);
  const matchId = await ensureActiveGroupMatchId();
  expect(matchId).toBeTruthy();

  const credentials = await createRefereeCredentials();
  await signInReferee(page, credentials);

  const firstSelection = await selectRefereeMatchByIndex(page, 0);
  test.skip(!firstSelection.selected, "existing-group dataset needs at least one selectable referee match.");
  test.skip(firstSelection.optionCount < 2, "needs at least two selectable referee matches for isolation check.");

  const swapButton = page.getByTestId("swap-sides-button");
  await expect(swapButton).toHaveText("Swap Sides");
  await swapButton.click();
  await expect(swapButton).toHaveText("Reset Sides");

  const secondSelection = await selectRefereeMatchByIndex(page, 1);
  test.skip(!secondSelection.selected, "second referee match is not selectable in current dataset.");
  await expect(page.getByTestId("swap-sides-button")).toHaveText("Swap Sides");

  const firstAgain = await selectRefereeMatchByIndex(page, 0);
  test.skip(!firstAgain.selected, "first referee match is not selectable in current dataset.");
  await expect(page.getByTestId("swap-sides-button")).toHaveText("Reset Sides");
});

test("Referee deactivated account cannot login @critical", async ({ page }) => {
  const credentials = await createRefereeCredentials();
  await setRefereeAccountActive(credentials.id, false);

  await page.goto("/referee");
  await page.getByLabel("Username").fill(credentials.username);
  await page.getByLabel("Password").fill(credentials.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Invalid credentials.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Referee Login" })).toBeVisible();
});

test("Referee revoked session forces re-login @critical", async ({ page }) => {
  const credentials = await createRefereeCredentials();
  await signInReferee(page, credentials);

  await deleteRefereeSessionsByAccountIds([credentials.id]);

  await page.reload();
  await expect(page.getByRole("heading", { name: "Referee Login" })).toBeVisible();
});

test("Referee cannot submit after match is completed @critical", async ({ page }) => {
  const credentials = await createRefereeCredentials();
  await signInReferee(page, credentials);

  const matchTrigger = page
    .locator("label", { hasText: "Match" })
    .locator("..")
    .locator('[role="combobox"]');
  const triggerDisabled = await matchTrigger.isDisabled();
  test.skip(triggerDisabled, "existing-group dataset needs at least one selectable referee match.");

  await matchTrigger.click();
  await page.getByRole("option").first().click();

  await page.getByLabel("Home score").fill("21");
  await page.getByLabel("Away score").fill("19");
  await page.getByRole("button", { name: "Lock" }).click();

  await markAllActiveGroupAssignmentsCompleted();
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page.getByText("Only scheduled matches can be submitted by referee.")).toBeVisible();
});

test("Utilities emergency tool @critical", async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto("/utilities");
  await page.getByRole("button", { name: "Check duplicate assignments" }).click();
  await expect(page.getByText("Check complete.")).toBeVisible();

  await page.getByRole("button", { name: "Clear duplicate assignments" }).click();
  await expect(page.getByText(/Cleanup complete\./)).toBeVisible();
  const bucketCard = page
    .locator("div.rounded-md.border.border-border.bg-muted\\/30.p-3")
    .filter({ hasText: "Duplicate buckets" })
    .first();
  await expect(bucketCard).toBeVisible();
  await expect(bucketCard.getByText(/^0$/)).toBeVisible();
});
