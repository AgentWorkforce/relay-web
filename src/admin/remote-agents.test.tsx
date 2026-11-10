import { beforeEach, afterEach, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
  act,
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
const secret = "capy_" + "s".repeat(32);
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
  if (path.endsWith("/remote-agent-connections/capy")) {
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

it("keeps known provider cards when a newer server adds an unfamiliar provider shape", async () => {
  override = (call) => call.url.endsWith("/remote-agent-connections")
    ? Response.json({ providers: [
      { id: "future-provider", futureConfig: { different: true } },
      { id: "capy", product: "Capy", docsUrl: "https://capy.ai", connection: null,
        capabilities: { connectionManagement: true, relayBinding: false, historySync: false } },
    ] }) : null;
  render(<RemoteAgentsSection workspaceId="w1" canManage />);
  expect(await screen.findByLabelText("Capy API key")).toBeInTheDocument();
  expect(screen.queryByText("future-provider")).not.toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(calls.every((call) => !call.url.includes("future-provider"))).toBe(true);
});

it("refreshes and re-seeds a connection after a conflicting key write without resending", async () => {
  override = (call) => {
    if (call.url.endsWith("/remote-agent-connections/capy") && call.init.method === "POST") {
      remoteConnected = true;
      return Response.json({ error: "connection_changed", message: "This connection changed. Refresh settings." }, { status: 409 });
    }
    return null;
  };
  render(<RemoteAgentsSection workspaceId="w1" canManage />);
  const field = await screen.findByLabelText("Capy API key");
  const card = field.closest('[data-slot="card"]')! as HTMLElement;
  fireEvent.change(field, { target: { value: secret } });
  fireEvent.click(within(card).getByRole("button", { name: "Connect" }));
  expect(await within(card).findByText("…ssss")).toBeInTheDocument();
  expect(within(card).getByLabelText("Replace Capy API key")).toHaveValue("");
  expect(calls.filter((call) => call.url.endsWith("/remote-agent-connections") && (call.init.method ?? "GET") === "GET")).toHaveLength(2);
  expect(calls.filter((call) => call.init.method === "POST")).toHaveLength(1);
});

it("clears a locally saved connection when a conflict refresh reports it deleted", async () => {
  let writes = 0;
  override = (call) => {
    if (call.url.endsWith("/remote-agent-connections/capy") && call.init.method === "POST") {
      if (++writes === 2) {
        // Another admin deleted the saved key while this replacement ran.
        remoteConnected = false;
        return Response.json({ error: "connection_changed", message: "This connection changed. Refresh settings." }, { status: 409 });
      }
    }
    return null;
  };
  render(<RemoteAgentsSection workspaceId="w1" canManage />);
  const field = await screen.findByLabelText("Capy API key");
  const card = field.closest('[data-slot="card"]')! as HTMLElement;
  fireEvent.change(field, { target: { value: secret } });
  fireEvent.click(within(card).getByRole("button", { name: "Connect" }));
  expect(await within(card).findByText("…ssss")).toBeInTheDocument();
  expect(within(card).getByLabelText("Replace Capy API key")).toHaveValue("");

  fireEvent.change(field, { target: { value: secret } });
  fireEvent.click(within(card).getByRole("button", { name: "Connect" }));
  expect(await within(card).findByRole("alert")).toHaveTextContent("This connection changed.");
  expect(await within(card).findByLabelText("Capy API key")).toHaveValue("");
  expect(within(card).queryByText("…ssss")).not.toBeInTheDocument();
  expect(within(card).queryByRole("button", { name: "Disconnect" })).not.toBeInTheDocument();
  expect(calls.filter((call) => call.url.endsWith("/remote-agent-connections") && (call.init.method ?? "GET") === "GET")).toHaveLength(2);
  expect(writes).toBe(2);
});

it("keeps a newer successful save when an older conflict refresh returns empty", async () => {
  let writes = 0;
  let reads = 0;
  let finishRefresh!: () => void;
  override = (call) => {
    if (call.url.endsWith("/remote-agent-connections/capy") && call.init.method === "POST" && ++writes === 2) {
      remoteConnected = false;
      return Response.json({ error: "connection_changed", message: "This connection changed. Refresh settings." }, { status: 409 });
    }
    if (call.url.endsWith("/remote-agent-connections") && ++reads === 2) {
      const staleEmpty = respond(call);
      return new Promise(resolve => { finishRefresh = () => resolve(staleEmpty); });
    }
    return null;
  };
  render(<RemoteAgentsSection workspaceId="w1" canManage />);
  const field = await screen.findByLabelText("Capy API key");
  const card = field.closest('[data-slot="card"]')! as HTMLElement;
  const connect = () => within(card).getByRole("button", { name: "Connect" });
  fireEvent.change(field, { target: { value: secret } });
  fireEvent.click(connect());
  await within(card).findByText("…ssss");

  fireEvent.change(field, { target: { value: secret } });
  fireEvent.click(connect());
  await within(card).findByRole("alert");
  await waitFor(() => expect(finishRefresh).toBeDefined());

  fireEvent.change(field, { target: { value: secret } });
  fireEvent.click(connect());
  await waitFor(() => expect(writes).toBe(3));
  await waitFor(() => expect(within(card).queryByRole("status")).not.toBeInTheDocument());
  await waitFor(() => expect(field).toHaveValue(""));
  await act(async () => { finishRefresh(); });
  expect(within(card).getByText("…ssss")).toBeInTheDocument();
  expect(within(card).getByRole("button", { name: "Disconnect" })).toBeEnabled();
  expect(within(card).getByLabelText("Replace Capy API key")).toHaveValue("");
  expect(writes).toBe(3);
  expect(reads).toBe(2);
});

it.each(["not_found", "workspace_not_found"])("classifies connection-list 404 %s correctly", async (code) => {
  override = (call) => call.url.endsWith("/remote-agent-connections")
    ? Response.json({ error: code, message: "Workspace could not be read." }, { status: 404 }) : null;
  render(<RemoteAgentsSection workspaceId="w1" canManage />);
  if (code === "not_found") expect(await screen.findByText("Remote provider connection settings are not available on this server version.")).toBeInTheDocument();
  else {
    expect(await screen.findByRole("alert")).toHaveTextContent("Workspace could not be read.");
    expect(screen.queryByText("Remote provider connection settings are not available on this server version.")).not.toBeInTheDocument();
  }
});

it.each(["forbidden", "csrf_rejected"])("surfaces %s without retrying the key write", async (code) => {
  override = (call) => call.url.endsWith("/remote-agent-connections/capy") && call.init.method === "POST"
    ? Response.json({ error: code, message: code === "forbidden" ? "Only current owners and admins can manage provider connections." : "Cross-origin provider write refused." }, { status: 403 }) : null;
  render(<RemoteAgentsSection workspaceId="w1" canManage />);
  const field = await screen.findByLabelText("Capy API key");
  const card = field.closest('[data-slot="card"]')! as HTMLElement;
  fireEvent.change(field, { target: { value: secret } });
  fireEvent.click(within(card).getByRole("button", { name: "Connect" }));
  expect(await within(card).findByRole("alert")).toHaveTextContent(code === "forbidden" ? "Only current owners" : "Cross-origin provider write refused");
  expect(field).toHaveValue("");
  expect(calls.filter((call) => call.init.method === "POST")).toHaveLength(1);
});

it("accepts a non-null provider account without displaying that identity", async () => {
  override = (call) => call.url.endsWith("/remote-agent-connections") ? Response.json({ providers: [
    { id: "devin", product: "Devin", docsUrl: "https://app.devin.ai", connection: { ...connection, providerAccount: "private-provider-account" },
      capabilities: { connectionManagement: true, relayBinding: false, historySync: false } },
  ] }) : null;
  render(<RemoteAgentsSection workspaceId="w1" canManage />);
  expect(await screen.findByLabelText("Replace Devin API key")).toBeInTheDocument();
  expect(screen.getByText("…ssss")).toBeInTheDocument();
  expect(document.body).not.toHaveTextContent("private-provider-account");
});

it("requires the Cognition organization before sending the Devin key", async () => {
  render(<RemoteAgentsSection workspaceId="w1" canManage />);
  const field = await screen.findByLabelText("Devin API key");
  const card = field.closest('[data-slot="card"]')! as HTMLElement;
  const connect = within(card).getByRole("button", { name: "Connect" });
  fireEvent.change(field, { target: { value: "cognition_test_secret_1234" } });
  expect(connect).toBeDisabled();
  fireEvent.change(within(card).getByLabelText("Cognition organization ID"), { target: { value: "cognition-org" } });
  expect(connect).toBeEnabled();
  fireEvent.click(connect);
  expect(await within(card).findByText("…ssss")).toBeInTheDocument();
  expect(calls.find((call) => call.url.endsWith("/remote-agent-connections/devin") && call.init.method === "POST")?.body)
    .toEqual({ key: "cognition_test_secret_1234", orgId: "cognition-org" });
});

it("mounts remote provider connections in the real Settings Connections section", async () => {
  render(<Settings section="connections" />);
  expect(await screen.findByLabelText("Capy API key")).toBeInTheDocument();
  expect(await screen.findByLabelText("Amp API key")).toBeInTheDocument();
});

it("renders each provider and saves/removes a key through same-origin Control API without retaining it", async () => {
  render(<RemoteAgentsSection workspaceId="w1" canManage />);
  const input = await screen.findByLabelText("Capy API key");
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
    "/cloud/api/v1/workspaces/w1/remote-agent-connections/capy",
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
      (call) => call.init.method === "DELETE" && call.url.endsWith("/capy"),
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
  await waitFor(() => expect(within(card).getAllByRole("button", { name: "Connect thread" })[0]).toBeEnabled());
  fireEvent.click(
    within(card).getAllByRole("button", { name: "Connect thread" })[0]!,
  );
  await within(card).findByText("@amp-one");
  await waitFor(() => expect(within(card).getByRole("button", { name: "Check delivery" })).toBeEnabled());
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
  await waitFor(() => expect(within(card).getByRole("button", { name: "Choose threads" })).toBeEnabled());
  fireEvent.click(within(card).getByRole("button", { name: "Choose threads" }));
  await within(card).findByText("Another thread");
  await waitFor(() => expect(within(card).getByRole("button", { name: /^Disconnect$/ })).toBeEnabled());
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
  expect(await screen.findAllByText("…ssss")).toHaveLength(4);
  expect(screen.queryByLabelText("Capy API key")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Amp API key")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Disconnect" })).not.toBeInTheDocument();
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
  const oldInput = await screen.findByLabelText("Capy API key");
  fireEvent.change(oldInput, { target: { value: secret } });
  fireEvent.submit(oldInput.closest("form")!);
  await waitFor(() => expect(finish).toBeDefined());
  rerender(<RemoteAgentsSection key="w2" workspaceId="w2" canManage />);
  const newInput = await screen.findByLabelText("Capy API key");
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
  const input = await screen.findByLabelText("Capy API key");
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
