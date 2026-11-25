import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { DelegateGrant } from "./contracts";
import { DelegatesSection } from "./delegates-section";
import { DelegationSection } from "./delegation";

type Call = { method: string; path: string; body: unknown };
type Handler = (call: Call) => [number, unknown] | Promise<[number, unknown]>;

const BASE = "/cloud/api/v1/workspaces/w1/delegates";
let calls: Call[] = [];
let routes: Record<string, Handler> = {};

const grant = (overrides: Partial<DelegateGrant> = {}): DelegateGrant => ({
  grant_id: "grt_abcdefgh1", owner_id: "u1", delegate_agent_id: "assistant-1",
  scopes: [{ class: "merge", targets: ["acme/*"] }], require_tier_o: [],
  expires_at: "2026-12-24T00:00:00.000Z", status: "active", ...overrides,
});

beforeEach(() => {
  calls = [];
  routes = {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const call: Call = {
        method: init.method ?? "GET",
        path: input,
        body: init.body ? JSON.parse(init.body as string) : undefined,
      };
      calls.push(call);
      const rest = input.startsWith(BASE) ? input.slice(BASE.length) : input;
      const key = `${call.method} ${rest.startsWith("?") || !rest ? `/${rest}` : rest}`;
      const handler = routes[key];
      if (!handler) return new Response(JSON.stringify({ error: `unexpected ${key}` }), { status: 500 });
      const [status, body] = await handler(call);
      return new Response(JSON.stringify(body), { status });
    }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const section = (props: Partial<Parameters<typeof DelegatesSection>[0]> = {}) => (
  <DelegatesSection workspaceId="w1" delegationEnabled maxExpiryDays={30} isAdmin={false} {...props} />
);
const writes = () => calls.filter((call) => call.method !== "GET");
const confirmGroup = () => screen.getByRole("group", { name: "Confirm revocation" });

it("lists my grants with delegate, scopes, status and expiry", async () => {
  routes = { "GET /": () => [200, { grants: [grant()] }] };
  render(section());
  expect(await screen.findByText("assistant-1")).toBeInTheDocument();
  expect(screen.getByText("merge: acme/*")).toBeInTheDocument();
  expect(screen.getByText(/^active, expires/)).toBeInTheDocument();
  expect(calls[0]).toMatchObject({ method: "GET", path: BASE });
});

it("starts a claim and shows the one-time code with its expiry, and copies it", async () => {
  const writeText = vi.fn(async () => {});
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  routes = {
    "GET /": () => [200, { grants: [] }],
    "POST /claims": () => [201, { claim_id: "clm_1", code: "dlg_onetimecode", expires_at: "2026-11-25T00:10:00.000Z" }],
  };
  render(section());
  fireEvent.click(screen.getByRole("button", { name: "Start a claim" }));
  expect(await screen.findByTestId("claim-code")).toHaveTextContent("dlg_onetimecode");
  expect(screen.getByText(/it works once/)).toBeInTheDocument();
  expect(writes()).toEqual([{ method: "POST", path: `${BASE}/claims`, body: {} }]);
  fireEvent.click(screen.getByRole("button", { name: "Copy" }));
  expect(await screen.findByText("Code copied.")).toBeInTheDocument();
  expect(writeText).toHaveBeenCalledWith("dlg_onetimecode");
});

it("grants with the form's values and shows the server's refusal", async () => {
  routes = {
    "GET /": () => [200, { grants: [] }],
    "POST /": () => [403, { error: "The agent must be bound to you; claim it first", code: "not_delegate" }],
  };
  render(section());
  fireEvent.change(screen.getByLabelText("Agent id"), { target: { value: "assistant-9" } });
  fireEvent.change(screen.getByLabelText("Class"), { target: { value: "release" } });
  fireEvent.change(screen.getByLabelText("Targets"), { target: { value: "acme/web:stable:*:*:*, acme/api:stable:*:*:*" } });
  fireEvent.change(screen.getByLabelText(/Expires in/), { target: { value: "7" } });
  fireEvent.click(screen.getByLabelText(/Require my own approval/));
  fireEvent.click(screen.getByRole("button", { name: "Grant" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("The agent must be bound to you; claim it first");
  const body = writes()[0]!.body as Record<string, unknown>;
  expect(body).toMatchObject({
    delegate_agent_id: "assistant-9",
    scopes: [{ class: "release", targets: ["acme/web:stable:*:*:*", "acme/api:stable:*:*:*"] }],
    require_tier_o: ["release"],
  });
  const days = (Date.parse(body.expires_at as string) - Date.now()) / 86_400_000;
  expect(days).toBeGreaterThan(6.9);
  expect(days).toBeLessThanOrEqual(7);
  // A refusal keeps the form as typed.
  expect(screen.getByLabelText("Agent id")).toHaveValue("assistant-9");
});

it("a successful grant clears the form, says so and re-reads the list", async () => {
  let grants: DelegateGrant[] = [];
  routes = {
    "GET /": () => [200, { grants }],
    "POST /": () => { grants = [grant({ delegate_agent_id: "assistant-9" })]; return [201, grants[0]]; },
  };
  render(section());
  await screen.findByText("No grants yet.");
  fireEvent.change(screen.getByLabelText("Agent id"), { target: { value: "assistant-9" } });
  fireEvent.change(screen.getByLabelText("Targets"), { target: { value: "acme/*" } });
  fireEvent.click(screen.getByRole("button", { name: "Grant" }));
  expect(await screen.findByText("Granted assistant-9.")).toBeInTheDocument();
  expect(await screen.findByText("assistant-9")).toBeInTheDocument();
  expect(screen.getByLabelText("Agent id")).toHaveValue("");
  // No expiry entered: the server's default applies, and no Tier O was asked for.
  expect(writes()[0]!.body).toEqual({ delegate_agent_id: "assistant-9", scopes: [{ class: "merge", targets: ["acme/*"] }] });
});

it("refuses an expiry past the policy maximum, or a missing target, before sending anything", async () => {
  routes = { "GET /": () => [200, { grants: [] }] };
  render(section({ maxExpiryDays: 14 }));
  expect(screen.getByLabelText("Expires in (days, up to 14)")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Agent id"), { target: { value: "a" } });
  fireEvent.click(screen.getByRole("button", { name: "Grant" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Enter the agent id and at least one target.");
  fireEvent.change(screen.getByLabelText("Targets"), { target: { value: "acme/*" } });
  fireEvent.change(screen.getByLabelText(/Expires in/), { target: { value: "30" } });
  fireEvent.click(screen.getByRole("button", { name: "Grant" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("from 1 to 14"));
  expect(writes()).toEqual([]);
});

it("revokes one grant only after a confirmation, then re-reads", async () => {
  let grants = [grant()];
  routes = {
    "GET /": () => [200, { grants }],
    "DELETE /grt_abcdefgh1": () => { grants = [grant({ status: "revoked" })]; return [200, grants[0]]; },
  };
  render(section());
  fireEvent.click(await screen.findByRole("button", { name: "Revoke assistant-1" }));
  expect(screen.getByText(/Revoke this grant\?/)).toBeInTheDocument();
  expect(writes()).toEqual([]);
  fireEvent.click(within(confirmGroup()).getByRole("button", { name: "Revoke" }));
  expect(await screen.findByText("Grant revoked.")).toBeInTheDocument();
  expect(await screen.findByText(/^revoked, expires/)).toBeInTheDocument();
  expect(writes()).toEqual([{ method: "DELETE", path: `${BASE}/grt_abcdefgh1`, body: {} }]);
});

it("cancelling a revocation sends nothing", async () => {
  routes = { "GET /": () => [200, { grants: [grant()] }] };
  render(section());
  fireEvent.click(await screen.findByRole("button", { name: "Revoke all my grants" }));
  expect(screen.getByText(/Revoke all your grants\?/)).toBeInTheDocument();
  fireEvent.click(within(confirmGroup()).getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("group", { name: "Confirm revocation" })).not.toBeInTheDocument();
  expect(writes()).toEqual([]);
});

it("revoke-all asks first; an admin's 'every grant' view revokes with {all: true}", async () => {
  routes = {
    "GET /?all=1": () => [200, { grants: [grant(), grant({ grant_id: "grt_other0001", owner_id: "u2", delegate_agent_id: "bot-2" })] }],
    "GET /": () => [200, { grants: [grant()] }],
    "POST /revoke-all": () => [200, { revoked: ["grt_abcdefgh1", "grt_other0001"] }],
  };
  render(section({ isAdmin: true }));
  await screen.findByText("assistant-1");
  fireEvent.click(screen.getByLabelText("Show every grant in the workspace"));
  expect(await screen.findByText("bot-2")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Revoke every grant" }));
  expect(screen.getByText(/Revoke every grant in this workspace\?/)).toBeInTheDocument();
  fireEvent.click(within(confirmGroup()).getByRole("button", { name: "Revoke" }));
  expect(await screen.findByText("Revoked 2 grant(s).")).toBeInTheDocument();
  expect(writes()).toEqual([{ method: "POST", path: `${BASE}/revoke-all`, body: { all: true } }]);
});

it("a member's revoke-all sends {} for their own grants, and members get no 'every grant' toggle", async () => {
  routes = {
    "GET /": () => [200, { grants: [grant()] }],
    "POST /revoke-all": () => [200, { revoked: ["grt_abcdefgh1"] }],
  };
  render(section());
  await screen.findByText("assistant-1");
  expect(screen.queryByText("Show every grant in the workspace")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Revoke all my grants" }));
  fireEvent.click(within(confirmGroup()).getByRole("button", { name: "Revoke" }));
  expect(await screen.findByText("Revoked 1 grant(s).")).toBeInTheDocument();
  expect(writes()).toEqual([{ method: "POST", path: `${BASE}/revoke-all`, body: {} }]);
});

it("shows a network failure, and a failed list read with a retry", async () => {
  let listFails = true;
  routes = {
    "GET /": () => (listFails ? [503, { error: "Delegation is unavailable", code: "unavailable" }] : [200, { grants: [] }]),
    "POST /claims": () => Promise.reject(new TypeError("Failed to fetch")),
  };
  render(section());
  expect(await screen.findByRole("alert")).toHaveTextContent("Delegation is unavailable");
  listFails = false;
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("No grants yet.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Start a claim" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the server. Try again.");
});

it("with delegation off, hides claims and new grants but keeps list and revoke", async () => {
  routes = { "GET /": () => [200, { grants: [grant()] }] };
  render(section({ delegationEnabled: false }));
  await screen.findByText("assistant-1");
  expect(screen.queryByRole("button", { name: "Start a claim" })).not.toBeInTheDocument();
  expect(screen.queryByRole("form", { name: "Grant a delegate" })).not.toBeInTheDocument();
  expect(screen.getByText(/Delegation is off for this workspace/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Revoke assistant-1" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Revoke all my grants" })).toBeInTheDocument();
});

it("sits under the toggle, follows it on, and takes the policy's expiry cap", async () => {
  let enabled = false;
  routes = {
    "GET /policy": () => [200, { delegation_enabled: enabled, max_expiry_days: 21 }],
    "PUT /policy": (call) => {
      enabled = (call.body as { delegation_enabled: boolean }).delegation_enabled;
      return [200, { delegation_enabled: enabled, max_expiry_days: 21, revoked_grants: [] }];
    },
    "GET /": () => [200, { grants: [] }],
  };
  render(<DelegationSection workspaceId="w1" canManage />);
  expect(await screen.findByText(/Delegation is off for this workspace/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("switch"));
  fireEvent.click(screen.getByRole("button", { name: "Turn on delegation" }));
  expect(await screen.findByRole("button", { name: "Start a claim" })).toBeInTheDocument();
  expect(screen.getByLabelText("Expires in (days, up to 21)")).toBeInTheDocument();
});

it("drops an answer that arrives after a workspace switch", async () => {
  let finish!: (reply: [number, unknown]) => void;
  routes = {
    "GET /": () => [200, { grants: [] }],
    "POST /claims": () => new Promise((resolve) => { finish = resolve; }),
  };
  const keyed = (workspaceId: string) => <DelegatesSection key={workspaceId} workspaceId={workspaceId}
    delegationEnabled maxExpiryDays={30} isAdmin={false} />;
  routes["GET /cloud/api/v1/workspaces/w2/delegates"] = () => [200, { grants: [] }];
  const { rerender } = render(keyed("w1"));
  fireEvent.click(screen.getByRole("button", { name: "Start a claim" }));
  rerender(keyed("w2"));
  await act(async () => finish([201, { claim_id: "clm_1", code: "dlg_staleforw1", expires_at: "2026-11-25T00:10:00.000Z" }]));
  expect(screen.queryByTestId("claim-code")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Start a claim" })).toBeEnabled();
  expect(await screen.findByText("No grants yet.")).toBeInTheDocument();
});
