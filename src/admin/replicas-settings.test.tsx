import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { RemoteAgentsSection } from "./remote-agents";

type Call = {
  url: string;
  init: RequestInit;
  body: Record<string, unknown> | null;
};
type Environment = {
  environmentId: string;
  name: string | null;
  enabled: boolean;
  status: string;
  optedOut: boolean;
  stale: boolean;
  bindings: number;
};
let calls: Call[] = [];
let remoteConnected = true;
let principal: { userId: string; member: boolean } | null = null;
let environments: Environment[] = [];
let spawns: Array<Record<string, unknown>> = [];
const secret = "replicas_" + "s".repeat(32);
const connection = {
  keyHint: "…ssss",
  validatedAt: "2026-11-10T00:00:00Z",
  providerAccount: null,
};
const environment = (
  environmentId: string,
  status: string,
  extra: Partial<Environment> = {},
): Environment => ({
  environmentId,
  name: null,
  enabled: status !== "disabled",
  status,
  optedOut: false,
  stale: false,
  bindings: 0,
  ...extra,
});
const policy = () => ({
  mcpUrl: "/cloud/api/v1/mcp/replicas",
  organizationId: "rep-org",
  accessRevoked: null,
  allEnvironments: true,
  principal,
  organizationShared: false,
  environments: environments.map((row) => ({
    ...row,
    discoveryMissingSince: null,
    registeredMcpId: row.status === "registered" ? "mcp-1" : null,
    creators: [],
    pendingCreators: [],
    futureField: { ignored: true },
  })),
});
function respond(call: Call) {
  const path = call.url;
  const method = call.init.method ?? "GET";
  if (path.endsWith("/providers")) return Response.json({ providers: [] });
  if (path.endsWith("/remote-agent-connections"))
    return Response.json({
      providers: [
        {
          id: "replicas",
          product: "Replicas",
          docsUrl: "https://replicas.dev",
          connection: remoteConnected ? connection : null,
          capabilities: {
            connectionManagement: true,
            relayBinding: true,
            historySync: false,
          },
        },
      ],
    });
  if (path.endsWith("/remote-agent-connections/replicas")) {
    remoteConnected = method !== "DELETE";
    return Response.json({ connection, environmentSetup: { status: "ok" } });
  }
  if (path.endsWith("/organizations/o1/memberships"))
    return Response.json({
      memberships: [
        { userId: "u-ada1", email: "ada@test.example", name: "Ada Lovelace", role: "admin", joinedAt: null },
        { userId: "u-ada2", email: "ada.l@test.example", name: "Ada Lovelace", role: "member", joinedAt: null },
      ],
    });
  if (path.endsWith("/replicas/environment-policies")) return Response.json(policy());
  if (path.endsWith("/replicas/environment-principal") && method === "PUT") {
    const userId = call.body?.userId;
    principal = typeof userId === "string" ? { userId, member: true } : null;
    return Response.json(policy());
  }
  if (path.endsWith("/replicas/environments/sync") && method === "POST") {
    environments = environments.map((row) => ({ ...row, status: "registered" }));
    return Response.json({
      discovery: { status: "ok", environments: [] },
      allEnvironments: true,
      environments: environments.map(({ environmentId, status }) => ({ environmentId, status })),
    });
  }
  const environmentWrite = /\/replicas\/environments\/([^/]+)$/.exec(path);
  if (environmentWrite && method === "PUT") {
    const row = environments.find((row) => row.environmentId === environmentWrite[1]);
    return Response.json({ environment: row });
  }
  if (path.endsWith("/workspaces/w1/replicas"))
    return Response.json({ connection: { keyHint: "…ssss", organizationId: "rep-org", validatedAt: connection.validatedAt }, spawns });
  return Response.json({ error: "not_found" }, { status: 404 });
}
beforeEach(() => {
  calls = [];
  remoteConnected = true;
  principal = null;
  environments = [environment("env-1", "enabled"), environment("env-2", "registration_unconfirmed")];
  spawns = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input, init: RequestInit = {}) => {
      const call = {
        url: String(input),
        init,
        body: init.body ? JSON.parse(String(init.body)) : null,
      };
      calls.push(call);
      return respond(call);
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const replicasCard = async () =>
  (await screen.findByText("Replicas", { selector: "h3" })).closest(
    '[data-slot="card"]',
  )! as HTMLElement;
const optionTexts = (select: HTMLElement) =>
  within(select).getAllByRole("option").map((option) => option.textContent);
const row = (id: string) =>
  screen.getByText(id, { selector: "small" }).closest("li")! as HTMLElement;

it("asks for a responsible member and lists same-name members by email", async () => {
  render(<RemoteAgentsSection workspaceId="w1" organizationId="o1" canManage />);
  const status = await screen.findByText(/Environment setup does not grant messaging by itself/);
  expect(status).toHaveTextContent("Choose the member responsible for these agents to enable automatic joining. 0 of 2 environments configured.");
  const select = screen.getByLabelText("Member responsible for Replicas agents");
  await waitFor(() => expect(optionTexts(select)).toEqual([
    "No default principal",
    "Ada Lovelace (ada@test.example)",
    "Ada Lovelace (ada.l@test.example)",
  ]));
  expect(select).toHaveValue("");
});

it("applies the chosen principal, then syncs and shows the configured state", async () => {
  render(<RemoteAgentsSection workspaceId="w1" organizationId="o1" canManage />);
  const select = await screen.findByLabelText("Member responsible for Replicas agents");
  await waitFor(() => expect(optionTexts(select)).toHaveLength(3));
  fireEvent.change(select, { target: { value: "u-ada2" } });
  fireEvent.click(screen.getByRole("button", { name: "Apply Relay setup" }));
  const status = await screen.findByText(/Automatic Relay messaging is configured/);
  expect(status).toHaveTextContent("2 of 2 environments configured.");
  const put = calls.findIndex((call) => call.url.endsWith("/replicas/environment-principal") && call.init.method === "PUT");
  const sync = calls.findIndex((call) => call.url.endsWith("/replicas/environments/sync") && call.init.method === "POST");
  expect(put).toBeGreaterThanOrEqual(0);
  expect(calls[put]?.body).toEqual({ userId: "u-ada2" });
  expect(sync).toBeGreaterThan(put);
  expect(screen.getByLabelText("Member responsible for Replicas agents")).toHaveValue("u-ada2");
});

it("opts out, retries and enables individual environments", async () => {
  principal = { userId: "u-ada1", member: true };
  environments = [
    environment("env-1", "registered", { name: "Primary" }),
    environment("env-2", "registration_unconfirmed"),
    environment("env-3", "disabled", { optedOut: true }),
  ];
  render(<RemoteAgentsSection workspaceId="w1" organizationId="o1" canManage />);
  await screen.findByText(/Automatic Relay setup failed for 1 environment\./);
  expect(within(row("env-1")).getByText("Configured")).toBeInTheDocument();
  expect(within(row("env-3")).getByText("Opted out")).toBeInTheDocument();
  const writes = () => calls.filter((call) => call.init.method === "PUT");

  fireEvent.click(within(row("env-1")).getByRole("button", { name: "Opt out" }));
  await waitFor(() => expect(writes()).toHaveLength(1));
  expect(writes()[0]?.url).toBe("/cloud/api/v1/workspaces/w1/replicas/environments/env-1");
  expect(writes()[0]?.body).toEqual({ enabled: false });

  await waitFor(() => expect(within(row("env-2")).getByRole("button", { name: "Retry" })).toBeEnabled());
  fireEvent.click(within(row("env-2")).getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(writes()).toHaveLength(2));
  expect(writes()[1]?.url).toMatch(/\/environments\/env-2$/);
  expect(writes()[1]?.body).toEqual({ retry_registration: true });

  await waitFor(() => expect(within(row("env-3")).getByRole("button", { name: "Enable" })).toBeEnabled());
  fireEvent.click(within(row("env-3")).getByRole("button", { name: "Enable" }));
  await waitFor(() => expect(writes()).toHaveLength(3));
  expect(writes()[2]?.url).toMatch(/\/environments\/env-3$/);
  expect(writes()[2]?.body).toEqual({ enabled: true });
});

it("lists replica bindings with errors and message counts", async () => {
  spawns = [
    { id: "s1", agent: "ship-1", replicaId: "r-1", status: "bound", error: null, uncertainMessages: 0, rejectedMessages: 0, retryingMessages: 0 },
    { id: "s2", agent: null, replicaId: "r-2", status: "rejected", error: "Replicas refused the launch.", uncertainMessages: 1, rejectedMessages: 2, retryingMessages: 3 },
  ];
  render(<RemoteAgentsSection workspaceId="w1" organizationId="o1" canManage />);
  expect(await screen.findByText((_, element) => element?.tagName === "SPAN" && element.textContent === "@ship-1 · bound")).toBeInTheDocument();
  expect(screen.getByText((_, element) => element?.tagName === "SPAN" && element.textContent === "r-2 · rejected")).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("Replicas refused the launch.");
  expect(screen.getByText("2 rejected · 1 uncertain · 3 retrying")).toBeInTheDocument();
});

it("connects with a key, never keeps it in the document, then loads Replicas setup", async () => {
  remoteConnected = false;
  render(<RemoteAgentsSection workspaceId="w1" organizationId="o1" canManage />);
  const input = await screen.findByLabelText("Replicas API key");
  expect(calls.some((call) => call.url.includes("/replicas/"))).toBe(false);
  fireEvent.change(input, { target: { value: secret } });
  fireEvent.click(screen.getByRole("button", { name: "Connect" }));
  await screen.findByText(/Environment setup does not grant messaging by itself/);
  const save = calls.find((call) => call.init.method === "POST")!;
  expect(save.url).toBe("/cloud/api/v1/workspaces/w1/remote-agent-connections/replicas");
  expect(save.body).toEqual({ key: secret });
  expect(screen.getByLabelText("Replace Replicas API key")).toHaveValue("");
  expect(document.body.innerHTML).not.toContain(secret);
  expect(calls.some((call) => call.url.endsWith("/replicas/environment-policies"))).toBe(true);
});

it("shows members a safe prompt without management controls", async () => {
  remoteConnected = false;
  render(<RemoteAgentsSection workspaceId="w1" organizationId="o1" canManage={false} />);
  expect(await screen.findByText("Ask an organization owner or admin to connect Replicas.")).toBeInTheDocument();
  const card = await replicasCard();
  expect(within(card).queryByRole("button")).not.toBeInTheDocument();
  expect(within(card).queryByRole("combobox")).not.toBeInTheDocument();
  expect(within(card).queryByLabelText("Replicas API key")).not.toBeInTheDocument();
  expect(calls.some((call) => call.url.includes("/replicas") || call.url.includes("/memberships"))).toBe(false);
});
