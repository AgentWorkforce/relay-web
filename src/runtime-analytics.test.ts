import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";

it.each([undefined, "false", "true"])("writes analytics as an explicit boolean, off by default (%s)", value => {
  const directory = mkdtempSync(join(tmpdir(), "dashboard-analytics-"));
  try {
    const env: NodeJS.ProcessEnv = { ...process.env, DASHBOARD_HTML_ROOT: directory };
    if (value === undefined) delete env.DASHBOARD_ANALYTICS_ENABLED;
    else env.DASHBOARD_ANALYTICS_ENABLED = value;
    execFileSync("sh", [resolve("docker/40-runtime-config.sh")], { env, stdio: "pipe" });
    const context = { window: {} as { __AGENT_RELAY_DASHBOARD_CONFIG__?: { analyticsEnabled: unknown } } };
    runInNewContext(readFileSync(join(directory, "runtime-config.js"), "utf8"), context);
    expect(context.window.__AGENT_RELAY_DASHBOARD_CONFIG__?.analyticsEnabled).toBe(value === "true");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
it.each(["1", "yes", "TRUE", "https://analytics.example", "false\ntrue"])("refuses malformed analytics opt-in (%s)", value => {
  const directory = mkdtempSync(join(tmpdir(), "dashboard-analytics-"));
  try {
    expect(() => execFileSync("sh", [resolve("docker/40-runtime-config.sh")], { env: { ...process.env, DASHBOARD_HTML_ROOT: directory, DASHBOARD_ANALYTICS_ENABLED: value }, stdio: "pipe" })).toThrow();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
