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
  expect(screen.getByText("active")).toBeInTheDocument();
  expect(screen.getByText(/^Expires \d/)).toBeInTheDocument();
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
  fireEvent.change(screen.getByLabelText(/^Targets/), { target: { value: "acme/web:stable:*:*:*  acme/api:stable:*:*:*" } });
  fireEvent.change(screen.getByLabelText("Expires after"), { target: { value: "7" } });
  fireEvent.click(screen.getByLabelText("Ask me before each action in this class"));
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
  await screen.findByText("No delegates yet.");
  fireEvent.change(screen.getByLabelText("Agent id"), { target: { value: "assistant-9" } });
  fireEvent.change(screen.getByLabelText(/^Targets/), { target: { value: "acme/*" } });
  fireEvent.click(screen.getByRole("button", { name: "Grant" }));
  expect(await screen.findByText("Granted assistant-9.")).toBeInTheDocument();
  expect(await screen.findByText("assistant-9")).toBeInTheDocument();
  expect(screen.getByLabelText("Agent id")).toHaveValue("");
  // No expiry entered: the server's default applies, and no Tier O was asked for.
  expect(writes()[0]!.body).toEqual({ delegate_agent_id: "assistant-9", scopes: [{ class: "merge", targets: ["acme/*"] }] });
});

it("offers expiry presets capped by the policy maximum, and keeps Grant disabled until the form is valid", async () => {
  routes = { "GET /": () => [200, { grants: [] }], "POST /": () => [201, grant()] };
  render(section({ maxExpiryDays: 14 }));
  const options = within(screen.getByLabelText("Expires after")).getAllByRole("option").map((option) => option.textContent);
  expect(options).toEqual(["14 days (default)", "7 days"]);
  const grantButton = screen.getByRole("button", { name: "Grant" });
  expect(grantButton).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Agent id"), { target: { value: "my agent" } });
  fireEvent.change(screen.getByLabelText(/^Targets/), { target: { value: "acme/*" } });
  expect(screen.getByRole("alert")).toHaveTextContent("An agent id has no spaces.");
  expect(grantButton).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Agent id"), { target: { value: "agt_1" } });
  expect(grantButton).toBeEnabled();
  fireEvent.click(grantButton);
  await waitFor(() => expect(writes()).toHaveLength(1));
  // The default preset sends no expiry, so the server's default applies, as the blank box did.
  expect(writes()[0]!.body).not.toHaveProperty("expires_at");
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
  expect(await screen.findByText("revoked")).toBeInTheDocument();
  expect(writes()).toEqual([{ method: "DELETE", path: `${BASE}/grt_abcdefgh1`, body: {} }]);
});

it("cancelling a revocation sends nothing", async () => {
  routes = { "GET /": () => [200, { grants: [grant()] }] };
  render(section());
  await screen.findByText("assistant-1");
  fireEvent.click(screen.getByRole("button", { name: "Revoke all my grants and approvals" }));
  expect(screen.getByText(/Revoke all your grants and approvals\?/)).toBeInTheDocument();
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
  fireEvent.click(screen.getByRole("button", { name: "Revoke every grant and approval" }));
  expect(screen.getByText(/Revoke every grant and approval in this workspace\?/)).toHaveTextContent(
    "including approvals given without a grant");
  fireEvent.click(within(confirmGroup()).getByRole("button", { name: "Revoke" }));
  expect(await screen.findByText("Revoked 2 grant(s) and the approvals in scope.")).toBeInTheDocument();
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
  fireEvent.click(screen.getByRole("button", { name: "Revoke all my grants and approvals" }));
  fireEvent.click(within(confirmGroup()).getByRole("button", { name: "Revoke" }));
  expect(await screen.findByText("Revoked 1 grant(s) and the approvals in scope.")).toBeInTheDocument();
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
  expect(await screen.findByText("No delegates yet.")).toBeInTheDocument();
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
  expect(screen.getByRole("button", { name: "Revoke all my grants and approvals" })).toBeInTheDocument();
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
  fireEvent.click(screen.getByRole("switch", { name: /^Delegation is/ }));
  fireEvent.click(screen.getByRole("button", { name: "Turn on delegation" }));
  expect(await screen.findByRole("button", { name: "Start a claim" })).toBeInTheDocument();
  expect(screen.getByText("This workspace allows up to 21 days.")).toBeInTheDocument();
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
  expect(await screen.findByText("No delegates yet.")).toBeInTheDocument();
});

it("keeps a literal comma inside a target, and refuses commas used as separators", async () => {
  routes = { "GET /": () => [200, { grants: [] }], "POST /": () => [201, grant()] };
  render(section());
  fireEvent.change(screen.getByLabelText("Agent id"), { target: { value: "assistant-1" } });
  fireEvent.change(screen.getByLabelText("Class"), { target: { value: "external_comms" } });
  fireEvent.change(screen.getByLabelText(/^Targets/), { target: { value: "acme, channel:ops" } });
  expect(await screen.findByRole("alert")).toHaveTextContent("Separate targets with spaces");
  expect(screen.getByRole("button", { name: "Grant" })).toBeDisabled();
  expect(writes()).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: "Remove acme," }));
  fireEvent.change(screen.getByLabelText(/^Targets/), { target: { value: "channel:ops,security channel:eng" } });
  fireEvent.click(screen.getByRole("button", { name: "Grant" }));
  await waitFor(() => expect(writes()).toHaveLength(1));
  expect(writes()[0]!.body).toMatchObject({
    scopes: [{ class: "external_comms", targets: ["channel:ops,security", "channel:eng"] }],
  });
});

it("never shows the every-grant rows in the personal view, and shows a failed read of it with a retry", async () => {
  let mineFails = false;
  routes = {
    "GET /?all=1": () => [200, { grants: [grant({ grant_id: "grt_other0001", owner_id: "u2", delegate_agent_id: "bot-2" })] }],
    "GET /": () => (mineFails ? [503, { error: "Delegation is unavailable", code: "unavailable" }] : [200, { grants: [grant()] }]),
  };
  render(section({ isAdmin: true }));
  await screen.findByText("assistant-1");
  fireEvent.click(screen.getByLabelText("Show every grant in the workspace"));
  expect(await screen.findByText("bot-2")).toBeInTheDocument();
  mineFails = true;
  fireEvent.click(screen.getByLabelText("Show every grant in the workspace"));
  // The every-grant rows go at once, before the personal read settles.
  expect(screen.queryByText("bot-2")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Revoke bot-2" })).not.toBeInTheDocument();
  expect(await screen.findByRole("alert")).toHaveTextContent("Delegation is unavailable");
  expect(screen.queryByText("bot-2")).not.toBeInTheDocument();
  mineFails = false;
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("assistant-1")).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("drops an every-grant answer that settles after the admin went back to their own grants", async () => {
  let finishAll!: (reply: [number, unknown]) => void;
  routes = {
    "GET /?all=1": () => new Promise((resolve) => { finishAll = resolve; }),
    "GET /": () => [200, { grants: [grant()] }],
  };
  render(section({ isAdmin: true }));
  await screen.findByText("assistant-1");
  fireEvent.click(screen.getByLabelText("Show every grant in the workspace"));
  expect(screen.queryByText("assistant-1")).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("Show every grant in the workspace"));
  expect(await screen.findByText("assistant-1")).toBeInTheDocument();
  await act(async () => finishAll([200, { grants: [grant({ grant_id: "grt_other0001", owner_id: "u2", delegate_agent_id: "bot-2" })] }]));
  expect(screen.queryByText("bot-2")).not.toBeInTheDocument();
  expect(screen.getByText("assistant-1")).toBeInTheDocument();
});

it("shows a failed re-read after a revocation alongside the list it still has", async () => {
  let reads = 0;
  routes = {
    "GET /": () => (++reads === 1 ? [200, { grants: [grant()] }] : [503, { error: "Delegation is unavailable", code: "unavailable" }]),
    "DELETE /grt_abcdefgh1": () => [200, grant({ status: "revoked" })],
  };
  render(section());
  fireEvent.click(await screen.findByRole("button", { name: "Revoke assistant-1" }));
  fireEvent.click(within(confirmGroup()).getByRole("button", { name: "Revoke" }));
  expect(await screen.findByText("Grant revoked.")).toBeInTheDocument();
  expect(await screen.findByRole("alert")).toHaveTextContent("Delegation is unavailable");
  expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
});

it("offers revoke-all with no grants listed, since it also revokes approvals given without a grant", async () => {
  routes = { "GET /": () => [200, { grants: [] }], "POST /revoke-all": () => [200, { revoked: [] }] };
  render(section());
  await screen.findByText("No delegates yet.");
  fireEvent.click(screen.getByRole("button", { name: "Revoke all my grants and approvals" }));
  expect(screen.getByText(/Revoke all your grants and approvals\?/)).toHaveTextContent(
    "including approvals given without a grant");
  fireEvent.click(within(confirmGroup()).getByRole("button", { name: "Revoke" }));
  expect(await screen.findByText("Revoked 0 grant(s) and the approvals in scope.")).toBeInTheDocument();
  expect(writes()).toEqual([{ method: "POST", path: `${BASE}/revoke-all`, body: {} }]);
});

it("shows the classes a grant asks its owner before", async () => {
  routes = { "GET /": () => [200, { grants: [grant({ require_tier_o: ["merge"] })] }] };
  render(section());
  expect(await screen.findByText(/^Asks its owner before each action in: merge/)).toBeInTheDocument();
});

it("does not bring a claim code back after delegation is turned off and on again", async () => {
  routes = {
    "GET /": () => [200, { grants: [] }],
    "POST /claims": () => [201, { claim_id: "clm_1", code: "dlg_onetimecode", expires_at: "2026-11-25T00:10:00.000Z" }],
  };
  const { rerender } = render(section());
  fireEvent.click(screen.getByRole("button", { name: "Start a claim" }));
  expect(await screen.findByTestId("claim-code")).toHaveTextContent("dlg_onetimecode");
  rerender(section({ delegationEnabled: false }));
  rerender(section({ delegationEnabled: true }));
  expect(screen.getByRole("button", { name: "Start a claim" })).toBeInTheDocument();
  expect(screen.queryByTestId("claim-code")).not.toBeInTheDocument();
});

it("shows a trust-rule grant (scopes []) as covering every class", async () => {
  routes = { "GET /": () => [200, { grants: [grant({ scopes: [], trust_rule_id: "dtr_1", delegate_agent_id: "bot-1" })] }] };
  render(section());
  expect(await screen.findByText("All classes (trust rule)")).toBeInTheDocument();
});

it("splits the panel into your delegates, add a delegate, connect an external agent and a red danger zone", async () => {
  routes = { "GET /": () => [200, { grants: [] }] };
  render(section());
  await screen.findByText("No delegates yet.");
  expect(screen.getAllByRole("heading", { level: 4 }).map((heading) => heading.textContent)).toEqual([
    "Your delegates", "Add a delegate", "Connect an external agent", "Danger zone",
  ]);
  expect(screen.getByText("Add a delegate below to let one of your agents pass on your approval.")).toBeInTheDocument();
  expect(screen.queryByText(/Tier O/)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Revoke all my grants and approvals" }).className).toContain("bg-destructive");
});

it("shows the every-grant filter switch in the list header to admins only", async () => {
  routes = { "GET /": () => [200, { grants: [] }], "GET /?all=1": () => [200, { grants: [] }] };
  const { unmount } = render(section());
  await screen.findByText("No delegates yet.");
  expect(screen.queryByRole("switch", { name: "Show every grant in the workspace" })).not.toBeInTheDocument();
  unmount();
  render(section({ isAdmin: true }));
  const filter = screen.getByRole("switch", { name: "Show every grant in the workspace" });
  expect(filter).toHaveAttribute("aria-checked", "false");
  fireEvent.click(filter);
  expect(await screen.findByText("No grants in this workspace yet.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Revoke every grant and approval" })).toBeInTheDocument();
});

it("turns typed targets into chips on space or Enter, and removes them with x or Backspace", async () => {
  routes = { "GET /": () => [200, { grants: [] }], "POST /": () => [201, grant()] };
  render(section());
  const input = screen.getByLabelText(/^Targets/);
  fireEvent.change(screen.getByLabelText("Agent id"), { target: { value: "agt_1" } });
  fireEvent.change(input, { target: { value: "acme/web " } });
  fireEvent.change(input, { target: { value: "acme/*" } });
  fireEvent.keyDown(input, { key: "Enter" });
  fireEvent.change(input, { target: { value: "acme/old " } });
  const chips = () => screen.queryAllByTestId("target-chip").map((chip) => chip.firstChild?.textContent);
  expect(chips()).toEqual(["acme/web", "acme/*", "acme/old"]);
  fireEvent.keyDown(input, { key: "Backspace" });
  fireEvent.click(screen.getByRole("button", { name: "Remove acme/web" }));
  expect(chips()).toEqual(["acme/*"]);
  expect(screen.getByText(/owner\/\* means every repository that owner has/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Grant" }));
  await waitFor(() => expect(writes()).toHaveLength(1));
  expect(writes()[0]!.body).toMatchObject({ scopes: [{ class: "merge", targets: ["acme/*"] }] });
  await waitFor(() => expect(chips()).toEqual([]));
});

it("describes each class in the class picker", () => {
  routes = { "GET /": () => [200, { grants: [] }] };
  render(section());
  const options = within(screen.getByLabelText("Class")).getAllByRole("option").map((option) => option.textContent);
  expect(options).toContain("merge — Merge a pull request or turn on auto-merge.");
  expect(options).toContain("spend — Buy or scale up paid resources. Each approval works once.");
  expect(options).toHaveLength(10);
});

it("'Start a claim' opens an inline step with the one-time code, a copy button and its expiry", async () => {
  const writeText = vi.fn(async () => {});
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  routes = {
    "GET /": () => [200, { grants: [] }],
    "POST /claims": () => [201, { claim_id: "clm_1", code: "dlg_onetimecode", expires_at: "2026-11-25T00:10:00.000Z" }],
  };
  render(section());
  fireEvent.click(screen.getByRole("button", { name: "Start a claim" }));
  const step = await screen.findByRole("group", { name: "One-time code" });
  expect(within(step).getByText("Give this code to the agent")).toBeInTheDocument();
  expect(within(step).getByTestId("claim-code")).toHaveTextContent("dlg_onetimecode");
  expect(within(step).getByText(/it works once/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Start a claim" })).not.toBeInTheDocument();
  fireEvent.click(within(step).getByRole("button", { name: "Copy" }));
  expect(await screen.findByText("Code copied.")).toBeInTheDocument();
  expect(writeText).toHaveBeenCalledWith("dlg_onetimecode");
});
