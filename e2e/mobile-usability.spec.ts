import { expect, test } from "@playwright/test";
import { loginAsAdmin } from "./helpers/auth";
import {
  closeDb,
  countTestRefereeAccountsByPrefix,
  createTestRefereeAccount,
  deleteTestRefereeAccountsByPrefix,
} from "./helpers/db";

const TEST_REF_PREFIX = `test_ref_mobile_${Date.now()}`;
const TEST_REF_PASSWORD = "TestRefPass123!";

test.afterEach(async () => {
  await deleteTestRefereeAccountsByPrefix(TEST_REF_PREFIX);
  const remaining = await countTestRefereeAccountsByPrefix(TEST_REF_PREFIX);
  expect(remaining).toBe(0);
});

test.afterAll(async () => {
  await deleteTestRefereeAccountsByPrefix(TEST_REF_PREFIX);
  await closeDb();
});

test("Schedule and referee controls are usable on mobile @regression @mobile", async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto("/schedule");

  await expect(page.getByRole("heading", { name: "Schedule" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Live Courts/i })).toBeVisible();
  await expect(page.getByRole("button", { name: "Queue", exact: true })).toBeVisible();

  const referee = await createTestRefereeAccount({
    prefix: TEST_REF_PREFIX,
    password: TEST_REF_PASSWORD,
  });

  await page.goto("/referee");
  await expect(page.getByRole("heading", { name: "Referee Login" })).toBeVisible();
  await page.getByLabel("Username").fill(referee.username);
  await page.getByLabel("Password").fill(TEST_REF_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByRole("heading", { name: "Referee Scoresheet" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Lock" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Submit" })).toBeVisible();
});
