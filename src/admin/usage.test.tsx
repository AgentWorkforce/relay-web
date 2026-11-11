import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Settings } from "./settings";
import { ProductCapabilitiesProvider } from "../features/product-capabilities";

type Reply = { status?: number; body?: unknown };

let role: "owner" | "admin" | "member" = "owner";
let usageFlag: boolean | undefined = true;
let usageReply: (days: string) => Reply;
let paths: string[] = [];

function day(date: string, counts: Partial<Record<string, number | null>> = {}) {
  return {
    date,
    activeUsers: 0,
    sessionsUploaded: 0,
    searches: 0,
    summaries: 0,
    ...counts,
  };
}

function usage(days: number, overrides: Record<string, unknown> = {}) {
  return {
    usage: {
      range: { days, from: "2026-11-08", to: "2026-11-10" },
      totals: { activeUsers: 3, sessionsUploaded: 120, searches: 14, summaries: 40 },
      days: [
        day("2026-11-08", { activeUsers: 1, sessionsUploaded: 4, summaries: 2 }),
        day("2026-11-09", { activeUsers: 2, sessionsUploaded: 70, searches: 9, summaries: 30 }),
        day("2026-11-10", { activeUsers: 2, sessionsUploaded: 46, searches: 5, summaries: 8 }),
      ],
      unavailable: [],
      ...overrides,
    },
  };
}

beforeEach(() => {
  role = "owner";
  usageFlag = true;
  paths = [];
  usageReply = (days) => ({ body: usage(Number(days)) });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      paths.push(input);
      const reply = ((): Reply => {
        if (input === "/cloud/api/v1/auth/whoami")
          return {
            body: {
              user: { id: "u1", email: "me@acme.test", name: "Me" },
              currentOrganization: { id: "o1", name: "Acme", role },
              currentWorkspace: { id: "w1", name: "Primary" },
            },
          };
        if (input === "/cloud/api/v1/capabilities") {
          const capabilities: Record<string, boolean> = {
            flows: false,
            chief: false,
            relayfile: false,
          };
          if (usageFlag !== undefined) capabilities.usage = usageFlag;
          return { body: { capabilities } };
        }
        const match = /^\/cloud\/api\/v1\/organizations\/o1\/usage\?days=(\d+)$/.exec(input);
        if (match) return usageReply(match[1]!);
        if (input.startsWith("/cloud/api/v1/workspaces/w1/"))
          return { body: {} };
        return { status: 404, body: { error: "not_found" } };
      })();
      return new Response(JSON.stringify(reply.body ?? {}), {
        status: reply.status ?? 200,
      });
    }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderSettings(section: string) {
  return render(
    <ProductCapabilitiesProvider>
      <Settings section={section} />
    </ProductCapabilitiesProvider>,
  );
}

const usageRequests = () => paths.filter((path) => path.includes("/usage"));
const nav = () => screen.getByRole("navigation", { name: "Settings" });

it("owners see the Usage nav entry and the counts", async () => {
  renderSettings("usage");
  expect(await screen.findByTestId("usage-total-activeUsers")).toHaveTextContent("3");
  expect(within(nav()).getByRole("link", { name: "Usage" })).toHaveAttribute(
    "href",
    "#/settings/usage",
  );
  expect(screen.getByTestId("usage-total-sessionsUploaded")).toHaveTextContent("120");
  expect(screen.getByTestId("usage-total-searches")).toHaveTextContent("14");
  expect(screen.getByTestId("usage-total-summaries")).toHaveTextContent("40");
  expect(
    screen.getByRole("img", { name: /Sessions uploaded per day over the last 30 days/ }),
  ).toBeInTheDocument();
  expect(
    screen.getByText(/counted from when usage tracking was enabled/),
  ).toBeInTheDocument();
  expect(usageRequests()).toEqual(["/cloud/api/v1/organizations/o1/usage?days=30"]);
  // Counts only: nothing identifying the people behind them.
  expect(document.body.textContent).not.toContain("me@acme.test");
});

it.each(["admin", "member"] as const)(
  "%s sees no Usage nav entry and the route is refused",
  async (who) => {
    role = who;
    renderSettings("usage");
    expect(
      await screen.findByText("Only organization owners can view usage"),
    ).toBeInTheDocument();
    expect(within(nav()).queryByText("Usage")).not.toBeInTheDocument();
    expect(usageRequests()).toEqual([]);
  },
);

it.each([false, undefined])(
  "a capability of %s hides Usage even from owners",
  async (flag) => {
    usageFlag = flag;
    renderSettings("usage");
    expect(
      await screen.findByText("Usage is not enabled on this installation"),
    ).toBeInTheDocument();
    expect(within(nav()).queryByText("Usage")).not.toBeInTheDocument();
    expect(usageRequests()).toEqual([]);
  },
);

it("owners on other sections see the nav entry only when enabled", async () => {
  renderSettings("workspace");
  expect(await within(await screen.findByRole("navigation", { name: "Settings" })).findByText("Usage")).toBeInTheDocument();
});

it("a 403 from the API renders the owner-only message", async () => {
  usageReply = () => ({ status: 403, body: { error: "forbidden" } });
  renderSettings("usage");
  expect(
    await screen.findByText("Only organization owners can view usage"),
  ).toBeInTheDocument();
  expect(screen.queryByTestId("usage-total-activeUsers")).not.toBeInTheDocument();
});

it("a feature_not_enabled 403 says usage is off", async () => {
  usageReply = () => ({ status: 403, body: { error: "feature_not_enabled" } });
  renderSettings("usage");
  expect(
    await screen.findByText("Usage is not enabled on this installation"),
  ).toBeInTheDocument();
});

it("all-zero usage shows the empty state", async () => {
  usageReply = (days) => ({
    body: usage(Number(days), {
      totals: { activeUsers: 0, sessionsUploaded: 0, searches: 0, summaries: 0 },
      days: [day("2026-11-09"), day("2026-11-10")],
    }),
  });
  renderSettings("usage");
  expect(
    await screen.findByText("No usage recorded in this period"),
  ).toBeInTheDocument();
  expect(screen.getByTestId("usage-total-sessionsUploaded")).toHaveTextContent("0");
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
});

it("switching the range requests days=7, 90 and back to 30", async () => {
  renderSettings("usage");
  await screen.findByTestId("usage-total-activeUsers");
  const period = screen.getByRole("group", { name: "Usage period" });
  expect(within(period).getByRole("button", { name: "30 days" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  fireEvent.click(within(period).getByRole("button", { name: "7 days" }));
  await waitFor(() =>
    expect(usageRequests().at(-1)).toBe("/cloud/api/v1/organizations/o1/usage?days=7"),
  );
  expect(
    await screen.findByRole("img", { name: /Searches per day over the last 7 days/ }),
  ).toBeInTheDocument();
  fireEvent.click(within(period).getByRole("button", { name: "90 days" }));
  await waitFor(() =>
    expect(usageRequests().at(-1)).toBe("/cloud/api/v1/organizations/o1/usage?days=90"),
  );
  fireEvent.click(within(period).getByRole("button", { name: "30 days" }));
  await waitFor(() =>
    expect(usageRequests().at(-1)).toBe("/cloud/api/v1/organizations/o1/usage?days=30"),
  );
  expect(usageRequests()).toHaveLength(4);
});

it("null summaries render n/a with a note", async () => {
  usageReply = (days) => {
    const body = usage(Number(days), { unavailable: ["summaries"] });
    body.usage.totals = { ...body.usage.totals, summaries: null as unknown as number };
    body.usage.days = body.usage.days.map((entry) => ({
      ...entry,
      summaries: null as unknown as number,
    }));
    return { body };
  };
  renderSettings("usage");
  expect(await screen.findByTestId("usage-total-summaries")).toHaveTextContent("n/a");
  expect(
    screen.getAllByText("Summary counts need a newer sessions pipeline").length,
  ).toBeGreaterThan(0);
  expect(
    screen.queryByRole("img", { name: /Summaries generated per day/ }),
  ).not.toBeInTheDocument();
  expect(screen.getByTestId("usage-total-sessionsUploaded")).toHaveTextContent("120");
});
