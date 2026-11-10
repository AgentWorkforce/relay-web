import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RemoteConnectionsSection } from "./remote-connections";

let enabled: string[];
let connected: Set<string>;
let reject: string | null;
let requests: Array<{ path: string; method: string; body: unknown }>;
const hint = "…5678";
const date = "2026-11-10T08:00:00Z";
const key = "provider-test-key-5678";

beforeEach(() => {
  enabled = ["factory", "capy", "replicas"]; connected = new Set(); reject = null; requests = [];
  vi.stubGlobal("fetch", vi.fn(async (path: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(init.body as string) : undefined;
    requests.push({ path, method, body });
    expect(init.credentials).toBe("same-origin"); expect(init.redirect).toBe("error");
    if (path.endsWith("/providers")) return Response.json({ providers: ["factory", "capy", "replicas", "amp"].map(id => ({
      id, setup: "api_key", enabled: enabled.includes(id), implemented: true,
    })) });
    const provider = path.includes("/replicas") ? "replicas" : path.includes("/capy") ? "capy" : "factory";
    if (method === "POST" || method === "PUT") {
      if (reject === provider) return Response.json(provider === "replicas" ? { error: "Disconnect Replicas before connecting a different organization." }
        : { error: "capy_unavailable", message: "Capy is unavailable." }, { status: 409 });
      connected.add(provider);
    }
    if (method === "DELETE") {
      connected.delete(provider);
      return provider === "replicas" ? Response.json({ disconnected: true }) : new Response(null, { status: 204 });
    }
    if (provider === "replicas") return Response.json(connected.has(provider) ? { keyHint: hint, organizationId: "provider-org", validatedAt: date } : null);
    if (provider === "capy") return Response.json({ connected: connected.has(provider), key_hint: connected.has(provider) ? `capy_${hint}` : null,
      validated_at: connected.has(provider) ? date : null, last_error: null });
    return Response.json({ connected: false, key_hint: null, validated_at: null, user_is_owner: false, bindings_count: 0, history: "deferred" });
  }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("uses the server provider gates and never queries disabled key endpoints", async () => {
  enabled = ["factory"];
  render(<RemoteConnectionsSection workspaceId="w1" canManage />);
  expect(await screen.findByLabelText("Factory API key")).toBeInTheDocument();
  expect(screen.queryByLabelText("Capy API key")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Replicas API key")).not.toBeInTheDocument();
  expect(requests.map(r => r.path)).toEqual(["/cloud/api/v1/workspaces/w1/providers", "/cloud/api/v1/workspaces/w1/factory/connection"]);
});

it("connects and replaces Capy through its write-only Control contract", async () => {
  render(<RemoteConnectionsSection workspaceId="w1" canManage />);
  fireEvent.change(await screen.findByLabelText("Capy API key"), { target: { value: key } });
  fireEvent.click(screen.getByRole("button", { name: "Connect Capy" }));
  expect(await screen.findByText(`capy_${hint}`)).toBeInTheDocument();
  expect(requests.find(r => r.method === "PUT")).toEqual({ path: "/cloud/api/v1/workspaces/w1/capy/connection", method: "PUT", body: { key } });
  expect(screen.getByLabelText("Replace Capy API key")).toHaveValue("");
  fireEvent.change(screen.getByLabelText("Replace Capy API key"), { target: { value: "replacement-key-5678" } });
  fireEvent.click(screen.getAllByRole("button", { name: "Replace key" })[0]);
  await waitFor(() => expect(requests.filter(r => r.method === "PUT")).toHaveLength(2));
  expect(document.body).not.toHaveTextContent(key);
});

it("connects Replicas using api_key and confirms disconnect", async () => {
  render(<RemoteConnectionsSection workspaceId="w1" canManage />);
  fireEvent.change(await screen.findByLabelText("Replicas API key"), { target: { value: key } });
  fireEvent.click(screen.getByRole("button", { name: "Connect Replicas" }));
  expect(await screen.findByText(hint)).toBeInTheDocument();
  expect(requests.find(r => r.method === "POST")).toEqual({ path: "/cloud/api/v1/workspaces/w1/replicas", method: "POST", body: { api_key: key } });
  expect(screen.getByLabelText("Replace Replicas API key")).toHaveValue("");
  fireEvent.click(screen.getByRole("button", { name: "Disconnect Replicas" }));
  expect(requests.some(r => r.method === "DELETE")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Confirm disconnect" }));
  expect(await screen.findByLabelText("Replicas API key")).toHaveValue("");
  expect(requests.filter(r => r.method === "DELETE")).toEqual([{ path: "/cloud/api/v1/workspaces/w1/replicas", method: "DELETE", body: undefined }]);
});

it("shows Replicas organization conflicts without a second write", async () => {
  reject = "replicas";
  render(<RemoteConnectionsSection workspaceId="w1" canManage />);
  fireEvent.change(await screen.findByLabelText("Replicas API key"), { target: { value: key } });
  fireEvent.click(screen.getByRole("button", { name: "Connect Replicas" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Disconnect Replicas before connecting a different organization.");
  expect(screen.getByLabelText("Replicas API key")).toHaveValue("");
  expect(requests.filter(r => r.method !== "GET")).toHaveLength(1);
});

it("allows members to see Capy/Replicas status without key controls or Factory reads", async () => {
  connected.add("capy");
  render(<RemoteConnectionsSection workspaceId="w1" canManage={false} />);
  expect(await screen.findByText(`capy_${hint}`)).toBeInTheDocument();
  expect(screen.queryByLabelText("Replace Capy API key")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Replicas API key")).not.toBeInTheDocument();
  expect(requests.some(r => r.path.includes("/factory/"))).toBe(false);
  expect(requests.every(r => r.method === "GET")).toBe(true);
});

it("clears an unsaved key when changing workspace", async () => {
  const view = render(<RemoteConnectionsSection workspaceId="w1" canManage />);
  fireEvent.change(await screen.findByLabelText("Replicas API key"), { target: { value: key } });
  view.rerender(<RemoteConnectionsSection workspaceId="w2" canManage />);
  expect(await screen.findByLabelText("Replicas API key")).toHaveValue("");
  expect(requests.some(r => r.path === "/cloud/api/v1/workspaces/w2/replicas")).toBe(true);
  expect(requests.every(r => r.method === "GET")).toBe(true);
});
