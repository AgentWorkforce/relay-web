import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Binding, DelegationAgent, DelegationGroup, RolesInfo } from "./contracts";
import { AgentPermissions, badRepoPattern, principalFor, skippedNote } from "./agent-permissions";

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
  expect(within(table).getByText("5 agents · new connected agents join automatically · your trust rule")).toBeInTheDocument();
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
  fireEvent.click(within(again).getByLabelText("Apply to all workspaces in this organization"));
  fireEvent.click(within(again).getByRole("button", { name: "Add" }));
  await waitFor(() => expect(writes()).toHaveLength(2));
  const body = writes()[1]!.body as Record<string, unknown>;
  expect(body).toMatchObject({ principal: { kind: "relay_agents" }, role: "trusted", all_workspaces: true });
  expect((Date.parse(String(body.expires_at)) - Date.now()) / 86_400_000).toBeGreaterThan(6.9);
  expect(await screen.findByText("Added. Not added in 1 workspace: w9 (delegation is off there).")).toBeInTheDocument();
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
  // Not Relay agents (that conflict offers converting the old rule): one agent.
  fireEvent.change(within(screen.getByRole("form", { name: "Add permission" })).getByLabelText("Who"), { target: { value: "agent:agt_1" } });
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

it("shows a legacy rule as All actions (set before roles), built-ins without a member list, bare-name classes, and works without the agent list", async () => {
  routes["GET /roles"] = () => [200, { ...ROLES, classes: ["merge", "pr_ops", "deploy", "spend"], principal_kinds: ["relay_agents"] }];
  routes["GET /bindings"] = () => [200, { bindings: [binding({ role: "legacy" })], recommendation: null }];
  routes["GET /groups"] = () => [200, { groups: [{ ...GROUPS[0], members: null }, { ...GROUPS[2], members: [
    { agent_id: "agt_1", name: "helper", proven: false, added_at: "x" }] }] }];
  routes["GET /agents"] = () => [503, { error: "Messaging is not provisioned for this workspace", code: "unavailable" }];
  render(panel());
  const table = await loaded();
  expect(within(table).getAllByRole("option", { name: "All actions (set before roles)" }).length).toBeGreaterThan(0);
  openAdvanced();
  expect(screen.getByText("Everyone it covers; see Your agents below.")).toBeInTheDocument();
  expect(screen.getByText("helper (not proven)")).toBeInTheDocument();
  expect(screen.getByLabelText("Spend money")).toBeInTheDocument();
  expect(screen.getByText(/Your agents can't be listed right now: Messaging is not provisioned/)).toBeInTheDocument();
});

it.each([["/roles", 503], ["/bindings", 404], ["/groups", 503]])(
  "keeps the explicit grants and a working Revoke everything when %s answers %i", async (failing, status) => {
    routes[`GET ${failing}`] = () => [status as number, { error: "Delegation is unavailable", code: "unavailable" }];
    routes["GET /"] = () => [200, { grants: [{ grant_id: "grt_1", owner_id: "u1", delegate_agent_id: "assistant-1",
      scopes: [{ class: "merge", targets: ["acme/*"] }], require_tier_o: [], expires_at: "2099-01-01T00:00:00.000Z", status: "active" }] }];
    routes["POST /revoke-all"] = () => [200, { revoked: ["grt_1"] }];
    render(panel());
    expect(await screen.findByText(/Delegation is unavailable/)).toBeInTheDocument();
    expect(screen.getByText(/Permission rows can.t be read right now/)).toBeInTheDocument();
    // Advanced opens itself: the grants and Revoke everything are reachable without a click.
    expect(await screen.findByText("assistant-1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Revoke everything" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Confirm revocation" })).getByRole("button", { name: "Revoke everything" }));
    await waitFor(() => expect(writes()).toEqual([{ method: "POST", path: "/revoke-all", body: {} }]));
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

it("excluding an agent decided by its own grant revokes that grant too", async () => {
  routes["GET /agents"] = () => [200, { agents: [agent({ effective: { binding_id: null, role: "custom", source: "explicit_grant", grant_id: "grt_9" } })] }];
  routes["DELETE /grt_9"] = () => [200, { grant_id: "grt_9", owner_id: "u1", delegate_agent_id: "helper", scopes: [], require_tier_o: [],
    expires_at: "2099-01-01T00:00:00.000Z", status: "revoked" }];
  routes["POST /bindings"] = () => [201, { binding: binding({ binding_id: "rul_x", role: "excluded" }) }];
  const grantsChanged = vi.fn();
  render(panel({ onGrantsChanged: grantsChanged }));
  await loaded();
  openAdvanced();
  fireEvent.click(within(screen.getByRole("table", { name: "Your agents" })).getByRole("button", { name: "Exclude" }));
  await waitFor(() => expect(writes()).toHaveLength(2));
  // The exclusion is written before the grant is revoked, so access never widens in between.
  expect(writes()).toEqual([
    { method: "POST", path: "/bindings", body: { principal: { kind: "agent", ref: "agt_1" }, role: "excluded" } },
    { method: "DELETE", path: "/grt_9", body: {} },
  ]);
  expect(await screen.findByText(/its own grant was revoked/)).toBeInTheDocument();
  expect(grantsChanged).toHaveBeenCalledTimes(1);
});

it("the custom form keeps its own expiry and workspace choice", async () => {
  routes["POST /bindings"] = () => [201, { binding: binding({ role: "custom" }) }];
  render(panel());
  await loaded();
  fireEvent.click(screen.getByRole("button", { name: "Add permission" }));
  const draft = screen.getByRole("form", { name: "Add permission" });
  fireEvent.click(within(draft).getByRole("button", { name: "Set expiry" }));
  fireEvent.click(within(draft).getByLabelText("Apply to all workspaces in this organization"));
  fireEvent.click(within(draft).getByRole("button", { name: "Cancel" }));
  openAdvanced();
  const form = screen.getByRole("form", { name: "Add a custom permission" });
  fireEvent.change(within(form).getByLabelText("Merge PRs once checks pass"), { target: { value: "allow" } });
  fireEvent.click(within(form).getByRole("button", { name: "Add custom permission" }));
  await waitFor(() => expect(writes()).toHaveLength(1));
  expect(writes()[0]!.body).toEqual({ principal: { kind: "relay_agents" }, role: "custom", classes: ["merge"], require_tier_o: [] });
});

it("closes an open add form when delegation is turned off", async () => {
  const { rerender } = render(panel());
  await loaded();
  fireEvent.click(screen.getByRole("button", { name: "Add permission" }));
  expect(screen.getByRole("form", { name: "Add permission" })).toBeInTheDocument();
  rerender(panel({ delegationEnabled: false }));
  expect(screen.queryByRole("form", { name: "Add permission" })).not.toBeInTheDocument();
});

it("offers to convert a rule from before roles instead of adding Relay agents", async () => {
  routes["GET /bindings"] = () => [200, { bindings: [binding({ binding_id: "dtr_legacy", role: "legacy" })],
    recommendation: { principal: { kind: "relay_agents" }, role: "trusted", label: "Give your Relay agents Trusted" } }];
  routes["PATCH /bindings/dtr_legacy"] = () => [200, { binding: binding({ binding_id: "dtr_legacy", role: "trusted" }) }];
  render(panel());
  await loaded();
  expect(screen.queryByRole("button", { name: "Apply" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Convert your existing rule to Trusted" }));
  await waitFor(() => expect(writes()).toEqual([{ method: "PATCH", path: "/bindings/dtr_legacy", body: { role: "trusted" } }]));
  expect(await screen.findByText("Your existing rule is now Trusted.")).toBeInTheDocument();
});

it("turns a binding_exists on adding Relay agents into the convert offer only when that row is a legacy rule", async () => {
  routes["GET /bindings"] = () => [200, { bindings: [binding({ binding_id: "dtr_legacy", role: "legacy",
    principal: { kind: "all_agents", ref: null, name: "All my agents" } })], recommendation: null }];
  routes["POST /bindings"] = () => [409, { error: "A binding for this principal already exists", code: "binding_exists", binding_id: "dtr_legacy" }];
  routes["PATCH /bindings/dtr_legacy"] = () => [200, { binding: binding({ binding_id: "dtr_legacy", role: "trusted" }) }];
  render(panel());
  await loaded();
  fireEvent.click(screen.getByRole("button", { name: "Add permission" }));
  fireEvent.click(within(screen.getByRole("form", { name: "Add permission" })).getByRole("button", { name: "Add" }));
  const offer = await screen.findByRole("group", { name: "Convert existing rule" });
  fireEvent.click(within(offer).getByRole("button", { name: "Convert your existing rule to Trusted" }));
  await waitFor(() => expect(writes()[1]).toEqual({ method: "PATCH", path: "/bindings/dtr_legacy", body: { role: "trusted" } }));
});

it("excludes before revoking the agent's own grant (PATCH first), and a failed revoke says it keeps that grant", async () => {
  routes["GET /bindings"] = () => [200, { bindings: [binding(), binding({ binding_id: "rul_own", role: "standard",
    principal: { kind: "agent", ref: "agt_1", name: "helper" } })], recommendation: null }];
  routes["GET /agents"] = () => [200, { agents: [agent({ effective: { binding_id: null, role: "custom", source: "explicit_grant", grant_id: "grt_9" } })] }];
  routes["PATCH /bindings/rul_own"] = () => [200, { binding: binding({ binding_id: "rul_own", role: "excluded" }) }];
  routes["DELETE /grt_9"] = () => [503, { error: "Delegation is unavailable", code: "unavailable" }];
  const changed = vi.fn();
  render(panel({ onChanged: changed }));
  await loaded();
  openAdvanced();
  fireEvent.click(within(screen.getByRole("table", { name: "Your agents" })).getByRole("button", { name: "Exclude" }));
  expect(await screen.findByText(/its own grant could not be revoked, so it still acts on that grant: Delegation is unavailable/)).toBeInTheDocument();
  expect(writes()).toEqual([
    { method: "PATCH", path: "/bindings/rul_own", body: { role: "excluded" } },
    { method: "DELETE", path: "/grt_9", body: {} },
  ]);
  await waitFor(() => expect(reads("/bindings")).toBe(2));
  expect(changed).toHaveBeenCalledTimes(1);
});

it("a failed exclusion revokes nothing", async () => {
  routes["GET /agents"] = () => [200, { agents: [agent({ effective: { binding_id: null, role: "custom", source: "explicit_grant", grant_id: "grt_9" } })] }];
  routes["POST /bindings"] = () => [503, { error: "Delegation is unavailable", code: "unavailable" }];
  render(panel());
  await loaded();
  openAdvanced();
  fireEvent.click(within(screen.getByRole("table", { name: "Your agents" })).getByRole("button", { name: "Exclude" }));
  expect(await screen.findByText(/Delegation is unavailable/)).toBeInTheDocument();
  expect(writes()).toEqual([{ method: "POST", path: "/bindings", body: { principal: { kind: "agent", ref: "agt_1" }, role: "excluded" } }]);
});

it("offers converting a legacy rule the API sends as all_agents", async () => {
  routes["GET /bindings"] = () => [200, { bindings: [binding({ binding_id: "dtr_legacy", role: "legacy",
    principal: { kind: "all_agents", ref: null, name: "All my agents" } })],
    recommendation: { principal: { kind: "relay_agents" }, role: "trusted", label: "Give your Relay agents Trusted" } }];
  routes["PATCH /bindings/dtr_legacy"] = () => [200, { binding: binding({ binding_id: "dtr_legacy", role: "trusted" }) }];
  render(panel());
  await loaded();
  expect(screen.queryByRole("button", { name: "Apply" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Convert your existing rule to Trusted" }));
  await waitFor(() => expect(writes()).toEqual([{ method: "PATCH", path: "/bindings/dtr_legacy", body: { role: "trusted" } }]));
});

it("says merges that need GitHub checks are not available on self-hosted, and lists every connector group from GET groups", async () => {
  routes["GET /roles"] = () => [200, { ...ROLES, presets: [{ ...ROLES.presets[0]!, required_conditions: { merge: [{ type: "ci_green" }, { type: "mergeable" }] } },
    ...ROLES.presets.slice(1)], required_condition_types: ["ci_green", "mergeable"] }];
  routes["GET /bindings"] = () => [200, { bindings: [], recommendation: { principal: { kind: "relay_agents" }, role: "trusted", label: "Give your Relay agents Trusted" } }];
  routes["GET /groups"] = () => [200, { groups: [{ ...GROUPS[0]!, members: null },
    { group_id: "connector:cursor-cloud", kind: "builtin", name: "Cursor cloud agents", members: null }] }];
  render(panel());
  await loaded();
  expect(screen.getByText(/delegated merges are refused here/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Trusted \(server\)/ }));
  expect(screen.getByText("Merge PRs once checks pass (needs GitHub checks; not available on self-hosted)")).toBeInTheDocument();
  openAdvanced();
  // Listed under Groups, and offered as a Who in a custom permission.
  expect(screen.getAllByText("Cursor cloud agents").filter((node) => node.tagName !== "OPTION")).toHaveLength(1);
  expect(within(screen.getByRole("form", { name: "Add a custom permission" })).getByRole("option", { name: "Cursor cloud agents" })).toBeInTheDocument();
});

it("applies a recommendation that names a live legacy rule as a PATCH of that rule", async () => {
  routes["GET /bindings"] = () => [200, { bindings: [], recommendation: { principal: { kind: "relay_agents" }, role: "trusted",
    label: "Give your Relay agents Trusted", binding_id: "dtr_legacy" } }];
  routes["PATCH /bindings/dtr_legacy"] = () => [200, { binding: binding({ binding_id: "dtr_legacy", role: "trusted" }) }];
  render(panel());
  await loaded();
  fireEvent.click(screen.getByRole("button", { name: "Convert your existing rule to Trusted" }));
  await waitFor(() => expect(writes()).toEqual([{ method: "PATCH", path: "/bindings/dtr_legacy", body: { role: "trusted" } }]));
});

it("keeps Exclude while delegation is off (an exclusion may be posted then)", async () => {
  routes["POST /bindings"] = () => [201, { binding: binding({ binding_id: "rul_x", role: "excluded" }) }];
  render(panel({ delegationEnabled: false }));
  await loaded();
  openAdvanced();
  fireEvent.click(within(screen.getByRole("table", { name: "Your agents" })).getByRole("button", { name: "Exclude" }));
  await waitFor(() => expect(writes()).toEqual([{ method: "POST", path: "/bindings", body: { principal: { kind: "agent", ref: "agt_1" }, role: "excluded" } }]));
});

it("says plainly when every workspace in the organization needs a browser session (400)", async () => {
  routes["POST /bindings"] = () => [400, { error: "all_workspaces needs a browser session", code: "invalid_request" }];
  render(panel());
  await loaded();
  fireEvent.click(screen.getByRole("button", { name: "Add permission" }));
  const form = screen.getByRole("form", { name: "Add permission" });
  fireEvent.click(within(form).getByLabelText("Apply to all workspaces in this organization"));
  fireEvent.click(within(form).getByRole("button", { name: "Add" }));
  expect(await screen.findByText(/Adding to every workspace in this organization needs you signed in here in the browser\./)).toBeInTheDocument();
});

it("refuses a repo pattern with a wildcard owner before sending, and maps the server's 400 to the same hint", async () => {
  expect(badRepoPattern("*/web")).toBe(true);
  expect(badRepoPattern("acme/*")).toBe(false);
  routes["POST /bindings"] = () => [400, { error: "Invalid targets", code: "invalid_request" }];
  render(panel());
  await loaded();
  openAdvanced();
  const form = screen.getByRole("form", { name: "Add a custom permission" });
  fireEvent.change(within(form).getByLabelText("Merge PRs once checks pass"), { target: { value: "allow" } });
  fireEvent.change(within(form).getByLabelText("Repos"), { target: { value: "*/web" } });
  expect(within(form).getByRole("alert")).toHaveTextContent("Use owner/repo or owner/* for repos.");
  expect(within(form).getByRole("button", { name: "Add custom permission" })).toBeDisabled();
  fireEvent.change(within(form).getByLabelText("Repos"), { target: { value: "acme/* " } });
  fireEvent.click(within(form).getByRole("button", { name: "Add custom permission" }));
  await waitFor(() => expect(writes()).toHaveLength(1));
  // The patterns are fine, so the server's own message is shown, not the repo hint.
  expect(await within(form).findByText("Invalid targets")).toBeInTheDocument();
});

it("lists the workspaces an all-workspaces add skipped, with each reason in words", async () => {
  expect(skippedNote([{ workspace_id: "w9", reason: "not_enabled" }, { workspace_id: "w2", reason: "binding_exists" },
    { workspace_id: "w3", reason: "forbidden" }, { workspace_id: "w4", reason: "unavailable" }]))
    .toBe("Not added in 4 workspaces: w9 (delegation is off there); w2 (it already has a row for this); "
      + "w3 (you can't manage permissions there); w4 (it couldn't be reached; try that one again).");
  routes["POST /bindings"] = () => [201, { bindings: [binding()], skipped: [{ workspace_id: "w9", reason: "unavailable" }] }];
  render(panel());
  await loaded();
  fireEvent.click(screen.getByRole("button", { name: "Add permission" }));
  const form = screen.getByRole("form", { name: "Add permission" });
  fireEvent.click(within(form).getByLabelText("Apply to all workspaces in this organization"));
  fireEvent.click(within(form).getByRole("button", { name: "Add" }));
  expect(await screen.findByText("Added. Not added in 1 workspace: w9 (it couldn't be reached; try that one again).")).toBeInTheDocument();
});

it("an ordinary duplicate says the row exists and offers no conversion", async () => {
  routes["GET /bindings"] = () => [200, { bindings: [binding({ binding_id: "rul_ro", role: "read_only" })], recommendation: null }];
  routes["POST /bindings"] = () => [409, { error: "A binding for this principal already exists", code: "binding_exists", binding_id: "rul_ro" }];
  render(panel());
  await loaded();
  fireEvent.click(screen.getByRole("button", { name: "Add permission" }));
  fireEvent.click(within(screen.getByRole("form", { name: "Add permission" })).getByRole("button", { name: "Add" }));
  expect(await screen.findByText("There is already a row for this. Change its role in the table instead.")).toBeInTheDocument();
  expect(screen.queryByRole("group", { name: "Convert existing rule" })).not.toBeInTheDocument();
});

it("accepts an agent with no setting yet and a group member with no name", async () => {
  routes["GET /agents"] = () => [200, { agents: [agent({ effective: { binding_id: null, role: null, source: "none", grant_id: null } }),
    { ...agent({ agent_id: "agt_2", name: "second" }), effective: null }] }];
  routes["GET /groups"] = () => [200, { groups: [{ ...GROUPS[2]!, members: [{ agent_id: "agt_gone", name: null, proven: null, added_at: null }] }] }];
  render(panel());
  await loaded();
  fireEvent.click(screen.getByRole("button", { name: "Add permission" }));
  expect(within(screen.getByRole("form", { name: "Add permission" })).getByRole("option", { name: "helper (agt_1)" })).toBeInTheDocument();
  openAdvanced();
  expect(within(screen.getByRole("table", { name: "Your agents" })).getAllByText("No access")).toHaveLength(2);
  expect(screen.getByText("agt_gone")).toBeInTheDocument();
});

it("offers all workspaces only for built-in groups, and asks again for a principal that disappeared", async () => {
  let groups = GROUPS;
  routes["GET /groups"] = () => [200, { groups }];
  routes["DELETE /groups/grp_ops"] = () => { groups = GROUPS.filter((group) => group.group_id !== "grp_ops"); return [200, { revoked: "grp_ops", revoked_bindings: 0, revoked_grants: 0 }]; };
  render(panel());
  await loaded();
  fireEvent.click(screen.getByRole("button", { name: "Add permission" }));
  const form = () => screen.getByRole("form", { name: "Add permission" });
  expect(within(form()).getByLabelText("Apply to all workspaces in this organization")).toBeInTheDocument();
  fireEvent.change(within(form()).getByLabelText("Who"), { target: { value: "agent:agt_1" } });
  expect(within(form()).queryByLabelText("Apply to all workspaces in this organization")).not.toBeInTheDocument();
  fireEvent.change(within(form()).getByLabelText("Who"), { target: { value: "grp_ops" } });
  openAdvanced();
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  fireEvent.click(within(screen.getByRole("group", { name: "Confirm removal" })).getByRole("button", { name: "Delete group" }));
  await waitFor(() => expect(within(form()).getByLabelText("Who")).toHaveValue(""));
  expect(within(form()).getByRole("button", { name: "Add" })).toBeDisabled();
});

it("omits the comments-only limit once PR work is Never, and shows a custom row's actions", async () => {
  routes["GET /bindings"] = () => [200, { bindings: [binding({ binding_id: "rul_c", role: "custom", classes: ["merge", "pr_ops", "deploy"],
    require_tier_o: ["deploy"], pr_ops_limit: ["comment"] })], recommendation: null }];
  routes["POST /bindings"] = () => [201, { binding: binding({ role: "custom" }) }];
  render(panel());
  const table = await loaded();
  expect(within(table).getByText("Does: merge, pr_ops (only: comment); asks first: deploy")).toBeInTheDocument();
  openAdvanced();
  const form = screen.getByRole("form", { name: "Add a custom permission" });
  fireEvent.change(within(form).getByLabelText("Routine PR work"), { target: { value: "allow" } });
  fireEvent.click(within(form).getByLabelText("Pull request work: comments only"));
  fireEvent.change(within(form).getByLabelText("Routine PR work"), { target: { value: "never" } });
  fireEvent.change(within(form).getByLabelText("Deploy"), { target: { value: "allow" } });
  fireEvent.click(within(form).getByRole("button", { name: "Add custom permission" }));
  await waitFor(() => expect(writes()).toHaveLength(1));
  expect(writes()[0]!.body).not.toHaveProperty("pr_ops_limit");
});

it("keeps the draft and says nothing was added when every workspace was skipped", async () => {
  routes["POST /bindings"] = () => [201, { bindings: [], skipped: [{ workspace_id: "w1", reason: "binding_exists" }] }];
  render(panel());
  await loaded();
  fireEvent.click(screen.getByRole("button", { name: "Add permission" }));
  const form = screen.getByRole("form", { name: "Add permission" });
  fireEvent.click(within(form).getByLabelText("Apply to all workspaces in this organization"));
  fireEvent.click(within(form).getByRole("button", { name: "Add" }));
  expect(await screen.findByText("Nothing was added. Not added in 1 workspace: w1 (it already has a row for this).")).toBeInTheDocument();
  expect(screen.getByRole("form", { name: "Add permission" })).toBeInTheDocument();
  expect(screen.queryByText(/^Added\./)).not.toBeInTheDocument();
});

it("Exclude reads what decides the agent now, so a grant added since render is revoked too", async () => {
  let reads = 0;
  routes["GET /agents"] = () => { reads += 1; return [200, { agents: [reads === 1 ? agent()
    : agent({ effective: { binding_id: null, role: "custom", source: "explicit_grant", grant_id: "grt_new" } })] }]; };
  routes["POST /bindings"] = () => [201, { binding: binding({ binding_id: "rul_x", role: "excluded" }) }];
  routes["DELETE /grt_new"] = () => [200, { grant_id: "grt_new", owner_id: "u1", delegate_agent_id: "helper", scopes: [], require_tier_o: [],
    expires_at: "2099-01-01T00:00:00.000Z", status: "revoked" }];
  render(panel());
  await loaded();
  openAdvanced();
  fireEvent.click(within(screen.getByRole("table", { name: "Your agents" })).getByRole("button", { name: "Exclude" }));
  await waitFor(() => expect(writes()).toEqual([
    { method: "POST", path: "/bindings", body: { principal: { kind: "agent", ref: "agt_1" }, role: "excluded" } },
    { method: "DELETE", path: "/grt_new", body: {} },
  ]));
});

it("keeps the grant table mounted while Advanced is closed, so a grant change in flight still tells the page", async () => {
  let finish!: () => void;
  routes["GET /"] = () => [200, { grants: [{ grant_id: "grt_1", owner_id: "u1", delegate_agent_id: "assistant-1",
    scopes: [{ class: "merge", targets: ["acme/*"] }], require_tier_o: [], expires_at: "2099-01-01T00:00:00.000Z", status: "active" }] }];
  routes["DELETE /grt_1"] = () => new Promise((resolve) => { finish = () => resolve([200, { grant_id: "grt_1", owner_id: "u1",
    delegate_agent_id: "assistant-1", scopes: [], require_tier_o: [], expires_at: "2099-01-01T00:00:00.000Z", status: "revoked" }]); });
  const grantsChanged = vi.fn();
  render(panel({ onGrantsChanged: grantsChanged }));
  await loaded();
  openAdvanced();
  fireEvent.click(await screen.findByRole("button", { name: "Remove assistant-1" }));
  fireEvent.click(within(screen.getByRole("group", { name: "Confirm revocation" })).getByRole("button", { name: "Remove" }));
  openAdvanced();
  finish();
  await waitFor(() => expect(grantsChanged).toHaveBeenCalledTimes(1));
});

it("the Relay agents row is the trust rule: adding it turns trust on, Remove turns it off", async () => {
  let on = false;
  routes["GET /bindings"] = () => [200, { bindings: on ? [binding()] : [], recommendation: null }];
  routes["POST /bindings"] = () => { on = true; return [201, { binding: binding() }]; };
  routes["DELETE /bindings/rul_1"] = () => { on = false; return [200, { revoked: "rul_1", revoked_grants: 0 }]; };
  render(panel());
  await loaded();
  fireEvent.click(screen.getByRole("button", { name: "Add permission" }));
  fireEvent.change(within(screen.getByRole("form", { name: "Add permission" })).getByLabelText("Role"), { target: { value: "trusted" } });
  fireEvent.click(within(screen.getByRole("form", { name: "Add permission" })).getByRole("button", { name: "Add" }));
  expect(await screen.findByText(/your trust rule/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Remove Relay agents" }));
  fireEvent.click(within(screen.getByRole("group", { name: "Confirm removal" })).getByRole("button", { name: "Remove" }));
  await waitFor(() => expect(screen.queryByText(/your trust rule/)).not.toBeInTheDocument());
  expect(writes()).toEqual([
    { method: "POST", path: "/bindings", body: { principal: { kind: "relay_agents" }, role: "trusted" } },
    { method: "DELETE", path: "/bindings/rul_1", body: {} },
  ]);
});

it("does not claim no access when it could not check for a newer grant", async () => {
  let agentReads = 0;
  routes["GET /agents"] = () => { agentReads += 1; return agentReads === 1 ? [200, { agents: [agent()] }] : [503, { error: "Delegation is unavailable", code: "unavailable" }]; };
  routes["POST /bindings"] = () => [201, { binding: binding({ binding_id: "rul_x", role: "excluded" }) }];
  render(panel());
  await loaded();
  openAdvanced();
  fireEvent.click(within(screen.getByRole("table", { name: "Your agents" })).getByRole("button", { name: "Exclude" }));
  expect(await screen.findByText(/whether it still has its own grant couldn.t be checked/)).toBeInTheDocument();
  expect(screen.queryByText(/has no access now/)).not.toBeInTheDocument();
  expect(writes()).toEqual([{ method: "POST", path: "/bindings", body: { principal: { kind: "agent", ref: "agt_1" }, role: "excluded" } }]);
});

it("adds an agent to an existing custom group (PATCH add)", async () => {
  routes["GET /agents"] = () => [200, { agents: [agent(), agent({ agent_id: "agt_2", name: "second" })] }];
  routes["PATCH /groups/grp_ops"] = () => [200, { group: GROUPS[2] }];
  render(panel());
  await loaded();
  openAdvanced();
  expect(screen.getByRole("button", { name: "Add to Ops bots" })).toBeDisabled();
  // Choosing (as arrow keys do on a closed select) adds nothing until Add.
  fireEvent.change(screen.getByLabelText("Add an agent to Ops bots"), { target: { value: "agt_2" } });
  expect(writes()).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: "Add to Ops bots" }));
  await waitFor(() => expect(writes()).toEqual([{ method: "PATCH", path: "/groups/grp_ops", body: { add: ["agt_2"] } }]));
  expect(await screen.findByText("Added second to Ops bots.")).toBeInTheDocument();
});

it("edits a saved row into a custom permission with repos and expiry, as one PATCH of that row", async () => {
  routes["GET /bindings"] = () => [200, { bindings: [binding({ required_conditions: { merge: [{ type: "ci_green" }, { type: "mergeable" }] } })], recommendation: null }];
  routes["PATCH /bindings/rul_1"] = () => [200, { binding: binding({ role: "custom" }) }];
  render(panel());
  await loaded();
  fireEvent.click(screen.getByRole("button", { name: "Edit Relay agents" }));
  const form = screen.getByRole("form", { name: "Edit permission" });
  fireEvent.change(within(form).getByLabelText("Role"), { target: { value: "custom" } });
  fireEvent.change(within(form).getByLabelText("Edit Routine PR work"), { target: { value: "ask" } });
  fireEvent.click(within(form).getByLabelText("Pull request work: comments only"));
  fireEvent.change(within(form).getByLabelText("Repos"), { target: { value: "*/web" } });
  expect(within(form).getByRole("alert")).toHaveTextContent("Use owner/repo or owner/* for repos.");
  fireEvent.change(within(form).getByLabelText("Repos"), { target: { value: "acme/web acme/*" } });
  fireEvent.change(within(form).getByLabelText("Expires"), { target: { value: "never" } });
  fireEvent.click(within(form).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(writes()).toHaveLength(1));
  // Merge's conditions are carried along with the actions.
  expect(writes()[0]).toEqual({ method: "PATCH", path: "/bindings/rul_1", body: { role: "custom", classes: ["merge", "pr_ops"],
    require_tier_o: ["pr_ops"], required_conditions: { merge: [{ type: "ci_green" }, { type: "mergeable" }] },
    pr_ops_limit: ["comment"], targets: ["acme/web", "acme/*"], expires_at: null } });
  await waitFor(() => expect(screen.queryByRole("form", { name: "Edit permission" })).not.toBeInTheDocument());
});

it("edits a preset row's repos and keeps its expiry unless changed", async () => {
  routes["PATCH /bindings/rul_1"] = () => [200, { binding: binding() }];
  render(panel());
  await loaded();
  fireEvent.click(screen.getByRole("button", { name: "Edit Relay agents" }));
  const form = screen.getByRole("form", { name: "Edit permission" });
  fireEvent.change(within(form).getByLabelText("Repos"), { target: { value: "acme/web" } });
  fireEvent.click(within(form).getByRole("button", { name: "Save" }));
  // Only what changed: re-sending the role would re-resolve the preset from today's presets.
  await waitFor(() => expect(writes()).toEqual([{ method: "PATCH", path: "/bindings/rul_1", body: { targets: ["acme/web"] } }]));
});

it("offers no Edit on excluded or legacy rows", async () => {
  routes["GET /bindings"] = () => [200, { bindings: [
    binding({ binding_id: "rul_x", role: "excluded", principal: { kind: "agent", ref: "agt_1", name: "helper" } }),
    binding({ binding_id: "dtr_old", role: "legacy", principal: { kind: "all_agents", ref: null, name: "All my agents" } }),
    binding({ binding_id: "rul_ok", role: "standard", principal: { kind: "group", ref: "grp_ops", name: "Ops bots" } }),
  ], recommendation: null }];
  render(panel());
  await loaded();
  expect(screen.queryByRole("button", { name: "Edit helper" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Edit All my agents" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Edit Ops bots" })).toBeInTheDocument();
});

it("drops a class's conditions only with that class, and shows them while editing", async () => {
  routes["GET /bindings"] = () => [200, { bindings: [binding({ classes: ["merge", "pr_ops"],
    required_conditions: { merge: [{ type: "ci_green" }, { type: "mergeable" }] } })], recommendation: null }];
  routes["PATCH /bindings/rul_1"] = () => [200, { binding: binding({ role: "custom" }) }];
  render(panel());
  await loaded();
  fireEvent.click(screen.getByRole("button", { name: "Edit Relay agents" }));
  const form = screen.getByRole("form", { name: "Edit permission" });
  expect(within(form).getByText("Conditions kept: merge only when checks pass and mergeable.")).toBeInTheDocument();
  fireEvent.change(within(form).getByLabelText("Role"), { target: { value: "custom" } });
  fireEvent.change(within(form).getByLabelText("Edit Merge PRs once checks pass"), { target: { value: "never" } });
  fireEvent.click(within(form).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(writes()).toHaveLength(1));
  expect(writes()[0]!.body).toEqual({ role: "custom", classes: ["pr_ops"], require_tier_o: [], required_conditions: {}, pr_ops_limit: null });
});

it("blocks switching to Custom when the row's conditions can't be read", async () => {
  render(panel());
  await loaded();
  fireEvent.click(screen.getByRole("button", { name: "Edit Relay agents" }));
  const form = screen.getByRole("form", { name: "Edit permission" });
  fireEvent.change(within(form).getByLabelText("Role"), { target: { value: "custom" } });
  expect(within(form).getByRole("alert")).toHaveTextContent("This row's conditions can't be read here, so switching it to Custom would drop them.");
  expect(within(form).getByRole("button", { name: "Save" })).toBeDisabled();
});

it("keeps a custom row's other PR work limit unless the comments-only box changes", async () => {
  routes["GET /bindings"] = () => [200, { bindings: [binding({ binding_id: "rul_c", role: "custom", classes: ["pr_ops"],
    pr_ops_limit: ["label"], required_conditions: {} })], recommendation: null }];
  routes["PATCH /bindings/rul_c"] = () => [200, { binding: binding({ binding_id: "rul_c", role: "custom" }) }];
  render(panel());
  await loaded();
  fireEvent.click(screen.getByRole("button", { name: "Edit Relay agents" }));
  const form = screen.getByRole("form", { name: "Edit permission" });
  expect(within(form).getByLabelText("Pull request work: comments only")).not.toBeChecked();
  fireEvent.change(within(form).getByLabelText("Repos"), { target: { value: "acme/web" } });
  fireEvent.click(within(form).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(writes()).toEqual([{ method: "PATCH", path: "/bindings/rul_c", body: { targets: ["acme/web"] } }]));
});

it("Read-only switched to Custom, keeping PR work, keeps comments only", async () => {
  routes["GET /bindings"] = () => [200, { bindings: [binding({ role: "read_only", classes: ["pr_ops"], pr_ops_limit: ["comment"],
    required_conditions: {} })], recommendation: null }];
  routes["PATCH /bindings/rul_1"] = () => [200, { binding: binding({ role: "custom" }) }];
  render(panel());
  await loaded();
  fireEvent.click(screen.getByRole("button", { name: "Edit Relay agents" }));
  const form = screen.getByRole("form", { name: "Edit permission" });
  fireEvent.change(within(form).getByLabelText("Role"), { target: { value: "custom" } });
  expect(within(form).getByLabelText("Pull request work: comments only")).toBeChecked();
  fireEvent.click(within(form).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(writes()).toHaveLength(1));
  expect(writes()[0]!.body).toEqual({ role: "custom", classes: ["pr_ops"], require_tier_o: [], required_conditions: {}, pr_ops_limit: ["comment"] });
});

it("a custom row's own limit survives a change to its actions", async () => {
  routes["GET /bindings"] = () => [200, { bindings: [binding({ binding_id: "rul_c", role: "custom", classes: ["pr_ops"], pr_ops_limit: ["label"],
    required_conditions: {} })], recommendation: null }];
  routes["PATCH /bindings/rul_c"] = () => [200, { binding: binding({ binding_id: "rul_c", role: "custom" }) }];
  render(panel());
  await loaded();
  fireEvent.click(screen.getByRole("button", { name: "Edit Relay agents" }));
  const form = screen.getByRole("form", { name: "Edit permission" });
  fireEvent.change(within(form).getByLabelText("Edit Deploy"), { target: { value: "ask" } });
  fireEvent.click(within(form).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(writes()).toHaveLength(1));
  expect(writes()[0]!.body).toEqual({ classes: ["pr_ops", "deploy"], require_tier_o: ["deploy"], required_conditions: {}, pr_ops_limit: ["label"] });
});

it("shows conditions as kept only for actions still chosen", async () => {
  routes["GET /bindings"] = () => [200, { bindings: [binding({ classes: ["merge", "pr_ops"], required_conditions: { merge: [{ type: "ci_green" }] } })],
    recommendation: null }];
  render(panel());
  await loaded();
  fireEvent.click(screen.getByRole("button", { name: "Edit Relay agents" }));
  const form = screen.getByRole("form", { name: "Edit permission" });
  fireEvent.change(within(form).getByLabelText("Role"), { target: { value: "custom" } });
  expect(within(form).getByText("Conditions kept: merge only when checks pass.")).toBeInTheDocument();
  fireEvent.change(within(form).getByLabelText("Edit Merge PRs once checks pass"), { target: { value: "never" } });
  expect(within(form).queryByText(/Conditions kept/)).not.toBeInTheDocument();
});

it("closes the editor when another control changes the row, so the old draft can't be saved over it", async () => {
  let role = "trusted";
  routes["GET /bindings"] = () => [200, { bindings: [binding({ role, required_conditions: {} })], recommendation: null }];
  routes["PATCH /bindings/rul_1"] = () => {
    role = "standard";
    return [200, { binding: binding({ role: "standard" }) }];
  };
  render(panel());
  await loaded();
  fireEvent.click(screen.getByRole("button", { name: "Edit Relay agents" }));
  fireEvent.change(within(screen.getByRole("form", { name: "Edit permission" })).getByLabelText("Repos"), { target: { value: "acme/web" } });
  fireEvent.change(screen.getByRole("combobox", { name: "Role for Relay agents" }), { target: { value: "standard" } });
  expect(await screen.findByText("That row changed while you were editing it. Open Edit again to change it.")).toBeInTheDocument();
  expect(screen.queryByRole("form", { name: "Edit permission" })).not.toBeInTheDocument();
  expect(writes()).toEqual([{ method: "PATCH", path: "/bindings/rul_1", body: { role: "standard" } }]);
});

it("keeps the editor's own save from counting as someone else's change", async () => {
  let targets: string[] = [];
  routes["GET /bindings"] = () => [200, { bindings: [binding({ targets })], recommendation: null }];
  routes["PATCH /bindings/rul_1"] = () => {
    targets = ["acme/web"];
    return [200, { binding: binding({ targets }) }];
  };
  render(panel());
  await loaded();
  fireEvent.click(screen.getByRole("button", { name: "Edit Relay agents" }));
  const form = screen.getByRole("form", { name: "Edit permission" });
  fireEvent.change(within(form).getByLabelText("Repos"), { target: { value: "acme/web" } });
  fireEvent.click(within(form).getByRole("button", { name: "Save" }));
  expect(await screen.findByText("Saved Relay agents.")).toBeInTheDocument();
  expect(screen.queryByText(/That row changed while you were editing it/)).not.toBeInTheDocument();
});

it("treats a repeated repo as one, so removing a repo by repeating another still saves", async () => {
  routes["GET /bindings"] = () => [200, { bindings: [binding({ targets: ["acme/web", "acme/api"] })], recommendation: null }];
  routes["PATCH /bindings/rul_1"] = () => [200, { binding: binding({ targets: ["acme/web"] }) }];
  render(panel());
  await loaded();
  fireEvent.click(screen.getByRole("button", { name: "Edit Relay agents" }));
  const form = screen.getByRole("form", { name: "Edit permission" });
  fireEvent.change(within(form).getByLabelText("Repos"), { target: { value: "acme/web acme/web" } });
  fireEvent.click(within(form).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(writes()).toEqual([{ method: "PATCH", path: "/bindings/rul_1", body: { targets: ["acme/web"] } }]));
});

it("leaves a custom row's unreadable conditions to the server instead of sending none", async () => {
  routes["GET /bindings"] = () => [200, { bindings: [binding({ binding_id: "rul_c", role: "custom", classes: ["pr_ops"] })], recommendation: null }];
  routes["PATCH /bindings/rul_c"] = () => [200, { binding: binding({ binding_id: "rul_c", role: "custom" }) }];
  render(panel());
  await loaded();
  fireEvent.click(screen.getByRole("button", { name: "Edit Relay agents" }));
  const form = screen.getByRole("form", { name: "Edit permission" });
  fireEvent.change(within(form).getByLabelText("Edit Deploy"), { target: { value: "ask" } });
  fireEvent.click(within(form).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(writes()).toHaveLength(1));
  expect(writes()[0]!.body).not.toHaveProperty("required_conditions");
});

it("closes the editor when only the row's conditions changed elsewhere", async () => {
  let conditions: Record<string, Array<{ type: string }>> = { merge: [{ type: "ci_green" }] };
  routes["GET /bindings"] = () => [200, { bindings: [binding({ classes: ["merge", "pr_ops"], required_conditions: conditions })], recommendation: null }];
  const { rerender } = render(panel());
  await loaded();
  fireEvent.click(screen.getByRole("button", { name: "Edit Relay agents" }));
  fireEvent.change(within(screen.getByRole("form", { name: "Edit permission" })).getByLabelText("Role"), { target: { value: "custom" } });
  conditions = { merge: [{ type: "ci_green" }, { type: "mergeable" }] };
  rerender(panel({ refreshKey: 1 }));
  expect(await screen.findByText("That row changed while you were editing it. Open Edit again to change it.")).toBeInTheDocument();
  expect(screen.queryByRole("form", { name: "Edit permission" })).not.toBeInTheDocument();
  expect(writes()).toEqual([]);
});

it("clears its saving marker when a save fails, so a later change elsewhere still closes the draft", async () => {
  let role = "trusted";
  routes["GET /bindings"] = () => [200, { bindings: [binding({ role, required_conditions: {} })], recommendation: null }];
  routes["PATCH /bindings/rul_1"] = (call) => {
    const body = call.body as { role?: string };
    if (!body.role) return [500, { error: "Delegation is unavailable. Try again." }];
    role = body.role;
    return [200, { binding: binding({ role }) }];
  };
  render(panel());
  await loaded();
  fireEvent.click(screen.getByRole("button", { name: "Edit Relay agents" }));
  const form = screen.getByRole("form", { name: "Edit permission" });
  fireEvent.change(within(form).getByLabelText("Repos"), { target: { value: "acme/web" } });
  fireEvent.click(within(form).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(writes()).toHaveLength(1));
  await waitFor(() => expect(within(screen.getByRole("form", { name: "Edit permission" })).getByRole("button", { name: "Save" })).toBeEnabled());
  fireEvent.change(screen.getByRole("combobox", { name: "Role for Relay agents" }), { target: { value: "standard" } });
  expect(await screen.findByText("That row changed while you were editing it. Open Edit again to change it.")).toBeInTheDocument();
  expect(screen.queryByRole("form", { name: "Edit permission" })).not.toBeInTheDocument();
});
