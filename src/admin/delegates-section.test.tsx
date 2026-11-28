import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { DelegateGrant } from "./contracts";
import { CAN_OPTIONS, DelegatesSection, expiryOptions } from "./delegates-section";

type Call = { method: string; path: string; body: unknown };
type Handler = (call: Call) => [number, unknown] | Promise<[number, unknown]>;

const BASE = "/cloud/api/v1/workspaces/w1/delegates";
let calls: Call[] = [];
let routes: Record<string, Handler> = {};

const grant = (overrides: Partial<DelegateGrant> = {}): DelegateGrant => ({
  grant_id: "grt_abcdefgh1", owner_id: "u1", delegate_agent_id: "assistant-1",
  scopes: [{ class: "merge", targets: ["acme/*"] }], require_tier_o: [],
  expires_at: "2099-12-24T00:00:00.000Z", status: "active", ...overrides,
});

beforeEach(() => {
  calls = [];
  routes = {};
  // Plain response objects (what the API client reads), so fake timers cannot stall reading a body.
  vi.stubGlobal("fetch", vi.fn(async (input: string, init: RequestInit = {}) => {
    const call: Call = { method: init.method ?? "GET", path: input, body: init.body ? JSON.parse(init.body as string) : undefined };
    calls.push(call);
    const rest = input.startsWith(BASE) ? input.slice(BASE.length) : input;
    const key = `${call.method} ${rest.startsWith("?") || !rest ? `/${rest}` : rest}`;
    const handler = routes[key];
    const [status, body] = handler ? await handler(call) : [500, { error: `unexpected ${key}` }];
    return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
  }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const section = (props: Partial<Parameters<typeof DelegatesSection>[0]> = {}) => (
  <DelegatesSection workspaceId="w1" delegationEnabled maxExpiryDays={30} isAdmin={false} {...props} />
);
const writes = () => calls.filter((call) => call.method !== "GET");
const confirmGroup = () => screen.getByRole("group", { name: "Confirm revocation" });
const addForm = () => screen.getByRole("form", { name: "Add grant" });
const submitButton = () => within(addForm()).getByRole("button", { name: "Add grant" });

it("shows one row per grant: agent, can (with ask me first), on, expires; inactive rows have no Remove", async () => {
  routes = { "GET /": () => [200, { grants: [
    grant({ scopes: [{ class: "release", targets: ["acme/web", "acme/*"] }], require_tier_o: ["release"] }),
    grant({ grant_id: "grt_old", delegate_agent_id: "old-agent", status: "revoked" }),
    grant({ grant_id: "grt_rule", delegate_agent_id: "rule-agent", scopes: [], trust_rule_id: "rul_1" }),
    grant({ grant_id: "grt_ro", delegate_agent_id: "reader-bot", trust_rule_id: "rul_2",
      scopes: [{ class: "pr_ops", targets: [], ops: ["comment"] }] }),
    grant({ grant_id: "grt_tr", delegate_agent_id: "trusted-bot", trust_rule_id: "rul_3", require_tier_o: ["deploy"],
      scopes: [{ class: "merge", targets: [], conditions: [{ type: "ci_green" }, { type: "mergeable" }] }, { class: "deploy", targets: [] }] }),
  ] }] };
  render(section());
  expect(await screen.findByText("assistant-1")).toBeInTheDocument();
  expect(screen.getByText("release, ask me first")).toBeInTheDocument();
  expect(screen.getByText("acme/web acme/*")).toBeInTheDocument();
  // A rule from before roles (no scopes) reads as every action; a system grant shows its binding's scopes, never "all".
  expect(screen.getByText("All actions (set before roles)")).toBeInTheDocument();
  expect(screen.getByText("pr_ops (only: comment)")).toBeInTheDocument();
  expect(screen.getByText("merge (when checks pass and mergeable)")).toBeInTheDocument();
  expect(screen.getByText("deploy, ask me first")).toBeInTheDocument();
  expect(screen.getAllByText("Everything I own").length).toBeGreaterThan(0);
  expect(screen.queryByText("all (trust rule)")).not.toBeInTheDocument();
  expect(screen.getByText("revoked")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Remove assistant-1" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Remove old-agent" })).not.toBeInTheDocument();
});

it("does not list approver grants: those are in the Approvers section", async () => {
  routes = { "GET /": () => [200, { grants: [grant(), grant({ grant_id: "grt_appr", delegate_agent_id: "approver-1", kind: "approver",
    delegate_address: "approver@host-1", github_logins: ["approver-login"], scopes: [{ class: "release", targets: ["acme/web:land:*:*"] }] })] }] };
  render(section());
  expect(await screen.findByText("assistant-1")).toBeInTheDocument();
  expect(screen.queryByText("approver-1")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Remove approver-1" })).not.toBeInTheDocument();
});

it("adds a grant: disabled until valid, ask-me-first maps to require_tier_o, expiry only behind Set expiry", async () => {
  routes = { "GET /": () => [200, { grants: [] }], "POST /": () => [201, grant()] };
  render(section());
  expect(await screen.findByText("No explicit grants.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Add grant" }));
  expect(submitButton()).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Agent"), { target: { value: "my agent" } });
  fireEvent.change(screen.getByLabelText("On"), { target: { value: "acme/*" } });
  expect(screen.getByRole("alert")).toHaveTextContent("An agent id has no spaces.");
  expect(submitButton()).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Agent"), { target: { value: "agt_1" } });
  expect(submitButton()).toBeEnabled();
  expect(CAN_OPTIONS.find((option) => option.value === "merge:ask")?.label).toBe("merge (ask me first)");
  fireEvent.change(screen.getByLabelText("Can"), { target: { value: "merge:ask" } });
  expect(screen.queryByLabelText("Expires after")).not.toBeInTheDocument();
  fireEvent.click(submitButton());
  await waitFor(() => expect(writes()).toHaveLength(1));
  expect(writes()[0]!.body).toEqual({ delegate_agent_id: "agt_1", scopes: [{ class: "merge", targets: ["acme/*"] }], require_tier_o: ["merge"] });

  fireEvent.click(await screen.findByRole("button", { name: "Add grant" }));
  fireEvent.change(screen.getByLabelText("Agent"), { target: { value: "agt_1" } });
  fireEvent.change(screen.getByLabelText("On"), { target: { value: "acme/*" } });
  expect(expiryOptions(30)).toEqual([7, 30]);
  fireEvent.click(screen.getByRole("button", { name: /Set expiry/ }));
  fireEvent.change(screen.getByLabelText("Expires after"), { target: { value: "7" } });
  fireEvent.click(submitButton());
  await waitFor(() => expect(writes()).toHaveLength(2));
  expect(typeof (writes()[1]!.body as { expires_at: unknown }).expires_at).toBe("string");
  expect(writes()[1]!.body).not.toHaveProperty("require_tier_o");
});

it("keeps a literal comma inside a resource, refuses one used as a separator, and shows the server's refusal", async () => {
  routes = {
    "GET /": () => [200, { grants: [] }],
    "POST /": () => [403, { error: "The agent must be bound to you; claim it first", code: "not_delegate" }],
  };
  render(section());
  fireEvent.click(await screen.findByRole("button", { name: "Add grant" }));
  fireEvent.change(screen.getByLabelText("Agent"), { target: { value: "agt_1" } });
  fireEvent.change(screen.getByLabelText("On"), { target: { value: "acme, channel:ops" } });
  expect(screen.getByRole("alert")).toHaveTextContent("Separate resources with spaces");
  fireEvent.click(screen.getByRole("button", { name: "Remove acme," }));
  fireEvent.change(screen.getByLabelText("On"), { target: { value: "channel:ops,security channel:eng" } });
  fireEvent.click(submitButton());
  expect(await screen.findByRole("alert")).toHaveTextContent("The agent must be bound to you; claim it first");
  expect((writes()[0]!.body as { scopes: Array<{ targets: string[] }> }).scopes[0]!.targets).toEqual(["channel:ops,security", "channel:eng"]);
  // A refusal keeps the form open as typed.
  expect(screen.getByLabelText("Agent")).toHaveValue("agt_1");
});

it("on grant_exists, says where the existing grant is, including under Approvers", async () => {
  routes = {
    "GET /": () => [200, { grants: [] }],
    "POST /": () => [409, { error: "The agent already has an active grant", code: "grant_exists" }],
  };
  render(section());
  fireEvent.click(await screen.findByRole("button", { name: "Add grant" }));
  fireEvent.change(screen.getByLabelText("Agent"), { target: { value: "agt_1" } });
  fireEvent.change(screen.getByLabelText("On"), { target: { value: "acme/*" } });
  fireEvent.click(submitButton());
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "This agent already has a grant. Narrow or remove it in this table, or, if it's an approver, under Approvers.");
});

it("removes a grant after a confirmation; a permission-row grant's confirmation says the agent is excluded", async () => {
  let grants = [grant(), grant({ grant_id: "grt_rule", delegate_agent_id: "rule-agent", scopes: [], trust_rule_id: "rul_1" })];
  routes = {
    "GET /": () => [200, { grants }],
    "DELETE /grt_abcdefgh1": () => { grants = [grant({ status: "revoked" }), grants[1]!]; return [200, grants[0]]; },
  };
  render(section());
  fireEvent.click(await screen.findByRole("button", { name: "Remove rule-agent" }));
  expect(confirmGroup()).toHaveTextContent("the agent is excluded: it gets nothing until you give it its own setting");
  fireEvent.click(screen.getByRole("button", { name: "Remove assistant-1" }));
  expect(confirmGroup()).toHaveTextContent("Revoke this grant?");
  fireEvent.click(within(confirmGroup()).getByRole("button", { name: "Remove" }));
  expect(await screen.findByText("Removed.")).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByRole("button", { name: "Remove assistant-1" })).not.toBeInTheDocument());
});

it("revoke everything sits in the overflow menu, asks first, and covers the view on screen", async () => {
  routes = {
    "GET /": () => [200, { grants: [grant()] }],
    "GET /?all=1": () => [200, { grants: [grant()] }],
    "POST /revoke-all": () => [200, { revoked: ["grt_abcdefgh1"] }],
  };
  render(section({ isAdmin: true }));
  await screen.findByText("assistant-1");
  expect(screen.queryByText("Revoke everything")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "More actions" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Revoke everything" }));
  expect(confirmGroup()).toHaveTextContent("every permission row of yours (Relay agents, connector and group rows, single agents and exclusions, and your old trust rule) is removed");
  fireEvent.click(within(confirmGroup()).getByRole("button", { name: "Revoke everything" }));
  await waitFor(() => expect(writes()).toEqual([{ method: "POST", path: `${BASE}/revoke-all`, body: {} }]));
  fireEvent.click(screen.getByRole("switch", { name: "Show every grant in the workspace" }));
  await screen.findByText("assistant-1");
  fireEvent.click(screen.getByRole("button", { name: "More actions" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Revoke everything" }));
  expect(confirmGroup()).toHaveTextContent("Revoke everything in this workspace?");
  fireEvent.click(within(confirmGroup()).getByRole("button", { name: "Revoke everything" }));
  await waitFor(() => expect(writes()[1]).toEqual({ method: "POST", path: `${BASE}/revoke-all`, body: { all: true } }));
});

it("the every-grant filter is admin-only and never shows another view's rows; a failed read shows a retry", async () => {
  let mineFails = false;
  routes = {
    "GET /?all=1": () => [200, { grants: [grant({ grant_id: "grt_o", owner_id: "u2", delegate_agent_id: "their-agent" })] }],
    "GET /": () => (mineFails ? [503, { error: "Delegation is unavailable", code: "unavailable" }] : [200, { grants: [grant()] }]),
  };
  const { unmount } = render(section());
  await screen.findByText("assistant-1");
  expect(screen.queryByRole("switch", { name: "Show every grant in the workspace" })).not.toBeInTheDocument();
  unmount();
  render(section({ isAdmin: true }));
  await screen.findByText("assistant-1");
  fireEvent.click(screen.getByRole("switch", { name: "Show every grant in the workspace" }));
  expect(await screen.findByText("their-agent")).toBeInTheDocument();
  mineFails = true;
  fireEvent.click(screen.getByRole("switch", { name: "Show every grant in the workspace" }));
  expect(screen.queryByText("their-agent")).not.toBeInTheDocument();
  expect(await screen.findByRole("alert")).toHaveTextContent("Delegation is unavailable");
  mineFails = false;
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("assistant-1")).toBeInTheDocument();
});

it("tells the page after a grant change, and re-reads on a new refresh key", async () => {
  let revoked = false;
  routes = {
    "GET /": () => [200, { grants: [grant({ status: revoked ? "revoked" : "active" })] }],
    "DELETE /grt_abcdefgh1": () => [200, grant({ status: "revoked" })],
  };
  const changed = vi.fn();
  const { rerender } = render(section({ onGrantsChanged: changed }));
  fireEvent.click(await screen.findByRole("button", { name: "Remove assistant-1" }));
  fireEvent.click(within(confirmGroup()).getByRole("button", { name: "Remove" }));
  await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
  revoked = true;
  rerender(section({ onGrantsChanged: changed, refreshKey: 1 }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Remove assistant-1" })).not.toBeInTheDocument());
});

it("with delegation off, offers no add or claim but keeps Remove", async () => {
  routes = { "GET /": () => [200, { grants: [grant()] }] };
  render(section({ delegationEnabled: false }));
  await screen.findByText("assistant-1");
  expect(screen.queryByRole("button", { name: "Add grant" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Connect an external agent" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Remove assistant-1" })).toBeInTheDocument();
});

function claimRoutes() {
  let n = 0;
  routes = {
    "GET /": () => [200, { grants: [] }],
    "POST /claims": () => {
      n += 1;
      return [201, { claim_id: `clm_${n}`, code: `dlg_code_${n}`, expires_at: new Date(Date.now() + 10 * 60_000).toISOString() }];
    },
  };
}

it("connecting an external agent shows the one-time code with Copy and its expiry; Close clears it", async () => {
  const writeText = vi.fn(async () => {});
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  claimRoutes();
  render(section());
  fireEvent.click(screen.getByRole("button", { name: "Connect an external agent" }));
  fireEvent.click(screen.getByRole("button", { name: "Get a code" }));
  expect(await screen.findByTestId("claim-code")).toHaveTextContent("dlg_code_1");
  expect(screen.getByText(/it works once/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Copy" }));
  expect(await screen.findByText("Code copied.")).toBeInTheDocument();
  expect(writeText).toHaveBeenCalledWith("dlg_code_1");
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  fireEvent.click(screen.getByRole("button", { name: "Connect an external agent" }));
  expect(screen.queryByTestId("claim-code")).not.toBeInTheDocument();
});

it("marks the code expired at expires_at, then starting a new claim replaces it", async () => {
  // Only the expiry timer is faked; the code's expires_at is ten real minutes away. Requests settle on
  // microtasks, flushed inside act, so no polling (which fake timers would stall) is needed.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const flush = () => act(async () => { for (let turn = 0; turn < 20; turn += 1) await Promise.resolve(); });
  claimRoutes();
  render(section());
  await flush();
  fireEvent.click(screen.getByRole("button", { name: "Connect an external agent" }));
  fireEvent.click(screen.getByRole("button", { name: "Get a code" }));
  await flush();
  expect(screen.getByTestId("claim-code")).toHaveTextContent("dlg_code_1");
  await act(async () => { vi.advanceTimersByTime(10 * 60_000 - 1_000); });
  expect(screen.getByTestId("claim-code")).toHaveTextContent("dlg_code_1");
  await act(async () => { vi.advanceTimersByTime(1_000); });
  expect(screen.queryByTestId("claim-code")).not.toBeInTheDocument();
  expect(screen.getByText("This code has expired.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Start a new claim" }));
  await flush();
  expect(screen.getByTestId("claim-code")).toHaveTextContent("dlg_code_2");
  expect(screen.queryByText("This code has expired.")).not.toBeInTheDocument();
});

it("starting a new claim while a code is shown replaces it, and turning delegation off clears it", async () => {
  claimRoutes();
  const { rerender } = render(section());
  fireEvent.click(screen.getByRole("button", { name: "Connect an external agent" }));
  fireEvent.click(screen.getByRole("button", { name: "Get a code" }));
  expect(await screen.findByTestId("claim-code")).toHaveTextContent("dlg_code_1");
  fireEvent.click(screen.getByRole("button", { name: "Start a new claim" }));
  await waitFor(() => expect(screen.getByTestId("claim-code")).toHaveTextContent("dlg_code_2"));
  expect(screen.getAllByTestId("claim-code")).toHaveLength(1);
  rerender(section({ delegationEnabled: false }));
  rerender(section({ delegationEnabled: true }));
  expect(screen.queryByTestId("claim-code")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Get a code" })).toBeInTheDocument();
});

it("keeps each action beside its own repos, and a pre-roles rule grant keeps its ask-first list", async () => {
  routes = { "GET /": () => [200, { grants: [
    grant({ scopes: [{ class: "merge", targets: ["acme/web"] }, { class: "deploy", targets: ["acme/api"] }] }),
    grant({ grant_id: "grt_old_rule", delegate_agent_id: "old-rule", scopes: [], trust_rule_id: "rul_9", require_tier_o: ["deploy", "release"] }),
  ] }] };
  render(section());
  // One table row per scope: each action shares its row with its own repos.
  const first = (await screen.findByText("assistant-1")).closest("tr")!;
  const second = first.nextElementSibling as HTMLElement;
  expect(within(first).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(expect.arrayContaining(["merge", "acme/web"]));
  expect(within(second).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["deploy", "acme/api"]);
  expect(screen.getByText("All actions (set before roles); ask me first: deploy, release")).toBeInTheDocument();
});

it("says what the default expiry is instead of promising none, and closes the add form when delegation turns off", async () => {
  routes = { "GET /": () => [200, { grants: [] }] };
  const { rerender } = render(section({ maxExpiryDays: 14 }));
  fireEvent.click(await screen.findByRole("button", { name: "Add grant" }));
  expect(screen.getByRole("button", { name: "Expires in 14 days. Set expiry" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Expires in 14 days. Set expiry" }));
  expect(screen.getByRole("button", { name: "Use default (14 days)" })).toBeInTheDocument();
  expect(screen.queryByText("No expiry")).not.toBeInTheDocument();
  rerender(section({ maxExpiryDays: 14, delegationEnabled: false }));
  expect(screen.queryByRole("form", { name: "Add grant" })).not.toBeInTheDocument();
});
