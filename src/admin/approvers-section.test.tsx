import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { DelegateGrant } from "./contracts";
import { APPROVER_REPOSITORIES, ApproversSection, approverExpiryOptions, approverScopes, parseLogins } from "./approvers-section";

type Call = { method: string; path: string; body: unknown };
type Handler = (call: Call) => [number, unknown] | Promise<[number, unknown]>;

const BASE = "/cloud/api/v1/workspaces/w1/delegates";
let calls: Call[] = [];
let routes: Record<string, Handler> = {};

const approver = (overrides: Partial<DelegateGrant> = {}): DelegateGrant => ({
  grant_id: "grt_appr0001", owner_id: "u1", delegate_agent_id: "desk-1",
  scopes: [{ class: "release", targets: ["AgentWorkforce/cloud:land:*:*"] }], require_tier_o: [],
  expires_at: "2099-12-24T00:00:00.000Z", status: "active", kind: "approver", delegate_address: "desk@host-1",
  github_logins: ["desk-login"], ...overrides,
});
const explicit = (overrides: Partial<DelegateGrant> = {}): DelegateGrant => ({
  grant_id: "grt_expl0001", owner_id: "u1", delegate_agent_id: "helper-1",
  scopes: [{ class: "merge", targets: ["acme/*"] }], require_tier_o: [],
  expires_at: "2099-12-24T00:00:00.000Z", status: "active", ...overrides,
});
const CANDIDATES = [{ agent_id: "desk-1", name: "desk", address: "desk@host-1" }];
const LANDS = (repo: string) => [`${repo}:land:*:*`, `${repo}:land:*/*:*`, `${repo}:land:*/*/*:*`];
// An agent in the permission rows' list with no pinnable binding: it is not an approver candidate.
const ROW_AGENT = { agent_id: "other-1", name: "unpinned", root_kind: "connector", connector: "x", spawned: false, launched_by: null,
  groups: [], effective: null };
const agents = (candidates: typeof CANDIDATES = CANDIDATES) =>
  [200, { agents: [ROW_AGENT], approver_candidates: candidates }] as [number, unknown];

beforeEach(() => {
  calls = [];
  routes = {};
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const section = (props: Partial<Parameters<typeof ApproversSection>[0]> = {}) => (
  <ApproversSection workspaceId="w1" delegationEnabled maxExpiryDays={90} isAdmin={false} {...props} />
);
const posts = () => calls.filter((call) => call.method === "POST").map((call) => call.body as Record<string, unknown>);
const addForm = () => screen.getByRole("form", { name: "Add approver" });
const submitButton = () => within(addForm()).getByRole("button", { name: "Add approver" });
const openForm = async () => {
  fireEvent.click(await screen.findByRole("button", { name: "Add approver" }));
  await screen.findByRole("option", { name: "desk (desk@host-1)" });
};
const fill = (logins: string, repo: string) => {
  fireEvent.change(screen.getByLabelText("Agent"), { target: { value: "desk-1" } });
  fireEvent.change(screen.getByLabelText("GitHub logins it acts as"), { target: { value: logins } });
  fireEvent.click(screen.getByLabelText(repo));
};

describe("ApproversSection", () => {
  it("lists only approver grants, with their pinned address, logins and targets; an explicit grant is not shown here", async () => {
    routes = { "GET /": () => [200, { grants: [approver(), explicit(),
      approver({ grant_id: "grt_appr0002", delegate_agent_id: "old-1", status: "revoked" })] }] };
    render(section());
    expect(await screen.findAllByText("desk@host-1")).toHaveLength(2);
    expect(screen.getAllByText("desk-login")).toHaveLength(2);
    expect(screen.getAllByText("AgentWorkforce/cloud:land:*:*")).toHaveLength(2);
    expect(screen.queryByText("helper-1")).not.toBeInTheDocument();
    // A revoked approver is listed without a Remove button.
    expect(screen.getByRole("button", { name: "Remove approver desk-1" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove approver old-1" })).not.toBeInTheDocument();
  });

  it("lists every approver in the workspace behind the admin-only toggle (all=1)", async () => {
    routes = {
      "GET /": () => [200, { grants: [approver()] }],
      "GET /?all=1": () => [200, { grants: [approver({ grant_id: "grt_o", owner_id: "u2", delegate_agent_id: "their-1" })] }],
    };
    const { unmount } = render(section());
    await screen.findByText("desk-1");
    expect(screen.queryByRole("switch", { name: "Show every approver in the workspace" })).not.toBeInTheDocument();
    unmount();
    render(section({ isAdmin: true }));
    await screen.findByText("desk-1");
    fireEvent.click(screen.getByRole("switch", { name: "Show every approver in the workspace" }));
    expect(await screen.findByText("their-1")).toBeInTheDocument();
    expect(screen.getByText("owner: u2")).toBeInTheDocument();
  });

  it("removes an approver only after confirming, with DELETE /delegates/{id}, re-reads and tells the page", async () => {
    let removed = false;
    routes = {
      "GET /": () => [200, { grants: removed ? [] : [approver()] }],
      "DELETE /grt_appr0001": () => { removed = true; return [200, approver({ status: "revoked" })]; },
    };
    const changed = vi.fn();
    render(section({ onGrantsChanged: changed }));
    fireEvent.click(await screen.findByRole("button", { name: "Remove approver desk-1" }));
    expect(calls.some((call) => call.method === "DELETE")).toBe(false);
    const confirm = screen.getByRole("group", { name: "Confirm approver removal" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Remove" }));
    expect(await screen.findByText("Approver removed.")).toBeInTheDocument();
    expect(await screen.findByText("No approvers.")).toBeInTheDocument();
    expect(calls.filter((call) => call.method === "DELETE").map((call) => call.path)).toEqual([`${BASE}/grt_appr0001`]);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("offers only pinnable agents, and posts kind approver pinned to the agent's address, release class only", async () => {
    routes = {
      "GET /": () => [200, { grants: [] }],
      "GET /agents": () => agents(),
      "POST /": (call) => [201, approver({ scopes: (call.body as { scopes: DelegateGrant["scopes"] }).scopes })],
    };
    render(section());
    await openForm();
    // Only approver candidates are offered: an agent in the permission rows' list without a pinnable binding is not.
    expect(screen.queryByText(/unpinned/)).not.toBeInTheDocument();
    expect(submitButton()).toBeDisabled();
    fill("Desk-Login, ci-app[bot] desk-login", APPROVER_REPOSITORIES[1]);
    fireEvent.click(screen.getByLabelText("Releases"));
    expect(submitButton()).toBeEnabled();
    fireEvent.click(submitButton());
    expect(await screen.findByText("desk is now an approver.")).toBeInTheDocument();
    expect(posts()).toEqual([{ delegate_agent_id: "desk-1", kind: "approver", delegate_address: "desk@host-1",
      github_logins: ["Desk-Login", "ci-app[bot]", "desk-login"],
      scopes: [{ class: "release", targets: [...LANDS("AgentWorkforce/relay-app"), "AgentWorkforce/relay-app:*:*:*:*",
        "AgentWorkforce/relay-app:*:*:*:*:*"] }] }]);
  });

  it("refuses malformed logins before posting, and shows the server's refusal", async () => {
    routes = {
      "GET /": () => [200, { grants: [] }],
      "GET /agents": () => agents(),
      "POST /": () => [403, { error: "Only a code owner can grant an approver", code: "not_code_owner" }],
    };
    render(section());
    await openForm();
    fill("not a login!", APPROVER_REPOSITORIES[0]);
    expect(screen.getByRole("alert")).toHaveTextContent("Enter GitHub logins");
    expect(submitButton()).toBeDisabled();
    fireEvent.submit(addForm());
    expect(posts()).toEqual([]);
    fireEvent.change(screen.getByLabelText("GitHub logins it acts as"), { target: { value: "desk-login" } });
    fireEvent.click(submitButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("Only a code owner can grant an approver");
    expect(posts()[0]).toMatchObject({ scopes: [{ class: "release", targets: LANDS("AgentWorkforce/cloud") }] });
    // A refusal keeps the form open as typed.
    expect(screen.getByLabelText("GitHub logins it acts as")).toHaveValue("desk-login");
  });

  it("sends a chosen expiry, capped at 90 days whatever the policy allows", async () => {
    expect(approverExpiryOptions(365)).toEqual([7, 30, 90]);
    expect(approverExpiryOptions(30)).toEqual([7, 30]);
    expect(approverExpiryOptions(3)).toEqual([3]);
    routes = { "GET /": () => [200, { grants: [] }], "GET /agents": () => agents(), "POST /": () => [201, approver()] };
    render(section({ maxExpiryDays: 365 }));
    await openForm();
    fill("desk-login", APPROVER_REPOSITORIES[0]);
    // No expiry chosen sends none (the server default); Set expiry offers the presets up to 90.
    fireEvent.click(screen.getByRole("button", { name: /Set expiry/ }));
    expect(within(screen.getByLabelText("Expires after")).getAllByRole("option").map((option) => option.textContent))
      .toEqual(["7 days", "30 days", "90 days"]);
    const before = Date.now();
    fireEvent.click(submitButton());
    await waitFor(() => expect(posts()).toHaveLength(1));
    const days = (Date.parse(posts()[0]!.expires_at as string) - before) / 86_400_000;
    expect(Math.round(days)).toBe(90);
  });

  it("offers no Add while delegation is off, and says there are no agents to pin when none has an address", async () => {
    routes = { "GET /": () => [200, { grants: [] }] };
    const { unmount } = render(section({ delegationEnabled: false }));
    expect(await screen.findByText("No approvers.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add approver" })).not.toBeInTheDocument();
    expect(screen.getByText(/Delegation is off/)).toBeInTheDocument();
    unmount();
    // relay-control sends no approver_candidates today: missing reads as none.
    routes["GET /agents"] = () => [200, { agents: [] }];
    render(section());
    fireEvent.click(await screen.findByRole("button", { name: "Add approver" }));
    expect(await screen.findByText(/None of your agents has an address/)).toBeInTheDocument();
  });

  it("re-reads the candidates each time the form opens, so a newly connected agent is offered", async () => {
    let candidates: typeof CANDIDATES = [];
    routes = { "GET /": () => [200, { grants: [] }], "GET /agents": () => agents(candidates) };
    render(section());
    fireEvent.click(await screen.findByRole("button", { name: "Add approver" }));
    expect(await screen.findByText(/None of your agents has an address/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    candidates = CANDIDATES;
    await openForm();
    expect(screen.getByLabelText("Agent")).toHaveValue("");
    expect(calls.filter((call) => call.path.endsWith("/delegates/agents"))).toHaveLength(2);
  });

  it("re-reads on a new refresh key (a grant or the trust rule changed elsewhere on the page)", async () => {
    let grants: DelegateGrant[] = [];
    routes = { "GET /": () => [200, { grants }] };
    const { rerender } = render(section());
    expect(await screen.findByText("No approvers.")).toBeInTheDocument();
    grants = [approver()];
    rerender(section({ refreshKey: 1 }));
    expect(await screen.findByText("desk@host-1")).toBeInTheDocument();
  });
});

describe("approver helpers", () => {
  it("builds one release scope from the chosen repositories and kinds", () => {
    expect(approverScopes([], ["land"])).toEqual([]);
    expect(approverScopes(["AgentWorkforce/cloud"], [])).toEqual([]);
    expect(approverScopes(["AgentWorkforce/cloud", "AgentWorkforce/relay-app"], ["land"])).toEqual([{ class: "release",
      targets: [...LANDS("AgentWorkforce/cloud"), ...LANDS("AgentWorkforce/relay-app")] }]);
  });

  it("parses GitHub logins, refusing anything that isn't one or more than 10", () => {
    expect(parseLogins("a-b, c[bot]  a-b")).toEqual(["a-b", "c[bot]"]);
    expect(parseLogins("-bad")).toBeNull();
    expect(parseLogins("x y!")).toBeNull();
    expect(parseLogins(Array.from({ length: 11 }, (_, index) => `u${index}`).join(" "))).toBeNull();
  });
});
