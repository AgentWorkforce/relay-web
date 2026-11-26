import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DelegationEnabledCard, DelegationSection } from "./delegation";
import { Settings } from "./settings";

type Call = { method: string; path: string; body: unknown };
type Reply = Response | Promise<Response>;

const POLICY = "/cloud/api/v1/workspaces/w1/delegates/policy";
let calls: Call[] = [];
let role: "owner" | "admin" | "member" = "owner";
let stored = false;
let reply: ((call: Call) => Reply | undefined) | null = null;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

function respond(call: Call): Reply {
  const custom = reply?.(call);
  if (custom) return custom;
  if (call.path === "/cloud/api/v1/auth/whoami")
    return json({
      user: { id: "u1", email: "me@example.test", name: "Me" },
      currentOrganization: { id: "o1", name: "Example", role },
      currentWorkspace: { id: "w1", name: "Primary" },
    });
  if (call.path.endsWith("/delegates/policy")) {
    if (call.method === "PUT")
      stored = (call.body as { delegation_enabled: boolean }).delegation_enabled;
    return json({ delegation_enabled: stored, max_expiry_days: 90, allowed_classes: null,
      require_tier_o: [], code_owner_match: "any_path", ...(call.method === "PUT" ? { revoked_grants: [] } : {}) });
  }
  // Agent permissions (the bindings contract) under the toggle: nothing set up yet.
  if (call.path.endsWith("/delegates/roles")) return json({ presets: [], classes: [], pr_ops_ops: [] });
  if (call.path.endsWith("/delegates/bindings")) return json({ bindings: [], recommendation: null });
  if (call.path.endsWith("/delegates/groups")) return json({ groups: [] });
  if (call.path.endsWith("/delegates/agents")) return json({ agents: [] });
  if (call.path.endsWith("/delegates")) return json({ grants: [] });
  if (call.path.endsWith("/memberships")) return json({ memberships: [] });
  if (call.path.endsWith("/invitations")) return json({ invitations: [] });
  return json({ error: "not_found", message: "no fake" }, 404);
}

const puts = () => calls.filter((call) => call.method === "PUT");
const toggle = () => screen.getByRole("switch");
const prompt = () => screen.queryByText(/Turn on delegation for this workspace\?/);
type CardProps = Parameters<typeof DelegationEnabledCard>[0];
let readCounter = 0;
/**
 * The card as rendered after a completed read of `initialEnabled`. Each call
 * is a fresh read with a new read id unless `readId` is given (a plain
 * re-render of the same read).
 */
const card = ({ initialEnabled = false, readId, ...props }:
  Partial<Omit<CardProps, "serverEnabled">> & { initialEnabled?: boolean } = {}) => (
  <DelegationEnabledCard workspaceId="w1" serverEnabled={initialEnabled} readId={readId ?? ++readCounter}
    canManage {...props} />
);
/** A PUT that answers only when the test says so. */
function heldPut() {
  const held: { resolve: (response: Response) => void; reject: (error: Error) => void } = {
    resolve: () => {}, reject: () => {},
  };
  reply = (call) => call.method === "PUT"
    ? new Promise<Response>((resolve, reject) => { held.resolve = resolve; held.reject = reject; })
    : undefined;
  return held;
}

beforeEach(() => {
  calls = [];
  role = "owner";
  stored = false;
  reply = null;
  readCounter = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const call: Call = {
        method: init.method ?? "GET",
        path: input,
        body: init.body ? JSON.parse(init.body as string) : undefined,
      };
      calls.push(call);
      return respond(call);
    }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("asks for confirmation before turning delegation on, then sends only delegation_enabled", async () => {
  render(card());
  expect(screen.getByText("Delegation is off")).toBeInTheDocument();
  fireEvent.click(toggle());
  // Nothing is sent until the owner confirms.
  expect(puts()).toEqual([]);
  expect(prompt()).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Turn on delegation" }));
  expect(await screen.findByText("Delegation is on")).toBeInTheDocument();
  expect(puts()).toEqual([{ method: "PUT", path: POLICY, body: { delegation_enabled: true } }]);
  expect(prompt()).not.toBeInTheDocument();
  expect(toggle()).toHaveAttribute("aria-checked", "true");
});

it("cancelling the confirmation changes nothing", () => {
  render(card());
  fireEvent.click(toggle());
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(puts()).toEqual([]);
  expect(prompt()).not.toBeInTheDocument();
  expect(screen.getByText("Delegation is off")).toBeInTheDocument();
});

it("turns delegation off without a confirmation step", async () => {
  stored = true;
  render(card({ initialEnabled: true }));
  fireEvent.click(toggle());
  expect(await screen.findByText("Delegation is off")).toBeInTheDocument();
  expect(puts()).toEqual([{ method: "PUT", path: POLICY, body: { delegation_enabled: false } }]);
  expect(prompt()).not.toBeInTheDocument();
});

it("shows the API's error and keeps the previous state", async () => {
  reply = (call) => call.method === "PUT"
    ? json({ error: "Only org owners and admins can set delegation policy", code: "forbidden" }, 403)
    : undefined;
  render(card());
  fireEvent.click(toggle());
  fireEvent.click(screen.getByRole("button", { name: "Turn on delegation" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Only org owners and admins can set delegation policy");
  expect(screen.getByText("Delegation is off")).toBeInTheDocument();
});

it("shows a network failure as an error", async () => {
  reply = (call) => call.method === "PUT" ? Promise.reject(new TypeError("Failed to fetch")) : undefined;
  render(card({ initialEnabled: true }));
  fireEvent.click(toggle());
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the server. Try again.");
  expect(screen.getByText("Delegation is on")).toBeInTheDocument();
});

it("shows members the state but not the control", () => {
  render(card({ initialEnabled: true, canManage: false }));
  expect(toggle()).toBeDisabled();
  expect(screen.getByText("Delegation is on")).toBeInTheDocument();
  expect(screen.getByText("Only org owners and admins can change this.")).toBeInTheDocument();
});

it("follows a new server value after a re-read", () => {
  const { rerender } = render(card());
  // Another admin turned it on; a re-read delivers the new value.
  rerender(card({ initialEnabled: true }));
  expect(screen.getByText("Delegation is on")).toBeInTheDocument();
});

it("a stale server value that arrives during a save never overwrites the confirmed answer", async () => {
  const held = heldPut();
  const { rerender } = render(card());
  fireEvent.click(toggle());
  fireEvent.click(screen.getByRole("button", { name: "Turn on delegation" }));
  expect(screen.getByRole("button", { name: "Turning on..." })).toBeDisabled();
  // A re-read from before the save delivers a stale `false`, then another stale `true`.
  rerender(card({ initialEnabled: true }));
  // Consumed, not applied: the pre-save state and the open prompt stay until the save settles.
  expect(screen.getByText("Delegation is off")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Turning on..." })).toBeInTheDocument();
  rerender(card({ initialEnabled: false }));
  await act(async () => held.resolve(json({ delegation_enabled: true, max_expiry_days: 90 })));
  expect(await screen.findByText("Delegation is on")).toBeInTheDocument();
  // Re-rendering the same stale read changes nothing; a newer read is followed.
  rerender(card({ initialEnabled: false, readId: readCounter }));
  expect(screen.getByText("Delegation is on")).toBeInTheDocument();
  rerender(card({ initialEnabled: false }));
  expect(screen.getByText("Delegation is off")).toBeInTheDocument();
});

it("a failed save shows the server value that arrived while it ran, and asks for a re-read", async () => {
  const held = heldPut();
  const onSaveFailed = vi.fn();
  const { rerender } = render(card({ onSaveFailed }));
  fireEvent.click(toggle());
  fireEvent.click(screen.getByRole("button", { name: "Turn on delegation" }));
  // Another admin turned it on; the re-read lands mid-save. Then the PUT fails on the network.
  rerender(card({ initialEnabled: true, onSaveFailed }));
  await act(async () => held.reject(new TypeError("Failed to fetch")));
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the server");
  expect(screen.getByText("Delegation is on")).toBeInTheDocument();
  expect(onSaveFailed).toHaveBeenCalledTimes(1);
  // The prompt is closed and the switch can be used again; later re-reads still apply.
  expect(prompt()).not.toBeInTheDocument();
  expect(toggle()).toBeEnabled();
  rerender(card({ initialEnabled: false, onSaveFailed }));
  expect(screen.getByText("Delegation is off")).toBeInTheDocument();
});

it("a failed save with no server value during it keeps the pre-save state", async () => {
  reply = (call) => call.method === "PUT" ? json({ error: "Delegation is unavailable", code: "unavailable" }, 503) : undefined;
  render(card({ initialEnabled: true }));
  fireEvent.click(toggle());
  expect(await screen.findByRole("alert")).toHaveTextContent("Delegation is unavailable");
  expect(screen.getByText("Delegation is on")).toBeInTheDocument();
});

it("never leaves the prompt open or the switch disabled once a save settles, on any path", async () => {
  const answers: Array<() => Reply> = [
    () => json({ delegation_enabled: true, max_expiry_days: 90 }),
    () => json({ error: "nope", code: "forbidden" }, 403),
    () => Promise.reject(new TypeError("Failed to fetch")),
  ];
  for (const answer of answers) {
    reply = (call) => (call.method === "PUT" ? answer() : undefined);
    const { unmount } = render(card());
    fireEvent.click(toggle());
    fireEvent.click(screen.getByRole("button", { name: "Turn on delegation" }));
    await waitFor(() => expect(toggle()).toBeEnabled());
    expect(prompt()).not.toBeInTheDocument();
    unmount();
  }
});

it("reads the stored state for the members tab, and owners and admins can change it", async () => {
  stored = true;
  render(<Settings section="members" />);
  expect(await screen.findByText("Delegation is on")).toBeInTheDocument();
  expect(toggle()).toBeEnabled();
  expect(calls.some((call) => call.method === "GET" && call.path === POLICY)).toBe(true);
});

it("shows members the stored state read-only in settings", async () => {
  role = "member";
  render(<Settings section="members" />);
  expect(await screen.findByText("Delegation is off")).toBeInTheDocument();
  expect(toggle()).toBeDisabled();
  expect(screen.getByText("Only org owners and admins can change this.")).toBeInTheDocument();
});

it("hides the card when the policy cannot be read", async () => {
  reply = (call) => call.path === POLICY ? json({ error: "Delegation is unavailable", code: "unavailable" }, 503) : undefined;
  render(<Settings section="members" />);
  await waitFor(() => expect(calls.some((call) => call.path === POLICY)).toBe(true));
  await screen.findByRole("heading", { level: 1, name: "Members" });
  expect(screen.queryByText("Trusted delegates")).not.toBeInTheDocument();
  expect(screen.queryByRole("switch")).not.toBeInTheDocument();
});

it("re-reads the policy after a successful save, so what depends on it follows", async () => {
  render(<DelegationSection workspaceId="w1" canManage />);
  fireEvent.click(await screen.findByRole("switch"));
  fireEvent.click(screen.getByRole("button", { name: "Turn on delegation" }));
  await waitFor(() => expect(calls.filter((call) => call.method === "GET" && call.path === POLICY)).toHaveLength(2));
  expect(screen.getByText("Delegation is on")).toBeInTheDocument();
});

it("a fresh read that confirms the state leaves an open prompt alone; one that changes it closes the prompt", () => {
  const { rerender } = render(card());
  fireEvent.click(toggle());
  rerender(card({ initialEnabled: false }));
  expect(prompt()).toBeInTheDocument();
  rerender(card({ initialEnabled: true }));
  expect(prompt()).not.toBeInTheDocument();
  expect(screen.getByText("Delegation is on")).toBeInTheDocument();
});

it("re-reads the policy after a failed save and shows the server's value", async () => {
  // The PUT is refused because another admin turned delegation on meanwhile.
  reply = (call) => {
    if (call.method !== "PUT") return undefined;
    stored = true;
    return json({ error: "Only org owners and admins can set delegation policy", code: "forbidden" }, 403);
  };
  render(<DelegationSection workspaceId="w1" canManage />);
  fireEvent.click(await screen.findByRole("switch"));
  fireEvent.click(screen.getByRole("button", { name: "Turn on delegation" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Only org owners and admins");
  expect(await screen.findByText("Delegation is on")).toBeInTheDocument();
  expect(calls.filter((call) => call.method === "GET" && call.path === POLICY)).toHaveLength(2);
});

it("ignores a save answer that arrives after a workspace switch", async () => {
  const held = heldPut();
  const section = (workspaceId: string) => (
    <DelegationSection key={`delegation-${workspaceId}`} workspaceId={workspaceId} canManage />
  );
  const { rerender } = render(section("w1"));
  fireEvent.click(await screen.findByRole("switch"));
  fireEvent.click(screen.getByRole("button", { name: "Turn on delegation" }));
  expect(puts()).toEqual([{ method: "PUT", path: POLICY, body: { delegation_enabled: true } }]);
  // The settings context switches to w2 (its policy is off); then the w1 answer fails.
  rerender(section("w2"));
  expect(await screen.findByText("Delegation is off")).toBeInTheDocument();
  await act(async () => held.resolve(json({ error: "boom", code: "unavailable" }, 500)));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByText("Delegation is off")).toBeInTheDocument();
  expect(toggle()).toBeEnabled();
  // The new card wrote nothing, and the switch never targeted w2.
  expect(puts().map((call) => call.path)).toEqual([POLICY]);
});

/** The next PUT commits on the server but its response never reaches the browser. */
function loseNextPutResponse() {
  reply = (call) => {
    if (call.method !== "PUT") return undefined;
    reply = null;
    stored = (call.body as { delegation_enabled: boolean }).delegation_enabled;
    return Promise.reject(new TypeError("Failed to fetch"));
  };
}

it("on, then off: a committed off whose response is lost shows the recovery read's off (review)", async () => {
  render(<DelegationSection workspaceId="w1" canManage />);
  fireEvent.click(await screen.findByRole("switch"));
  fireEvent.click(screen.getByRole("button", { name: "Turn on delegation" }));
  expect(await screen.findByText("Delegation is on")).toBeInTheDocument();
  // The recovery read returns `false`, the same value as the first read.
  loseNextPutResponse();
  fireEvent.click(toggle());
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the server");
  expect(await screen.findByText("Delegation is off")).toBeInTheDocument();
  expect(toggle()).toHaveAttribute("aria-checked", "false");
  // The first read, the re-read after the successful save, and the recovery read.
  expect(calls.filter((call) => call.method === "GET" && call.path === POLICY)).toHaveLength(3);
});

it("off, then on: a committed on whose response is lost shows the recovery read's on (review)", async () => {
  stored = true;
  render(<DelegationSection workspaceId="w1" canManage />);
  fireEvent.click(await screen.findByRole("switch"));
  expect(await screen.findByText("Delegation is off")).toBeInTheDocument();
  // The recovery read returns `true`, the same value as the first read.
  loseNextPutResponse();
  fireEvent.click(toggle());
  fireEvent.click(screen.getByRole("button", { name: "Turn on delegation" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the server");
  expect(await screen.findByText("Delegation is on")).toBeInTheDocument();
  expect(toggle()).toHaveAttribute("aria-checked", "true");
  expect(prompt()).not.toBeInTheDocument();
});

it("applies the confirmed policy to the Delegates section at once, even when the re-read fails", async () => {
  let policyReads = 0;
  reply = (call) => {
    if (call.method === "GET" && call.path === POLICY && ++policyReads > 1)
      return json({ error: "Delegation is unavailable", code: "unavailable" }, 503);
    return undefined;
  };
  render(<DelegationSection workspaceId="w1" canManage />);
  expect(await screen.findByText(/Delegation is off, so nothing can be added/)).toBeInTheDocument();
  fireEvent.click(toggle());
  fireEvent.click(screen.getByRole("button", { name: "Turn on delegation" }));
  expect(await screen.findByRole("button", { name: "Add permission" })).toBeInTheDocument();
  await waitFor(() => expect(policyReads).toBe(2));
  expect(screen.getByText("Delegation is on")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Add permission" })).toBeInTheDocument();
});

it("a policy read issued before a successful save never replaces the saved state, even if the re-read fails", async () => {
  // Read 1 answers off. A failed save asks for read 2, which is held and answers the old "off" only
  // after a later successful save; that save's re-read (read 3) fails.
  let policyReads = 0;
  let finishSecond!: (response: Response) => void;
  let putFails = true;
  reply = (call) => {
    if (call.method === "PUT") {
      if (putFails) return Promise.reject(new TypeError("Failed to fetch"));
      stored = true;
      return undefined;
    }
    if (call.path !== POLICY) return undefined;
    policyReads += 1;
    if (policyReads === 2) return new Promise<Response>((resolve) => { finishSecond = resolve; });
    if (policyReads >= 3) return json({ error: "Delegation is unavailable", code: "unavailable" }, 503);
    return undefined;
  };
  render(<DelegationSection workspaceId="w1" canManage />);
  fireEvent.click(await screen.findByRole("switch"));
  fireEvent.click(screen.getByRole("button", { name: "Turn on delegation" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the server");
  await waitFor(() => expect(policyReads).toBe(2));
  putFails = false;
  fireEvent.click(toggle());
  fireEvent.click(screen.getByRole("button", { name: "Turn on delegation" }));
  expect(await screen.findByRole("button", { name: "Add permission" })).toBeInTheDocument();
  await waitFor(() => expect(policyReads).toBe(3));
  await act(async () => finishSecond(json({ delegation_enabled: false, max_expiry_days: 90, allowed_classes: null,
    require_tier_o: [], code_owner_match: "any_path" })));
  expect(screen.getByText("Delegation is on")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Add permission" })).toBeInTheDocument();
});

it("turning delegation on re-reads Agent permissions, so the recommendation can appear", async () => {
  render(<DelegationSection workspaceId="w1" canManage />);
  fireEvent.click(await screen.findByRole("switch", { name: /^Delegation is/ }));
  const bindingReads = () => calls.filter((call) => call.method === "GET" && call.path.endsWith("/delegates/bindings")).length;
  const before = bindingReads();
  fireEvent.click(screen.getByRole("button", { name: "Turn on delegation" }));
  await waitFor(() => expect(bindingReads()).toBeGreaterThan(before));
});
