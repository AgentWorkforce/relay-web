import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
const api = vi.hoisted(() => ({
  integrationProviders: vi.fn(),
  renameIntegration: vi.fn(),
  createIntegrationWithCredentials: vi.fn(),
  connectIntegration: vi.fn(),
  disconnectIntegration: vi.fn(),
}));
vi.mock("../admin/api", () => ({
  adminApi: api,
  SignedOut: class extends Error {},
}));
import { FlowConnectionManager } from "./flow-connection-manager";

let providers: Array<Record<string, unknown>>;
beforeAll(() => {
  if (!HTMLDialogElement.prototype.showModal)
    HTMLDialogElement.prototype.showModal = function () {
      this.setAttribute("open", "");
    };
});
beforeEach(() => {
  vi.resetAllMocks();
  providers = [
    {
      id: "gitlab",
      displayName: "GitLab",
      authMode: "OAUTH2",
      configured: true,
      connection: {
        connectionId: "conn",
        providerConfigKey: "gitlab-relay",
        authMode: "oauth2",
        status: "ready",
        metadata: { displayName: "Engineering" },
      },
    },
    {
      id: "posthog",
      displayName: "PostHog",
      authMode: "API_KEY",
      configured: true,
      connection: null,
      credentialFields: [
        { key: "apiKey", label: "API key", secret: true, required: true },
        { key: "host", label: "Host", secret: false, required: true },
      ],
    },
    {
      id: "linear",
      displayName: "Linear",
      authMode: "OAUTH2",
      configured: false,
      connection: null,
      adminMessage: "Ask an administrator to configure Linear.",
    },
  ];
  api.integrationProviders.mockImplementation(async () => ({
    providers,
    canManage: true,
  }));
});
afterEach(cleanup);

it("renames through the canonical settings route, retains stale edits on failure, and refreshes after success", async () => {
  api.renameIntegration
    .mockRejectedValueOnce(
      new Error("This connection has changed. Refresh before editing."),
    )
    .mockImplementationOnce(async (_workspace, _provider, _id, name) => {
      providers[0] = {
        ...providers[0],
        connection: {
          connectionId: "conn",
          providerConfigKey: "gitlab-relay",
          status: "ready",
          metadata: { displayName: name },
        },
      };
    });
  render(<FlowConnectionManager workspaceId="workspace" canManage />);
  fireEvent.click(await screen.findByText("Engineering"));
  fireEvent.click(screen.getByRole("button", { name: "Edit connection" }));
  fireEvent.change(screen.getByLabelText("Connection name"), {
    target: { value: "Platform" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("has changed");
  expect(screen.getByText("Engineering")).toBeInTheDocument();
  expect(api.renameIntegration).toHaveBeenCalledWith(
    "workspace",
    "gitlab",
    "conn",
    "Platform",
  );
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  expect(
    await screen.findByText("Platform", { exact: true }),
  ).toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("creates API-key connections from the server's credential schema and clears secret inputs after saving", async () => {
  api.createIntegrationWithCredentials.mockImplementation(async () => {
    providers[1] = {
      ...providers[1],
      connection: {
        connectionId: "posthog-conn",
        providerConfigKey: "posthog-relay",
        authMode: "api_key",
        status: "ready",
      },
    };
  });
  const { container } = render(
    <FlowConnectionManager workspaceId="workspace" canManage />,
  );
  await screen.findByText("Engineering");
  fireEvent.click(screen.getByRole("button", { name: "Add connection" }));
  await waitFor(() => expect(screen.getByLabelText("Tool")).not.toBeDisabled());
  fireEvent.change(screen.getByLabelText("Tool"), {
    target: { value: "posthog" },
  });
  fireEvent.change(screen.getByLabelText("API key"), {
    target: { value: "private-example-key" },
  });
  fireEvent.change(screen.getByLabelText("Host"), {
    target: { value: "https://eu.posthog.com" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Connect securely" }));
  await waitFor(() =>
    expect(api.createIntegrationWithCredentials).toHaveBeenCalledWith(
      "workspace",
      "posthog",
      { apiKey: "private-example-key", host: "https://eu.posthog.com" },
    ),
  );
  await screen.findByText("PostHog", { exact: true });
  expect(
    screen.queryByDisplayValue("private-example-key"),
  ).not.toBeInTheDocument();
  expect(container.innerHTML).not.toContain("private-example-key");
  expect(api.connectIntegration).not.toHaveBeenCalled();
});

it("blocks unconfigured providers and gives members read-only controls", async () => {
  const view = render(
    <FlowConnectionManager workspaceId="workspace" canManage />,
  );
  await screen.findByText("Engineering");
  fireEvent.click(screen.getByRole("button", { name: "Add connection" }));
  await waitFor(() => expect(screen.getByLabelText("Tool")).not.toBeDisabled());
  fireEvent.change(screen.getByLabelText("Tool"), {
    target: { value: "linear" },
  });
  expect(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Continue to authorization",
    }),
  ).toBeDisabled();
  expect(screen.getByRole("note")).toHaveTextContent("administrator");
  view.unmount();
  render(<FlowConnectionManager workspaceId="workspace" canManage={false} />);
  await screen.findByText("Engineering");
  expect(
    screen.queryByRole("button", { name: "Add connection" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Edit connection" }),
  ).not.toBeInTheDocument();
});
