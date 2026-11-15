import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { SignedOut } from "../admin/api";
import { FlowConnections } from "./flow-connections";

const api = vi.hoisted(() => ({
  integrationProviders: vi.fn(),
  disconnectIntegration: vi.fn(),
}));
vi.mock("../admin/api", () => ({
  adminApi: api,
  SignedOut: class extends Error {},
}));
const providers = [
  {
    id: "gitlab",
    displayName: "GitLab",
    authMode: "OAUTH2",
    configured: true,
    connection: {
      status: "ready",
      connectionId: "gitlab-key",
      providerConfigKey: "gitlab-pat",
      authMode: "api_key",
      accountLabel: "Release bot",
      scopes: ["read_api"],
    },
  },
  {
    id: "slack",
    displayName: "Slack",
    authMode: "OAUTH2",
    configured: true,
    connection: {
      status: "error",
      connectionId: "slack-oauth",
      providerConfigKey: "slack",
      authMode: "oauth2",
    },
  },
];
beforeEach(() => {
  vi.resetAllMocks();
  api.integrationProviders.mockResolvedValue({ providers, canManage: true });
  api.disconnectIntegration.mockResolvedValue({ deleted: true });
});
afterEach(cleanup);

it("shows saved CLI connections and their connection auth mode instead of the provider's default", async () => {
  render(<FlowConnections workspaceId="workspace" canManage />);
  await screen.findByText("GitLab");
  expect(screen.getAllByText("Access token").length).toBeGreaterThan(0);
  expect(screen.getAllByText("OAuth").length).toBeGreaterThan(0);
  expect(screen.getByText("Release bot")).toBeInTheDocument();
  expect(screen.getByText("read_api")).toBeInTheDocument();
  expect(screen.getByText("Needs attention")).toBeInTheDocument();
});

it("requires confirmation and preserves the other provider after disconnect", async () => {
  render(<FlowConnections workspaceId="workspace" canManage />);
  await screen.findByText("GitLab");
  fireEvent.click(
    screen.getAllByRole("button", { name: "Disconnect", hidden: true })[0],
  );
  expect(api.disconnectIntegration).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Keep connection" }));
  expect(api.disconnectIntegration).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getAllByRole("button", { name: "Disconnect", hidden: true })[0],
  );
  fireEvent.click(screen.getByRole("button", { name: "Confirm disconnect" }));
  await waitFor(() =>
    expect(api.disconnectIntegration).toHaveBeenCalledWith(
      "workspace",
      "gitlab",
      "gitlab-key",
      undefined,
    ),
  );
  await waitFor(() =>
    expect(screen.queryByText("GitLab")).not.toBeInTheDocument(),
  );
  expect(screen.getByText("Slack")).toBeInTheDocument();
});

it("keeps rows and the confirmation available when the authority refuses disconnect", async () => {
  api.disconnectIntegration.mockRejectedValueOnce(new Error("Forbidden"));
  render(<FlowConnections workspaceId="workspace" canManage />);
  await screen.findByText("GitLab");
  fireEvent.click(
    screen.getAllByRole("button", { name: "Disconnect", hidden: true })[0],
  );
  fireEvent.click(screen.getByRole("button", { name: "Confirm disconnect" }));
  await screen.findByText("Forbidden");
  expect(screen.getByText("GitLab")).toBeInTheDocument();
});

it("offers members an inspector without disconnect controls", async () => {
  render(<FlowConnections workspaceId="workspace" canManage={false} />);
  await screen.findByText("GitLab");
  expect(
    screen.queryByRole("button", { name: "Disconnect", hidden: true }),
  ).not.toBeInTheDocument();
});

it("sends expired sessions through sign-in recovery on initial load", async () => {
  api.integrationProviders.mockRejectedValue(new SignedOut());
  render(<FlowConnections workspaceId="workspace" canManage />);
  expect(
    await screen.findByText(/Your session has expired/),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Refresh" })).not.toBeDisabled();
});

it("sends expired refreshes through sign-in recovery with a visible error", async () => {
  render(<FlowConnections workspaceId="workspace" canManage />);
  await screen.findByText("GitLab");
  api.integrationProviders.mockRejectedValue(new SignedOut());
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  expect(
    await screen.findByText(/Your session has expired/),
  ).toBeInTheDocument();
});
