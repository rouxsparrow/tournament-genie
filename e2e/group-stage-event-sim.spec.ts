import { mkdir } from "fs/promises";
import path from "path";
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { loginAsAdmin } from "./helpers/auth";
import {
  closeDb,
  getGroupSimulationCourtLabels,
  getGeneratedGroupMatchesByCategory,
  getGroupProgress,
  getGroupStagePreconditions,
} from "./helpers/db";
import { MetricsCollector } from "./helpers/metrics";

const MAX_REFEREE_LANES = 5;

const MAX_ITERATIONS = 200;
const MAX_STALLED_ITERATIONS = 20;
const STEP_ACTION_TIMEOUT_MS = 15_000;
const COURT_LABELS: Record<string, string> = {
  C1: "P5",
  C2: "P6",
  C3: "P7",
  C4: "P8",
  C5: "P9",
};

type TeamPair = { home: string; away: string };

type RefereeLane = {
  context: BrowserContext;
  page: Page;
  courtLabel: string;
};

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toUiCourtLabel(courtId: string) {
  return COURT_LABELS[courtId] ?? courtId;
}

function courtCard(page: Page, courtLabel: string) {
  const heading = page.getByRole("heading", { name: courtLabel, exact: true }).first();
  return heading.locator("xpath=ancestor::div[contains(@class,'rounded-xl')][1]");
}

async function cardHasAssignedMatch(card: Locator) {
  return (await card.getByText("No match assigned.").count()) === 0;
}

function parseTeamsFromCardText(rawText: string): TeamPair | null {
  const lines = rawText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const directLine = lines.find((line) => /\svs\s/i.test(line));
  if (directLine) {
    const parts = directLine.split(/\s+vs\s+/i);
    if (parts.length === 2) {
      return { home: parts[0].trim(), away: parts[1].trim() };
    }
  }

  const vsIndex = lines.findIndex((line) => line.toLowerCase() === "vs");
  if (vsIndex > 0 && vsIndex < lines.length - 1) {
    return {
      home: lines[vsIndex - 1] ?? "",
      away: lines[vsIndex + 1] ?? "",
    };
  }
  return null;
}

async function getAssignedTeamsFromCourt(page: Page, courtLabel: string) {
  const card = courtCard(page, courtLabel);
  if (!(await cardHasAssignedMatch(card))) return null;
  const text = await card.innerText();
  return parseTeamsFromCardText(text);
}

async function ensureAutoScheduleOff(adminPage: Page) {
  const autoButton = adminPage.getByRole("button", { name: /Auto Schedule/i });
  await expect(autoButton).toBeVisible();
  const label = (await autoButton.textContent()) ?? "";
  if (label.includes("ON")) {
    await autoButton.click();
    await expect(adminPage.getByRole("button", { name: /Auto Schedule OFF/i })).toBeVisible();
  }
}

async function assignNextIfPossible(adminPage: Page, courtLabel: string) {
  const card = courtCard(adminPage, courtLabel);
  const assignBtn = card.getByRole("button", { name: "Assign Next" });
  if (!(await assignBtn.isEnabled())) return false;

  await assignBtn.click();

  const modal = adminPage
    .locator("div.fixed.inset-0")
    .filter({ hasText: `Assign match to ${courtLabel}` })
    .first();
  await expect(modal).toBeVisible();

  const select = modal.locator("select").first();
  await expect(select).toBeVisible();
  const enabledOptions = select.locator("option:not([disabled])");
  if ((await enabledOptions.count()) === 0) {
    await modal.getByRole("button", { name: "Close" }).click();
    return false;
  }

  const selectedValue = await enabledOptions.first().getAttribute("value");
  if (!selectedValue) {
    await modal.getByRole("button", { name: "Close" }).click();
    return false;
  }

  await select.selectOption(selectedValue);
  await modal.getByRole("button", { name: "Confirm assignment" }).click();
  await expect(modal).toBeHidden();

  await adminPage.waitForTimeout(200);
  return cardHasAssignedMatch(card);
}

async function waitForNotificationForCourt(
  adminPage: Page,
  courtLabel: string,
  timeoutMs = 12_000
) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const card = adminPage
      .locator("div.rounded-lg.border.p-3")
      .filter({ hasText: `Court ${courtLabel}` })
      .first();
    const unread = card.getByRole("button", { name: "Mark as read" });
    if ((await unread.count()) > 0) return unread;
    await adminPage.waitForTimeout(300);
  }
  return null;
}

async function markUnreadNotificationForCourt(adminPage: Page, courtLabel: string) {
  const button = await waitForNotificationForCourt(adminPage, courtLabel);
  if (!button) return false;
  await button.click();
  await adminPage.waitForTimeout(200);
  await adminPage.reload({ waitUntil: "domcontentloaded" });
  return true;
}

async function selectRefereeMatch(page: Page, teams: TeamPair, courtLabel: string) {
  await page.reload({ waitUntil: "domcontentloaded" });

  const courtSelect = page
    .locator("label", { hasText: "Court" })
    .locator("xpath=following-sibling::select[1]");
  await expect(courtSelect).toBeVisible();
  await courtSelect.selectOption(courtLabel);
  const matchContainer = page.locator("label", { hasText: "Match" }).locator("..");
  const trigger = matchContainer.getByRole("combobox");
  if (!(await trigger.isEnabled())) {
    return false;
  }
  await trigger.click();
  const option = page.getByRole("option", {
    name: new RegExp(
      `${escapeRegExp(teams.home)}[\\s\\S]*vs\\.?[\\s\\S]*${escapeRegExp(teams.away)}`,
      "i"
    ),
  });
  if ((await option.count()) === 0) {
    await page.keyboard.press("Escape");
    return false;
  }
  await option.first().click();
  return true;
}

async function submitScoreFromReferee(page: Page, teams: TeamPair, courtLabel: string) {
  const selected = await selectRefereeMatch(page, teams, courtLabel);
  if (!selected) return false;

  await page.getByLabel("Home score").fill("21");
  await page.getByLabel("Away score").fill("15");
  const lockButton = page.getByRole("button", { name: /^Lock$/ });
  if ((await lockButton.count()) > 0) {
    await lockButton.click();
  }
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page.getByText("Submitted")).toBeVisible();
  return true;
}

async function createRefereeLane(
  browser: Browser,
  courtLabel: string,
  passcode: string
) {
  const context = await browser.newContext();
  await context.addInitScript(
    ({ code }) => {
      window.localStorage.setItem("referee:passcode", code);
    },
    { code: passcode }
  );
  const page = await context.newPage();
  return { context, page, courtLabel } satisfies RefereeLane;
}

async function saveDeadlockDiagnostics(adminPage: Page, refereeLanes: RefereeLane[]) {
  const dir = path.resolve(process.cwd(), "test-results", "metrics");
  await mkdir(dir, { recursive: true });
  await adminPage.screenshot({ path: path.join(dir, "group-event-admin-deadlock.png"), fullPage: true });
  for (const lane of refereeLanes) {
    await lane.page.screenshot({
      path: path.join(dir, `group-event-ref-${lane.courtLabel}-deadlock.png`),
      fullPage: true,
    });
  }
}

test.describe.configure({ mode: "serial" });

test.afterAll(async () => {
  await closeDb();
});

test("Group stage real-life event simulation (admin + 5 referees, auto off) @event-group @regression", async ({
  browser,
  page: adminPage,
}) => {
  test.setTimeout(20 * 60_000);

  const metrics = new MetricsCollector();
  const passcode =
    process.env.E2E_REFEREE_CODE ??
    process.env.Referee_code ??
    process.env.REFEREE_CODE ??
    "1234";

  const preconditions = await getGroupStagePreconditions();
  expect(preconditions.schedulableGroupMatches).toBeGreaterThan(0);
  const lockedCategoryCodes = preconditions.assignmentLocks
    .filter((lock) => lock.locked)
    .map((lock) => lock.categoryCode);
  expect(lockedCategoryCodes.length).toBeGreaterThan(0);

  const generatedMatchesByCategory = await getGeneratedGroupMatchesByCategory(
    lockedCategoryCodes
  );
  // Validate group-stage matches exist for every locked category.
  for (const code of lockedCategoryCodes) {
    expect(generatedMatchesByCategory[code]).toBeGreaterThan(0);
  }

  const courtIds = await getGroupSimulationCourtLabels(MAX_REFEREE_LANES);
  expect(courtIds.length).toBeGreaterThan(0);
  const laneLabels = courtIds.slice(0, MAX_REFEREE_LANES).map((courtId) => toUiCourtLabel(courtId));

  await metrics.time("T_schedule_nav", async () => {
    await loginAsAdmin(adminPage);
    await adminPage.goto("/schedule?stage=group", { waitUntil: "domcontentloaded" });
    await expect(adminPage.getByRole("heading", { name: "Schedule" })).toBeVisible();
    await expect(adminPage.getByRole("heading", { name: "Playing" })).toBeVisible();
  });
  adminPage.setDefaultTimeout(STEP_ACTION_TIMEOUT_MS);

  await ensureAutoScheduleOff(adminPage);
  await adminPage.getByRole("button", { name: "Live Courts", exact: true }).click();

  const refereeLanes: RefereeLane[] = [];
  for (const courtLabel of laneLabels) {
    const refereeLane = await createRefereeLane(browser, courtLabel, passcode);
    refereeLanes.push(refereeLane);
    await metrics.time(
      "T_referee_nav",
      async () => {
        await refereeLane.page.goto("/referee", { waitUntil: "domcontentloaded" });
        await expect(
          refereeLane.page.getByRole("heading", { name: "Referee Scoresheet" })
        ).toBeVisible();
      },
      { court: courtLabel }
    );
    refereeLane.page.setDefaultTimeout(STEP_ACTION_TIMEOUT_MS);
  }

  let iterations = 0;
  let stalledIterations = 0;
  let lastCompleted = -1;

  while (iterations < MAX_ITERATIONS) {
    iterations += 1;
    const progress = await getGroupProgress();
    if (iterations === 1 || iterations % 5 === 0) {
      console.log("[group-stage-event-sim] progress", {
        iterations,
        scheduled: progress.scheduled,
        completed: progress.completed,
        activeAssignments: progress.activeAssignments,
      });
    }
    if (progress.scheduled === 0 && progress.activeAssignments === 0) {
      break;
    }

    let cycleProgress = 0;
    for (const courtLabel of laneLabels) {
      const cycleStarted = Date.now();
      const laneReferee = refereeLanes.find((entry) => entry.courtLabel === courtLabel);
      if (!laneReferee) continue;
      console.log("[group-stage-event-sim] lane", {
        iterations,
        court: courtLabel,
        phase: "start",
      });

      const card = courtCard(adminPage, courtLabel);
      if (!(await cardHasAssignedMatch(card))) {
        await metrics.time("T_assign_step", async () => {
          const assigned = await assignNextIfPossible(adminPage, courtLabel);
          if (!assigned) {
            metrics.increment("wait_cycles");
            await adminPage.waitForTimeout(250);
          }
        }, { court: courtLabel });
      }

      const teams = await getAssignedTeamsFromCourt(adminPage, courtLabel);
      if (!teams?.home || !teams.away) {
        console.log("[group-stage-event-sim] lane", {
          iterations,
          court: courtLabel,
          phase: "skip-no-assigned-teams",
        });
        continue;
      }

      const submitted = await metrics.time(
        "T_submit_step",
        async () => {
          console.log("[group-stage-event-sim] lane", {
            iterations,
            court: courtLabel,
            phase: "referee-submit",
            teams,
          });
          return submitScoreFromReferee(laneReferee.page, teams, courtLabel);
        },
        { court: courtLabel }
      );
      if (!submitted) {
        console.log("[group-stage-event-sim] lane", {
          iterations,
          court: courtLabel,
          phase: "referee-not-ready",
        });
        metrics.increment("wait_cycles");
        await adminPage.waitForTimeout(300);
        continue;
      }

      const notiStarted = Date.now();
      const markedRead = await metrics.time(
        "T_mark_read",
        async () => markUnreadNotificationForCourt(adminPage, courtLabel),
        { court: courtLabel }
      );
      metrics.addSample("T_noti_latency", Date.now() - notiStarted, { court: courtLabel });

      if (!markedRead) {
        metrics.increment("wait_cycles");
        await adminPage.waitForTimeout(300);
        continue;
      }

      metrics.addSample("T_cycle", Date.now() - cycleStarted, { court: courtLabel });
      metrics.increment("matches_processed");
      cycleProgress += 1;
    }

    const progressAfter = await getGroupProgress();
    if (progressAfter.completed > lastCompleted) {
      lastCompleted = progressAfter.completed;
      stalledIterations = 0;
    } else {
      stalledIterations += 1;
    }

    if (cycleProgress === 0) {
      metrics.increment("idle_iterations");
      await adminPage.waitForTimeout(400);
    }

    if (stalledIterations >= MAX_STALLED_ITERATIONS) {
      await saveDeadlockDiagnostics(adminPage, refereeLanes);
      const reportPath = await metrics.writeJson("group-stage-event-sim", {
        reason: "deadlock_detected",
        iterations,
      });
      throw new Error(`No progress for ${MAX_STALLED_ITERATIONS} iterations. Metrics: ${reportPath}`);
    }
  }

  const finalProgress = await getGroupProgress();
  expect(finalProgress.scheduled).toBe(0);
  expect(finalProgress.activeAssignments).toBe(0);

  for (const courtLabel of laneLabels) {
    await expect(courtCard(adminPage, courtLabel).getByText("No match assigned.")).toBeVisible();
  }

  const totalRunMs = metrics.getTotalRunMs();
  const matchesProcessed = metrics.getCounter("matches_processed");
  const throughputPerMin = matchesProcessed > 0 ? (matchesProcessed / totalRunMs) * 60_000 : 0;
  metrics.addSample("T_total_run", totalRunMs);

  const reportPath = await metrics.writeJson("group-stage-event-sim", {
    totals: {
      iterations,
      matchesProcessed,
      throughputPerMin,
      waitCycles: metrics.getCounter("wait_cycles"),
      idleIterations: metrics.getCounter("idle_iterations"),
    },
  });
  metrics.printSummary();
  console.log("[group-stage-event-sim] metrics:", {
    reportPath,
    iterations,
    matchesProcessed,
    throughputPerMin,
    waitCycles: metrics.getCounter("wait_cycles"),
  });

  for (const lane of refereeLanes) {
    await lane.context.close();
  }
});
