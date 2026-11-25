import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { DelegationSection } from "./delegation";
import { rootLabel, TrustRuleCard } from "./trust-rule-card";

type Call = { method: string; path: string; body: unknown };
type Reply = [number, unknown] | Promise<[number, unknown]>;

const ROUTE = "/cloud/api/v1/workspaces/w1/delegates/trust-rule";
const OFF = { rule: null, covered: [], shadowed: [] };
const ON = {
  rule: { trust_rule_id: "dtr_1", owner_id: "u1", require_tier_o: ["deploy"], created_at: "2026-11-24T00:00:00.000Z",
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
      const tierO = (call.body as { require_tier_o: string[] }).require_tier_o;
      state = { ...ON, covered: [], shadowed: [], rule: { ...ON.rule, require_tier_o: tierO } };
      return [201, { rule: (state as typeof ON).rule }];
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

it("says plainly what the rule trusts, asks once with the Tier O classes, and sends a PUT", async () => {
  render(<TrustRuleCard workspaceId="w1" />);
  expect(screen.getByText(/no expiry and needs no tap from you/)).toBeInTheDocument();
  fireEvent.click(await screen.findByRole("button", { name: "Trust my connected assistants" }));
  expect(writes()).toEqual([]);
  expect(within(confirmGroup()).getByText(
    /Every connected assistant, every class, no expiry, no tap, until you revoke it or the connector\./,
  )).toBeInTheDocument();
  fireEvent.click(within(confirmGroup()).getByLabelText("release"));
  fireEvent.click(within(confirmGroup()).getByLabelText("merge"));
  fireEvent.click(screen.getByRole("button", { name: "Turn on the trust rule" }));
  expect(await screen.findByRole("button", { name: "Revoke trust rule" })).toBeInTheDocument();
  // Sent in the classes' canonical order.
  expect(writes()).toEqual([{ method: "PUT", path: ROUTE, body: { require_tier_o: ["merge", "release"] } }]);
  expect(screen.getByLabelText("merge")).toBeChecked();
  expect(screen.getByLabelText("deploy")).not.toBeChecked();
});

it("cancelling the confirmation sends nothing", async () => {
  render(<TrustRuleCard workspaceId="w1" />);
  fireEvent.click(await screen.findByRole("button", { name: "Trust my connected assistants" }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("group", { name: "Confirm turning on the trust rule" })).not.toBeInTheDocument();
  expect(writes()).toEqual([]);
});

it("lists each covered agent with its root kind and connector, and the bots whose own grant wins", async () => {
  state = ON;
  render(<TrustRuleCard workspaceId="w1" />);
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
  render(<TrustRuleCard workspaceId="w1" />);
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
  render(<TrustRuleCard workspaceId="w1" />);
  fireEvent.click(await screen.findByRole("button", { name: "Revoke trust rule" }));
  expect(await screen.findByRole("button", { name: "Trust my connected assistants" })).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("changes the Tier O classes of a rule that is on with the whole list", async () => {
  state = ON;
  render(<TrustRuleCard workspaceId="w1" />);
  expect(await screen.findByLabelText("deploy")).toBeChecked();
  const save = screen.getByRole("button", { name: "Save" });
  expect(save).toBeDisabled();
  fireEvent.click(screen.getByLabelText("spend"));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(writes()).toEqual([{ method: "PUT", path: ROUTE, body: { require_tier_o: ["deploy", "spend"] } }]));
  await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeDisabled());
  expect(screen.getByLabelText("spend")).toBeChecked();
});

it("shows the API's error and a network failure", async () => {
  reply = (call) => (call.method === "PUT" ? [403, { error: "Delegation is off for this workspace", code: "not_enabled" }] : undefined);
  render(<TrustRuleCard workspaceId="w1" />);
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
  const { unmount } = render(<TrustRuleCard workspaceId="w1" />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Delegation is unavailable");
  fails = false;
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByRole("button", { name: "Trust my connected assistants" })).toBeInTheDocument();
  unmount();
  reply = (call) => (call.path === ROUTE ? [404, { error: "not_found", message: "Not found" }] : undefined);
  const { container } = render(<TrustRuleCard workspaceId="w1" />);
  await waitFor(() => expect(calls.filter((call) => call.path === ROUTE)).toHaveLength(3));
  await waitFor(() => expect(container).toBeEmptyDOMElement());
});

it("shows under Trusted delegates only while delegation is on", async () => {
  let enabled = true;
  reply = (call) => {
    if (!call.path.endsWith("/delegates/policy")) return undefined;
    if (call.method === "PUT") enabled = (call.body as { delegation_enabled: boolean }).delegation_enabled;
    return [200, { delegation_enabled: enabled, max_expiry_days: 30 }];
  };
  render(<DelegationSection workspaceId="w1" canManage />);
  expect(await screen.findByText("Trust rule")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("switch"));
  await waitFor(() => expect(screen.queryByText("Trust rule")).not.toBeInTheDocument());
  expect(screen.getByText("Delegation is off")).toBeInTheDocument();
});

it("drops an answer that arrives after a workspace switch", async () => {
  let finish!: (reply: [number, unknown]) => void;
  reply = (call) => (call.method === "PUT" ? new Promise((resolve) => { finish = resolve; }) : undefined);
  const keyed = (workspaceId: string) => <TrustRuleCard key={workspaceId} workspaceId={workspaceId} />;
  const { rerender } = render(keyed("w1"));
  fireEvent.click(await screen.findByRole("button", { name: "Trust my connected assistants" }));
  fireEvent.click(screen.getByRole("button", { name: "Turn on the trust rule" }));
  rerender(keyed("w2"));
  await act(async () => finish([403, { error: "stale answer for w1", code: "forbidden" }]));
  expect(screen.queryByText("stale answer for w1")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Revoke trust rule" })).not.toBeInTheDocument();
});
