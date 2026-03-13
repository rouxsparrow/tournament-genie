import { expect, test } from "@playwright/test";
import { loginAsAdmin } from "./helpers/auth";

test("Group stage result uses a wide rotator with overflow scroll and manual controls @regression", async ({
  page,
}) => {
  await loginAsAdmin(page);
  await page.setViewportSize({ width: 1440, height: 720 });
  await page.goto("/group-stage-result");

  await expect(page.getByTestId("group-stage-rotator")).toBeVisible();
  await expect(page.getByTestId("current-category")).toContainText("MD");
  await expect(page.getByTestId("slide-indicator")).toHaveText("1 / 3");
  await expect(page.getByTestId("result-panel-MD")).toBeVisible();
  await expect(page.locator("[data-testid^='result-panel-']")).toHaveCount(1);

  const titleBox = await page.getByRole("heading", { name: "Group Stage Result" }).boundingBox();
  const controlsBox = await page.getByTestId("rotator-controls").boundingBox();
  expect(titleBox).not.toBeNull();
  expect(controlsBox).not.toBeNull();
  expect(Math.abs((titleBox?.y ?? 0) - (controlsBox?.y ?? 0))).toBeLessThan(12);

  const viewport = page.getByTestId("table-viewport");
  await expect(viewport).toBeVisible();
  await expect(page.getByTestId("table-header")).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Avg PD" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Avg PF" })).toBeVisible();
  const firstRow = page.locator("[data-testid^='result-row-MD-']").first();
  await expect(firstRow).toBeVisible();
  await expect(firstRow.locator("td").nth(4)).not.toHaveText("");
  await expect(firstRow.locator("td").nth(5)).not.toHaveText("");

  await page.waitForTimeout(4_500);
  const mdScrollTop = await viewport.evaluate((element) => element.scrollTop);
  expect(mdScrollTop).toBeGreaterThan(0);

  await page.getByRole("button", { name: "Pause" }).click();
  const pausedCategory = await page.getByTestId("current-category").textContent();
  const pausedScrollTop = await viewport.evaluate((element) => element.scrollTop);
  await page.waitForTimeout(2_500);
  await expect(page.getByTestId("current-category")).toHaveText(pausedCategory ?? "");
  const pausedScrollTopAfter = await viewport.evaluate((element) => element.scrollTop);
  expect(Math.abs(pausedScrollTopAfter - pausedScrollTop)).toBeLessThan(4);

  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByTestId("current-category")).toContainText("WD");
  await expect(page.getByTestId("slide-indicator")).toHaveText("2 / 3");
  const wdScrollTop = await viewport.evaluate((element) => element.scrollTop);
  expect(wdScrollTop).toBe(0);

  await page.getByRole("button", { name: "Previous" }).click();
  await expect(page.getByTestId("current-category")).toContainText("MD");
  await expect(page.getByTestId("slide-indicator")).toHaveText("1 / 3");
  const mdResetScrollTop = await viewport.evaluate((element) => element.scrollTop);
  expect(mdResetScrollTop).toBe(0);

  await page.getByRole("button", { name: "Play" }).click();
  await page.waitForTimeout(14_500);
  await expect(page.getByTestId("current-category")).toContainText("WD");
  await page.waitForTimeout(8_500);
  await expect(page.getByTestId("current-category")).toContainText("XD");
});
