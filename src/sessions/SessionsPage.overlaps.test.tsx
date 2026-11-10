import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SessionsPage } from "./SessionsPage";
import { overlapsFixture } from "./overlaps-fixture";

const overlapMocks = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("./overlaps-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./overlaps-api")>()),
  coordinationOverlaps: overlapMocks.load,
}));

beforeEach(() => {
  overlapMocks.load.mockReset();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith("/activity"))
        return new Response(JSON.stringify({ days: [] }));
      if (url.endsWith("/output"))
        return new Response(
          JSON.stringify({ output: null, unsupported: true }),
        );
      return new Response("{}", { status: 404 });
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

it("hides the Overlaps tab when the endpoint reports its disabled 404", async () => {
  overlapMocks.load.mockResolvedValue(null);
  render(
    <SessionsPage
      workspaceId="fake-workspace"
      initialQuery=""
      tab="activity"
      onSignedOut={() => undefined}
    />,
  );
  await waitFor(() => expect(overlapMocks.load).toHaveBeenCalledOnce());
  await waitFor(() =>
    expect(
      screen.queryByRole("link", { name: "Overlaps" }),
    ).not.toBeInTheDocument(),
  );
});

it("shows the Overlaps tab after the endpoint returns the contract", async () => {
  overlapMocks.load.mockResolvedValue({ report: overlapsFixture, members: [] });
  render(
    <SessionsPage
      workspaceId="fake-workspace"
      initialQuery=""
      tab="activity"
      onSignedOut={() => undefined}
    />,
  );
  expect(await screen.findByRole("link", { name: "Overlaps" })).toBeVisible();
});
