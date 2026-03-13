import { expect, type Page } from "@playwright/test";
import { createTestRefereeAccount } from "./db";

type Stage = "GROUP" | "KNOCKOUT";

const DEFAULT_TEST_REF_PASSWORD = "TestRefPass123!";

export async function createRefereeCredentials(prefix: string) {
  const account = await createTestRefereeAccount({
    prefix,
    password: DEFAULT_TEST_REF_PASSWORD,
  });

  return {
    ...account,
    password: DEFAULT_TEST_REF_PASSWORD,
  };
}

export async function signInReferee(
  page: Page,
  credentials: { username: string; password: string }
) {
  await page.goto("/referee");
  await expect(page.getByRole("heading", { name: "Referee Login" })).toBeVisible();
  await page.getByLabel("Username").fill(credentials.username);
  await page.getByLabel("Password").fill(credentials.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Referee Scoresheet" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Referee Login" })).toHaveCount(0);
}

async function selectFirstMatch(page: Page) {
  const matchTrigger = page
    .locator("label", { hasText: "Match" })
    .locator("..")
    .locator('[role="combobox"]');

  if (await matchTrigger.isDisabled()) return false;

  await matchTrigger.click();
  const options = page.getByRole("option");
  const optionCount = await options.count();
  if (optionCount === 0) {
    await page.keyboard.press("Escape");
    return false;
  }

  await options.first().click();
  return true;
}

async function fillRefereeScores(page: Page) {
  const homeScoreInput = page.getByLabel("Home score");
  const awayScoreInput = page.getByLabel("Away score");

  if (await homeScoreInput.isDisabled()) return false;

  await homeScoreInput.fill("21");
  await awayScoreInput.fill("19");

  const bestOf3Toggle = page.getByRole("button", { name: "Best of 3" });
  if ((await bestOf3Toggle.count()) === 0) return true;

  const gameSelect = bestOf3Toggle.locator("xpath=following-sibling::div//select").first();
  let hasGameSelect = await gameSelect.isVisible().catch(() => false);

  if (!hasGameSelect && !(await bestOf3Toggle.isDisabled())) {
    await bestOf3Toggle.click();
    hasGameSelect = await gameSelect.isVisible().catch(() => false);
  }

  if (!hasGameSelect) return true;

  await gameSelect.selectOption("2");
  await homeScoreInput.fill("21");
  await awayScoreInput.fill("18");

  return true;
}

export async function submitRefereeScoreForCourt(page: Page, params: {
  stage: Stage;
  court: string;
}) {
  await page.getByLabel("Stage").selectOption(params.stage);
  await page.waitForTimeout(50);
  await page.getByLabel("Court").selectOption(params.court);
  await page.waitForTimeout(50);

  const selected = await selectFirstMatch(page);
  if (!selected) return false;

  const scoresFilled = await fillRefereeScores(page);
  if (!scoresFilled) return false;

  await page.getByRole("button", { name: "Lock" }).click();
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page.getByText("Submitted")).toBeVisible();

  return true;
}
