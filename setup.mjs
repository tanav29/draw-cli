import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("cli.js", import.meta.resolve("playwright/package.json")));
const result = spawnSync(process.execPath, [cli, "install", "chromium", "--only-shell"], {
  env: { ...process.env, PLAYWRIGHT_SKIP_BROWSER_GC: "1" },
  stdio: "inherit",
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
