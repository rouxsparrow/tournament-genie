import { execFileSync } from "child_process";
import path from "path";

export default async function globalSetup() {
  const seedScript = path.resolve(process.cwd(), "scripts/e2e-reset-seed.mjs");
  const scenario = process.env.E2E_SCENARIO ?? "existing-group";
  execFileSync("node", [seedScript], {
    stdio: "inherit",
    env: { ...process.env, E2E_SCENARIO: scenario },
  });
}
