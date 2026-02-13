import { expect, type Locator, type Page, test } from "@playwright/test";
import { loginAsAdmin } from "./helpers/auth";

const COURT_LABELS = ["P5", "P6", "P7", "P8", "P9"] as const;

function courtCard(page: Page, courtLabel: string): Locator {
  const heading = page.getByRole("heading", { name: courtLabel, exact: true }).first();
  return heading.locator("xpath=ancestor::div[contains(@class,'rounded-xl')][1]");
}

async function isCourtEmpty(page: Page, courtLabel: string) {
  return (await courtCard(page, courtLabel).getByText("No match assigned.").count()) > 0;
}

async function ensureAutoScheduleOff(page: Page) {
  const button = page.getByRole("button", { name: /Auto Schedule/i });
  await expect(button).toBeVisible();
  const text = (await button.textContent()) ?? "";
  if (text.includes("ON")) {
    await button.click();
    await expect(page.getByRole("button", { name: /Auto Schedule OFF/i })).toBeVisible();
  }
}

async function pickTargetCourt(page: Page) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    for (const label of COURT_LABELS) {
      const card = courtCard(page, label);
      const assignButton = card.getByRole("button", { name: "Assign Next" });
      if ((await isCourtEmpty(page, label)) && (await assignButton.isEnabled())) {
        return label;
      }
    }

    for (const label of COURT_LABELS) {
      const card = courtCard(page, label);
      const backButton = card.getByRole("button", { name: "Back to Queue" });
      if (!(await backButton.isEnabled())) continue;
      await backButton.click();
      await expect(card.getByText("No match assigned.")).toBeVisible({ timeout: 10_000 });
      const assignButton = card.getByRole("button", { name: "Assign Next" });
      if (await assignButton.isEnabled()) return label;
    }

    await page.waitForTimeout(500);
  }
  throw new Error(
    "No assignable group-stage match available in current event data."
  );
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
  if (vsIndex > 0 && vsIndex < lines.length - 1) {
    return {
      home: lines[vsIndex - 1] ?? "",
      away: lines[vsIndex + 1] ?? "",
    };
  }
  throw new Error(`Unable to parse assigned teams from court card text: ${rawText}`);
}

async function assignNextOnCourt(page: Page, courtLabel: string) {
  const card = courtCard(page, courtLabel);
  const assignButton = card.getByRole("button", { name: "Assign Next" });
  if (!(await assignButton.isEnabled())) {
    throw new Error("No assignable group-stage match available in current event data.");
  }
  await assignButton.click();

  const modal = page
    .locator("div.fixed.inset-0")
    .filter({ hasText: `Assign match to ${courtLabel}` })
    .first();
  await expect(modal).toBeVisible();

  const select = modal.locator("select").first();
  await expect(select).toBeVisible();
  const options = select.locator("option:not([disabled])");
  const optionCount = await options.count();
  if (optionCount === 0) {
    await modal.getByRole("button", { name: "Close" }).click();
    throw new Error("No assignable group-stage match available in current event data.");
  }

  const optionValues: string[] = [];
  for (let index = 0; index < optionCount; index += 1) {
    const optionValue = await options.nth(index).getAttribute("value");
    if (optionValue) optionValues.push(optionValue);
  }
  if (optionValues.length === 0) {
    await modal.getByRole("button", { name: "Close" }).click();
    throw new Error("No assignable group-stage match available in current event data.");
  }

  let assigned = false;
  for (const value of optionValues) {
    await select.selectOption(value);
    const confirmButton = modal.getByRole("button", { name: "Confirm assignment" });
    if (!(await confirmButton.isEnabled())) {
      continue;
    }
    await confirmButton.click();
    try {
      await expect(modal).toBeHidden({ timeout: 2_000 });
      assigned = true;
      break;
    } catch {
      // Option may fail due live in-play changes; try the next one.
    }
  }

  if (!assigned) {
    throw new Error("No assignable group-stage match available in current event data.");
  }

  await expect(card.getByText("No match assigned.")).toHaveCount(0, { timeout: 5_000 });

  const cardText = await card.innerText();
  return parseAssignedTeams(cardText);
}

test("Broadcast updates via realtime when admin assigns on empty court @broadcast-realtime", async ({
  browser,
}) => {
  const operatorContext = await browser.newContext();
  const observerContext = await browser.newContext();
  const operatorPage = await operatorContext.newPage();
  const observerPage = await observerContext.newPage();

  await loginAsAdmin(operatorPage);
  await loginAsAdmin(observerPage);

  await operatorPage.goto("/schedule?stage=group");
  await observerPage.goto("/broadcast?stage=group");

  await ensureAutoScheduleOff(operatorPage);
  const targetCourt = await pickTargetCourt(operatorPage);
  const assignedTeams = await assignNextOnCourt(operatorPage, targetCourt);

  const broadcastCard = courtCard(observerPage, targetCourt);
  await expect(broadcastCard.getByText(assignedTeams.home, { exact: false })).toBeVisible({
    timeout: 15_000,
  });
  await expect(broadcastCard.getByText(assignedTeams.away, { exact: false })).toBeVisible({
    timeout: 15_000,
  });

  await operatorContext.close();
  await observerContext.close();
});
