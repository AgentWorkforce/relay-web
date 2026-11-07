import { beforeEach, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { ChiefPage } from "./chief-page";
import { RepositoryPicker } from "./repository-picker";

let role = "owner";
let chiefs: unknown[] = [];
const creates: unknown[] = [];
let catalog = {
  connected: true,
  repositories: [
    { id: "1", fullName: "acme/portal", private: true },
    { id: "2", fullName: "acme/backend", private: false },
  ],
};
let catalogFailure = false;
const snapshot = {
  id: "chief-1",
  name: "Portal",
  repository: "acme/portal",
  mode: "plan_only",
  status: "awaiting_approval",
  scanStatus: "idle",
  createdAt: "2026-11-07T00:00:00Z",
  lastScanAt: null,
  region: "us-east-1",
  budgetDollars: 10,
  maxConcurrentTasks: 2,
  allowedActions: ["unblock"],
  accounting: {
    knownCostMicros: 0,
    unknownCostEvents: 0,
    events: 0,
    committedReservationMicros: 0,
  },
  tasks: [],
  decisions: [],
  setupSteps: [{ label: "Project and policy saved", complete: true }],
};
beforeEach(() => {
  role = "owner";
  chiefs = [];
  creates.length = 0;
  catalog = {
    connected: true,
    repositories: [
      { id: "1", fullName: "acme/portal", private: true },
      { id: "2", fullName: "acme/backend", private: false },
    ],
  };
  catalogFailure = false;
  window.location.hash = "#/chief/new";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, options?: RequestInit) => {
      const path = String(url);
      let body: unknown;
      if (path.includes("/auth/session"))
        body = {
          authenticated: true,
          user: { id: "user-1", name: "Owner" },
          currentWorkspace: { id: "workspace-1", name: "Primary" },
        };
      else if (path.includes("/auth/whoami"))
        body = {
          user: { id: "user-1", name: "Owner", email: "owner@local.test" },
          currentOrganization: { id: "org-1", name: "Local", role },
          currentWorkspace: { id: "workspace-1", name: "Primary" },
        };
      else if (path.endsWith("/chiefs/repositories")) {
        if (catalogFailure) return new Response("{}", { status: 503 });
        body = catalog;
      } else if (path.endsWith("/integrations/connect-session"))
        body = { connectLink: "https://connect.nango.dev/test-connect" };
      else if (options?.method === "POST") {
        creates.push(JSON.parse(options.body as string));
        body = snapshot;
      } else body = { mode: "plan_only", chiefs };
      return new Response(JSON.stringify(body), { status: 200 });
    }),
  );
});

it("walks through project, policy and review, then submits a scoped setup request", async () => {
  render(<ChiefPage path="/chief/new" />);
  await screen.findByText("Where should your chief focus?");
  expect(screen.getByRole("button", { name: "Continue" })).toHaveProperty(
    "disabled",
    true,
  );
  fireEvent.click(await screen.findByRole("checkbox", { name: "acme/portal" }));
  fireEvent.change(screen.getByLabelText("Search repositories"), {
    target: { value: "backend" },
  });
  expect(screen.queryByRole("checkbox", { name: "acme/portal" })).toBeNull();
  fireEvent.click(screen.getByRole("checkbox", { name: "acme/backend" }));
  expect(screen.queryByText("Project name")).toBeNull();
  expect(screen.queryByRole("combobox", { name: "Host region" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await screen.findByText("Set the operating boundaries.");
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await screen.findByText("Review your chief.");
  expect(
    screen.getByText("Cloud infrastructure must be approved before it runs.", {
      exact: false,
    }),
  ).toBeTruthy();
  expect(screen.queryByText("Region")).toBeNull();
  expect(screen.queryByText("us-east-1")).toBeNull();
  expect(creates).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Create chief" }));
  await waitFor(() => expect(creates).toHaveLength(1));
  expect(creates[0]).toMatchObject({
    repositoryIds: ["1", "2"],
    region: "us-east-1",
    budgetDollars: 10,
    maxConcurrentTasks: 2,
  });
  expect(creates[0]).not.toHaveProperty("workspaceId");
  expect(creates[0]).not.toHaveProperty("organizationId");
  expect(creates[0]).not.toHaveProperty("token");
  expect(creates[0]).not.toHaveProperty("name");
  expect(creates[0]).not.toHaveProperty("repository");
  const call = vi
    .mocked(fetch)
    .mock.calls.find(([, init]) => init?.method === "POST");
  expect(call?.[1]).toMatchObject({
    credentials: "same-origin",
    redirect: "error",
    headers: expect.objectContaining({ "content-type": "application/json" }),
  });
});

it("does not let a member scan work, and displays missing billing data without inventing a cost", async () => {
  role = "member";
  chiefs = [{ ...snapshot, status: "ready" }];
  render(<ChiefPage path="/chief/chief-1" />);
  const scan = await screen.findByRole("button", { name: "Scan sessions" });
  expect(scan).toHaveProperty("disabled", true);
  expect(screen.getByText("No billing data reported")).toBeTruthy();
  expect(creates).toHaveLength(0);
});

it("connects GitHub using the existing workspace authorization flow and refreshes granted repositories", async () => {
  catalog = { connected: false, repositories: [] };
  const popup = { opener: null, location: { href: "" }, close: vi.fn() };
  vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
  render(<ChiefPage path="/chief/new" />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Connect GitHub" }),
  );
  await waitFor(() =>
    expect(popup.location.href).toBe("https://connect.nango.dev/test-connect"),
  );
  expect(
    vi
      .mocked(fetch)
      .mock.calls.some(
        ([url, init]) =>
          String(url).endsWith("/integrations/connect-session") &&
          JSON.parse(init?.body as string).allowedIntegrations[0] === "github",
      ),
  ).toBe(true);
  catalog = {
    connected: true,
    repositories: [{ id: "1", fullName: "acme/portal", private: true }],
  };
  fireEvent.click(screen.getByRole("button", { name: "Refresh repositories" }));
  fireEvent.click(await screen.findByRole("checkbox", { name: "acme/portal" }));
  expect(screen.getByRole("checkbox", { name: "acme/portal" })).toHaveProperty(
    "checked",
    true,
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Continue" })).toHaveProperty(
      "disabled",
      false,
    ),
  );
});

it("retains selections during refresh and blocks continuation if an App grant is removed", async () => {
  render(<ChiefPage path="/chief/new" />);
  fireEvent.click(await screen.findByRole("checkbox", { name: "acme/portal" }));
  catalog = { connected: true, repositories: [] };
  fireEvent.click(screen.getByRole("button", { name: "Refresh repositories" }));
  await screen.findByText(/Repository access changed/);
  expect(screen.getByRole("button", { name: "Continue" })).toHaveProperty(
    "disabled",
    true,
  );
  fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
  expect(screen.queryByText(/Repository access changed/)).toBeNull();
  expect(screen.getByText(/No repositories available/)).toBeTruthy();
});

it("shows a retryable discovery failure and never enables an empty scope", async () => {
  catalogFailure = true;
  render(<ChiefPage path="/chief/new" />);
  await screen.findByText(/Could not load GitHub repositories/);
  expect(screen.getByRole("button", { name: "Continue" })).toHaveProperty(
    "disabled",
    true,
  );
  catalogFailure = false;
  fireEvent.click(screen.getByRole("button", { name: "Refresh repositories" }));
  await screen.findByRole("checkbox", { name: "acme/portal" });
  expect(screen.queryByText(/Could not load GitHub repositories/)).toBeNull();
});

async function submitSetup() {
  fireEvent.click(await screen.findByRole("checkbox", { name: "acme/portal" }));
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.click(screen.getByRole("button", { name: "Create chief" }));
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it("keeps a failed scan visible through list refreshes until retry or navigation", async () => {
  chiefs = [{ ...snapshot, status: "ready" }];
  window.location.hash = "#/chief/chief-1";
  const original = fetch;
  let lists = 0;
  let failScan = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, options?: RequestInit) => {
      if (String(url).endsWith("/scan") && failScan)
        return new Response("{}", { status: 503 });
      if (String(url).endsWith("/chiefs")) lists++;
      return original(url, options);
    }),
  );
  const page = render(<ChiefPage path="/chief/chief-1" />);
  fireEvent.click(await screen.findByRole("button", { name: "Scan sessions" }));
  const error = await screen.findByRole("alert");
  const message = error.textContent;
  await waitFor(() => expect(lists).toBeGreaterThan(1), { timeout: 2500 });
  expect(screen.getByRole("alert").textContent).toBe(message);
  failScan = false;
  fireEvent.click(screen.getByRole("button", { name: "Scan sessions" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  failScan = true;
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Scan sessions" }),
    ).toHaveProperty("disabled", false),
  );
  fireEvent.click(screen.getByRole("button", { name: "Scan sessions" }));
  await screen.findByRole("alert");
  await act(async () => {
    window.location.hash = "#/chief";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
  page.rerender(<ChiefPage path="/chief" />);
  expect(screen.queryByRole("alert")).toBeNull();
});

it("ignores an older poll after creation and immediately refreshes the new chief", async () => {
  const oldPoll = deferred<Response>();
  const creation = deferred<Response>();
  const original = fetch;
  let lists = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, options?: RequestInit) => {
      if (String(url).endsWith("/chiefs") && options?.method === "POST")
        return creation.promise;
      if (String(url).endsWith("/chiefs")) {
        lists++;
        if (lists === 2) return oldPoll.promise;
      }
      return original(url, options);
    }),
  );
  const page = render(<ChiefPage path="/chief/new" />);
  await submitSetup();
  await waitFor(() => expect(lists).toBe(2), { timeout: 2500 });
  chiefs = [snapshot];
  await act(async () => {
    creation.resolve(new Response(JSON.stringify(snapshot)));
  });
  page.rerender(<ChiefPage path="/chief/chief-1" />);
  await waitFor(() => expect(lists).toBeGreaterThan(2));
  await act(async () => {
    oldPoll.resolve(
      new Response(JSON.stringify({ mode: "plan_only", chiefs: [] })),
    );
  });
  expect(screen.getByRole("heading", { name: "Portal" })).toBeTruthy();
  expect(screen.queryByText(/This chief is not available/)).toBeNull();
});

it.each([false, true])(
  "does not redirect a departed setup visit when creation finishes (unmounted: %s)",
  async (unmount) => {
    const creation = deferred<Response>();
    const original = fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, options?: RequestInit) => {
        if (String(url).endsWith("/chiefs") && options?.method === "POST")
          return creation.promise;
        return original(url, options);
      }),
    );
    const page = render(<ChiefPage path="/chief/new" />);
    await submitSetup();
    await act(async () => {
      window.location.hash = "#/chief";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    if (unmount) page.unmount();
    else {
      page.rerender(<ChiefPage path="/chief" />);
      // Returning to setup is a new visit, even though the URL matches the original.
      await act(async () => {
        window.location.hash = "#/chief/new";
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      });
      page.rerender(<ChiefPage path="/chief/new" />);
    }
    const destination = window.location.hash;
    await act(async () => {
      creation.resolve(new Response(JSON.stringify(snapshot)));
    });
    expect(window.location.hash).toBe(destination);
  },
);

it("never announces readiness when a refresh removes a selected App grant", async () => {
  const onReady = vi.fn();
  render(
    <RepositoryPicker
      workspace="workspace-1"
      disabled={false}
      selected={[{ id: "1", fullName: "acme/portal", private: true }]}
      onChange={vi.fn()}
      onReady={onReady}
    />,
  );
  await waitFor(() => expect(onReady).toHaveBeenLastCalledWith(true));
  onReady.mockClear();
  catalog = { connected: true, repositories: [] };
  fireEvent.click(screen.getByRole("button", { name: "Refresh repositories" }));
  await screen.findByText(/Repository access changed/);
  expect(onReady.mock.calls.some(([ready]) => ready)).toBe(false);
});
