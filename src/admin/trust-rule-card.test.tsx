import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { DelegationSection } from "./delegation";
import { rootLabel, TrustRuleCard } from "./trust-rule-card";

type Call = { method: string; path: string; body: unknown };
type Reply = [number, unknown] | Promise<[number, unknown]>;

const ROUTE = "/cloud/api/v1/workspaces/w1/delegates/trust-rule";
const OFF = { rule: null, covered: [], shadowed: [] };
const ON = {
  rule: { trust_rule_id: "dtr_1", owner_id: "u1", require_tier_o: [], created_at: "2026-11-24T00:00:00.000Z",
    updated_at: "2026-11-24T00:00:00.000Z" },
  shadowed: [{ grant_id: "g", delegate_agent_id: "bot-2", expires_at: "2026-12-24T00:00:00.000Z" }],
  covered: [
    { grant_id: "grt_1", delegate_agent_id: "bot-1", created_at: "x", root_kind: "connector", connector: "grok-bot",
      root_agent_id: "bot-1", launched_by: null, hops: 0 },
    { grant_id: "grt_2", delegate_agent_id: "worker-1", created_at: "x", root_kind: "connector", connector: "grok-bot",
      root_agent_id: "bot-1", launched_by: "bot-1", hops: 1 },
    { grant_id: "grt_3", delegate_agent_id: "claimed-1", created_at: "x", root_kind: "claim", connector: null,
      root_agent_id: "claimed-1", launched_by: null, hops: 0 },
  ],
};
let calls: Call[] = [];
let state: unknown = OFF;
let reply: ((call: Call) => Reply | undefined) | null = null;

function respond(call: Call): Reply {
  const custom = reply?.(call);
  if (custom) return custom;
  if (call.path === ROUTE) {
    if (call.method === "PUT") {
      state = { ...ON, covered: [], shadowed: [] };
      return [201, { rule: ON.rule }];
    }
    if (call.method === "DELETE") {
      state = OFF;
      return [200, { revoked: "dtr_1", revoked_grants: ["grt_1"] }];
    }
    return [200, state];
  }
  if (call.path.endsWith("/delegates/policy")) return [200, { delegation_enabled: true, max_expiry_days: 30 }];
  if (call.path.endsWith("/delegates")) return [200, { grants: [] }];
  return [404, { error: "not_found", message: "no fake" }];
}

beforeEach(() => {
  calls = [];
  state = OFF;
  reply = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const call: Call = { method: init.method ?? "GET", path: input, body: init.body ? JSON.parse(init.body as string) : undefined };
      calls.push(call);
      const [status, body] = await respond(call);
      return new Response(JSON.stringify(body), { status });
    }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const writes = () => calls.filter((call) => call.method !== "GET");
const confirmGroup = () => screen.getByRole("group", { name: "Confirm turning on the trust rule" });

it("says plainly what the rule trusts, asks once, and sends a PUT of {} (no class keeps a tap)", async () => {
  render(<TrustRuleCard workspaceId="w1" delegationEnabled />);
  expect(screen.getByText(/no expiry and needs no tap from you/)).toBeInTheDocument();
  fireEvent.click(await screen.findByRole("button", { name: "Trust my connected assistants" }));
  expect(writes()).toEqual([]);
  expect(within(confirmGroup()).getByText(
    /Every connected assistant, every class, no expiry, no tap, until you revoke it or the connector\./,
  )).toBeInTheDocument();
  // No per-class choice: Cloud's card has none either.
  expect(within(confirmGroup()).queryByRole("checkbox")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Turn on the trust rule" }));
  expect(await screen.findByRole("button", { name: "Revoke trust rule" })).toBeInTheDocument();
  expect(writes()).toEqual([{ method: "PUT", path: ROUTE, body: {} }]);
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
});

it("cancelling the confirmation sends nothing", async () => {
  render(<TrustRuleCard workspaceId="w1" delegationEnabled />);
  fireEvent.click(await screen.findByRole("button", { name: "Trust my connected assistants" }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("group", { name: "Confirm turning on the trust rule" })).not.toBeInTheDocument();
  expect(writes()).toEqual([]);
});

it("lists each covered agent with its root kind and connector, and the bots whose own grant wins", async () => {
  state = ON;
  render(<TrustRuleCard workspaceId="w1" delegationEnabled />);
  const list = await screen.findByRole("list", { name: "Agents the trust rule covers" });
  const items = within(list).getAllByRole("listitem").map((item) => item.textContent);
  expect(items).toEqual([
    "bot-1 · connector Grok",
    "worker-1 · started by bot-1 under connector Grok bot-1",
    "claimed-1 · claimed bot",
  ]);
  expect(screen.getByText(/1 bot uses its own grant/)).toBeInTheDocument();
  expect(rootLabel({ root_kind: "connector", connector: "other-bot" })).toBe("connector other-bot");
  expect(rootLabel({ root_kind: null, connector: null })).toBe("connected assistant");
});

it("revokes in one click", async () => {
  state = ON;
  render(<TrustRuleCard workspaceId="w1" delegationEnabled />);
  fireEvent.click(await screen.findByRole("button", { name: "Revoke trust rule" }));
  expect(await screen.findByRole("button", { name: "Trust my connected assistants" })).toBeInTheDocument();
  expect(writes()).toEqual([{ method: "DELETE", path: ROUTE, body: {} }]);
});

it("a revoke that finds no rule still shows the rule off", async () => {
  state = ON;
  reply = (call) => {
    if (call.method !== "DELETE") return undefined;
    state = OFF;
    return [404, { error: "No trust rule is on", code: "not_found" }];
  };
  render(<TrustRuleCard workspaceId="w1" delegationEnabled />);
  fireEvent.click(await screen.findByRole("button", { name: "Revoke trust rule" }));
  expect(await screen.findByRole("button", { name: "Trust my connected assistants" })).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("with delegation off, offers no way to turn the rule on", async () => {
  render(<TrustRuleCard workspaceId="w1" delegationEnabled={false} />);
  expect(await screen.findByText("Turn on Trusted delegates to use the trust rule.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Trust my connected assistants" })).not.toBeInTheDocument();
  expect(writes()).toEqual([]);
});

it("with delegation off, a rule that is on can still be revoked", async () => {
  state = ON;
  render(<TrustRuleCard workspaceId="w1" delegationEnabled={false} />);
  expect(await screen.findByText(/the rule covers nothing until it is turned back on/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Revoke trust rule" }));
  expect(await screen.findByText("Turn on Trusted delegates to use the trust rule.")).toBeInTheDocument();
  expect(writes()).toEqual([{ method: "DELETE", path: ROUTE, body: {} }]);
});

it("shows the API's error and a network failure", async () => {
  reply = (call) => (call.method === "PUT" ? [403, { error: "Delegation is off for this workspace", code: "not_enabled" }] : undefined);
  render(<TrustRuleCard workspaceId="w1" delegationEnabled />);
  fireEvent.click(await screen.findByRole("button", { name: "Trust my connected assistants" }));
  fireEvent.click(screen.getByRole("button", { name: "Turn on the trust rule" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Delegation is off for this workspace");
  expect(screen.getByRole("button", { name: "Trust my connected assistants" })).toBeEnabled();
  reply = (call) => (call.method === "PUT" ? Promise.reject(new TypeError("Failed to fetch")) : undefined);
  fireEvent.click(screen.getByRole("button", { name: "Trust my connected assistants" }));
  fireEvent.click(screen.getByRole("button", { name: "Turn on the trust rule" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Could not reach the server. Try again."));
});

it("shows a failed read with a retry, and hides on a relay-control without the route", async () => {
  let fails = true;
  reply = (call) => (call.method === "GET" && fails ? [503, { error: "Delegation is unavailable", code: "unavailable" }] : undefined);
  const { unmount } = render(<TrustRuleCard workspaceId="w1" delegationEnabled />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Delegation is unavailable");
  fails = false;
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByRole("button", { name: "Trust my connected assistants" })).toBeInTheDocument();
  unmount();
  reply = (call) => (call.path === ROUTE ? [404, { error: "not_found", message: "Not found" }] : undefined);
  const { container } = render(<TrustRuleCard workspaceId="w1" delegationEnabled />);
  await waitFor(() => expect(calls.filter((call) => call.path === ROUTE)).toHaveLength(3));
  await waitFor(() => expect(container).toBeEmptyDOMElement());
});

it("stays under Trusted delegates when delegation is turned off, with revoke and without enabling", async () => {
  state = ON;
  let enabled = true;
  reply = (call) => {
    if (!call.path.endsWith("/delegates/policy")) return undefined;
    if (call.method === "PUT") enabled = (call.body as { delegation_enabled: boolean }).delegation_enabled;
    return [200, { delegation_enabled: enabled, max_expiry_days: 30 }];
  };
  render(<DelegationSection workspaceId="w1" canManage />);
  expect(await screen.findByText("Trust rule")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("switch"));
  expect(await screen.findByText(/the rule covers nothing until it is turned back on/)).toBeInTheDocument();
  expect(screen.getByText("Delegation is off")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Revoke trust rule" })).toBeEnabled();
});

it("drops an answer that arrives after a workspace switch", async () => {
  let finish!: (reply: [number, unknown]) => void;
  reply = (call) => (call.method === "PUT" ? new Promise((resolve) => { finish = resolve; }) : undefined);
  const keyed = (workspaceId: string) => <TrustRuleCard key={workspaceId} workspaceId={workspaceId} delegationEnabled />;
  const { rerender } = render(keyed("w1"));
  fireEvent.click(await screen.findByRole("button", { name: "Trust my connected assistants" }));
  fireEvent.click(screen.getByRole("button", { name: "Turn on the trust rule" }));
  rerender(keyed("w2"));
  await act(async () => finish([403, { error: "stale answer for w1", code: "forbidden" }]));
  expect(screen.queryByText("stale answer for w1")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Revoke trust rule" })).not.toBeInTheDocument();
});

it("applies a successful turn-on at once, and shows a failed re-read with a retry", async () => {
  let reads = 0;
  reply = (call) => (call.path === ROUTE && call.method === "GET" && ++reads > 1
    ? [503, { error: "Delegation is unavailable", code: "unavailable" }] : undefined);
  render(<TrustRuleCard workspaceId="w1" delegationEnabled />);
  fireEvent.click(await screen.findByRole("button", { name: "Trust my connected assistants" }));
  fireEvent.click(screen.getByRole("button", { name: "Turn on the trust rule" }));
  expect(await screen.findByRole("button", { name: "Revoke trust rule" })).toBeInTheDocument();
  expect(await screen.findByRole("alert")).toHaveTextContent("Delegation is unavailable");
  expect(screen.queryByRole("button", { name: "Trust my connected assistants" })).not.toBeInTheDocument();
  reply = null;
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  expect(screen.getByRole("button", { name: "Revoke trust rule" })).toBeInTheDocument();
});

it("applies a successful revoke at once: while the re-read is in flight, the rule is off and nothing can re-send", async () => {
  state = ON;
  let finishReread!: (reply: [number, unknown]) => void;
  let reads = 0;
  reply = (call) => (call.path === ROUTE && call.method === "GET" && ++reads === 2
    ? new Promise((resolve) => { finishReread = resolve; }) : undefined);
  render(<TrustRuleCard workspaceId="w1" delegationEnabled />);
  fireEvent.click(await screen.findByRole("button", { name: "Revoke trust rule" }));
  expect(await screen.findByRole("button", { name: "Trust my connected assistants" })).toBeInTheDocument();
  await waitFor(() => expect(reads).toBe(2));
  expect(screen.queryByRole("button", { name: "Revoke trust rule" })).not.toBeInTheDocument();
  expect(screen.queryByText("bot-1")).not.toBeInTheDocument();
  expect(writes()).toEqual([{ method: "DELETE", path: ROUTE, body: {} }]);
  await act(async () => finishReread([200, OFF]));
  expect(screen.getByRole("button", { name: "Trust my connected assistants" })).toBeInTheDocument();
});

it("a read issued before a successful write never replaces what the write confirmed", async () => {
  // Read 1 answers off; read 2 (a retry issued before the write) is held and answers "off" after the
  // turn-on; the turn-on's re-read (read 3) fails.
  let reads = 0;
  let finishSecond!: (reply: [number, unknown]) => void;
  reply = (call) => {
    if (call.path !== ROUTE || call.method !== "GET") return undefined;
    reads += 1;
    if (reads === 1) return [503, { error: "Delegation is unavailable", code: "unavailable" }];
    if (reads === 2) return new Promise((resolve) => { finishSecond = resolve; });
    if (reads >= 4) return [503, { error: "Delegation is unavailable", code: "unavailable" }];
    return undefined;
  };
  render(<TrustRuleCard workspaceId="w1" delegationEnabled />);
  fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  // Read 3 answers off and is applied; read 2 is still in flight.
  fireEvent.click(await screen.findByRole("button", { name: "Trust my connected assistants" }));
  fireEvent.click(screen.getByRole("button", { name: "Turn on the trust rule" }));
  expect(await screen.findByRole("button", { name: "Revoke trust rule" })).toBeInTheDocument();
  await waitFor(() => expect(reads).toBe(4));
  await act(async () => finishSecond([200, OFF]));
  expect(screen.getByRole("button", { name: "Revoke trust rule" })).toBeInTheDocument();
});

it("follows a Trusted delegates change at once, even when the policy re-read fails", async () => {
  let enabled = false;
  let policyReads = 0;
  reply = (call) => {
    if (!call.path.endsWith("/delegates/policy")) return undefined;
    if (call.method === "PUT") {
      enabled = (call.body as { delegation_enabled: boolean }).delegation_enabled;
      return [200, { delegation_enabled: enabled, max_expiry_days: 30 }];
    }
    return ++policyReads > 1 ? [503, { error: "Delegation is unavailable", code: "unavailable" }]
      : [200, { delegation_enabled: enabled, max_expiry_days: 30 }];
  };
  render(<DelegationSection workspaceId="w1" canManage />);
  expect(await screen.findByText("Turn on Trusted delegates to use the trust rule.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("switch"));
  fireEvent.click(screen.getByRole("button", { name: "Turn on delegation" }));
  expect(await screen.findByRole("button", { name: "Trust my connected assistants" })).toBeInTheDocument();
  await waitFor(() => expect(policyReads).toBe(2));
  expect(screen.queryByText("Turn on Trusted delegates to use the trust rule.")).not.toBeInTheDocument();
});

it("re-reads the rule after a grant is revoked under Delegates, so the shadowed count follows", async () => {
  state = ON;
  let ownGrantLive = true;
  reply = (call) => {
    if (call.path.endsWith("/delegates/policy")) return [200, { delegation_enabled: true, max_expiry_days: 30 }];
    if (call.path === `${ROUTE.replace("/trust-rule", "")}` && call.method === "GET") {
      return [200, { grants: ownGrantLive ? [{ grant_id: "g", owner_id: "u1", delegate_agent_id: "bot-2",
        scopes: [{ class: "merge", targets: ["acme/*"] }], require_tier_o: [], expires_at: "2026-12-24T00:00:00.000Z",
        status: "active" }] : [] }];
    }
    if (call.method === "DELETE" && call.path.endsWith("/delegates/g")) {
      ownGrantLive = false;
      state = { ...ON, shadowed: [] };
      return [200, { grant_id: "g", owner_id: "u1", delegate_agent_id: "bot-2", scopes: [], require_tier_o: [],
        expires_at: "2026-12-24T00:00:00.000Z", status: "revoked" }];
    }
    return undefined;
  };
  render(<DelegationSection workspaceId="w1" canManage />);
  expect(await screen.findByText(/1 bot uses its own grant/)).toBeInTheDocument();
  fireEvent.click(await screen.findByRole("button", { name: "Revoke bot-2" }));
  fireEvent.click(within(screen.getByRole("group", { name: "Confirm revocation" })).getByRole("button", { name: "Revoke" }));
  await waitFor(() => expect(screen.queryByText(/1 bot uses its own grant/)).not.toBeInTheDocument());
});

it("re-reads the Delegates list after the rule is revoked, since revoking it ends the grants it created", async () => {
  state = ON;
  let ruleGrantLive = true;
  reply = (call) => {
    if (call.path.endsWith("/delegates/policy")) return [200, { delegation_enabled: true, max_expiry_days: 30 }];
    if (call.path === ROUTE && call.method === "DELETE") ruleGrantLive = false;
    if (call.path === `${ROUTE.replace("/trust-rule", "")}` && call.method === "GET") {
      return [200, { grants: [{ grant_id: "grt_1", owner_id: "u1", delegate_agent_id: "bot-1",
        scopes: [{ class: "merge", targets: ["*"] }], require_tier_o: [], expires_at: "2026-12-24T00:00:00.000Z",
        status: ruleGrantLive ? "active" : "revoked" }] }];
    }
    return undefined;
  };
  render(<DelegationSection workspaceId="w1" canManage />);
  expect(await screen.findByRole("button", { name: "Revoke bot-1" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Revoke trust rule" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Revoke bot-1" })).not.toBeInTheDocument());
  expect(screen.getByText(/^revoked, expires/)).toBeInTheDocument();
});

it("re-reads the rule after revoke-all under Delegates, which also ends the rule", async () => {
  state = ON;
  reply = (call) => {
    if (call.path.endsWith("/delegates/policy")) return [200, { delegation_enabled: true, max_expiry_days: 30 }];
    if (call.method === "POST" && call.path.endsWith("/delegates/revoke-all")) {
      state = OFF;
      return [200, { revoked: ["grt_1"] }];
    }
    return undefined;
  };
  render(<DelegationSection workspaceId="w1" canManage />);
  expect(await screen.findByRole("button", { name: "Revoke trust rule" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Revoke all my grants and approvals" }));
  expect(screen.getByText(/your trust rule are revoked/)).toBeInTheDocument();
  fireEvent.click(within(screen.getByRole("group", { name: "Confirm revocation" })).getByRole("button", { name: "Revoke" }));
  expect(await screen.findByRole("button", { name: "Trust my connected assistants" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Revoke trust rule" })).not.toBeInTheDocument();
});

it("re-reads the rule after a Trusted delegates change is saved", async () => {
  state = ON;
  let enabled = true;
  reply = (call) => {
    if (!call.path.endsWith("/delegates/policy")) return undefined;
    if (call.method === "PUT") enabled = (call.body as { delegation_enabled: boolean }).delegation_enabled;
    return [200, { delegation_enabled: enabled, max_expiry_days: 30 }];
  };
  render(<DelegationSection workspaceId="w1" canManage />);
  expect(await screen.findByRole("button", { name: "Revoke trust rule" })).toBeInTheDocument();
  const ruleReads = () => calls.filter((call) => call.method === "GET" && call.path === ROUTE).length;
  const before = ruleReads();
  fireEvent.click(screen.getByRole("switch"));
  expect(await screen.findByText("Delegation is off")).toBeInTheDocument();
  await waitFor(() => expect(ruleReads()).toBeGreaterThan(before));
});
