import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SessionsPage } from "./SessionsPage";
import { sessionIntelFixture } from "./session-intel-fixture";

const intelMocks = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("./session-intel-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./session-intel-api")>()),
  sessionIntelWorkspace: intelMocks.load,
}));

beforeEach(() => {
  intelMocks.load.mockReset();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith("/activity"))
        return new Response(JSON.stringify({ days: [] }));
      if (url.endsWith("/output"))
        return new Response(JSON.stringify({ output: null, unsupported: true }));
      return new Response("{}", { status: 404 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

const page = (tab: "activity" | "intel") => (
  <SessionsPage
    workspaceId="fake-workspace"
    initialQuery=""
    tab={tab}
    onSignedOut={() => undefined}
  />
);

it("hides the Session intelligence tab when the view is off or answers 501", async () => {
  intelMocks.load.mockResolvedValue(null);
  render(page("activity"));
  await waitFor(() => expect(intelMocks.load).toHaveBeenCalledOnce());
  await waitFor(() =>
    expect(
      screen.queryByRole("link", { name: "Session intelligence" }),
    ).not.toBeInTheDocument(),
  );
});

it("leaves an opened Session intelligence tab once it is unavailable", async () => {
  intelMocks.load.mockResolvedValue(null);
  window.history.replaceState(null, "", "/?tab=intel");
  render(page("intel"));
  await waitFor(() => expect(window.location.search).toBe(""));
  expect(screen.queryByRole("heading", { name: "Alerts" })).not.toBeInTheDocument();
});

it("shows the tab and the view after the endpoint returns the contract", async () => {
  intelMocks.load.mockResolvedValue(sessionIntelFixture);
  render(page("intel"));
  expect(
    await screen.findByRole("link", { name: "Session intelligence" }),
  ).toHaveAttribute("aria-current", "page");
  expect(await screen.findByRole("heading", { name: "Alerts" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "Live status" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "Handoffs" })).toBeVisible();
});
