/** Build normal packs; verify an installable artifact before publishing. */
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";

const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Run package preparation through npm pack or npm publish");

// The outer publish keeps --dry-run. Local verification must still create and
// install an actual tarball, including when rehearsing a release.
const env = { ...process.env };
delete env.NPM_CONFIG_DRY_RUN;
env.npm_config_dry_run = "false";
function npm(args) {
  const result = spawnSync(process.execPath, [npmCli, ...args], {
    env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

npm(["run", "build"]);
if (process.env.npm_command === "publish") {
  mkdirSync("artifacts", { recursive: true });
  // Avoid re-entering prepack or rebuilding the artifact being verified.
  npm(["pack", "--ignore-scripts", "--pack-destination", "artifacts"]);
  npm(["run", "verify:package"]);
}
