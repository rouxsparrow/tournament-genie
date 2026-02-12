import { expect, test } from "@playwright/test";
import { loginAsAdmin } from "./helpers/auth";
import {
  closeDb,
  getKnockoutMatchIds,
  getSeriesAQualifierTeamIds,
  getTop8GlobalRankingTeamIds,
  seedSeriesAQualifiersFromTop8,
  setGroupStageLock,
  setSecondChanceEnabled,
} from "./helpers/db";

test.describe.configure({ mode: "serial" });

test.afterAll(async () => {
  await closeDb();
});

test("Group stage lock enforcement @regression", async ({ page }) => {
  await loginAsAdmin(page);
  await setGroupStageLock("MD", false);

  const response = await page.request.post("/api/knockout/generate-full", {
    data: { category: "MD" },
  });

  expect(response.status()).toBe(400);
  const body = await response.json();
  expect(body.error).toBe("GROUP_STAGE_UNLOCKED");
});

test("Group-to-knockout boundary top-8 only @regression", async ({ page }) => {
  await loginAsAdmin(page);
  await setGroupStageLock("MD", true);
  await seedSeriesAQualifiersFromTop8("MD");

  const seriesAIds = await getSeriesAQualifierTeamIds("MD");
  const top8 = await getTop8GlobalRankingTeamIds("MD");

  expect(seriesAIds.length).toBe(8);
  expect([...seriesAIds].sort()).toEqual([...top8].sort());
});

test("Knockout generation idempotency @regression", async ({ page }) => {
  await loginAsAdmin(page);
  await setGroupStageLock("MD", true);
  await setSecondChanceEnabled("MD", false);
  await seedSeriesAQualifiersFromTop8("MD");

  const first = await page.request.post("/api/knockout/generate-full", {
    data: { category: "MD" },
  });
  expect(first.status()).toBe(200);

  const firstIds = await getKnockoutMatchIds("MD");
  expect(firstIds.length).toBeGreaterThan(0);

  const second = await page.request.post("/api/knockout/generate-full", {
    data: { category: "MD" },
  });
  expect(second.status()).toBe(409);

  const clear = await page.request.delete("/api/knockout/clear?category=MD");
  expect(clear.status()).toBe(200);

  const third = await page.request.post("/api/knockout/generate-full", {
    data: { category: "MD" },
  });
  expect(third.status()).toBe(200);

  const secondIds = await getKnockoutMatchIds("MD");
  expect(secondIds.length).toBeGreaterThan(0);
  expect(secondIds.some((id) => firstIds.includes(id))).toBe(false);
});

test("Viewer permission boundaries @regression", async ({ page, request }) => {
  await page.goto("/utilities");
  await expect(page).toHaveURL(/\/presenting/);

  await page.goto("/schedule");
  await expect(page).toHaveURL(/\/presenting/);

  const generate = await request.post("/api/knockout/generate-full", {
    data: { category: "MD" },
  });
  expect(generate.status()).toBe(401);

  const clear = await request.delete("/api/knockout/clear?category=MD");
  expect(clear.status()).toBe(401);

  const playersCsv = Buffer.from("Name,Gender\nViewer Import,MALE\n");
  const playersImport = await request.post("/api/import/players", {
    multipart: {
      file: {
        name: "players.csv",
        mimeType: "text/csv",
        buffer: playersCsv,
      },
    },
  });
  expect(playersImport.status()).toBe(401);
});
