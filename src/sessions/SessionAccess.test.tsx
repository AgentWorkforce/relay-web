import {
  fireEvent,
  render as renderView,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  ProductCapabilitiesProvider,
  useProductCapabilities,
} from "../features/product-capabilities";
import { SessionAccess } from "./SessionAccess";

function render(ui: ReactNode) {
  return renderView(
    <ProductCapabilitiesProvider>{ui}</ProductCapabilitiesProvider>,
  );
}

function CapabilityState() {
  return (
    <span data-testid="capability-state">
      {useProductCapabilities().status}
    </span>
  );
}

const ACCESS = "/cloud/api/v1/workspaces/w1/sessions/s1/access";

const policy = {
  sessionId: "s1",
  runtime: true,
  reset: false,
  version: 3,
  mode: "640",
  gid: 100,
  groups: [{ gid: 100, perm: "r" }],
  members: [
    {
      userId: "u2",
      email: "reader@example.test",
      name: "Reader One",
      perm: "rw",
      member: true,
    },
    { userId: "u9", perm: "r", member: false },
  ],
  label: "team",
  updatedAt: "2026-01-02T03:04:05Z",
};

const current = {
  ...policy,
  members: [policy.members[0]],
};

type Call = { method: string; url: string; body: unknown };
type Route = (call: Call) => Response | Promise<Response> | undefined;

const failure = (
  status: number,
  error: string,
  extra: Record<string, unknown> = {},
) => Response.json({ error, message: `Refused: ${error}.`, ...extra }, { status });

function stub(route: Route, ...given: [capability?: unknown]) {
  // An explicit undefined means the key is absent, as on an older install.
  const capability = given.length ? given[0] : true;
  const calls: Call[] = [];
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/capabilities")) {
      return Response.json({
        capabilities: {
          flows: false,
          chief: false,
          relayfile: false,
          session_access: capability,
        },
      });
    }
    const call = {
      method: init?.method ?? "GET",
      url,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    return (await route(call)) ?? failure(500, "unexpected_request");
  });
  vi.stubGlobal("fetch", fetch);
  return { fetch, calls };
}

const reads = (calls: Call[]) =>
  calls.filter((call) => call.method === "GET" && call.url === ACCESS);
const writes = (calls: Call[]) => calls.filter((call) => call.method !== "GET");

afterEach(() => vi.unstubAllGlobals());

async function openPanel() {
  fireEvent.click(
    await screen.findByRole("button", { name: "Session access" }),
  );
  return screen.findByRole("dialog", { name: "Session access" });
}

async function openEditor(dialog: HTMLElement) {
  fireEvent.click(
    await within(dialog).findByRole("button", { name: "Edit access" }),
  );
  return dialog;
}

const type = (element: HTMLElement, value: string) =>
  fireEvent.change(element, { target: { value } });

const save = (dialog: HTMLElement) =>
  fireEvent.click(within(dialog).getByRole("button", { name: "Save access" }));

it.each([false, undefined, "true"])(
  "is hidden without a literal true session_access capability (%s)",
  async (value) => {
    const { fetch } = stub(() => Response.json({ access: policy }), value);
    render(
      <>
        <CapabilityState />
        <SessionAccess workspaceId="w1" sessionId="s1" />
      </>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("capability-state").textContent).not.toBe(
        "loading",
      ),
    );
    expect(screen.queryByRole("button", { name: "Session access" })).toBeNull();
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "/cloud/api/v1/capabilities",
    ]);
  },
);

it("makes no access request before the control is opened", async () => {
  const { fetch, calls } = stub(() => Response.json({ access: policy }));
  render(<SessionAccess workspaceId="w1" sessionId="s1" />);
  await screen.findByRole("button", { name: "Session access" });
  expect(fetch.mock.calls.map(([url]) => url)).toEqual([
    "/cloud/api/v1/capabilities",
  ]);
  await openPanel();
  await waitFor(() => expect(reads(calls)).toHaveLength(1));
});

it("loads and renders the policy, including a former member", async () => {
  stub(() => Response.json({ access: policy }));
  render(<SessionAccess workspaceId="w1" sessionId="s1" />);
  const dialog = await openPanel();
  const view = within(dialog);
  expect(
    await view.findByText("reader@example.test (Reader One)"),
  ).toBeInTheDocument();
  expect(view.getByText("640")).toBeInTheDocument();
  expect(view.getByText("team")).toBeInTheDocument();
  expect(view.getByText("Set for this session")).toBeInTheDocument();
  expect(view.getByText("Former member")).toBeInTheDocument();
  expect(view.getByText("u9")).toBeInTheDocument();
  expect(view.getByText("Group 100")).toBeInTheDocument();
  expect(view.getByText("Read and write (rw)")).toBeInTheDocument();
});

it("says only that the person is not an administrator", async () => {
  stub(() => failure(403, "not_access_admin"));
  render(<SessionAccess workspaceId="w1" sessionId="s1" />);
  const dialog = await openPanel();
  const alert = await within(dialog).findByRole("alert");
  expect(alert.textContent).toBe("You are not a session access administrator.");
  expect(within(dialog).queryByRole("button", { name: "Try again" })).toBeNull();
  expect(
    within(dialog).queryByRole("button", { name: "Edit access" }),
  ).toBeNull();
});

it("hides the control when session access is not configured", async () => {
  stub(() => failure(404, "session_access_not_configured"));
  render(<SessionAccess workspaceId="w1" sessionId="s1" />);
  await openPanel();
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.queryByRole("button", { name: "Session access" })).toBeNull();
});

it("sends the loaded version, the full lists and the reason exactly once", async () => {
  let answer: (response: Response) => void = () => undefined;
  const { calls } = stub((call) =>
    call.method === "PATCH"
      ? new Promise<Response>((resolve) => {
          answer = resolve;
        })
      : Response.json({ access: current }),
  );
  render(<SessionAccess workspaceId="w1" sessionId="s1" />);
  const dialog = await openEditor(await openPanel());
  const form = within(dialog);
  expect(
    form.getByText(/full lists that will be saved/),
  ).toBeInTheDocument();
  expect(
    form.getByText(/Do not include anything from the session itself/),
  ).toBeInTheDocument();
  type(form.getByLabelText("Mode"), "600");
  type(form.getByLabelText("Label"), "");
  fireEvent.click(form.getByRole("button", { name: "Remove group 100" }));
  type(form.getByLabelText("Add member by email"), "new@example.test");
  fireEvent.click(form.getByRole("button", { name: "Add member" }));
  type(form.getByLabelText("Reason (required)"), "  narrow access  ");
  // The button is renamed while saving, so keep hold of it.
  const button = form.getByRole("button", { name: "Save access" });
  fireEvent.click(button);
  fireEvent.click(button);
  fireEvent.submit(form.getByLabelText("Mode").closest("form")!);
  await waitFor(() => expect(writes(calls)).toHaveLength(1));
  expect(writes(calls)[0]).toEqual({
    method: "PATCH",
    url: ACCESS,
    body: {
      mode: "600",
      label: null,
      groups: [],
      members: [
        { email: "reader@example.test", perm: "rw" },
        { email: "new@example.test", perm: "r" },
      ],
      reason: "narrow access",
      expectedVersion: 3,
    },
  });
  answer(Response.json({ access: { ...current, version: 4, mode: "600" } }));
  expect(
    await within(dialog).findByText("Session access saved."),
  ).toBeInTheDocument();
  expect(writes(calls)).toHaveLength(1);
});

it("keeps former members by leaving the unchanged members list out", async () => {
  const { calls } = stub((call) =>
    call.method === "PATCH"
      ? Response.json({ access: { ...policy, version: 4 } })
      : Response.json({ access: policy }),
  );
  render(<SessionAccess workspaceId="w1" sessionId="s1" />);
  const dialog = await openEditor(await openPanel());
  const form = within(dialog);
  type(form.getByLabelText("Mode"), "600");
  type(form.getByLabelText("Reason (required)"), "tighten mode");
  save(dialog);
  await waitFor(() => expect(writes(calls)).toHaveLength(1));
  expect(writes(calls)[0]!.body).not.toHaveProperty("members");
});

it("refuses to change a members list that still holds a former member", async () => {
  const { calls } = stub(() => Response.json({ access: policy }));
  render(<SessionAccess workspaceId="w1" sessionId="s1" />);
  const dialog = await openEditor(await openPanel());
  const form = within(dialog);
  type(form.getByLabelText("Add member by email"), "new@example.test");
  fireEvent.click(form.getByRole("button", { name: "Add member" }));
  type(form.getByLabelText("Reason (required)"), "add one");
  save(dialog);
  expect(
    await form.findByText(/Remove the former members before saving/),
  ).toBeInTheDocument();
  expect(writes(calls)).toHaveLength(0);
});

it("keeps the edits on a conflict and offers a reload without resending", async () => {
  const { calls } = stub((call) =>
    call.method === "PATCH"
      ? failure(409, "conflict", { currentVersion: 4 })
      : Response.json({ access: current }),
  );
  render(<SessionAccess workspaceId="w1" sessionId="s1" />);
  const dialog = await openEditor(await openPanel());
  const form = within(dialog);
  type(form.getByLabelText("Mode"), "600");
  type(form.getByLabelText("Reason (required)"), "narrow access");
  save(dialog);
  const alert = await form.findByText(/changed meanwhile/);
  expect(alert).toHaveAttribute("role", "alert");
  expect(alert.textContent).toContain("version 4");
  expect(form.getByLabelText("Mode")).toHaveValue("600");
  expect(form.getByRole("button", { name: "Save access" })).toBeDisabled();
  save(dialog);
  expect(writes(calls)).toHaveLength(1);
  fireEvent.click(form.getByRole("button", { name: "Reload current access" }));
  await waitFor(() => expect(reads(calls)).toHaveLength(2));
  expect(
    await form.findByRole("button", { name: "Edit access" }),
  ).toBeInTheDocument();
  expect(writes(calls)).toHaveLength(1);
});

it("marks unknown members in the form", async () => {
  const { calls } = stub((call) =>
    call.method === "PATCH"
      ? failure(400, "unknown_members", { emails: ["gone@example.test"] })
      : Response.json({ access: current }),
  );
  render(<SessionAccess workspaceId="w1" sessionId="s1" />);
  const dialog = await openEditor(await openPanel());
  const form = within(dialog);
  type(form.getByLabelText("Add member by email"), "Gone@example.test");
  fireEvent.click(form.getByRole("button", { name: "Add member" }));
  type(form.getByLabelText("Reason (required)"), "add one");
  save(dialog);
  expect(
    await form.findByText("Not a current member of this organization"),
  ).toBeInTheDocument();
  const permission = form.getByLabelText("Permission for Gone@example.test");
  expect(permission).toHaveAttribute("aria-invalid", "true");
  expect(permission).toHaveAccessibleDescription(
    "Not a current member of this organization",
  );
  expect(form.getByRole("alert").textContent).toContain("gone@example.test");
  expect(
    form.getByLabelText("Permission for reader@example.test"),
  ).not.toHaveAttribute("aria-invalid");
  expect(writes(calls)).toHaveLength(1);
});

it.each([
  ["Control's outcome-unknown answer", () =>
    failure(504, "session_access_outcome_unknown")],
  ["a gateway timeout", () => new Response("Bad gateway", { status: 502 })],
])(
  "on %s says the change may have applied and reloads without resending",
  async (_name, reply) => {
    let read = 0;
    const { calls } = stub((call) => {
      if (call.method === "PATCH") return reply();
      read += 1;
      return Response.json({
        access: read === 1 ? current : { ...current, version: 4, mode: "600" },
      });
    });
    render(<SessionAccess workspaceId="w1" sessionId="s1" />);
    const dialog = await openEditor(await openPanel());
    const form = within(dialog);
    type(form.getByLabelText("Mode"), "600");
    type(form.getByLabelText("Reason (required)"), "narrow access");
    save(dialog);
    expect(
      await form.findByText(/The change may have been applied/),
    ).toBeInTheDocument();
    await waitFor(() => expect(reads(calls)).toHaveLength(2));
    expect(await form.findByText("600")).toBeInTheDocument();
    expect(writes(calls)).toHaveLength(1);
    expect(
      form.getByRole("button", { name: "Edit access" }),
    ).toBeInTheDocument();
  },
);

it("asks for a reason before resetting to the defaults", async () => {
  const { calls } = stub((call) =>
    call.method === "POST"
      ? Response.json({
          access: { ...current, runtime: false, reset: true, version: 4 },
        })
      : Response.json({ access: current }),
  );
  render(<SessionAccess workspaceId="w1" sessionId="s1" />);
  const dialog = await openPanel();
  const panel = within(dialog);
  fireEvent.click(
    await panel.findByRole("button", { name: "Reset to defaults" }),
  );
  fireEvent.click(panel.getByRole("button", { name: "Yes, reset access" }));
  expect(panel.getByRole("alert").textContent).toBe(
    "Give a reason of 1 to 200 characters.",
  );
  expect(writes(calls)).toHaveLength(0);
  type(panel.getByLabelText("Reason (required)"), " back to defaults ");
  fireEvent.click(panel.getByRole("button", { name: "Yes, reset access" }));
  expect(
    await panel.findByText("Session access reset to the installation defaults."),
  ).toBeInTheDocument();
  expect(writes(calls)).toEqual([
    {
      method: "POST",
      url: `${ACCESS}/reset`,
      body: { reason: "back to defaults", expectedVersion: 3 },
    },
  ]);
  expect(panel.getByText("Installation defaults")).toBeInTheDocument();
});

it("pages the history with after", async () => {
  const snapshot = {
    mode: "640",
    gid: 100,
    groups: [{ gid: 100, perm: "r" }],
    members: [policy.members[0]],
    label: "team",
    reset: false,
  };
  const { calls } = stub((call) => {
    if (call.url === `${ACCESS}/history`) {
      return Response.json({
        rows: [
          {
            seq: 1,
            at: "2026-01-01T00:00:00Z",
            actorId: "u2",
            actorName: "Reader One",
            actor: {
              userId: "u2",
              email: "reader@example.test",
              name: "Reader One",
              member: true,
            },
            version: 1,
            reason: "first grant",
            before: null,
            after: snapshot,
          },
        ],
        nextAfter: 1,
      });
    }
    if (call.url === `${ACCESS}/history?after=1`) {
      return Response.json({
        rows: [
          {
            seq: 2,
            at: "2026-01-02T00:00:00Z",
            actorId: "u9",
            actorName: null,
            actor: { userId: "u9", member: false },
            version: 2,
            reason: "back to defaults",
            before: snapshot,
            after: { ...snapshot, reset: true },
          },
        ],
        nextAfter: null,
      });
    }
    return Response.json({ access: current });
  });
  render(<SessionAccess workspaceId="w1" sessionId="s1" />);
  const dialog = await openPanel();
  fireEvent.click(
    await within(dialog).findByRole("button", { name: "Show history" }),
  );
  const history = within(
    within(dialog).getByRole("region", { name: "Access history" }),
  );
  const first = (await history.findByText("Reason: first grant")).closest("li")!;
  expect(first.textContent).toContain("reader@example.test (Reader One)");
  expect(first.textContent).toContain("version 1");
  expect(first.textContent).not.toContain("Before:");
  expect(first.textContent).toContain(
    "After: mode 640; label team; members: reader@example.test rw; groups: group 100 r",
  );
  fireEvent.click(history.getByRole("button", { name: "Load more history" }));
  const second = (
    await history.findByText("Reason: back to defaults")
  ).closest("li")!;
  expect(second.textContent).toContain("Former member u9");
  expect(second.textContent).toContain("After: installation defaults");
  expect(history.getAllByRole("listitem")).toHaveLength(2);
  expect(
    history.queryByRole("button", { name: "Load more history" }),
  ).toBeNull();
  expect(
    calls.filter((call) => call.url.includes("/history")).map((c) => c.url),
  ).toEqual([`${ACCESS}/history`, `${ACCESS}/history?after=1`]);
});

it.each([
  ["a bad mode", "999", "a reason", /Mode must be three digits/],
  ["a blank reason", "640", "   ", /Give a reason of 1 to 200 characters/],
  ["a control character in the reason", "640", "bad\u0007reason", /Give a reason/],
])("rejects %s before sending", async (_name, mode, reason, message) => {
  const { calls } = stub(() => Response.json({ access: current }));
  render(<SessionAccess workspaceId="w1" sessionId="s1" />);
  const dialog = await openEditor(await openPanel());
  const form = within(dialog);
  type(form.getByLabelText("Mode"), mode);
  type(form.getByLabelText("Reason (required)"), reason);
  save(dialog);
  expect(form.getByRole("alert").textContent).toMatch(message);
  expect(writes(calls)).toHaveLength(0);
});

it("rejects a label Control would refuse", async () => {
  const { calls } = stub(() => Response.json({ access: current }));
  render(<SessionAccess workspaceId="w1" sessionId="s1" />);
  const dialog = await openEditor(await openPanel());
  const form = within(dialog);
  type(form.getByLabelText("Label"), "-starts badly");
  type(form.getByLabelText("Reason (required)"), "relabel");
  save(dialog);
  expect(form.getByRole("alert").textContent).toMatch(/Label must be empty/);
  expect(writes(calls)).toHaveLength(0);
});

it("returns focus to the opener on Escape", async () => {
  stub(() => Response.json({ access: current }));
  render(<SessionAccess workspaceId="w1" sessionId="s1" />);
  const dialog = await openPanel();
  expect(within(dialog).getByRole("button", { name: "Close" })).toHaveFocus();
  fireEvent.keyDown(document, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.getByRole("button", { name: "Session access" })).toHaveFocus();
});

it("reports a signed-out read", async () => {
  const onSignedOut = vi.fn();
  stub(() => new Response(null, { status: 401 }));
  render(
    <SessionAccess workspaceId="w1" sessionId="s1" onSignedOut={onSignedOut} />,
  );
  await openPanel();
  await waitFor(() => expect(onSignedOut).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole("dialog")).toBeNull();
});
