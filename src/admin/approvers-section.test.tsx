import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { DelegateGrant } from "./contracts";
import { ApproversSection, approverExpiryOptions, approverScopes, parseLogins } from "./approvers-section";

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
// Connected to the workspace and with an approver allow-list, as the server lists them.
const REPOS = ["AgentWorkforce/cloud", "AgentWorkforce/relay-app"];
const APPROVER_REPOSITORIES = REPOS;
/** `"missing"` leaves `approver_repositories` out, as a server from before it would. */
const candidates = (list: typeof CANDIDATES = CANDIDATES, partial = false, repositories: string[] | null | "missing" = REPOS) =>
  [200, { approver_candidates: list, approver_candidates_partial: partial,
    ...(repositories === "missing" ? {} : { approver_repositories: repositories }) }] as [number, unknown];

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
const fill = (logins: string, repo: string | null) => {
  fireEvent.change(screen.getByLabelText("Agent"), { target: { value: "desk-1" } });
  fireEvent.change(screen.getByLabelText("GitHub logins it acts as"), { target: { value: logins } });
  if (repo) fireEvent.click(screen.getByLabelText(repo));
};

describe("ApproversSection", () => {
  it("has a one-line header and no explanatory hints", async () => {
    routes = { "GET /": () => [200, { grants: [] }], "GET /approver-candidates": () => candidates() };
    render(section());
    expect(await screen.findByText("No approvers.")).toBeInTheDocument();
    expect(screen.getByText("Agents that can approve releases for you")).toBeInTheDocument();
    await openForm();
    for (const hint of [/pinned to/, /never approves/, /allow-list/, /Listed:/]) expect(screen.queryByText(hint)).not.toBeInTheDocument();
  });

  it("offers only the repositories the server lists, and says so when there are none or they can't be read", async () => {
    let repositories: string[] | null | "missing" = ["AgentWorkforce/cloud"];
    routes = { "GET /": () => [200, { grants: [] }], "GET /approver-candidates": () => candidates(CANDIDATES, false, repositories) };
    render(section());
    await openForm();
    expect(screen.getByLabelText("AgentWorkforce/cloud")).toBeInTheDocument();
    expect(screen.queryByLabelText("AgentWorkforce/relay-app")).not.toBeInTheDocument();
    const reopen = async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      await openForm();
    };
    repositories = [];
    await reopen();
    expect(screen.getByText("No connected repository can have approvers yet.")).toBeInTheDocument();
    expect(within(addForm()).queryAllByRole("checkbox").map((box) => box.id).filter((id) => id.startsWith("approvers-repo-"))).toEqual([]);
    repositories = null;
    await reopen();
    expect(screen.getByText(/Connected repositories can't be read right now/)).toBeInTheDocument();
    expect(screen.queryByLabelText("AgentWorkforce/cloud")).not.toBeInTheDocument();
    // Missing (an older server) reads like null: nothing offered, and the form says so.
    repositories = "missing";
    await reopen();
    expect(screen.getByText(/Connected repositories can't be read right now/)).toBeInTheDocument();
    fill("desk-login", null);
    expect(submitButton()).toBeDisabled();
  });

  it("never sends a repository chosen in an earlier opening that this one doesn't offer", async () => {
    let repositories = REPOS;
    routes = { "GET /": () => [200, { grants: [] }], "GET /approver-candidates": () => candidates(CANDIDATES, false, repositories),
      "POST /": () => [201, approver()] };
    render(section());
    await openForm();
    fireEvent.click(screen.getByLabelText(REPOS[1]!));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    repositories = [REPOS[0]!];
    await openForm();
    fill("desk-login", null);
    expect(submitButton()).toBeDisabled();
    fireEvent.submit(addForm());
    expect(posts()).toEqual([]);
    fireEvent.click(screen.getByLabelText(REPOS[0]!));
    fireEvent.click(submitButton());
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]!.scopes).toEqual([{ class: "release", targets: LANDS("AgentWorkforce/cloud") }]);
  });

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

  it("lists every approver in the workspace from the admin-only More menu (all=1)", async () => {
    routes = {
      "GET /": () => [200, { grants: [approver()] }],
      "GET /?all=1": () => [200, { grants: [approver({ grant_id: "grt_o", owner_id: "u2", delegate_agent_id: "their-1" })] }],
    };
    const { unmount } = render(section());
    await screen.findByText("desk-1");
    expect(screen.queryByRole("button", { name: "More approver actions" })).not.toBeInTheDocument();
    unmount();
    render(section({ isAdmin: true }));
    await screen.findByText("desk-1");
    // A plain disclosure: no menu roles, a trigger with aria-expanded and aria-controls.
    const trigger = screen.getByRole("button", { name: "More approver actions" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById(trigger.getAttribute("aria-controls")!)).toBeInTheDocument();
    const every = screen.getByRole("button", { name: "Show every approver" });
    expect(every).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(every);
    expect(await screen.findByText("their-1")).toBeInTheDocument();
    expect(screen.getByText("owner: u2")).toBeInTheDocument();
    // Toggling closes it and returns focus to the trigger.
    expect(screen.queryByRole("button", { name: "Show only mine" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    // Escape closes it (focus back on the trigger); so does a click outside.
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("button", { name: "Show only mine" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("button", { name: "Show only mine" })).not.toBeInTheDocument();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Show only mine" }));
    expect(await screen.findByText("desk-1")).toBeInTheDocument();
    expect(screen.queryByText("their-1")).not.toBeInTheDocument();
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
      "GET /approver-candidates": () => candidates([...CANDIDATES, { agent_id: "other-1", name: "unpinned", address: "" }]),
      "POST /": (call) => [201, approver({ scopes: (call.body as { scopes: DelegateGrant["scopes"] }).scopes })],
    };
    render(section());
    await openForm();
    // A candidate with no address can't be pinned, so it isn't offered.
    expect(screen.queryByText(/unpinned/)).not.toBeInTheDocument();
    expect(submitButton()).toBeDisabled();
    fill("Desk-Login, ci-app[bot] desk-login", APPROVER_REPOSITORIES[1]);
    fireEvent.click(screen.getByLabelText("Releases"));
    expect(submitButton()).toBeEnabled();
    fireEvent.click(submitButton());
    expect(await screen.findByText("desk is now an approver.")).toBeInTheDocument();
    expect(posts()).toEqual([{ delegate_agent_id: "desk-1", kind: "approver", delegate_address: "desk@host-1",
      // Lowercased and without repeats, as the server stores them.
      github_logins: ["desk-login", "ci-app[bot]"],
      scopes: [{ class: "release", targets: [...LANDS("AgentWorkforce/relay-app"), "AgentWorkforce/relay-app:*:*:*:*",
        "AgentWorkforce/relay-app:*:*:*:*:*"] }] }]);
  });

  it("refuses malformed logins before posting, and shows the server's refusal", async () => {
    routes = {
      "GET /": () => [200, { grants: [] }],
      "GET /approver-candidates": () => candidates(),
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
    expect(approverExpiryOptions(2.5)).toEqual([2]);
    expect(approverExpiryOptions(0)).toEqual([1]);
    routes = { "GET /": () => [200, { grants: [] }], "GET /approver-candidates": () => candidates(), "POST /": () => [201, approver()] };
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
    // A minute short of the full 90 days, so the server's cap is never crossed in transit.
    expect(days).toBeLessThan(90);
    expect(Math.round(days)).toBe(90);
  });

  it("offers no Add while delegation is off, and says there are no agents to pin when none has an address", async () => {
    routes = { "GET /": () => [200, { grants: [] }] };
    const { unmount } = render(section({ delegationEnabled: false }));
    expect(await screen.findByText("No approvers.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add approver" })).not.toBeInTheDocument();
    expect(screen.getByText("Turn on delegation to add an approver.")).toBeInTheDocument();
    unmount();
    routes["GET /approver-candidates"] = () => candidates([]);
    render(section());
    fireEvent.click(await screen.findByRole("button", { name: "Add approver" }));
    expect(await screen.findByText(/None of your agents can be an approver yet/)).toBeInTheDocument();
  });

  it("re-reads the candidates each time the form opens, so a newly connected agent is offered", async () => {
    let list: typeof CANDIDATES = [];
    routes = { "GET /": () => [200, { grants: [] }], "GET /approver-candidates": () => candidates(list) };
    render(section());
    fireEvent.click(await screen.findByRole("button", { name: "Add approver" }));
    expect(await screen.findByText(/None of your agents can be an approver yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    list = CANDIDATES;
    await openForm();
    expect(screen.getByLabelText("Agent")).toHaveValue("");
    expect(calls.filter((call) => call.path.endsWith("/delegates/approver-candidates"))).toHaveLength(2);
  });

  it("clears the previous list on open and applies only the latest read, so a stale address is never offered", async () => {
    let release!: () => void;
    let reads = 0;
    routes = {
      "GET /": () => [200, { grants: [] }],
      // The first read hangs until released; the second answers at once with a moved address.
      "GET /approver-candidates": () => {
        reads += 1;
        const answer = candidates([{ agent_id: "desk-1", name: "desk", address: reads === 1 ? "desk@old-host" : "desk@new-host" }]);
        return reads === 1 ? new Promise((resolve) => { release = () => resolve(answer); }) : answer;
      },
    };
    render(section());
    fireEvent.click(await screen.findByRole("button", { name: "Add approver" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Add approver" }));
    expect(await screen.findByRole("option", { name: "desk (desk@new-host)" })).toBeInTheDocument();
    // The first opening's read lands last: dropped.
    await act(async () => { release(); });
    expect(screen.getByRole("option", { name: "desk (desk@new-host)" })).toBeInTheDocument();
    expect(screen.queryByText(/old-host/)).not.toBeInTheDocument();
  });

  it("clears an earlier opening's list while the new read is in flight, so Submit stays blocked", async () => {
    let release!: () => void;
    let reads = 0;
    routes = {
      "GET /": () => [200, { grants: [] }],
      "GET /approver-candidates": () => {
        reads += 1;
        return reads === 1 ? candidates() : new Promise((resolve) => { release = () => resolve(candidates()); });
      },
    };
    render(section());
    await openForm();
    fill("desk-login", APPROVER_REPOSITORIES[0]);
    expect(submitButton()).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Add approver" }));
    expect(screen.queryByRole("option", { name: "desk (desk@host-1)" })).not.toBeInTheDocument();
    expect(screen.getByText("Loading your agents...")).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();
    await act(async () => { release(); });
    expect(await screen.findByRole("option", { name: "desk (desk@host-1)" })).toBeInTheDocument();
    expect(screen.getByLabelText("Agent")).toHaveValue("");
  });

  it("says some agents couldn't be checked when the candidate read is partial, not that there are none", async () => {
    routes = { "GET /": () => [200, { grants: [] }], "GET /approver-candidates": () => candidates([], true) };
    render(section());
    fireEvent.click(await screen.findByRole("button", { name: "Add approver" }));
    expect(await screen.findByText("Some agents couldn't be checked; try again by reopening the form.")).toBeInTheDocument();
    expect(screen.queryByText(/None of your agents can be an approver yet/)).not.toBeInTheDocument();
  });

  it("says approver grants aren't available when the install has no candidates route (404), and keeps the list", async () => {
    routes = {
      "GET /": () => [200, { grants: [approver()] }],
      "GET /approver-candidates": () => [404, { error: "not_found", message: "Not found" }],
    };
    render(section());
    fireEvent.click(await screen.findByRole("button", { name: "Add approver" }));
    expect(await screen.findByText("Approver grants aren't available on this install: it can't confirm code owners.")).toBeInTheDocument();
    // No form: no picker, no fields and nothing to submit; the list and Remove still work.
    expect(screen.queryByText(/None of your agents/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Agent")).not.toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Add approver" })).not.toBeInTheDocument();
    expect(posts()).toEqual([]);
    expect(screen.getByRole("button", { name: "Remove approver desk-1" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByText(/Approver grants aren't available/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add approver" })).toBeInTheDocument();
  });

  it("shows another failed candidates read as the server's error", async () => {
    routes = {
      "GET /": () => [200, { grants: [] }],
      "GET /approver-candidates": () => [503, { error: "Delegation is unavailable", code: "unavailable" }],
    };
    render(section());
    fireEvent.click(await screen.findByRole("button", { name: "Add approver" }));
    expect(await screen.findByText("Delegation is unavailable")).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();
  });

  it("shows a grant past its expiry as expired, with no Remove", async () => {
    routes = { "GET /": () => [200, { grants: [approver({ expires_at: "2020-01-01T00:00:00.000Z" })] }] };
    render(section());
    expect(await screen.findByText("desk@host-1")).toBeInTheDocument();
    expect(screen.getByText("expired")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove approver desk-1" })).not.toBeInTheDocument();
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
    expect(parseLogins("a-b, c[bot]  A-B")).toEqual(["a-b", "c[bot]"]);
    expect(parseLogins("-bad")).toBeNull();
    expect(parseLogins("x y!")).toBeNull();
    expect(parseLogins(Array.from({ length: 11 }, (_, index) => `u${index}`).join(" "))).toBeNull();
  });
});
