import { expect, test, type Page } from "@playwright/test";
import { loginAsAdmin } from "./helpers/auth";

async function readMatchCount(page: Page) {
  const text = (await page.getByTestId("knockout-match-count").textContent()) ?? "";
  const match = text.match(/\d+/);
  return match ? Number.parseInt(match[0], 10) : NaN;
}

function filterSelect(page: Page, label: string) {
  return page
    .locator("label", { hasText: label })
    .locator("..")
    .locator("select");
}

function filterInput(page: Page, label: string) {
  return page
    .locator("label", { hasText: label })
    .locator("..")
    .locator("input");
}

test("Knockout matches shows a filter-aware match count @regression", async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto("/matches?view=knockout");

  await expect(page.getByRole("heading", { name: "Matches", exact: true })).toBeVisible();
  await expect(page.getByTestId("knockout-match-count")).toBeVisible();

  const initialCards = page.getByTestId("knockout-match-card");
  const initialCardCount = await initialCards.count();
  await expect(page.getByTestId("knockout-match-count")).toHaveText(
    `${initialCardCount} match${initialCardCount === 1 ? "" : "es"}`
  );

  if (initialCardCount === 0) {
    await expect(page.getByText("No knockout matches found for this filter.")).toBeVisible();
    return;
  }

  const completedCards = page
    .getByTestId("knockout-match-card")
    .filter({ has: page.getByText("Completed", { exact: true }) });
  const scheduledCards = page
    .getByTestId("knockout-match-card")
    .filter({ has: page.getByText("Scheduled", { exact: true }) });

  const completedCount = await completedCards.count();
  const scheduledCount = await scheduledCards.count();

  let expectedCount = initialCardCount;
  let changed = false;

  if (completedCount > 0 && completedCount < initialCardCount) {
    await filterSelect(page, "Status").selectOption("COMPLETED");
    expectedCount = completedCount;
    changed = true;
  } else if (scheduledCount > 0 && scheduledCount < initialCardCount) {
    await filterSelect(page, "Status").selectOption("SCHEDULED");
    expectedCount = scheduledCount;
    changed = true;
  } else {
    const seriesOptions = await filterSelect(page, "Series").locator("option").evaluateAll((options) =>
      options.map((option) => ({ value: option.getAttribute("value"), label: option.textContent }))
    );

    for (const option of seriesOptions) {
      if (!option.value || option.value === "ALL") continue;
      await filterSelect(page, "Series").selectOption(option.value);
      const filteredCount = await page.getByTestId("knockout-match-card").count();
      if (filteredCount !== initialCardCount) {
        expectedCount = filteredCount;
        changed = true;
        break;
      }
    }
  }

  if (!changed) {
    const roundOptions = await filterSelect(page, "Round").locator("option").evaluateAll((options) =>
      options.map((option) => option.getAttribute("value")).filter(Boolean)
    );
    for (const option of roundOptions) {
      if (!option || option === "ALL") continue;
      await filterSelect(page, "Round").selectOption(option);
      const filteredCount = await page.getByTestId("knockout-match-card").count();
      if (filteredCount !== initialCardCount) {
        expectedCount = filteredCount;
        changed = true;
        break;
      }
    }
  }

  if (!changed) {
    const firstCardText = await page.getByTestId("knockout-match-card").first().textContent();
    const firstTeam = firstCardText
      ?.split("Vs.")[0]
      ?.trim()
      ?.split("\n")
      ?.pop()
      ?.trim();
    if (firstTeam) {
      await filterInput(page, "Search by player").fill(firstTeam);
      expectedCount = await page.getByTestId("knockout-match-card").count();
      changed = expectedCount !== initialCardCount;
    }
  }

  expect(changed).toBe(true);
  expect(await readMatchCount(page)).toBe(expectedCount);
  expect(await page.getByTestId("knockout-match-card").count()).toBe(expectedCount);

  if (expectedCount === 0) {
    await expect(page.getByText("No knockout matches found for this filter.")).toBeVisible();
  }
});
