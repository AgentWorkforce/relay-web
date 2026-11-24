import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Settings } from "./settings";
import { ProductCapabilitiesProvider } from "../features/product-capabilities";

type Reply = { status?: number; body?: unknown };
type Request = { method: string; path: string; body: unknown };
type TeamRow = { id: string; name: string; memberCount: number };
type MemberRow = {
  userId: string;
  name: string;
  email: string;
  role: "owner" | "admin" | "member";
  teamId: string | null;
};

const ORG = "/cloud/api/v1/organizations/o1";

let role: "owner" | "admin" | "member" = "owner";
let teamsFlag: boolean | undefined = true;
let teams: TeamRow[] = [];
let members: MemberRow[] = [];
let requests: Request[] = [];
/** Replaces the next write's answer (an error, typically). */
let refuse: ((request: Request) => Reply | null) | null = null;

function team(row: TeamRow) {
  return {
    ...row,
    archivedAt: null,
    createdAt: "2026-11-01T09:00:00.000Z",
    updatedAt: "2026-11-01T09:00:00.000Z",
  };
}

function counted() {
  return teams.map((row) =>
    team({
      ...row,
      memberCount: members.filter((member) => member.teamId === row.id).length,
    }),
  );
}

function answer(request: Request): Reply {
  const { method, path, body } = request;
  if (path === "/cloud/api/v1/auth/whoami")
    return {
      body: {
        user: { id: "u0", email: "owner@example.test", name: "Owner" },
        currentOrganization: { id: "o1", name: "Org", role },
        currentWorkspace: { id: "w1", name: "Primary" },
      },
    };
  if (path === "/cloud/api/v1/capabilities") {
    const capabilities: Record<string, boolean> = {
      flows: false,
      chief: false,
      relayfile: false,
    };
    if (teamsFlag !== undefined) capabilities.teams = teamsFlag;
    return { body: { capabilities } };
  }
  if (path === `${ORG}/workspaces`) return { body: { workspaces: [] } };
  if (path === `${ORG}/memberships` && method === "GET")
    return {
      body: {
        memberships: members.map((member) => ({ ...member, joinedAt: null })),
      },
    };
  if (path === `${ORG}/teams` && method === "GET") return { body: { teams: counted() } };
  const refused = method !== "GET" ? refuse?.(request) : null;
  if (refused) return refused;
  if (path === `${ORG}/teams` && method === "POST") {
    const name = String((body as { name: string }).name);
    const created = { id: `t${teams.length + 1}`, name, memberCount: 0 };
    teams.push(created);
    return { status: 201, body: team(created) };
  }
  const one = new RegExp(`^${ORG}/teams/([^/]+)$`).exec(path);
  if (one && method === "PATCH") {
    const row = teams.find((item) => item.id === one[1])!;
    row.name = String((body as { name: string }).name);
    return { body: counted().find((item) => item.id === row.id) };
  }
  if (one && method === "DELETE") {
    const row = counted().find((item) => item.id === one[1])!;
    teams = teams.filter((item) => item.id !== row.id);
    for (const member of members) if (member.teamId === row.id) member.teamId = null;
    return {
      body: {
        team: { ...row, archivedAt: "2026-11-02T09:00:00.000Z" },
        unassigned: row.memberCount,
      },
    };
  }
  const assignment = new RegExp(`^${ORG}/teams/([^/]+)/members/([^/]+)$`).exec(path);
  if (assignment && method === "PUT") {
    const member = members.find((item) => item.userId === assignment[2])!;
    const previousTeamId = member.teamId;
    member.teamId = assignment[1]!;
    return {
      body: {
        assignment: {
          userId: member.userId,
          teamId: member.teamId,
          startsAt: "2026-11-02T09:00:00.000Z",
        },
        previousTeamId,
      },
    };
  }
  if (assignment && method === "DELETE") {
    const member = members.find((item) => item.userId === assignment[2])!;
    const unassigned = member.teamId === assignment[1];
    if (unassigned) member.teamId = null;
    return { body: { unassigned } };
  }
  return { status: 404, body: { error: "not_found" } };
}

beforeEach(() => {
  role = "owner";
  teamsFlag = true;
  requests = [];
  refuse = null;
  teams = [
    { id: "t1", name: "Platform", memberCount: 0 },
    { id: "t2", name: "Support", memberCount: 0 },
  ];
  members = [
    { userId: "u1", name: "Member One", email: "one@example.test", role: "owner", teamId: "t1" },
    { userId: "u2", name: "Member Two", email: "two@example.test", role: "member", teamId: "t1" },
    { userId: "u3", name: "", email: "three@example.test", role: "admin", teamId: null },
  ];
  window.history.replaceState(null, "", "/");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const request: Request = {
        method: init.method ?? "GET",
        path: input,
        body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
      };
      requests.push(request);
      const reply = answer(request);
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

function renderSettings(section = "teams") {
  return render(
    <ProductCapabilitiesProvider>
      <Settings section={section} />
    </ProductCapabilitiesProvider>,
  );
}

const nav = () => screen.getByRole("navigation", { name: "Settings" });
const teamRequests = () => requests.filter((request) => request.path.includes("/teams"));
const writes = () => teamRequests().filter((request) => request.method !== "GET");
const teamRow = (id: string) => screen.getByTestId(`team-${id}`);
const memberSelect = (name: string) =>
  screen.getByRole("combobox", { name: `Team for ${name}` });

async function openTeams() {
  renderSettings();
  await screen.findByRole("table", { name: "Teams" });
  await screen.findByRole("table", { name: "Team members" });
}

it("owners and admins see the Teams nav entry, teams and member counts", async () => {
  role = "admin";
  await openTeams();
  expect(within(nav()).getByRole("link", { name: "Teams" })).toHaveAttribute(
    "href",
    "#/settings/teams",
  );
  expect(screen.getByRole("heading", { level: 1, name: "Teams" })).toBeInTheDocument();
  expect(within(teamRow("t1")).getAllByRole("cell").map((cell) => cell.textContent)).toEqual([
    "Platform",
    "2",
    "RenameArchive",
  ]);
  expect(within(teamRow("t2")).getAllByRole("cell")[1]).toHaveTextContent("0");
  expect(memberSelect("Member One")).toHaveValue("t1");
  expect(memberSelect("three@example.test")).toHaveValue("");
  expect(
    within(memberSelect("three@example.test"))
      .getAllByRole("option")
      .map((option) => option.textContent),
  ).toEqual(["No team", "Platform", "Support"]);
  expect(teamRequests().map((request) => request.path)).toEqual([`${ORG}/teams`]);
});

it.each([false, undefined])(
  "a capability of %s hides Teams even from owners",
  async (flag) => {
    teamsFlag = flag;
    renderSettings();
    expect(
      await screen.findByRole("heading", { level: 2, name: "Workspace" }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(requests.map((request) => request.path)).toContain(
        "/cloud/api/v1/capabilities",
      ),
    );
    expect(within(nav()).queryByText("Teams")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Teams" })).not.toBeInTheDocument();
    expect(teamRequests()).toEqual([]);
  },
);

it("members see no Teams entry and a direct link shows Workspace", async () => {
  role = "member";
  renderSettings();
  expect(
    await screen.findByRole("heading", { level: 2, name: "Workspace" }),
  ).toBeInTheDocument();
  expect(within(nav()).queryByText("Teams")).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 1, name: "Workspace" })).toBeInTheDocument();
  expect(teamRequests()).toEqual([]);
});

it("shows an empty state with the create action when there are no teams", async () => {
  teams = [];
  for (const member of members) member.teamId = null;
  renderSettings();
  expect(
    await screen.findByText("No teams yet. Create the first one above."),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Create team" })).toBeInTheDocument();
  expect(screen.queryByRole("table", { name: "Teams" })).not.toBeInTheDocument();
  expect(screen.queryByRole("table", { name: "Team members" })).not.toBeInTheDocument();
});

it("creates a team", async () => {
  await openTeams();
  const input = screen.getByLabelText("New team name");
  expect(screen.getByRole("button", { name: "Create team" })).toBeDisabled();
  fireEvent.change(input, { target: { value: "  Research  " } });
  fireEvent.click(screen.getByRole("button", { name: "Create team" }));
  expect(await screen.findByText("Created the team Research.")).toHaveAttribute(
    "role",
    "status",
  );
  expect(writes()).toEqual([
    { method: "POST", path: `${ORG}/teams`, body: { name: "Research" } },
  ]);
  expect(await screen.findByTestId("team-t3")).toHaveTextContent("Research");
  expect(input).toHaveValue("");
});

it("says when a team name is already in use and keeps the typed name", async () => {
  refuse = () => ({
    status: 409,
    body: { error: "team_name_taken", message: "team name is taken" },
  });
  await openTeams();
  const input = screen.getByLabelText("New team name");
  fireEvent.change(input, { target: { value: "Platform" } });
  fireEvent.click(screen.getByRole("button", { name: "Create team" }));
  expect(
    await screen.findByText("That name is already in use by another team."),
  ).toHaveAttribute("role", "alert");
  expect(input).toHaveValue("Platform");
});

it("renames a team", async () => {
  await openTeams();
  fireEvent.click(screen.getByRole("button", { name: "Rename Support" }));
  const input = screen.getByLabelText("New name for Support");
  expect(input).toHaveValue("Support");
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  fireEvent.change(input, { target: { value: "Customer Support" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByText("Renamed Support to Customer Support.")).toBeInTheDocument();
  expect(writes()).toEqual([
    { method: "PATCH", path: `${ORG}/teams/t2`, body: { name: "Customer Support" } },
  ]);
  await waitFor(() =>
    expect(within(teamRow("t2")).getAllByRole("cell")[0]).toHaveTextContent(
      "Customer Support",
    ),
  );
  expect(screen.queryByLabelText(/New name for/)).not.toBeInTheDocument();
});

it("cancelling a rename sends nothing", async () => {
  await openTeams();
  fireEvent.click(screen.getByRole("button", { name: "Rename Support" }));
  fireEvent.keyDown(screen.getByLabelText("New name for Support"), { key: "Escape" });
  expect(screen.queryByLabelText("New name for Support")).not.toBeInTheDocument();
  expect(writes()).toEqual([]);
});

it("archives a team only after confirmation that names what happens", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  await openTeams();
  fireEvent.click(screen.getByRole("button", { name: "Archive Platform" }));
  expect(confirm).toHaveBeenCalledWith(
    "Archive the team Platform? Its 2 people will have no team. Past reports keep the team.",
  );
  expect(writes()).toEqual([]);

  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole("button", { name: "Archive Platform" }));
  expect(
    await screen.findByText("Archived Platform. 2 people now have no team."),
  ).toHaveAttribute("role", "status");
  expect(writes()).toEqual([
    { method: "DELETE", path: `${ORG}/teams/t1`, body: {} },
  ]);
  await waitFor(() => expect(screen.queryByTestId("team-t1")).not.toBeInTheDocument());
  await waitFor(() => expect(memberSelect("Member One")).toHaveValue(""));
});

it("assigns a person with no team", async () => {
  await openTeams();
  fireEvent.change(memberSelect("three@example.test"), { target: { value: "t2" } });
  expect(
    await screen.findByText("Added three@example.test to Support."),
  ).toHaveAttribute("role", "status");
  expect(writes()).toEqual([
    { method: "PUT", path: `${ORG}/teams/t2/members/u3`, body: {} },
  ]);
  await waitFor(() => expect(memberSelect("three@example.test")).toHaveValue("t2"));
});

it("states that choosing another team moves the person", async () => {
  await openTeams();
  expect(memberSelect("Member Two")).toHaveAccessibleDescription(
    /Choosing a team for someone who already has one moves them out of their current team\./,
  );
  fireEvent.change(memberSelect("Member Two"), { target: { value: "t2" } });
  expect(
    await screen.findByText("Moved Member Two from Platform to Support."),
  ).toBeInTheDocument();
  expect(writes()).toEqual([
    { method: "PUT", path: `${ORG}/teams/t2/members/u2`, body: {} },
  ]);
  await waitFor(() =>
    expect(within(teamRow("t2")).getAllByRole("cell")[1]).toHaveTextContent("1"),
  );
});

it("choosing No team removes the person from their team", async () => {
  await openTeams();
  fireEvent.change(memberSelect("Member One"), { target: { value: "" } });
  expect(
    await screen.findByText("Removed Member One from Platform. Member One has no team now."),
  ).toBeInTheDocument();
  expect(writes()).toEqual([
    { method: "DELETE", path: `${ORG}/teams/t1/members/u1`, body: {} },
  ]);
  await waitFor(() => expect(memberSelect("Member One")).toHaveValue(""));
});

it.each([
  ["membership_not_found", 404, "That person is no longer a member of this organization."],
  ["team_archived", 409, "That team was archived."],
])("shows %s as a short message and reloads", async (code, status, text) => {
  refuse = () => ({ status, body: { error: code, message: "raw server text" } });
  await openTeams();
  const loads = teamRequests().length;
  fireEvent.change(memberSelect("three@example.test"), { target: { value: "t2" } });
  expect(await screen.findByText(text)).toHaveAttribute("role", "alert");
  expect(screen.queryByText("raw server text")).not.toBeInTheDocument();
  await waitFor(() => expect(teamRequests().length).toBeGreaterThan(loads + 1));
});

it("shows an unknown error with the generic display", async () => {
  refuse = () => ({
    status: 500,
    body: { error: "boom", message: "The team could not be saved." },
  });
  await openTeams();
  fireEvent.click(screen.getByRole("button", { name: "Rename Platform" }));
  fireEvent.change(screen.getByLabelText("New name for Platform"), {
    target: { value: "Infra" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByText("The team could not be saved.")).toHaveAttribute(
    "role",
    "alert",
  );
  // The rename stays open so the name can be retried.
  expect(screen.getByLabelText("New name for Platform")).toHaveValue("Infra");
});

it("a failed teams load can be retried", async () => {
  let failing = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const request: Request = { method: init.method ?? "GET", path: input, body: undefined };
      requests.push(request);
      const reply =
        failing && input === `${ORG}/teams`
          ? { status: 503, body: { error: "unavailable", message: "Teams are unavailable." } }
          : answer(request);
      return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status ?? 200 });
    }),
  );
  renderSettings();
  expect(await screen.findByText(/Teams are unavailable\./)).toHaveAttribute("role", "alert");
  failing = false;
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByRole("table", { name: "Teams" })).toBeInTheDocument();
});
