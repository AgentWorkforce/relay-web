import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "../../src/app";
import { createFixtureFetch } from "./transport";

beforeEach(() => {
  window.__AGENT_RELAY_DASHBOARD_CONFIG__ = {
    appPath: "/preview/small/",
    sessionAgentNames: true,
    sessionShortSummaries: true,
    sessionReadApi: false,
  };
  vi.stubGlobal("fetch", createFixtureFetch("small", location.origin));
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete window.__AGENT_RELAY_DASHBOARD_CONFIG__;
});

it("renders team usage, people and a linked transcript in the production App", async () => {
  history.replaceState(null, "", "/preview/small/#/settings/usage");
  render(<App />);
  expect(
    (await screen.findAllByText("Sessions uploaded")).length,
  ).toBeGreaterThan(0);
  expect((await screen.findAllByText("Ana Silva")).length).toBeGreaterThan(0);
  await act(async () => {
    history.replaceState(
      null,
      "",
      "/preview/small/#/settings/usage/people/design-ana",
    );
    window.dispatchEvent(new Event("hashchange"));
  });
  await screen.findByRole("link", { name: /Move asset delivery to the edge/ });
  const link = screen.getByRole("link", {
    name: /Move asset delivery to the edge/,
  });
  fireEvent.click(link);
  expect(
    await screen.findByText(
      "Move asset delivery to the edge. Keep the existing cache invalidation behavior.",
    ),
  ).toBeInTheDocument();
  expect(
    await screen.findByText(
      "Routing is implemented and the focused tests pass. Staging validation is still pending.",
    ),
  ).toBeInTheDocument();
  await waitFor(() =>
    expect(
      screen.getByText(/Asset routing is implemented/),
    ).toBeInTheDocument(),
  );
});

it("keeps transcripts available when summary and timing coverage are absent", async () => {
  vi.stubGlobal("fetch", createFixtureFetch("partial", location.origin));
  history.replaceState(
    null,
    "",
    "/preview/partial/?session=design-session-1&source=codex",
  );
  render(<App />);
  expect(
    await screen.findByText(
      "Routing is implemented and the focused tests pass. Staging validation is still pending.",
    ),
  ).toBeInTheDocument();
  expect(
    screen.queryByText(/Asset routing is implemented/),
  ).not.toBeInTheDocument();
});
