import { afterEach, expect, it, vi } from "vitest";
import { activityWindow } from "../../src/sessions/ActivityPanel";
import { sessionActivity } from "../../src/sessions/api";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("keeps newly opened previews populated when the browser date is years later", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2035-07-18T08:00:00Z"));
  const { createFixtureFetch } = await import("./transport");
  const { fixtureClock, workspace } = await import("./scenarios");
  vi.stubGlobal("fetch", createFixtureFetch("busy", location.origin));
  expect(fixtureClock).toBe("2035-07-18T12:00:00.000Z");
  const activity = await sessionActivity(
    workspace.id,
    activityWindow(7),
    new AbortController().signal,
  );
  expect(
    activity.reduce((n, day) => n + day.conversations, 0),
  ).toBeGreaterThanOrEqual(30);
});
