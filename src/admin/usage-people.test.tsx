import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Settings } from "./settings";
import { ProductCapabilitiesProvider } from "../features/product-capabilities";
import { sessionHref } from "../sessions/route";

type Reply = { status?: number; body?: unknown };

let role: "owner" | "admin" | "member" = "owner";
let usageFlag = true;
let peopleFlag: boolean | undefined = true;
let peopleReply: (days: string) => Reply;
let sessionsReply: (userId: string, query: URLSearchParams) => Reply;
let paths: string[] = [];

function member(overrides: Record<string, unknown> = {}) {
  return {
    userId: "u1",
    name: "Ada",
    email: "ada@example.test",
    role: "owner",
    sessionsUploaded: 12,
    searches: 3,
    lastActiveAt: "2026-11-10T09:00:00.000Z",
    lastSessionAt: "2026-11-10T08:00:00.000Z",
    topProjects: [{ name: "relay", sessions: 8 }],
    ...overrides,
  };
}

function people(days: number, members = [
  member(),
  member({
    userId: "u2",
    name: "Grace",
    email: "grace@example.test",
    role: "member",
    sessionsUploaded: 30,
    searches: 1,
    lastActiveAt: null,
    lastSessionAt: "2026-11-09T10:00:00.000Z",
    topProjects: [],
  }),
  member({
    userId: "u3",
    name: "Linus",
    email: "linus@example.test",
    role: "admin",
    sessionsUploaded: 2,
    searches: 9,
    lastActiveAt: null,
    lastSessionAt: null,
    topProjects: [],
  }),
]) {
  return {
    people: {
      range: { days, from: "2026-10-12", to: "2026-11-10" },
      members,
      truncated: false,
      unavailable: [],
    },
  };
}

function session(id: string, overrides: Record<string, unknown> = {}) {
  return {
    sessionId: id,
    source: "claude",
    workspaceId: "w1",
    title: `Session ${id}`,
    summary: `Summary of ${id}`,
    agentName: "reviewer",
    project: "relay",
    firstTs: "2026-11-10T08:00:00.000Z",
    lastTs: "2026-11-10T09:00:00.000Z",
    ...overrides,
  };
}

function sessionsPage(days: number, cursor: string | null) {
  return cursor
    ? {
        person: { userId: "u1", name: "Ada", email: "ada@example.test", role: "member" },
        range: { days, from: "2026-10-12", to: "2026-11-10" },
        rollup: null,
        sessions: [session("s3", { title: null, summary: null })],
        nextCursor: null,
      }
    : {
        person: { userId: "u1", name: "Ada", email: "ada@example.test", role: "member" },
        range: { days, from: "2026-10-12", to: "2026-11-10" },
        rollup: {
          titles: ["Fix login flow"],
          projects: [{ name: "relay", sessions: 8 }],
        },
        sessions: [session("s1"), session("s2", { workspaceId: "w2" })],
        nextCursor: "next-page",
      };
}

beforeEach(() => {
  role = "owner";
  usageFlag = true;
  peopleFlag = true;
  paths = [];
  peopleReply = (days) => ({ body: people(Number(days)) });
  sessionsReply = (_userId, query) => ({
    body: sessionsPage(Number(query.get("days")), query.get("cursor")),
  });
  window.history.replaceState(null, "", "/");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      paths.push(input);
      const reply = ((): Reply => {
        if (input === "/cloud/api/v1/auth/whoami")
          return {
            body: {
              user: { id: "u0", email: "owner@example.test", name: "Owner" },
              currentOrganization: { id: "o1", name: "Org", role },
              currentWorkspace: { id: "w1", name: "Primary" },
            },
          };
        if (input === "/cloud/api/v1/capabilities") {
          const capabilities: Record<string, boolean> = {
            flows: false,
            chief: false,
            relayfile: false,
            usage: usageFlag,
          };
          if (peopleFlag !== undefined) capabilities.usage_people = peopleFlag;
          return { body: { capabilities } };
        }
        if (/^\/cloud\/api\/v1\/organizations\/o1\/usage\?days=\d+$/.test(input))
          return {
            body: {
              usage: {
                range: { days: Number(input.split("=")[1]), from: "a", to: "b" },
                totals: { activeUsers: 3, sessionsUploaded: 120, searches: 14, summaries: 40 },
                days: [],
                unavailable: [],
              },
            },
          };
        const list = /^\/cloud\/api\/v1\/organizations\/o1\/usage\/people\?days=(\d+)$/.exec(input);
        if (list) return peopleReply(list[1]!);
        const detail =
          /^\/cloud\/api\/v1\/organizations\/o1\/usage\/people\/([^/]+)\/sessions\?(.*)$/.exec(input);
        if (detail)
          return sessionsReply(decodeURIComponent(detail[1]!), new URLSearchParams(detail[2]!));
        if (input.startsWith("/cloud/api/v1/workspaces/w1/")) return { body: {} };
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

function renderSettings(props: { section: string; person?: string; days?: 7 | 30 | 90 }) {
  return render(
    <ProductCapabilitiesProvider>
      <Settings {...props} />
    </ProductCapabilitiesProvider>,
  );
}

const peopleRequests = () => paths.filter((path) => path.includes("/usage/people"));
const names = () =>
  screen
    .getAllByTestId("usage-person-row")
    .map((row) => within(row).getAllByRole("cell")[0]!.textContent);

it("owners with usage_people see the People table sorted by sessions, and can sort", async () => {
  renderSettings({ section: "usage" });
  const table = await screen.findByRole("table", { name: "People usage" });
  // v1 still renders above it.
  expect(screen.getByTestId("usage-total-activeUsers")).toHaveTextContent("3");
  expect(names()).toEqual(["Grace", "Ada", "Linus"]);
  expect(within(table).getByText("ada@example.test")).toBeInTheDocument();
  expect(within(table).getByText("relay (8)")).toBeInTheDocument();
  expect(
    within(table).getByRole("link", { name: "Ada" }),
  ).toHaveAttribute("href", "#/settings/usage/people/u1");

  fireEvent.click(screen.getByRole("button", { name: "Sort by Searches" }));
  expect(names()).toEqual(["Linus", "Ada", "Grace"]);
  fireEvent.click(screen.getByRole("button", { name: "Sort by Searches" }));
  expect(names()).toEqual(["Grace", "Ada", "Linus"]);
  fireEvent.click(screen.getByRole("button", { name: "Sort by Name" }));
  expect(names()).toEqual(["Ada", "Grace", "Linus"]);
  expect(
    screen.getByRole("button", { name: "Sort by Name" }).closest("th"),
  ).toHaveAttribute("aria-sort", "ascending");
  expect(peopleRequests()).toEqual(["/cloud/api/v1/organizations/o1/usage/people?days=30"]);
});

it("last active falls back to the last session, then never", async () => {
  renderSettings({ section: "usage" });
  await screen.findByRole("table", { name: "People usage" });
  const rows = Object.fromEntries(
    screen.getAllByTestId("usage-person-row").map((row) => [
      within(row).getAllByRole("cell")[0]!.textContent,
      within(row).getAllByRole("cell")[5]!.textContent,
    ]),
  );
  expect(rows.Ada).not.toContain("(last session)");
  expect(rows.Ada).not.toBe("never");
  expect(rows.Grace).toContain("(last session)");
  expect(rows.Linus).toBe("never");
  expect(
    screen.getByText(/tracked from when people usage was enabled/),
  ).toBeInTheDocument();
});

it("null and truncated session counts show n/a and a lower-bound note", async () => {
  peopleReply = (days) => {
    const body = people(Number(days), [member({ sessionsUploaded: null })]);
    return {
      body: {
        people: { ...body.people, truncated: true, unavailable: ["sessionsUploaded"] },
      },
    };
  };
  renderSettings({ section: "usage" });
  const table = await screen.findByRole("table", { name: "People usage" });
  expect(within(table).getByText("n/a")).toBeInTheDocument();
  expect(screen.getByText(/Session counts are lower bounds/)).toBeInTheDocument();
});

it("search-only activity keeps the table", async () => {
  peopleReply = (days) => ({
    body: people(Number(days), [member({ sessionsUploaded: 0, searches: 4 })]),
  });
  renderSettings({ section: "usage" });
  expect(await screen.findByRole("table", { name: "People usage" })).toBeInTheDocument();
  expect(screen.queryByText("No sessions in this period")).not.toBeInTheDocument();
});

it("navigating to the Usage link resets the period it shows", async () => {
  renderSettings({ section: "usage" });
  await screen.findByRole("table", { name: "People usage" });
  fireEvent.click(screen.getByRole("button", { name: "7 days" }));
  await waitFor(() =>
    expect(peopleRequests().at(-1)).toBe("/cloud/api/v1/organizations/o1/usage/people?days=7"),
  );
  expect(window.location.hash).toBe("#/settings/usage?days=7");
  window.location.hash = "#/settings/usage";
  await waitFor(() =>
    expect(peopleRequests().at(-1)).toBe("/cloud/api/v1/organizations/o1/usage/people?days=30"),
  );
  expect(
    screen.getByRole("button", { name: "30 days" }),
  ).toHaveAttribute("aria-pressed", "true");
});

it("no members with sessions shows the empty state", async () => {
  peopleReply = (days) => ({ body: people(Number(days), [member({ sessionsUploaded: 0, searches: 0 })]) });
  renderSettings({ section: "usage" });
  expect(await screen.findByText("No sessions in this period")).toBeInTheDocument();
  expect(screen.queryByRole("table", { name: "People usage" })).not.toBeInTheDocument();
});

it("switching the range refetches people with days=N", async () => {
  renderSettings({ section: "usage" });
  await screen.findByRole("table", { name: "People usage" });
  const period = screen.getByRole("group", { name: "Usage period" });
  fireEvent.click(within(period).getByRole("button", { name: "7 days" }));
  await waitFor(() =>
    expect(peopleRequests().at(-1)).toBe("/cloud/api/v1/organizations/o1/usage/people?days=7"),
  );
  expect(
    await within(await screen.findByRole("table", { name: "People usage" })).findByRole(
      "link",
      { name: "Ada" },
    ),
  ).toHaveAttribute("href", "#/settings/usage/people/u1?days=7");
  fireEvent.click(within(period).getByRole("button", { name: "90 days" }));
  await waitFor(() =>
    expect(peopleRequests().at(-1)).toBe("/cloud/api/v1/organizations/o1/usage/people?days=90"),
  );
  expect(peopleRequests()).toHaveLength(3);
});

it("a response for another period is not shown under the selected one", async () => {
  renderSettings({ section: "usage" });
  await screen.findByRole("table", { name: "People usage" });
  peopleReply = () => ({ body: people(30) });
  fireEvent.click(screen.getByRole("button", { name: "7 days" }));
  await waitFor(() => expect(peopleRequests()).toHaveLength(2));
  await waitFor(() =>
    expect(screen.queryByRole("table", { name: "People usage" })).not.toBeInTheDocument(),
  );
});

it.each(["admin", "member"] as const)(
  "%s sees no People section and a direct drill-down link is refused",
  async (who) => {
    role = who;
    const { unmount } = renderSettings({ section: "usage" });
    expect(
      await screen.findByText("Only organization owners can view usage"),
    ).toBeInTheDocument();
    expect(screen.queryByText("People")).not.toBeInTheDocument();
    unmount();
    renderSettings({ section: "usage", person: "u1" });
    expect(
      await screen.findByText("Only organization owners can view usage"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Ada")).not.toBeInTheDocument();
    expect(peopleRequests()).toEqual([]);
  },
);

it.each([false, undefined])(
  "usage_people of %s hides People while v1 still works",
  async (flag) => {
    peopleFlag = flag;
    const { unmount } = renderSettings({ section: "usage" });
    expect(await screen.findByTestId("usage-total-activeUsers")).toHaveTextContent("3");
    expect(screen.queryByRole("heading", { name: "People" })).not.toBeInTheDocument();
    unmount();
    renderSettings({ section: "usage", person: "u1" });
    expect(
      await screen.findByText("People usage is not enabled on this installation"),
    ).toBeInTheDocument();
    expect(peopleRequests()).toEqual([]);
  },
);

it("a 403 from the people API renders the owner-only message", async () => {
  peopleReply = () => ({ status: 403, body: { error: "forbidden" } });
  renderSettings({ section: "usage" });
  expect(
    await screen.findByText("Only organization owners can view usage"),
  ).toBeInTheDocument();
  expect(screen.getByTestId("usage-total-activeUsers")).toBeInTheDocument();
});

it("the drill-down renders sessions with summaries, detail links and Load more", async () => {
  renderSettings({ section: "usage", person: "u1" });
  const list = await screen.findByRole("list", { name: "Sessions" });
  expect(screen.getByRole("heading", { name: "Ada" })).toBeInTheDocument();
  expect(screen.getByText(/2026-10-12 – 2026-11-10/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Back to Usage/ })).toHaveAttribute(
    "href",
    "#/settings/usage",
  );
  expect(within(screen.getByRole("list", { name: "Recent titles" })).getByText("Fix login flow")).toBeInTheDocument();
  expect(within(screen.getByRole("list", { name: "Projects" })).getByText(/relay · 8/)).toBeInTheDocument();
  expect(within(list).getByText("Summary of s1")).toBeInTheDocument();
  expect(within(list).getAllByText(/claude · reviewer/)).toHaveLength(2);
  expect(within(list).getByRole("link", { name: "Session s1" })).toHaveAttribute(
    "href",
    sessionHref("s1", "claude", null, null, "w1"),
  );
  // The session viewer only opens the current workspace: no dead link.
  expect(within(list).queryByRole("link", { name: "Session s2" })).not.toBeInTheDocument();
  expect(within(list).getByText("In another workspace")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Load more" }));
  expect(await within(list).findByRole("link", { name: "Untitled session" })).toBeInTheDocument();
  expect(peopleRequests()).toEqual([
    "/cloud/api/v1/organizations/o1/usage/people/u1/sessions?days=30",
    "/cloud/api/v1/organizations/o1/usage/people/u1/sessions?days=30&cursor=next-page",
  ]);
  expect(
    within(list).getAllByRole("link").map((link) => link.textContent),
  ).toEqual(["Session s1", "Untitled session"]);
  expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  // Only the people endpoints: the counts page is not fetched here.
  expect(paths.some((path) => /\/usage\?days=/.test(path))).toBe(false);
});

it("the drill-down keeps the period from the link", async () => {
  renderSettings({ section: "usage", person: "u1", days: 7 });
  await screen.findByRole("list", { name: "Sessions" });
  expect(peopleRequests()).toEqual([
    "/cloud/api/v1/organizations/o1/usage/people/u1/sessions?days=7",
  ]);
  expect(screen.getByRole("link", { name: /Back to Usage/ })).toHaveAttribute(
    "href",
    "#/settings/usage?days=7",
  );
});

it("a drill-down for a non-member renders not found", async () => {
  sessionsReply = () => ({ status: 404, body: { error: "user_not_found" } });
  renderSettings({ section: "usage", person: "nobody" });
  expect(await screen.findByText("Person not found")).toBeInTheDocument();
});

it("a drill-down with no sessions shows the empty state", async () => {
  sessionsReply = (_userId, query) => ({
    body: {
      ...sessionsPage(Number(query.get("days")), null),
      rollup: { titles: [], projects: [] },
      sessions: [],
      nextCursor: null,
    },
  });
  renderSettings({ section: "usage", person: "u1" });
  expect(
    await screen.findByText("No sessions for this person in this period"),
  ).toBeInTheDocument();
});

it("a feature_not_enabled 403 on the drill-down says people usage is off", async () => {
  sessionsReply = () => ({ status: 403, body: { error: "feature_not_enabled" } });
  renderSettings({ section: "usage", person: "u1" });
  expect(
    await screen.findByText("People usage is not enabled on this installation"),
  ).toBeInTheDocument();
});
