import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";

it.each([undefined, "false", "true"])("writes the Overlaps view gate as a strict boolean, off by default (%s)", (value) => {
  const directory = mkdtempSync(join(tmpdir(), "dashboard-overlaps-"));
  try {
    const env: NodeJS.ProcessEnv = { ...process.env, DASHBOARD_HTML_ROOT: directory };
    if (value === undefined) delete env.DASHBOARD_COORDINATION_OVERLAPS_ENABLED;
    else env.DASHBOARD_COORDINATION_OVERLAPS_ENABLED = value;
    execFileSync("sh", [resolve("docker/40-runtime-config.sh")], { env, stdio: "pipe" });
    const context = { window: {} as { __AGENT_RELAY_DASHBOARD_CONFIG__?: { coordinationOverlaps: unknown } } };
    runInNewContext(readFileSync(join(directory, "runtime-config.js"), "utf8"), context);
    expect(context.window.__AGENT_RELAY_DASHBOARD_CONFIG__?.coordinationOverlaps).toBe(value === "true");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

it.each(["", "yes", "TRUE", "1", " true ", "true\nfalse"])("refuses malformed Overlaps view config without replacing existing config (%j)", (value) => {
  const directory = mkdtempSync(join(tmpdir(), "dashboard-overlaps-"));
  const target = join(directory, "runtime-config.js");
  try {
    writeFileSync(target, "existing config");
    expect(() => execFileSync("sh", [resolve("docker/40-runtime-config.sh")], {
      env: { ...process.env, DASHBOARD_HTML_ROOT: directory, DASHBOARD_COORDINATION_OVERLAPS_ENABLED: value }, stdio: "pipe",
    })).toThrow();
    expect(readFileSync(target, "utf8")).toBe("existing config");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
