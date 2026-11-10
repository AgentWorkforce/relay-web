import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FactoryConnectionSection } from "./factory-connection";
import { RemoteAgentsSection } from "./remote-agents";

const prefix = "/cloud/api/v1/workspaces/w1/factory";
const secret = "fk-test-owner-secret-1234";
let connected = false;
let owner = true;
let enabled = true;
let warning: string | undefined;
let rejectConnect = false;
let bound = false;
let retired = false;
let connectionError: string | null;
let failComputers = false;
let bindResponse: Promise<Response> | null;
let writes: Array<{ path: string; method: string; body: unknown }>;

function summary() {
  return { connected, key_hint: connected ? "…1234" : null, validated_at: connected ? "2026-11-10T08:00:00Z" : null,
    user_is_owner: connected && owner, bindings_count: bound ? 1 : 0, history: "deferred" };
}
function binding() {
  return { id: "b1", session_id: "s1", computer_id: "c1", state: retired ? "retired" : "bound",
    agent: { name: "factory-owned", id: "a1" }, history: "deferred",
    created_at: "2026-11-10T08:00:00Z", updated_at: "2026-11-10T08:00:00Z", retired_at: null };
}

beforeEach(() => {
  connected = false; owner = true; enabled = true; warning = undefined; rejectConnect = false; bound = false; writes = [];
  failComputers = false; bindResponse = null;
  retired = false; connectionError = null;
  vi.stubGlobal("fetch", vi.fn(async (path: string, init: RequestInit = {}) => {
    expect(init.credentials).toBe("same-origin");
    expect(init.redirect).toBe("error");
    expect(init.cache).toBe("no-store");
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(init.body as string) : undefined;
    if (method !== "GET") writes.push({ path, method, body });
    if (!enabled) return Response.json({ error: "not_found", message: "Route not found" }, { status: 404 });
    if (path === `${prefix}/connection`) {
      if (method === "GET" && connectionError) return Response.json({ error: connectionError, message: "Factory connection could not be read" }, { status: 404 });
      if (method === "PUT") {
        if (rejectConnect) return Response.json({ error: "factory_unavailable", message: `Could not save ${secret}` }, { status: 503 });
        connected = true;
      }
      if (method === "DELETE") { connected = false; bound = false; return new Response(null, { status: 204 }); }
      return Response.json(summary());
    }
    if (path === `${prefix}/computers`) {
      if (failComputers) return Response.json({ error: "factory_unavailable", message: "Factory computers unavailable" }, { status: 503 });
      return Response.json({ computers: [{ id: "c1", name: "My Mac", status: "active" }, { id: "c2", name: "Other Mac", status: "active" }] });
    }
    if (path === `${prefix}/computers/c1/sessions`) return Response.json({
      sessions: [
        { id: "s1", title: "My open chat", computer_id: "c1", bound: bound ? "here" : null },
        { id: "s2", title: "Another workspace", computer_id: "c1", bound: "elsewhere" },
        { id: "s3", title: "Different computer", computer_id: "c2", bound: null },
      ], ...(warning ? { warning } : {}),
    });
    if (path === `${prefix}/bindings`) {
      if (method === "POST") {
        if (bindResponse) return bindResponse;
        bound = true; retired = false; return Response.json({ binding_id: "b1", session_id: "s1", agent: binding().agent }, { status: 201 });
      }
      return Response.json({ bindings: bound || retired ? [binding()] : [], history: "deferred" });
    }
    if (path === `${prefix}/bindings/b1` && method === "DELETE") { bound = false; retired = true; return new Response(null, { status: 204 }); }
    throw new Error(`Unexpected test request ${method} ${path}`);
  }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("sends the API key only to Control and clears it after save", async () => {
  render(<FactoryConnectionSection workspaceId="w1" canManage />);
  const field = await screen.findByLabelText("Factory API key");
  expect(field).toHaveAttribute("type", "password");
  fireEvent.change(field, { target: { value: secret } });
  fireEvent.click(screen.getByRole("button", { name: "Connect Factory" }));
  expect(await screen.findByText("…1234")).toBeInTheDocument();
  expect(writes).toEqual([{ path: `${prefix}/connection`, method: "PUT", body: { key: secret } }]);
  expect(screen.getByLabelText("Replace Factory API key")).toHaveValue("");
  expect(document.body).not.toHaveTextContent(secret);
  expect(localStorage.getItem("factory-key")).toBeNull();
  expect(await screen.findByText(/Factory transcript history is not available/)).toBeInTheDocument();
});

it("connects an existing chat by exact computer/session and disconnects only its binding", async () => {
  connected = true;
  render(<FactoryConnectionSection workspaceId="w1" canManage />);
  fireEvent.change(await screen.findByLabelText("Computer"), { target: { value: "c1" } });
  fireEvent.change(await screen.findByLabelText("Factory session"), { target: { value: "s1" } });
  fireEvent.click(screen.getByRole("button", { name: "Connect session" }));
  expect(await screen.findByText("@factory-owned")).toBeInTheDocument();
  expect(writes[0]).toEqual({ path: `${prefix}/bindings`, method: "POST", body: { session_id: "s1", computer_id: "c1" } });
  fireEvent.click(screen.getByRole("button", { name: "Disconnect @factory-owned" }));
  await waitFor(() => expect(screen.queryByText("@factory-owned")).not.toBeInTheDocument());
  expect(writes[1]).toEqual({ path: `${prefix}/bindings/b1`, method: "DELETE", body: undefined });
  expect(writes).toHaveLength(2);
});

it("does not offer chats bound elsewhere or returned under another computer", async () => {
  connected = true;
  render(<FactoryConnectionSection workspaceId="w1" canManage />);
  fireEvent.change(await screen.findByLabelText("Computer"), { target: { value: "c1" } });
  const field = await screen.findByLabelText("Factory session");
  expect(screen.getByRole("option", { name: "Another workspace · connected elsewhere" })).toBeDisabled();
  expect(screen.getByRole("option", { name: "Different computer" })).toBeDisabled();
  // Even a synthetic selection of a disabled option must not bind it.
  fireEvent.change(field, { target: { value: "s3" } });
  expect(screen.getByRole("button", { name: "Connect session" })).toBeDisabled();
  expect(writes).toHaveLength(0);
});

it("preserves the connected key when the Mac is unreachable", async () => {
  connected = true; warning = "Keep Factory Remote Control running on that computer";
  render(<FactoryConnectionSection workspaceId="w1" canManage />);
  fireEvent.change(await screen.findByLabelText("Computer"), { target: { value: "c1" } });
  expect(await screen.findByText(warning)).toBeInTheDocument();
  expect(screen.getByText("…1234")).toBeInTheDocument();
  expect(writes).toHaveLength(0);
});

it("requires explicit confirmation before removing the key and its bindings", async () => {
  connected = true; bound = true;
  render(<FactoryConnectionSection workspaceId="w1" canManage />);
  fireEvent.click(await screen.findByRole("button", { name: "Disconnect Factory" }));
  expect(writes).toHaveLength(0);
  expect(screen.getByRole("alertdialog", { name: "Disconnect Factory" })).toHaveTextContent("Your Factory chats will stay in Factory");
  fireEvent.click(screen.getByRole("button", { name: "Confirm disconnect" }));
  expect(await screen.findByLabelText("Factory API key")).toHaveValue("");
  expect(writes).toEqual([{ path: `${prefix}/connection`, method: "DELETE", body: undefined }]);
  expect(screen.queryByText("@factory-owned")).not.toBeInTheDocument();
});

it("does not expose another owner's manage or discovery controls", async () => {
  connected = true; owner = false;
  render(<FactoryConnectionSection workspaceId="w1" canManage />);
  expect(await screen.findByText(/Only the person who connected Factory/)).toBeInTheDocument();
  expect(screen.queryByLabelText("Replace Factory API key")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Computer")).not.toBeInTheDocument();
  expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
});

it("makes no Factory request for members and hides a disabled feature", async () => {
  const view = render(<FactoryConnectionSection workspaceId="w1" canManage={false} />);
  expect(fetch).not.toHaveBeenCalled();
  enabled = false;
  view.rerender(<FactoryConnectionSection workspaceId="w1" canManage />);
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole("heading", { name: "Factory" })).not.toBeInTheDocument();
  expect(writes).toHaveLength(0);
});

it("does not retry an unavailable key save or echo its secret in an error", async () => {
  rejectConnect = true;
  render(<FactoryConnectionSection workspaceId="w1" canManage />);
  fireEvent.change(await screen.findByLabelText("Factory API key"), { target: { value: secret } });
  fireEvent.click(screen.getByRole("button", { name: "Connect Factory" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("[redacted]");
  expect(document.body).not.toHaveTextContent(secret);
  expect(screen.getByLabelText("Factory API key")).toHaveValue("");
  expect(writes).toHaveLength(1);
});

it("keeps disconnect controls usable when the provider's computer list fails", async () => {
  connected = true; bound = true; failComputers = true;
  render(<FactoryConnectionSection workspaceId="w1" canManage />);
  const disconnect = await screen.findByRole("button", { name: "Disconnect @factory-owned" });
  expect(await screen.findByRole("alert")).toHaveTextContent("Factory computers unavailable");
  fireEvent.click(disconnect);
  await waitFor(() => expect(screen.queryByText("@factory-owned")).not.toBeInTheDocument());
  expect(writes).toEqual([{ path: `${prefix}/bindings/b1`, method: "DELETE", body: undefined }]);
});

it("does not display retained retired bindings as connected sessions", async () => {
  connected = true; retired = true;
  render(<FactoryConnectionSection workspaceId="w1" canManage />);
  expect(await screen.findByText("No Factory sessions connected yet.")).toBeInTheDocument();
  expect(screen.queryByText("@factory-owned")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Disconnect @factory-owned" })).not.toBeInTheDocument();
});

it("does not hide a connection-specific 404 as a disabled feature", async () => {
  connectionError = "factory_not_connected";
  render(<FactoryConnectionSection workspaceId="w1" canManage />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Factory connection could not be read");
  expect(screen.getByRole("heading", { name: "Factory" })).toBeInTheDocument();
});

it("keeps the selected computer and pending bind error visible until the request settles", async () => {
  connected = true;
  let finish!: (response: Response) => void;
  bindResponse = new Promise<Response>((resolve) => { finish = resolve; });
  render(<FactoryConnectionSection workspaceId="w1" canManage />);
  const computer = await screen.findByLabelText("Computer");
  fireEvent.change(computer, { target: { value: "c1" } });
  fireEvent.change(await screen.findByLabelText("Factory session"), { target: { value: "s1" } });
  fireEvent.click(screen.getByRole("button", { name: "Connect session" }));
  expect(computer).toBeDisabled();
  fireEvent.change(computer, { target: { value: "c2" } });
  expect(computer).toHaveValue("c1");
  await act(async () => finish(Response.json({ error: "factory_bindings_changed", message: "Refresh Factory settings before trying again." }, { status: 409 })));
  expect(await screen.findByRole("alert")).toHaveTextContent("Refresh Factory settings before trying again.");
  expect(computer).toBeEnabled();
  expect(writes).toHaveLength(1);
});

it.each([[false, true], [true, false], [true, true]])("mounts the Factory card only for enabled=%s implemented=%s", async (enabled, implemented) => {
  const original = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    if (input === "/cloud/api/v1/workspaces/w1/providers") return Response.json({ providers: [{ id: "factory", product: "Factory", enabled, implemented, configured: true }] });
    if (input === "/cloud/api/v1/workspaces/w1/remote-agent-connections") return Response.json({ providers: [] });
    return original(input, init);
  });
  render(<RemoteAgentsSection workspaceId="w1" canManage />);
  if (enabled && implemented) expect(await screen.findByLabelText("Factory API key")).toBeInTheDocument();
  else {
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(screen.queryByLabelText("Factory API key")).not.toBeInTheDocument();
    expect(writes).toHaveLength(0);
  }
});
