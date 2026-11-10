import { beforeEach, afterEach, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { RemoteAgentsSection } from "./remote-agents";
import { remoteAgentApi } from "./remote-agent-api";
import { Settings } from "./settings";

type Call = {
  url: string;
  init: RequestInit;
  body: Record<string, unknown> | null;
};
let calls: Call[] = [];
let enabled = true;
let configured = true;
let bound = false;
let connected = false;
let remoteConnected = false;
let override: ((call: Call) => Response | Promise<Response> | null) | undefined;
const secret = "cursor_key_" + "s".repeat(32);
const connection = {
  keyHint: "…ssss",
  validatedAt: "2026-11-10T00:00:00Z",
  providerAccount: null,
};
const amp = () => ({
  connection: connected ? connection : null,
  history: { available: false, reason: "push_session_unavailable" },
  bindings: bound
    ? [
        {
          id: "b1",
          threadId: "T-one",
          agentName: "amp-one",
          state: "bound",
          lastError: null,
          deliveries: [{ messageId: "m1", state: "unknown" }],
        },
      ]
    : [],
});
function respond(call: Call) {
  const path = call.url;
  if (path.endsWith("/auth/whoami")) return Response.json({
    user: { id: "u1", name: "Owner", email: "owner@test.example" },
    currentWorkspace: { id: "w1", name: "Primary" },
    currentOrganization: { id: "o1", name: "Acme", role: "owner" },
  });
  if (path.endsWith("/cloud-agents")) return Response.json({ agents: [], providers: [], canManage: true });
  if (path.endsWith("/providers"))
    return Response.json({
      providers: [
        { id: "amp", product: "Amp", implemented: true, configured, enabled },
      ],
    });
  if (path.endsWith("/remote-agent-connections"))
    return Response.json({
      providers: [
        { id: "capy", product: "Capy", docsUrl: "https://capy.ai" },
        {
          id: "replicas",
          product: "Replicas",
          docsUrl: "https://replicas.dev",
        },
        { id: "devin", product: "Devin", docsUrl: "https://app.devin.ai" },
        {
          id: "cursor-cloud",
          product: "Cursor Cloud",
          docsUrl: "https://cursor.com/dashboard",
        },
      ].map((provider) => ({
        ...provider,
        connection: remoteConnected ? connection : null,
        capabilities: {
          connectionManagement: true,
          relayBinding: false,
          historySync: false,
        },
      })),
    });
  if (path.endsWith("/remote-agent-connections/cursor-cloud")) {
    remoteConnected = call.init.method !== "DELETE";
    return Response.json({ connection: remoteConnected ? connection : null });
  }
  if (path.endsWith("/remote-agent-connections/devin"))
    return Response.json({ connection });
  if (path.endsWith("/amp/connection")) {
    connected = call.init.method !== "DELETE";
    return Response.json({
      ...amp(),
      threads: [{ id: "T-one", title: "Selected thread" }],
    });
  }
  if (path.endsWith("/amp/threads"))
    return Response.json({
      threads: [{ id: "T-two", title: "Another thread" }],
    });
  if (path.endsWith("/amp/bindings")) {
    bound = true;
    return Response.json({ binding_id: "b1" });
  }
  if (path.endsWith("/amp/bindings/b1")) {
    bound = false;
    return Response.json({ ok: true });
  }
  if (path.endsWith("/amp/bindings/b1/deliveries/m1/check"))
    return Response.json({ confirmed: true, state: "delivered" });
  if (path.endsWith("/amp")) return Response.json(amp());
  return Response.json({ error: "not_found" }, { status: 404 });
}
beforeEach(() => {
  calls = [];
  enabled = true;
  configured = true;
  bound = false;
  connected = false;
  remoteConnected = false;
  override = undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input, init: RequestInit = {}) => {
      const call = {
        url: String(input),
        init,
        body: init.body ? JSON.parse(String(init.body)) : null,
      };
      calls.push(call);
      return (await override?.(call)) ?? respond(call);
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

it("mounts remote provider connections in the real Settings Connections section", async () => {
  render(<Settings section="connections" />);
  expect(await screen.findByLabelText("Cursor Cloud API key")).toBeInTheDocument();
  expect(await screen.findByLabelText("Amp API key")).toBeInTheDocument();
});

it("renders each provider and saves/removes a key through same-origin Control API without retaining it", async () => {
  render(<RemoteAgentsSection workspaceId="w1" canManage />);
  const input = await screen.findByLabelText("Cursor Cloud API key");
  expect(await screen.findByText("Replicas")).toBeInTheDocument();
  expect(screen.getByText("Devin")).toBeInTheDocument();
  expect(screen.getByText("Cursor Cloud")).toBeInTheDocument();
  const card = input.closest('[data-slot="card"]')! as HTMLElement;
  fireEvent.change(input, { target: { value: secret } });
  fireEvent.click(within(card).getByRole("button", { name: "Connect" }));
  await within(card).findByText("…ssss");
  expect(input).toHaveValue("");
  expect(document.body.textContent).not.toContain(secret);
  const save = calls.find((call) => call.init.method === "POST")!;
  expect(save.url).toBe(
    "/cloud/api/v1/workspaces/w1/remote-agent-connections/cursor-cloud",
  );
  expect(save.body).toEqual({ key: secret });
  expect(save.init.credentials).toBe("same-origin");
  expect(save.init.redirect).toBe("error");
  expect(card.textContent).toContain("History sync is not available yet");
  fireEvent.click(within(card).getByRole("button", { name: "Disconnect" }));
  await waitFor(() =>
    expect(within(card).queryByText("…ssss")).not.toBeInTheDocument(),
  );
  expect(
    calls.some(
      (call) => call.init.method === "DELETE" && call.url.endsWith("/cursor-cloud"),
    ),
  ).toBe(true);
});

it("uses existing Amp discovery, binding, delivery-check and disconnect contracts", async () => {
  render(<RemoteAgentsSection workspaceId="w1" canManage />);
  const input = await screen.findByLabelText("Amp API key");
  const card = input.closest('[data-slot="card"]')! as HTMLElement;
  expect(card.textContent).toContain("Amp history sync is not available");
  fireEvent.change(input, { target: { value: "sgamp_" + "s".repeat(32) } });
  fireEvent.click(within(card).getByRole("button", { name: "Connect" }));
  await within(card).findByText("Selected thread");
  fireEvent.click(
    within(card).getAllByRole("button", { name: "Connect thread" })[0]!,
  );
  await within(card).findByText("@amp-one");
  fireEvent.click(within(card).getByRole("button", { name: "Check delivery" }));
  await waitFor(() =>
    expect(
      calls.some((call) =>
        call.url.endsWith("/amp/bindings/b1/deliveries/m1/check"),
      ),
    ).toBe(true),
  );
  await waitFor(() =>
    expect(
      within(card).getByRole("button", { name: "Disconnect thread" }),
    ).toBeEnabled(),
  );
  fireEvent.click(
    within(card).getByRole("button", { name: "Disconnect thread" }),
  );
  await waitFor(() =>
    expect(within(card).queryByText("@amp-one")).not.toBeInTheDocument(),
  );
  fireEvent.click(within(card).getByRole("button", { name: "Choose threads" }));
  await within(card).findByText("Another thread");
  fireEvent.click(
    within(card).getByRole("button", { name: /^Disconnect$/ }),
  );
  await waitFor(() =>
    expect(
      within(card).queryByRole("button", { name: "Choose threads" }),
    ).not.toBeInTheDocument(),
  );
  expect(
    calls.find(
      (call) =>
        call.url.endsWith("/amp/bindings") && call.init.method === "POST",
    )?.body,
  ).toEqual({ threadId: "T-one" });
});

it.each([
  [false, true],
  [true, false],
])(
  "never offers Amp management when enabled=%s configured=%s",
  async (on, ready) => {
    enabled = on;
    configured = ready;
    render(<RemoteAgentsSection workspaceId="w1" canManage />);
    await screen.findByText(/Amp is not enabled and configured/);
    expect(screen.queryByLabelText("Amp API key")).not.toBeInTheDocument();
    expect(calls.some((call) => call.url.endsWith("/amp"))).toBe(false);
  },
);

it("members can see safe summaries but cannot enter keys or invoke Amp management", async () => {
  remoteConnected = true;
  render(<RemoteAgentsSection workspaceId="w1" canManage={false} />);
  expect(await screen.findAllByText("…ssss")).toHaveLength(2);
  expect(screen.queryByLabelText("Cursor Cloud API key")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Amp API key")).not.toBeInTheDocument();
  expect(
    screen
      .getAllByRole("button", { name: "Disconnect" })
      .every((button) => button.hasAttribute("disabled")),
  ).toBe(true);
  expect(
    calls.every((call) => !call.init.method || call.init.method === "GET"),
  ).toBe(true);
  expect(calls.some((call) => call.url.endsWith("/amp"))).toBe(false);
});

it("a workspace change discards drafts and ignores a late old-workspace save", async () => {
  let finish!: (response: Response) => void;
  override = (call) =>
    call.init.method === "POST"
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : null;
  const { rerender } = render(
    <RemoteAgentsSection key="w1" workspaceId="w1" canManage />,
  );
  const oldInput = await screen.findByLabelText("Cursor Cloud API key");
  fireEvent.change(oldInput, { target: { value: secret } });
  fireEvent.submit(oldInput.closest("form")!);
  await waitFor(() => expect(finish).toBeDefined());
  rerender(<RemoteAgentsSection key="w2" workspaceId="w2" canManage />);
  const newInput = await screen.findByLabelText("Cursor Cloud API key");
  finish(Response.json({ connection }));
  await waitFor(() =>
    expect(
      calls.some((call) => call.url.includes("/w2/remote-agent-connections")),
    ).toBe(true),
  );
  expect(newInput).toHaveValue("");
  expect(screen.queryByText("…ssss")).not.toBeInTheDocument();
});

it("a failed validation clears the submitted secret without showing connected", async () => {
  override = (call) =>
    call.init.method === "POST"
      ? Response.json(
          {
            error: "credential_check_failed",
            message: "The provider could not validate this key.",
          },
          { status: 502 },
        )
      : null;
  render(<RemoteAgentsSection workspaceId="w1" canManage />);
  const input = await screen.findByLabelText("Cursor Cloud API key");
  fireEvent.change(input, { target: { value: secret } });
  fireEvent.submit(input.closest("form")!);
  await screen.findByText("The provider could not validate this key.");
  expect(input).toHaveValue("");
  expect(screen.queryByText("…ssss")).not.toBeInTheDocument();
});

it("encodes workspace ids and supplies the Devin organization without importing Cloud actions", async () => {
  await remoteAgentApi.connect(
    "workspace/one",
    "devin",
    "a".repeat(32),
    "org-id",
  );
  expect(calls[0]?.url).toBe(
    "/cloud/api/v1/workspaces/workspace%2Fone/remote-agent-connections/devin",
  );
  expect(calls[0]?.body).toEqual({ key: "a".repeat(32), orgId: "org-id" });
});
