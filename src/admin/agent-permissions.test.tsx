import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Binding, DelegationAgent, DelegationGroup, RolesInfo } from "./contracts";
import { AgentPermissions, principalFor } from "./agent-permissions";

type Call = { method: string; path: string; body: unknown };
type Handler = (call: Call) => [number, unknown] | Promise<[number, unknown]>;

const BASE = "/cloud/api/v1/workspaces/w1/delegates";
let calls: Call[] = [];
let routes: Record<string, Handler> = {};

const ROLES: RolesInfo = {
  presets: [
    { role: "trusted", label: "Trusted (server)", description: "Server copy for trusted.", classes: ["merge", "pr_ops", "deploy"],
      require_tier_o: ["deploy"], pr_ops_limit: null },
    { role: "standard", label: "Standard (server)", description: "Server copy for standard.", classes: ["pr_ops"],
      require_tier_o: [], pr_ops_limit: null },
    { role: "read_only", label: "Read-only (server)", description: "Server copy for read-only.", classes: ["pr_ops"],
      require_tier_o: [], pr_ops_limit: ["comment"] },
  ],
  classes: [
    { class: "merge", description: "Merge PRs once checks pass" },
    { class: "pr_ops", description: "Routine PR work" },
    { class: "deploy", description: "Deploy" },
    { class: "spend", description: "Spend money" },
  ],
  pr_ops_ops: ["comment"],
};
const binding = (overrides: Partial<Binding> = {}): Binding => ({ binding_id: "rul_1", owner_id: "u1",
  principal: { kind: "relay_agents", ref: null, name: "Relay agents" }, role: "trusted", classes: ["merge"], require_tier_o: [],
  pr_ops_limit: null, targets: null, expires_at: null, covered: 5, clipped_by_policy: [], ...overrides });
const GROUPS: DelegationGroup[] = [
  { group_id: "relay_agents", kind: "builtin", name: "Relay agents", members: [{ agent_id: "agt_1", name: "helper", proven: true, added_at: null }] },
  { group_id: "connector:grok-bot", kind: "builtin", name: "Grok bots", members: [] },
  { group_id: "grp_ops", kind: "custom", name: "Ops bots", members: [{ agent_id: "agt_1", name: "helper", proven: true, added_at: "x" }] },
];
const agent = (overrides: Partial<DelegationAgent> = {}): DelegationAgent => ({ agent_id: "agt_1", name: "helper", root_kind: "connector",
  connector: "grok-bot", spawned: false, launched_by: null, groups: ["relay_agents"],
  effective: { binding_id: "rul_1", role: "trusted", source: "relay_agents", grant_id: null }, ...overrides });

beforeEach(() => {
  calls = [];
  routes = {
    "GET /roles": () => [200, ROLES],
    "GET /bindings": () => [200, { bindings: [binding()], recommendation: null }],
    "GET /groups": () => [200, { groups: GROUPS }],
    "GET /agents": () => [200, { agents: [agent()] }],
    "GET /": () => [200, { grants: [] }],
  };
  vi.stubGlobal("fetch", vi.fn(async (input: string, init: RequestInit = {}) => {
    const call: Call = { method: init.method ?? "GET", path: input, body: init.body ? JSON.parse(init.body as string) : undefined };
    calls.push(call);
    const rest = input.startsWith(BASE) ? input.slice(BASE.length) : input;
    const key = `${call.method} ${rest || "/"}`;
    const handler = routes[key];
    const [status, body] = handler ? await handler(call) : [500, { error: `unexpected ${key}` }];
    return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
  }));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const panel = (props: Partial<Parameters<typeof AgentPermissions>[0]> = {}) => (
  <AgentPermissions workspaceId="w1" delegationEnabled maxExpiryDays={90} isAdmin={false} {...props} />
);
const writes = () => calls.filter((call) => call.method !== "GET").map(({ method, path, body }) => ({ method, path: path.replace(BASE, ""), body }));
const reads = (path: string) => calls.filter((call) => call.method === "GET" && call.path === `${BASE}${path}`).length;
const loaded = () => screen.findByRole("table", { name: "Agent permissions" });
const confirmGroup = () => screen.getByRole("group", { name: "Confirm removal" });
const openAdvanced = () => fireEvent.click(screen.getByRole("button", { name: "Advanced" }));

it("shows each binding as who, role, scope and expiry, with role labels and descriptions from GET roles", async () => {
  routes["GET /bindings"] = () => [200, { bindings: [binding({ clipped_by_policy: ["deploy"] }),
    binding({ binding_id: "rul_2", principal: { kind: "agent", ref: "agt_9", name: "ci-bot" }, role: "standard",
      targets: ["acme/web", "acme/*"], expires_at: "2099-01-01T00:00:00.000Z", covered: 1 })], recommendation: null }];
  render(panel());
  const table = await loaded();
  expect(within(table).getByText("Relay agents")).toBeInTheDocument();
  expect(within(table).getByText("5 agents · new connected agents join automatically")).toBeInTheDocument();
  expect(within(table).getByRole("combobox", { name: "Role for Relay agents" })).toHaveValue("trusted");
  expect(within(table).getAllByRole("option", { name: "Trusted (server)" }).length).toBeGreaterThan(0);
  expect(within(table).getByText("Everything I own")).toBeInTheDocument();
  expect(within(table).getByText("Never")).toBeInTheDocument();
  expect(within(table).getByText("Workspace policy blocks: deploy")).toBeInTheDocument();
  expect(within(table).getByText("acme/web acme/*")).toBeInTheDocument();
  expect(screen.getByText("Server copy for trusted.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Trusted \(server\)/ }));
  expect(screen.getByText("Merge PRs once checks pass")).toBeInTheDocument();
  expect(screen.getByText("Spend money")).toBeInTheDocument();
});

it("offers the server's recommendation and applies it as a binding; no card without one", async () => {
  let recommended = true;
  routes["GET /bindings"] = () => [200, { bindings: recommended ? [] : [binding()],
    recommendation: recommended ? { principal: { kind: "relay_agents" }, role: "trusted", label: "Give your Relay agents Trusted" } : null }];
  routes["POST /bindings"] = () => { recommended = false; return [201, { binding: binding() }]; };
  const changed = vi.fn();
  render(panel({ onChanged: changed }));
  expect(await screen.findByText("Recommended: Give your Relay agents Trusted")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Apply" }));
  expect(await screen.findByText("Applied: Give your Relay agents Trusted.")).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByText(/Recommended:/)).not.toBeInTheDocument());
  expect(writes()).toEqual([{ method: "POST", path: "/bindings", body: { principal: { kind: "relay_agents" }, role: "trusted" } }]);
  expect(changed).toHaveBeenCalledTimes(1);
});

it("adds a permission for one of my agents picked by id, with optional expiry and all workspaces", async () => {
  routes["POST /bindings"] = (call) => (call.body as { all_workspaces?: boolean }).all_workspaces
    ? [201, { bindings: [binding()], skipped: [{ workspace_id: "w9", reason: "not_enabled" }] }]
    : [201, { binding: binding() }];
  render(panel());
  await loaded();
  fireEvent.click(screen.getByRole("button", { name: "Add permission" }));
  const form = screen.getByRole("form", { name: "Add permission" });
  // The picker lists my agents by name and immutable id, from GET agents.
  expect(within(form).getByRole("option", { name: "helper (agt_1)" })).toBeInTheDocument();
  fireEvent.change(within(form).getByLabelText("Who"), { target: { value: "agent:agt_1" } });
  fireEvent.change(within(form).getByLabelText("Role"), { target: { value: "standard" } });
  expect(within(form).getByText("Server copy for standard.")).toBeInTheDocument();
  fireEvent.click(within(form).getByRole("button", { name: "Add" }));
  await waitFor(() => expect(writes()).toHaveLength(1));
  expect(writes()[0]).toEqual({ method: "POST", path: "/bindings", body: { principal: { kind: "agent", ref: "agt_1" }, role: "standard" } });

  fireEvent.click(await screen.findByRole("button", { name: "Add permission" }));
  const again = screen.getByRole("form", { name: "Add permission" });
  fireEvent.click(within(again).getByRole("button", { name: "Set expiry" }));
  fireEvent.change(within(again).getByLabelText("Expires after"), { target: { value: "7" } });
  fireEvent.click(within(again).getByLabelText("Apply to all my workspaces"));
  fireEvent.click(within(again).getByRole("button", { name: "Add" }));
  await waitFor(() => expect(writes()).toHaveLength(2));
  const body = writes()[1]!.body as Record<string, unknown>;
  expect(body).toMatchObject({ principal: { kind: "relay_agents" }, role: "trusted", all_workspaces: true });
  expect((Date.parse(String(body.expires_at)) - Date.now()) / 86_400_000).toBeGreaterThan(6.9);
  expect(await screen.findByText(/Skipped 1 workspace\(s\)/)).toBeInTheDocument();
});

it("builds a custom permission: disabled until an action is chosen, then posts classes, ask-first and repos", async () => {
  routes["POST /bindings"] = () => [201, { binding: binding({ role: "custom" }) }];
  render(panel());
  await loaded();
  openAdvanced();
  const form = screen.getByRole("form", { name: "Add a custom permission" });
  const submit = within(form).getByRole("button", { name: "Add custom permission" });
  expect(submit).toBeDisabled();
  fireEvent.change(within(form).getByLabelText("Who"), { target: { value: "connector:grok-bot" } });
  fireEvent.change(within(form).getByLabelText("Merge PRs once checks pass"), { target: { value: "allow" } });
  fireEvent.change(within(form).getByLabelText("Deploy"), { target: { value: "ask" } });
  fireEvent.change(within(form).getByLabelText("Routine PR work"), { target: { value: "allow" } });
  fireEvent.click(within(form).getByLabelText("Pull request work: comments only"));
  fireEvent.change(within(form).getByLabelText("Repos"), { target: { value: "a," } });
  expect(within(form).getByRole("alert")).toHaveTextContent("Separate repos with spaces");
  expect(submit).toBeDisabled();
  fireEvent.change(within(form).getByLabelText("Repos"), { target: { value: "acme/*" } });
  expect(submit).toBeEnabled();
  fireEvent.click(submit);
  await waitFor(() => expect(writes()).toHaveLength(1));
  expect(writes()[0]!.body).toEqual({ principal: { kind: "connector_kind", ref: "grok-bot" }, role: "custom",
    classes: ["merge", "pr_ops", "deploy"], require_tier_o: ["deploy"], pr_ops_limit: ["comment"], targets: ["acme/*"] });
});

it("explains a duplicate row (binding_exists) in the contract's error shape, and keeps the form", async () => {
  routes["POST /bindings"] = () => [409, { ok: false, error: "binding_exists", message: "exists", binding_id: "rul_1" }];
  render(panel());
  await loaded();
  fireEvent.click(screen.getByRole("button", { name: "Add permission" }));
  fireEvent.click(within(screen.getByRole("form", { name: "Add permission" })).getByRole("button", { name: "Add" }));
  expect(await screen.findByText("There is already a row for this. Change its role in the table instead.")).toBeInTheDocument();
  expect(screen.getByRole("form", { name: "Add permission" })).toBeInTheDocument();
  expect(principalFor("grp_ops")).toEqual({ kind: "group", ref: "grp_ops" });
});

it("removes a row after a confirmation, and changes a role in place", async () => {
  routes["DELETE /bindings/rul_1"] = () => [200, { revoked: "rul_1", revoked_grants: 2 }];
  routes["PATCH /bindings/rul_1"] = () => [200, { binding: binding({ role: "standard" }) }];
  render(panel());
  await loaded();
  fireEvent.click(screen.getByRole("button", { name: "Remove Relay agents" }));
  expect(writes()).toEqual([]);
  expect(confirmGroup()).toHaveTextContent("Approvals it made under this row stop working at once.");
  fireEvent.click(within(confirmGroup()).getByRole("button", { name: "Remove" }));
  await waitFor(() => expect(writes()).toEqual([{ method: "DELETE", path: "/bindings/rul_1", body: {} }]));
  fireEvent.change(await screen.findByRole("combobox", { name: "Role for Relay agents" }), { target: { value: "standard" } });
  await waitFor(() => expect(writes()[1]).toEqual({ method: "PATCH", path: "/bindings/rul_1", body: { role: "standard" } }));
  expect(await screen.findByText(/Approvals made under the old role were ended\./)).toBeInTheDocument();
});

it("shows what decides each agent, excludes one (no access until it has its own setting) and gives it a role back", async () => {
  let excluded = false;
  routes["GET /bindings"] = () => [200, { bindings: [binding(), ...(excluded ? [binding({ binding_id: "rul_x", role: "excluded",
    principal: { kind: "agent", ref: "agt_1", name: "helper" } })] : [])], recommendation: null }];
  routes["GET /agents"] = () => [200, { agents: [excluded
    ? agent({ effective: { binding_id: "rul_x", role: "excluded", source: "agent", grant_id: null } })
    : agent(), agent({ agent_id: "agt_2", name: "spawned-x", spawned: true, groups: [],
    effective: { binding_id: null, role: "read_only", source: "spawn_default", grant_id: null } })] }];
  routes["POST /bindings"] = () => { excluded = true; return [201, { binding: binding({ binding_id: "rul_x", role: "excluded" }) }]; };
  routes["PATCH /bindings/rul_x"] = () => [200, { binding: binding({ binding_id: "rul_x", role: "standard" }) }];
  render(panel());
  await loaded();
  openAdvanced();
  const agents = screen.getByRole("table", { name: "Your agents" });
  expect(within(agents).getByText("Started by another agent: Read-only")).toBeInTheDocument();
  expect(screen.getByText(/no access until you give it its own setting/)).toBeInTheDocument();
  fireEvent.click(within(agents).getAllByRole("button", { name: "Exclude" })[0]!);
  await waitFor(() => expect(writes()[0]).toEqual({ method: "POST", path: "/bindings",
    body: { principal: { kind: "agent", ref: "agt_1" }, role: "excluded" } }));
  const giveRole = await screen.findByRole("combobox", { name: "Give helper a role" });
  fireEvent.change(giveRole, { target: { value: "standard" } });
  await waitFor(() => expect(writes()[1]).toEqual({ method: "PATCH", path: "/bindings/rul_x", body: { role: "standard" } }));
});

it("creates a custom group from my agents, removes a member, and deletes a group after a confirmation", async () => {
  routes["POST /groups"] = () => [201, { group: GROUPS[2] }];
  routes["PATCH /groups/grp_ops"] = () => [200, { group: GROUPS[2] }];
  routes["DELETE /groups/grp_ops"] = () => [200, { revoked: "grp_ops", revoked_bindings: 1, revoked_grants: 0 }];
  render(panel());
  await loaded();
  openAdvanced();
  const create = screen.getByRole("form", { name: "Create a group" });
  fireEvent.change(within(create).getByLabelText("Group name"), { target: { value: "Night shift" } });
  fireEvent.click(within(create).getByLabelText("helper"));
  fireEvent.click(within(create).getByRole("button", { name: "Create group" }));
  await waitFor(() => expect(writes()[0]).toEqual({ method: "POST", path: "/groups", body: { name: "Night shift", agent_ids: ["agt_1"] } }));
  fireEvent.click(await screen.findByRole("button", { name: "Remove helper from Ops bots" }));
  await waitFor(() => expect(writes()[1]).toEqual({ method: "PATCH", path: "/groups/grp_ops", body: { remove: ["agt_1"] } }));
  fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
  fireEvent.click(within(confirmGroup()).getByRole("button", { name: "Delete group" }));
  await waitFor(() => expect(writes()[2]).toEqual({ method: "DELETE", path: "/groups/grp_ops", body: {} }));
});

it("re-reads on a new refresh key (a grant or the trust rule changed elsewhere)", async () => {
  const { rerender } = render(panel());
  await loaded();
  expect(reads("/bindings")).toBe(1);
  rerender(panel({ refreshKey: 1 }));
  await waitFor(() => expect(reads("/bindings")).toBe(2));
});

it("shows a legacy rule as Trusted (pending seed), built-ins without a member list, bare-name classes, and works without the agent list", async () => {
  routes["GET /roles"] = () => [200, { ...ROLES, classes: ["merge", "pr_ops", "deploy", "spend"], principal_kinds: ["relay_agents"] }];
  routes["GET /bindings"] = () => [200, { bindings: [binding({ role: "legacy" })], recommendation: null }];
  routes["GET /groups"] = () => [200, { groups: [{ ...GROUPS[0], members: null }, { ...GROUPS[2], members: [
    { agent_id: "agt_1", name: "helper", proven: false, added_at: "x" }] }] }];
  routes["GET /agents"] = () => [503, { error: "Messaging is not provisioned for this workspace", code: "unavailable" }];
  render(panel());
  const table = await loaded();
  expect(within(table).getAllByRole("option", { name: "Trusted (pending seed)" }).length).toBeGreaterThan(0);
  openAdvanced();
  expect(screen.getByText("Everyone it covers; see Your agents below.")).toBeInTheDocument();
  expect(screen.getByText("helper (not proven)")).toBeInTheDocument();
  expect(screen.getByLabelText("Spend money")).toBeInTheDocument();
  expect(screen.getByText(/Your agents can't be listed right now: Messaging is not provisioned/)).toBeInTheDocument();
});

it("shows a failed read with a retry", async () => {
  let fail = true;
  routes["GET /roles"] = () => (fail ? [503, { error: "Delegation is unavailable", code: "unavailable" }] : [200, ROLES]);
  render(panel());
  expect(await screen.findByRole("alert")).toHaveTextContent("Delegation is unavailable");
  fail = false;
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await loaded()).toBeInTheDocument();
});

it("with delegation off, offers no adding or role changes but keeps Remove", async () => {
  render(panel({ delegationEnabled: false }));
  await loaded();
  expect(screen.queryByRole("button", { name: "Add permission" })).not.toBeInTheDocument();
  expect(screen.queryByRole("combobox", { name: "Role for Relay agents" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Remove Relay agents" })).toBeInTheDocument();
  expect(screen.getByText(/Delegation is off, so nothing can be added/)).toBeInTheDocument();
  openAdvanced();
  expect(screen.queryByRole("form", { name: "Add a custom permission" })).not.toBeInTheDocument();
});
