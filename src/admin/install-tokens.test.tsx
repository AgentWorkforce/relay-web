import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { InstallTokens } from "./install-tokens";

const TOKENS = "/cloud/api/v1/desktop/feed/install-tokens";
const SECRET = "rit_a1b2c3dSECRETVALUE0123456789abcdef";
const PREFIX = SECRET.slice(0, 11);

function summary(extra: Record<string, unknown> = {}) {
  return {
    id: "itk_1",
    label: "build-server",
    token_prefix: PREFIX,
    profile: "x7k2q",
    workspace_id: "ws_1",
    created_at: "2026-11-24T10:00:00Z",
    expires_at: "2026-11-24T11:00:00Z",
    revoked_at: null,
    last_used_at: null,
    status: "active",
    ...extra,
  };
}

type Reply = { status: number; body: unknown };
type Seen = { path: string; method: string; headers: Record<string, string>; body: string | undefined };

let replies: Record<string, Reply>;
let seen: Seen[];

beforeEach(() => {
  // Only the clock is faked: the fixtures expire at 11:00.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-24T10:05:00Z"));
  seen = [];
  replies = {
    [`GET ${TOKENS}`]: { status: 200, body: { tokens: [] } },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init: RequestInit) => {
      const method = init.method ?? "GET";
      seen.push({
        path: input,
        method,
        headers: init.headers as Record<string, string>,
        body: typeof init.body === "string" ? init.body : undefined,
      });
      const reply = replies[`${method} ${input}`] ?? { status: 500, body: { error: "unexpected" } };
      return new Response(JSON.stringify(reply.body), { status: reply.status });
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function created() {
  return {
    id: "itk_2",
    token: SECRET,
    label: "build-server",
    profile: "x7k2q",
    workspace_id: "ws_1",
    created_at: "2026-11-24T10:00:00Z",
    expires_at: "2026-11-24T11:00:00Z",
    command: "curl … | AGENT_RELAY_INSTALL_TOKEN=… sh install.sh",
  };
}

it("creates a token with the profile header and label, shows it once, and drops it on Done", async () => {
  replies[`POST ${TOKENS}`] = { status: 201, body: created() };
  render(<InstallTokens profileId="x7k2q" />);
  expect(await screen.findByText("No install tokens yet.")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Label (optional)"), { target: { value: " build-server " } });
  replies[`GET ${TOKENS}`] = { status: 200, body: { tokens: [summary({ id: "itk_2" })] } };
  fireEvent.click(screen.getByRole("button", { name: "Create install token" }));

  expect(await screen.findByText(SECRET)).toBeInTheDocument();
  expect(screen.getByText(/it will not be shown again/)).toBeInTheDocument();
  expect(screen.getByText("AGENT_RELAY_INSTALL_TOKEN")).toBeInTheDocument();
  // The server-built command is never rendered, and no command carries the token.
  expect(screen.queryByText(/install\.sh/)).toBeNull();
  expect(screen.getByText("read -rs AGENT_RELAY_INSTALL_TOKEN && export AGENT_RELAY_INSTALL_TOKEN")).toBeInTheDocument();
  expect(screen.getByText("$env:AGENT_RELAY_INSTALL_TOKEN = Read-Host")).toBeInTheDocument();

  const post = seen.find((call) => call.method === "POST");
  expect(post?.path).toBe(TOKENS);
  expect(post?.headers["X-Agent-Relay-Profile"]).toBe("x7k2q");
  expect(post?.headers["Content-Type"]).toBe("application/json");
  expect(JSON.parse(post?.body ?? "null")).toEqual({ label: "build-server" });

  // The list refreshes and shows only the prefix.
  const list = await screen.findByRole("list", { name: "Your install tokens" });
  expect(within(list).getByText(`${PREFIX}…`)).toBeInTheDocument();
  expect(list.textContent).not.toContain(SECRET);

  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  expect(screen.queryByText(SECRET)).toBeNull();
  expect(document.body.textContent).not.toContain(SECRET);
  for (const storage of [window.localStorage, window.sessionStorage]) {
    for (let index = 0; index < storage.length; index += 1) {
      expect(storage.getItem(storage.key(index) ?? "") ?? "").not.toContain(SECRET);
    }
  }
  expect(window.location.href).not.toContain(SECRET);
});

it("sends no label when the field is empty", async () => {
  replies[`POST ${TOKENS}`] = { status: 201, body: { ...created(), label: null } };
  render(<InstallTokens profileId="x7k2q" />);
  fireEvent.click(await screen.findByRole("button", { name: "Create install token" }));
  expect(await screen.findByText(SECRET)).toBeInTheDocument();
  const post = seen.find((call) => call.method === "POST");
  expect(JSON.parse(post?.body ?? "null")).toEqual({});
});

it("drops the shown token when the profile changes", async () => {
  replies[`POST ${TOKENS}`] = { status: 201, body: created() };
  const view = render(<InstallTokens profileId="x7k2q" />);
  fireEvent.click(await screen.findByRole("button", { name: "Create install token" }));
  expect(await screen.findByText(SECRET)).toBeInTheDocument();
  view.rerender(<InstallTokens profileId="other" />);
  expect(screen.queryByText(SECRET)).toBeNull();
});

it("lists tokens newest first with prefix and status, never the token", async () => {
  replies[`GET ${TOKENS}`] = {
    status: 200,
    body: {
      tokens: [
        summary({ id: "itk_old", label: null, token_prefix: "rit_old0000", created_at: "2026-11-24T08:00:00Z", status: "expired" }),
        summary({ last_used_at: "2026-11-24T10:30:00Z" }),
      ],
    },
  };
  render(<InstallTokens profileId="x7k2q" />);
  const list = await screen.findByRole("list", { name: "Your install tokens" });
  const rows = within(list).getAllByRole("listitem");
  expect(rows).toHaveLength(2);
  expect(rows[0]).toHaveTextContent("build-server");
  expect(rows[0]).toHaveTextContent(`${PREFIX}…`);
  expect(rows[0]).toHaveTextContent("Active");
  expect(rows[0]).toHaveTextContent("Last used");
  expect(rows[1]).toHaveTextContent("No label");
  expect(rows[1]).toHaveTextContent("Expired");
  expect(rows[1]).not.toHaveTextContent("Last used");
  expect(within(rows[1]!).queryByRole("button")).toBeNull();
  expect(seen[0]?.headers["X-Agent-Relay-Profile"]).toBe("x7k2q");
});

it("revokes with DELETE and updates the row", async () => {
  replies[`GET ${TOKENS}`] = { status: 200, body: { tokens: [summary()] } };
  replies[`DELETE ${TOKENS}/itk_1`] = {
    status: 200,
    body: summary({ status: "revoked", revoked_at: "2026-11-24T10:10:00Z" }),
  };
  render(<InstallTokens profileId="x7k2q" />);
  fireEvent.click(
    await screen.findByRole("button", { name: `Revoke install token ${PREFIX}… (build-server)` }),
  );
  expect(await screen.findByText("Revoked")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /^Revoke install token/ })).toBeNull();
  const del = seen.find((call) => call.method === "DELETE");
  expect(del?.path).toBe(`${TOKENS}/itk_1`);
  expect(del?.headers["X-Agent-Relay-Profile"]).toBe("x7k2q");
});

it("refreshes the list when the token to revoke is already gone", async () => {
  replies[`GET ${TOKENS}`] = { status: 200, body: { tokens: [summary()] } };
  replies[`DELETE ${TOKENS}/itk_1`] = {
    status: 404,
    body: { error: "install_token_not_found", message: "Not found" },
  };
  render(<InstallTokens profileId="x7k2q" />);
  const revoke = await screen.findByRole("button", { name: /^Revoke install token/ });
  replies[`GET ${TOKENS}`] = { status: 200, body: { tokens: [] } };
  fireEvent.click(revoke);
  expect(await screen.findByText("No install tokens yet.")).toBeInTheDocument();
  expect(screen.queryByRole("alert")).toBeNull();
});

it("explains the hourly limit", async () => {
  replies[`POST ${TOKENS}`] = { status: 429, body: { error: "rate_limited", message: "rate limited" } };
  render(<InstallTokens profileId="x7k2q" />);
  fireEvent.click(await screen.findByRole("button", { name: "Create install token" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Too many install tokens were created in the last hour. Try again later.",
  );
});

it("offers a retry when the list fails to load", async () => {
  replies[`GET ${TOKENS}`] = { status: 500, body: { error: "boom", message: "Could not load" } };
  render(<InstallTokens profileId="x7k2q" />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not load");
  replies[`GET ${TOKENS}`] = { status: 200, body: { tokens: [] } };
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("No install tokens yet.")).toBeInTheDocument();
});

it("renders nothing when the feed is not available", async () => {
  replies[`GET ${TOKENS}`] = { status: 404, body: { error: "not_found", message: "Not found" } };
  const { container } = render(<InstallTokens profileId="x7k2q" />);
  await waitFor(() => expect(seen).toHaveLength(1));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(container).toBeEmptyDOMElement();
});

it("shows a token as expired once its expiry passes while the page is open", async () => {
  vi.setSystemTime(new Date("2026-11-24T10:59:59.950Z"));
  replies[`GET ${TOKENS}`] = { status: 200, body: { tokens: [summary()] } };
  render(<InstallTokens profileId="x7k2q" />);
  const list = await screen.findByRole("list", { name: "Your install tokens" });
  expect(list).toHaveTextContent("Active");
  vi.setSystemTime(new Date("2026-11-24T11:00:00Z"));
  await waitFor(() => expect(list).toHaveTextContent("Expired"));
  expect(list).not.toHaveTextContent("Active");
  expect(screen.queryByRole("button", { name: /^Revoke install token/ })).toBeNull();
});

it("checks expiry again when the tab becomes visible", async () => {
  replies[`GET ${TOKENS}`] = { status: 200, body: { tokens: [summary()] } };
  render(<InstallTokens profileId="x7k2q" />);
  const list = await screen.findByRole("list", { name: "Your install tokens" });
  expect(list).toHaveTextContent("Active");
  vi.setSystemTime(new Date("2026-11-24T11:30:00Z"));
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(list).toHaveTextContent("Expired");
  expect(screen.queryByRole("button", { name: /^Revoke install token/ })).toBeNull();
});
