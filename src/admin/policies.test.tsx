import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { adminApi, ApiError } from "./api";
import { describeSeconds, leaderPatternsFrom } from "./policies";
import { Settings } from "./settings";

type Call = { method: string; path: string; body: unknown; init: RequestInit };
type Reply = { status?: number; body?: unknown };

const POLICY = "/cloud/api/v1/organizations/o1/capture-policy";
const LEADERS = "/cloud/api/v1/workspaces/w1/leaders";
const ROSTER = [
  { name: "lead", agent_id: "a1" },
  { name: "review-1", agent_id: "a2" },
  { name: "ops-7", agent_id: "a3" },
];
let calls: Call[] = [];
let role: "owner" | "admin" | "member" = "owner";
let policy: { version: 1; revision: number; settings: Record<string, unknown> };
let override: ((call: Call) => Reply | undefined) | null = null;
let leaderPatterns: string[] = [];

/** Exact names only, plus a trailing `*`; enough for these tests. */
const matched = (patterns: string[]) =>
  ROSTER.filter((agent) =>
    patterns.some((pattern) =>
      pattern.endsWith("*")
        ? agent.name.startsWith(pattern.slice(0, -1))
        : agent.name === pattern,
    ),
  );

function respond(call: Call): Reply {
  const custom = override?.(call);
  if (custom) return custom;
  if (call.path === "/cloud/api/v1/auth/whoami")
    return {
      body: {
        user: { id: "u1", email: "me@example.test", name: "Me" },
        currentOrganization: { id: "o1", name: "Example", role },
        currentWorkspace: { id: "w1", name: "Primary" },
      },
    };
  if (call.path.endsWith("/leaders")) {
    if (call.method === "PUT")
      leaderPatterns = (call.body as { patterns: string[] }).patterns;
    return { body: { leaders: matched(leaderPatterns), patterns: leaderPatterns } };
  }
  if (call.path.endsWith("/capture-policy")) {
    if (role === "member")
      return { status: 403, body: { error: "forbidden", message: "Forbidden" } };
    if (call.method === "GET") return { body: policy };
    if (call.method === "PUT") {
      const settings = (call.body as { settings: Record<string, unknown> }).settings;
      policy = { version: 1, revision: policy.revision + 1, settings };
      return { body: policy };
    }
    if (call.method === "DELETE") {
      policy = { version: 1, revision: policy.revision + 1, settings: {} };
      return { body: policy };
    }
  }
  return { status: 404, body: { error: "not_found", message: "no fake" } };
}

const header = (call: Call, name: string) =>
  (call.init.headers as Record<string, string>)[name];
const writes = () => calls.filter((call) => call.method !== "GET");

beforeEach(() => {
  calls = [];
  role = "owner";
  override = null;
  leaderPatterns = ["lead", "review-*"];
  policy = { version: 1, revision: 4, settings: { sharing_mode: "new" } };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const call: Call = {
        method: init.method ?? "GET",
        path: input,
        body: init.body ? JSON.parse(init.body as string) : undefined,
        init,
      };
      calls.push(call);
      const { status = 200, body } = respond(call);
      return new Response(JSON.stringify(body), { status });
    }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("api: reads, writes with If-Match and clears the org capture policy", async () => {
  expect(await adminApi.capturePolicy("o/1")).toEqual(policy);
  expect(calls[0]!.path).toBe("/cloud/api/v1/organizations/o%2F1/capture-policy");
  expect(calls[0]!.init.credentials).toBe("same-origin");

  await adminApi.putCapturePolicy("o1", { upload_control: "operator" }, 4);
  const put = calls[1]!;
  expect(put.method).toBe("PUT");
  expect(put.body).toEqual({ settings: { upload_control: "operator" } });
  expect(header(put, "If-Match")).toBe("4");
  expect(header(put, "Content-Type")).toBe("application/json");

  const cleared = await adminApi.clearCapturePolicy("o1", 5);
  expect(cleared).toEqual({ version: 1, revision: 6, settings: {} });
  expect(calls[2]!.method).toBe("DELETE");
  expect(header(calls[2]!, "If-Match")).toBe("5");

  override = () => ({
    status: 409,
    body: { error: "revision_mismatch", message: "Capture policy is at revision 7, not 6" },
  });
  const failure = await adminApi
    .putCapturePolicy("o1", {}, 6)
    .catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(ApiError);
  expect((failure as ApiError).status).toBe(409);
  expect((failure as ApiError).code).toBe("revision_mismatch");
});

it("owners see Policies in settings with current values and revision", async () => {
  render(<Settings section="policies" />);
  expect(
    await screen.findByRole("heading", { level: 1, name: "Policies" }),
  ).toBeInTheDocument();
  const nav = screen.getByRole("navigation", { name: "Settings" });
  expect(within(nav).getByText("Policies").closest("a")).toHaveAttribute(
    "href",
    "#/settings/policies",
  );
  expect(await screen.findByTestId("policy-revision")).toHaveTextContent("4");
  const uploads = screen.getByRole("group", { name: "What gets uploaded" });
  expect(
    within(uploads).getByRole("radio", { name: /Automatically upload new sessions/ }),
  ).toBeChecked();
  expect(
    within(screen.getByRole("group", { name: "Who controls uploading" })).getByRole(
      "radio",
      { name: /Let each person choose/ },
    ),
  ).toBeChecked();
  expect(screen.getByRole("button", { name: "Save policy" })).toBeDisabled();
});

it("members see no Policies section and never read the policy", async () => {
  role = "member";
  render(<Settings section="policies" />);
  // Falls back to the default section, like API tokens.
  expect(
    await screen.findByRole("heading", { level: 1, name: "Workspace" }),
  ).toBeInTheDocument();
  const nav = screen.getByRole("navigation", { name: "Settings" });
  expect(within(nav).queryByText("Policies")).not.toBeInTheDocument();
  expect(calls.some((call) => call.path === POLICY)).toBe(false);
});

it("saves the whole settings object with If-Match and shows the new revision", async () => {
  render(<Settings section="policies" />);
  await screen.findByTestId("policy-revision");
  fireEvent.click(
    within(screen.getByRole("group", { name: "Who controls uploading" })).getByRole(
      "radio",
      { name: /The organization/ },
    ),
  );
  const oops = screen.getByRole("group", { name: "“Oops” window before upload" });
  fireEvent.click(within(oops).getByRole("radio", { name: /Set a window/ }));
  fireEvent.change(within(oops).getByLabelText(/Seconds/), {
    target: { value: "1800" },
  });
  expect(within(oops).getByText("30 min")).toBeInTheDocument();
  fireEvent.click(
    within(
      screen.getByRole("group", { name: "People may delete uploaded sessions" }),
    ).getByRole("radio", { name: /Not allowed/ }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Save policy" }));

  expect(await screen.findByText(/Policy saved \(revision 5\)/)).toBeInTheDocument();
  const put = writes()[0]!;
  expect(put.method).toBe("PUT");
  expect(header(put, "If-Match")).toBe("4");
  expect(put.body).toEqual({
    settings: {
      sharing_mode: "new",
      upload_control: "operator",
      oops_window_seconds: 1800,
      user_retroactive_delete: false,
    },
  });
  expect(screen.getByTestId("policy-revision")).toHaveTextContent("5");
  expect(screen.getByRole("button", { name: "Save policy" })).toBeDisabled();
});

it("an unset choice is left out of the settings sent", async () => {
  render(<Settings section="policies" />);
  await screen.findByTestId("policy-revision");
  fireEvent.click(
    within(screen.getByRole("group", { name: "What gets uploaded" })).getByRole(
      "radio",
      { name: /Let each person choose/ },
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Save policy" }));
  await screen.findByText(/Policy saved/);
  expect(writes()[0]!.body).toEqual({ settings: {} });
});

it("refuses an out-of-range Oops window before sending anything", async () => {
  render(<Settings section="policies" />);
  await screen.findByTestId("policy-revision");
  const oops = screen.getByRole("group", { name: "“Oops” window before upload" });
  fireEvent.click(within(oops).getByRole("radio", { name: /Set a window/ }));
  fireEvent.change(within(oops).getByLabelText(/Seconds/), {
    target: { value: "86401" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save policy" }));
  expect(
    await screen.findByText(/whole number of seconds from 0 to 86,400/),
  ).toBeInTheDocument();
  expect(writes()).toHaveLength(0);
});

it("on a revision conflict reloads the latest policy and says nothing was saved", async () => {
  render(<Settings section="policies" />);
  await screen.findByTestId("policy-revision");
  // Someone else writes revision 5 first.
  policy = { version: 1, revision: 5, settings: { sharing_mode: "all" } };
  override = (call) =>
    call.method === "PUT"
      ? {
          status: 409,
          body: { error: "revision_mismatch", message: "Capture policy is at revision 5, not 4" },
        }
      : undefined;
  fireEvent.click(
    within(screen.getByRole("group", { name: "What gets uploaded" })).getByRole(
      "radio",
      { name: /Only sessions each person chooses/ },
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Save policy" }));
  expect(
    await screen.findByText(/Someone changed the policy since you opened this page/),
  ).toBeInTheDocument();
  await waitFor(() =>
    expect(screen.getByTestId("policy-revision")).toHaveTextContent("5"),
  );
  expect(
    within(screen.getByRole("group", { name: "What gets uploaded" })).getByRole(
      "radio",
      { name: /Automatically upload all sessions/ },
    ),
  ).toBeChecked();
  expect(header(writes()[0]!, "If-Match")).toBe("4");
});

it("a failed reload after a conflict is shown with a retry", async () => {
  render(<Settings section="policies" />);
  await screen.findByTestId("policy-revision");
  override = (call) =>
    call.method === "PUT"
      ? { status: 409, body: { error: "revision_mismatch", message: "stale" } }
      : call.path.endsWith("/capture-policy")
        ? { status: 500, body: { error: "internal", message: "Control is down" } }
        : undefined;
  fireEvent.click(
    within(screen.getByRole("group", { name: "What gets uploaded" })).getByRole(
      "radio",
      { name: /Automatically upload all sessions/ },
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Save policy" }));
  expect(
    await screen.findByText(/Couldn't load the latest policy.*Control is down/),
  ).toBeInTheDocument();
  policy = { version: 1, revision: 5, settings: { sharing_mode: "all" } };
  override = null;
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() =>
    expect(screen.getByTestId("policy-revision")).toHaveTextContent("5"),
  );
  expect(screen.queryByText(/Couldn't load the latest policy/)).not.toBeInTheDocument();
});

it("shows Control's invalid_policy message and keeps the policy", async () => {
  override = (call) =>
    call.method === "PUT"
      ? {
          status: 400,
          body: { error: "invalid_policy", message: "sharing_mode must be one of all, new, selected" },
        }
      : undefined;
  render(<Settings section="policies" />);
  await screen.findByTestId("policy-revision");
  fireEvent.click(
    within(screen.getByRole("group", { name: "What gets uploaded" })).getByRole(
      "radio",
      { name: /Automatically upload all sessions/ },
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Save policy" }));
  expect(
    await screen.findByText(
      "Control refused the policy, and nothing was saved: sharing_mode must be one of all, new, selected",
    ),
  ).toBeInTheDocument();
  expect(screen.getByTestId("policy-revision")).toHaveTextContent("4");
});

it("goes read only when operator controls are turned off", async () => {
  override = (call) =>
    call.method === "PUT"
      ? {
          status: 403,
          body: { error: "operator_controls_not_entitled", message: "Operator controls are not enabled" },
        }
      : undefined;
  render(<Settings section="policies" />);
  await screen.findByTestId("policy-revision");
  fireEvent.click(
    within(screen.getByRole("group", { name: "What gets uploaded" })).getByRole(
      "radio",
      { name: /Automatically upload all sessions/ },
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Save policy" }));
  expect(await screen.findByTestId("policy-read-only")).toHaveTextContent(
    /SELFHOST_OPERATOR_CONTROLS/,
  );
  expect(screen.getByRole("button", { name: "Save policy" })).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Reset all to let people choose" }),
  ).toBeDisabled();
});

it("reset asks for confirmation, then DELETEs with If-Match", async () => {
  render(<Settings section="policies" />);
  await screen.findByTestId("policy-revision");
  fireEvent.click(
    screen.getByRole("button", { name: "Reset all to let people choose" }),
  );
  expect(writes()).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Reset all to let people choose" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Confirm reset" }));
  expect(
    await screen.findByText(/Every setting is back to each person's choice \(revision 5\)/),
  ).toBeInTheDocument();
  const reset = writes()[0]!;
  expect(reset.method).toBe("DELETE");
  expect(reset.path).toBe(POLICY);
  expect(header(reset, "If-Match")).toBe("4");
  expect(
    within(screen.getByRole("group", { name: "What gets uploaded" })).getByRole(
      "radio",
      { name: /Let each person choose/ },
    ),
  ).toBeChecked();
  expect(
    screen.getByRole("button", { name: "Reset all to let people choose" }),
  ).toBeDisabled();
});

it("describes Oops windows in plain units", () => {
  expect(describeSeconds(0)).toBe("no wait");
  expect(describeSeconds(900)).toBe("15 min");
  expect(describeSeconds(86_400)).toBe("24 h");
  expect(describeSeconds(3_661)).toBe("1 h 1 min 1 s");
});

const leaderBox = () =>
  within(screen.getByRole("form", { name: "Workspace leaders" })).getByRole(
    "textbox",
    { name: "Leader patterns" },
  ) as HTMLTextAreaElement;

it("api: reads and replaces the workspace leader patterns", async () => {
  expect(await adminApi.getWorkspaceLeaders("w/1")).toEqual({
    leaders: [ROSTER[0], ROSTER[1]],
    patterns: ["lead", "review-*"],
  });
  expect(calls[0]!.path).toBe("/cloud/api/v1/workspaces/w%2F1/leaders");

  const saved = await adminApi.setWorkspaceLeaders("w1", ["lead"]);
  expect(saved).toEqual({ leaders: [ROSTER[0]], patterns: ["lead"] });
  const put = calls[1]!;
  expect(put.method).toBe("PUT");
  expect(put.path).toBe(LEADERS);
  expect(put.body).toEqual({ patterns: ["lead"] });
  expect(header(put, "Content-Type")).toBe("application/json");
});

it("shows the leader patterns and the agents they match", async () => {
  render(<Settings section="policies" />);
  expect(
    await screen.findByRole("heading", { level: 2, name: "Workspace leaders" }),
  ).toBeInTheDocument();
  await waitFor(() => expect(leaderBox().value).toBe("lead\nreview-*"));
  const list = screen.getByRole("list", { name: "Currently matched leaders" });
  expect(
    within(list)
      .getAllByRole("listitem")
      .map((item) => item.textContent),
  ).toEqual(["lead", "review-1"]);
  expect(screen.getByRole("button", { name: "Save leaders" })).toBeDisabled();
});

it("members never read the workspace leaders", async () => {
  role = "member";
  render(<Settings section="policies" />);
  await screen.findByRole("heading", { level: 1, name: "Workspace" });
  expect(calls.some((call) => call.path === LEADERS)).toBe(false);
});

it("saves the trimmed, de-duplicated patterns and shows the new matches", async () => {
  render(<Settings section="policies" />);
  await waitFor(() => expect(leaderBox().value).toBe("lead\nreview-*"));
  fireEvent.change(leaderBox(), {
    target: { value: "  lead \n\nops-*\nlead\n  release-?  \n" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save leaders" }));
  expect(await screen.findByText(/Leaders saved/)).toBeInTheDocument();
  const put = writes()[0]!;
  expect(put.method).toBe("PUT");
  expect(put.path).toBe(LEADERS);
  expect(put.body).toEqual({ patterns: ["lead", "ops-*", "release-?"] });
  expect(leaderBox().value).toBe("lead\nops-*\nrelease-?");
  const list = screen.getByRole("list", { name: "Currently matched leaders" });
  expect(within(list).getByText("ops-7")).toBeInTheDocument();
  expect(within(list).queryByText("review-1")).not.toBeInTheDocument();
});

it("refuses a 65th pattern before sending anything", async () => {
  render(<Settings section="policies" />);
  await waitFor(() => expect(leaderBox().value).toBe("lead\nreview-*"));
  fireEvent.change(leaderBox(), {
    target: {
      value: Array.from({ length: 65 }, (_, index) => `agent-${index}`).join("\n"),
    },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save leaders" }));
  expect(
    await screen.findByText("There are 65 patterns; a workspace can have at most 64."),
  ).toBeInTheDocument();
  expect(writes()).toHaveLength(0);
});

it("refuses a pattern longer than 128 characters before sending anything", async () => {
  render(<Settings section="policies" />);
  await waitFor(() => expect(leaderBox().value).toBe("lead\nreview-*"));
  fireEvent.change(leaderBox(), {
    target: { value: `lead\n${"a".repeat(129)}` },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save leaders" }));
  expect(
    await screen.findByText(
      "Pattern 2 is 129 characters long; each pattern can be at most 128.",
    ),
  ).toBeInTheDocument();
  expect(writes()).toHaveLength(0);
});

it("says nothing was saved when the relay engine is unavailable", async () => {
  override = (call) =>
    call.method === "PUT" && call.path === LEADERS
      ? {
          status: 502,
          body: {
            error: "workspace_leaders_unavailable",
            message: "Relaycast could not be reached",
          },
        }
      : undefined;
  render(<Settings section="policies" />);
  await waitFor(() => expect(leaderBox().value).toBe("lead\nreview-*"));
  fireEvent.change(leaderBox(), { target: { value: "lead" } });
  fireEvent.click(screen.getByRole("button", { name: "Save leaders" }));
  expect(
    await screen.findByText(
      "The relay engine could not be reached, so nothing was saved: Relaycast could not be reached",
    ),
  ).toBeInTheDocument();
  expect(leaderBox().value).toBe("lead");
});

it("shows Control's invalid_request message for refused patterns", async () => {
  override = (call) =>
    call.method === "PUT" && call.path === LEADERS
      ? {
          status: 400,
          body: { error: "invalid_request", message: "patterns must be strings" },
        }
      : undefined;
  render(<Settings section="policies" />);
  await waitFor(() => expect(leaderBox().value).toBe("lead\nreview-*"));
  fireEvent.change(leaderBox(), { target: { value: "lead" } });
  fireEvent.click(screen.getByRole("button", { name: "Save leaders" }));
  expect(
    await screen.findByText(
      "Control refused the patterns, and nothing was saved: patterns must be strings",
    ),
  ).toBeInTheDocument();
});

it("normalizes leader patterns like Control", () => {
  expect(leaderPatternsFrom(" a \r\n\n b\na ")).toEqual(["a", "b"]);
  expect(leaderPatternsFrom("")).toEqual([]);
  expect(leaderPatternsFrom("x".repeat(128))).toEqual(["x".repeat(128)]);
  // Duplicates collapse before the count is checked.
  expect(leaderPatternsFrom(Array(65).fill("lead").join("\n"))).toEqual(["lead"]);
});
