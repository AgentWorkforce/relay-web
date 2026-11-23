import { expect, it, vi } from "vitest";
import {
  installPreviewBridge,
  previewDataEntry,
  validPreviewRoute,
} from "./preview-navigation";

it("reports push, replace and hash navigation and restores the original history methods", () => {
  history.replaceState(null, "", "/preview/small/");
  const push = history.pushState;
  const replace = history.replaceState;
  const report = vi.fn();
  const theme = vi.fn();
  const stop = installPreviewBridge(window, report, theme);
  try {
    history.pushState(
      null,
      "",
      "/preview/small/?session=design-session-1&source=codex",
    );
    expect(report).toHaveBeenLastCalledWith(
      "/preview/small/?session=design-session-1&source=codex",
    );
    history.replaceState(null, "", "/preview/small/?q=cache");
    expect(report).toHaveBeenLastCalledWith("/preview/small/?q=cache");
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: location.origin,
        source: window.parent,
        data: { type: "design-theme", preference: "light" },
      }),
    );
    expect(theme).toHaveBeenCalledWith("light");
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: "https://outside.example.test",
        source: window.parent,
        data: { type: "design-theme", preference: "dark" },
      }),
    );
    expect(theme).toHaveBeenCalledTimes(1);
  } finally {
    stop();
  }
  expect(history.pushState).toBe(push);
  expect(history.replaceState).toBe(replace);
});

it("validates frame routes and identifies their data domain", () => {
  expect(
    validPreviewRoute("https://outside.example.test/preview/small/", "small"),
  ).toBeNull();
  expect(validPreviewRoute("/preview/busy/", "small")).toBeNull();
  expect(validPreviewRoute("/preview/small/../../login", "small")).toBeNull();
  expect(previewDataEntry("/preview/small/?session=s1&source=codex")).toBe(
    "events",
  );
  expect(
    previewDataEntry("/preview/small/#/settings/usage/people/design-ana"),
  ).toBe("people");
  expect(previewDataEntry("/preview/small/#/settings/usage")).toBe("usage");
});
