import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "../app";
import { FlowsApp } from "../flows/flows-app";
import { ChiefPage } from "../chief/chief-page";
import { getAccount } from "../api/client";
import { TokensSection } from "../admin/tokens";
import { adminApi } from "../admin/api";

vi.mock("../dashboard", () => ({ Dashboard: () => <p>Session workspace</p> }));
vi.mock("../flows/flows-app", async (original) => ({
  ...(await original<typeof import("../flows/flows-app")>()),
  FlowsApp: vi.fn(() => <p data-testid="flows-page">Flows workspace</p>),
}));
vi.mock("../chief/chief-page", () => ({
  ChiefPage: vi.fn(() => <p data-testid="chief-page">Chief workspace</p>),
}));
vi.mock("../api/client", async (original) => ({
  ...(await original<typeof import("../api/client")>()),
  getAccount: vi.fn(),
}));
vi.mock("../admin/api", async (original) => {
  const api = await original<typeof import("../admin/api")>();
  return {
    ...api,
    adminApi: { ...api.adminApi, listTokens: vi.fn(), createToken: vi.fn() },
  };
});

const OFF = { flows: false, chief: false, relayfile: false };
const response = (capabilities = OFF) =>
  new Response(JSON.stringify({ capabilities }));
const fetchMock = vi.fn();
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  window.history.replaceState(null, "", "/");
  window.localStorage.clear();
  fetchMock.mockReset().mockImplementation(async () => response());
  vi.stubGlobal("fetch", fetchMock);
  vi.mocked(getAccount).mockResolvedValue({
    authenticated: true,
    user: { id: "user", name: "Member" },
    currentWorkspace: { id: "workspace", name: "Workspace" },
  });
  vi.mocked(adminApi.listTokens).mockResolvedValue([]);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it.each([
  "#/flows",
  "#/flows/f/one",
  "#/flows/runs/one",
  "#/flows/workers/new",
  "#/flows?features=flows,chief",
  "#/chief",
  "#/chief/project",
])(
  "does not mount an off feature or show its navigation at %s",
  async (path) => {
    window.location.hash = path;
    window.localStorage.setItem("SELFHOST_FEATURES", "flows,chief");
    render(<App />);
    const label = path.startsWith("#/chief") ? "Chief" : "Flows";
    expect(
      await screen.findByRole("heading", { name: `${label} is not enabled` }),
    ).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Workspace views" });
    expect(within(nav).queryByRole("link", { name: "Flows" })).toBeNull();
    expect(within(nav).queryByRole("link", { name: "Chief" })).toBeNull();
    expect(FlowsApp).not.toHaveBeenCalled();
    expect(ChiefPage).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/cloud/api/v1/license",
    ]);
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
    });
  },
);

it("keeps feature navigation and pages closed while availability is pending", () => {
  fetchMock.mockReturnValue(new Promise(() => {}));
  window.location.hash = "#/flows";
  render(<App />);
  expect(screen.getByRole("status")).toHaveTextContent("Checking availability");
  expect(screen.queryByRole("link", { name: "Flows" })).toBeNull();
  expect(FlowsApp).not.toHaveBeenCalled();
});

it.each([
  [404, { error: "not_found" }],
  [503, { error: "private-server-detail" }],
  [200, { capabilities: { ...OFF, flows: "true" } }],
  [200, { capabilities: { flows: true } }],
])(
  "keeps an unavailable or malformed capability read closed (%s)",
  async (status, body) => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(body), { status: status as number }),
    );
    window.location.hash = "#/flows";
    render(<App />);
    expect(
      await screen.findByRole("heading", { name: "Flows is unavailable" }),
    ).toBeInTheDocument();
    expect(FlowsApp).not.toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: "Flows" })).toBeNull();
    expect(document.body.textContent).not.toContain("private-server-detail");
  },
);

it("shows Chief from its server capability independently of paid Flows", async () => {
  fetchMock.mockResolvedValue(response({ ...OFF, chief: true }));
  window.location.hash = "#/chief";
  render(<App />);
  expect(await screen.findByTestId("chief-page")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Chief" })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Flows" })).toBeNull();
  expect(FlowsApp).not.toHaveBeenCalled();
});

it("retries through the server rather than enabling a failed feature locally", async () => {
  fetchMock.mockRejectedValueOnce(new Error("offline"));
  window.location.hash = "#/flows";
  render(<App />);
  await screen.findByRole("heading", { name: "Flows is unavailable" });
  fetchMock.mockResolvedValueOnce(response({ ...OFF, flows: true }));
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByTestId("flows-page")).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("closes an active feature immediately on refresh, then honors revocation", async () => {
  fetchMock.mockResolvedValueOnce(response({ ...OFF, flows: true }));
  window.location.hash = "#/flows";
  render(<App />);
  await screen.findByTestId("flows-page");
  const pending = deferred<Response>();
  fetchMock.mockReturnValueOnce(pending.promise);
  fireEvent(window, new Event("focus"));
  expect(screen.queryByTestId("flows-page")).toBeNull();
  expect(screen.queryByRole("link", { name: "Flows" })).toBeNull();
  await act(async () => pending.resolve(response()));
  expect(
    await screen.findByRole("heading", { name: "Flows is not enabled" }),
  ).toBeInTheDocument();
});

it("does not let a stale earlier response restore an enabled feature", async () => {
  const old = deferred<Response>(),
    fresh = deferred<Response>();
  fetchMock.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
  window.location.hash = "#/flows";
  render(<App />);
  fireEvent(window, new Event("focus"));
  await act(async () => fresh.resolve(response()));
  await screen.findByRole("heading", { name: "Flows is not enabled" });
  await act(async () => old.resolve(response({ ...OFF, flows: true })));
  expect(screen.queryByTestId("flows-page")).toBeNull();
  expect(screen.queryByRole("link", { name: "Flows" })).toBeNull();
});

it("a timed-out read stays closed even if an ignored-abort response arrives late", async () => {
  vi.useFakeTimers();
  const pending = deferred<Response>();
  fetchMock.mockReturnValue(pending.promise);
  window.location.hash = "#/flows";
  render(<App />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(8_000);
  });
  expect(
    screen.getByRole("heading", { name: "Flows is unavailable" }),
  ).toBeInTheDocument();
  await act(async () => pending.resolve(response({ ...OFF, flows: true })));
  expect(FlowsApp).not.toHaveBeenCalled();
});

it("hides workflow token creation by default and refuses a stale selection after disablement", async () => {
  const view = render(<TokensSection workspaceId="workspace" />);
  await screen.findByLabelText("Purpose");
  expect(screen.queryByRole("option", { name: "Flows token" })).toBeNull();
  view.rerender(<TokensSection workspaceId="workspace" flowsEnabled />);
  fireEvent.change(screen.getByLabelText("Purpose"), {
    target: { value: "workflow" },
  });
  fireEvent.change(screen.getByLabelText("Expires"), {
    target: { value: "never" },
  });
  fireEvent.change(screen.getByLabelText("Name"), {
    target: { value: "worker" },
  });
  view.rerender(<TokensSection workspaceId="workspace" flowsEnabled={false} />);
  expect(screen.queryByRole("option", { name: "Flows token" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Create token" }));
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Flows is no longer enabled",
  );
  await waitFor(() => expect(adminApi.createToken).not.toHaveBeenCalled());
});
