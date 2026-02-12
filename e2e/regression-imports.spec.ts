import { expect, test } from "@playwright/test";
import { loginAsAdmin } from "./helpers/auth";
import { closeDb } from "./helpers/db";

test.describe.configure({ mode: "serial" });

test.afterAll(async () => {
  await closeDb();
});

async function getWithRetry(
  page: import("@playwright/test").Page,
  path: string,
  attempts = 3
) {
  let lastResponse: import("@playwright/test").APIResponse | null = null;
  for (let i = 0; i < attempts; i += 1) {
    lastResponse = await page.request.get(path);
    if (lastResponse.status() === 200) return lastResponse;
    await page.waitForTimeout(300);
  }
  return lastResponse;
}

async function postImportCsv(page: import("@playwright/test").Page, path: string, filename: string, csv: string) {
  return page.evaluate(
    async ({ requestPath, fileName, content }) => {
      const formData = new FormData();
      formData.append("file", new File([content], fileName, { type: "text/csv" }));
      const response = await fetch(requestPath, { method: "POST", body: formData });
      const body = await response.json();
      return { status: response.status, body };
    },
    { requestPath: path, fileName: filename, content: csv }
  );
}

test("Import templates are reachable @regression", async ({ page }) => {
  await loginAsAdmin(page);

  const playersTemplate = await getWithRetry(page, "/api/templates/players.csv");
  if (!playersTemplate) {
    throw new Error("players template response is null");
  }
  expect(playersTemplate.status()).toBe(200);
  expect(await playersTemplate.text()).toContain("Player name,Gender");

  const teamsTemplate = await getWithRetry(page, "/api/templates/teams.csv");
  if (!teamsTemplate) {
    throw new Error("teams template response is null");
  }
  expect(teamsTemplate.status()).toBe(200);
  expect(await teamsTemplate.text()).toContain("Player 1,Player 2,Category");
});

test("Players import validation and dedupe @regression", async ({ page }) => {
  await loginAsAdmin(page);

  const missingHeaderResp = await postImportCsv(
    page,
    "/api/import/players",
    "players-missing.csv",
    "Name\nOnly Name\n"
  );
  expect([200, 400]).toContain(missingHeaderResp.status);
  const missingHeaderBody = missingHeaderResp.body;
  if (missingHeaderResp.status === 200) {
    expect(missingHeaderBody.errors[0].message).toContain("Missing required headers");
  } else {
    const errorText = String(missingHeaderBody.error ?? "");
    expect(
      errorText.includes("Unsupported file type") ||
        errorText.includes("delimiting character")
    ).toBe(true);
  }

  const dedupeResp = await postImportCsv(
    page,
    "/api/import/players",
    "players-dedupe.csv",
    "Name,Gender\nImport Runner,MALE\nimport runner,MALE\nUnique Runner,FEMALE\n"
  );
  expect(dedupeResp.status).toBe(200);
  const dedupeBody = dedupeResp.body;
  expect(dedupeBody.created).toBe(2);
  expect(dedupeBody.skipped).toBe(1);
});

test("Teams import validation @regression", async ({ page }) => {
  await loginAsAdmin(page);

  const prepPlayersResp = await postImportCsv(
    page,
    "/api/import/players",
    "players-prep.csv",
    "Name,Gender\nImport Mix Male,MALE\nImport Mix Female,FEMALE\n"
  );
  expect(prepPlayersResp.status).toBe(200);

  const missingPlayersResp = await postImportCsv(
    page,
    "/api/import/teams",
    "teams-missing.csv",
    "Player 1,Player 2,Category\nNobody One,Nobody Two,MD\n"
  );
  expect(missingPlayersResp.status).toBe(200);
  const missingPlayersBody = missingPlayersResp.body;
  expect(missingPlayersBody.errors[0].message).toContain("Both players must exist");

  const invalidCategoryRuleResp = await postImportCsv(
    page,
    "/api/import/teams",
    "teams-gender.csv",
    "Player 1,Player 2,Category\nImport Mix Male,Import Mix Female,MD\n"
  );
  expect(invalidCategoryRuleResp.status).toBe(200);
  const invalidCategoryRuleBody = invalidCategoryRuleResp.body;
  expect(invalidCategoryRuleBody.errors[0].message).toContain("Men's Doubles requires two male players");
});
