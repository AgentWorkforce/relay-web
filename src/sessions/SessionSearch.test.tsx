import { useState } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { agentNames } from "./api";
import { SessionSearch } from "./SessionSearch";
import { listServerFilters, matchesSessionFilters } from "./query";
import type { Member, SessionRow } from "./data";

vi.mock("./api", () => ({ agentNames: vi.fn() }));
const roster = vi.mocked(agentNames);
const now = Date.parse("2026-11-10T12:00:00Z");
const rows = [
  {
    source: "codex",
    projectId: "project-1",
    project: { name: "Team workspace" },
    repoUrl: null,
    projectKey: null,
  },
] as SessionRow[];

function SearchHarness({
  initial = "",
  workspace = "w1",
  busy = false,
  items = rows,
  people = [{ id: "u1", name: "Ada" }],
}: {
  initial?: string;
  workspace?: string;
  busy?: boolean;
  items?: SessionRow[];
  people?: Member[];
}) {
  const [query, setQuery] = useState(initial);
  return (
    <>
      <SessionSearch
        workspaceId={workspace}
        query={query}
        onChange={setQuery}
        tab="sessions"
        rows={items}
        members={people}
        now={now}
        busy={busy}
      />
      <output data-testid="query">{query}</output>
    </>
  );
}
function open() {
  fireEvent.click(
    screen.getByRole("button", { name: "Search and filter sessions" }),
  );
  return screen.getByRole("combobox", { name: "Search sessions" });
}
beforeEach(() => {
  roster.mockReset();
  roster.mockResolvedValue(["yo", "builder@node", "other"]);
});

it("widens date presets while keeping an independently typed upper bound", () => {
  render(<SearchHarness initial="updated:>=2026-11-10 updated:<=2026-11-10 " />);
  const input = open();
  fireEvent.click(screen.getByRole("option", { name: /Last 7 days/ }));
  expect(input).toHaveValue("updated:<=2026-11-10 updated:>=2026-11-04 ");
  const row = { lastTs: "2026-11-06T12:00:00Z" } as SessionRow;
  expect(matchesSessionFilters(row, (input as HTMLInputElement).value, now)).toBe(true);
});

it("replaces a mixed-case activity status when another status is selected", () => {
  render(<SearchHarness initial="is:Active " />);
  const input = open();
  fireEvent.click(screen.getByRole("option", { name: /Idle.*is:idle/ }));
  expect(input).toHaveValue("is:idle ");
});

it("opens the Cloud-style grouped command panel, preview tokens and supported syntax", () => {
  render(<SearchHarness />);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  const input = open();
  expect(input).toHaveFocus();
  for (const group of ["Harnesses", "Projects", "Status", "People", "Updated"])
    expect(screen.getByText(group)).toBeVisible();
  expect(screen.getByText("project:project-1")).toBeVisible();
  expect(
    screen
      .getByRole("option", { name: /Codex.*harness:codex/ })
      .querySelector("img"),
  ).toHaveAttribute("src", expect.stringContaining("codex.svg"));
  expect(roster).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Search syntax tips" }));
  expect(
    screen.getByText(
      /Text search scope and availability depend on the workspace backend/,
    ),
  ).toBeVisible();
  expect(screen.queryByText(/is:on-relay/)).not.toBeInTheDocument();
});

it("navigates, selects and removes without corrupting words or unrelated filters, then submits and returns focus", () => {
  render(<SearchHarness initial="fix harness:cod" />);
  const input = open();
  expect(input).not.toHaveAttribute("aria-activedescendant");
  fireEvent.keyDown(input, { key: "ArrowDown" });
  expect(input).toHaveAttribute(
    "aria-activedescendant",
    screen.getByRole("option").id,
  );
  fireEvent.keyDown(input, { key: "ArrowRight" });
  expect(input).toHaveValue("fix harness:codex ");
  fireEvent.keyDown(input, { key: "ArrowLeft" });
  expect(input).toHaveValue("fix");
  fireEvent.change(input, { target: { value: "is:idle is:act" } });
  fireEvent.keyDown(input, { key: "ArrowDown" });
  fireEvent.submit(screen.getByRole("search"));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByTestId("query")).toHaveTextContent("is:active");
  expect(
    screen.getByRole("button", { name: "Search and filter sessions" }),
  ).toHaveFocus();
});

it("toggles exact quoted project chips, keeps similarly named text, and clears from the compact trigger", () => {
  render(
    <SearchHarness
      initial={'"project:project-1" project:project-1 project:other'}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Remove filter project:project-1" }),
  );
  expect(screen.getByTestId("query")).toHaveTextContent(
    '"project:project-1" project:other',
  );
  open();
  fireEvent.change(screen.getByRole("combobox"), {
    target: { value: '"project:project-1" project:other ' },
  });
  fireEvent.click(
    screen.getByRole("option", { name: /Team workspace.*project:project-1/ }),
  );
  expect(screen.getByRole("combobox")).toHaveValue(
    '"project:project-1" project:other project:project-1 ',
  );
  fireEvent.click(
    screen.getByRole("option", { name: /Team workspace.*project:project-1/ }),
  );
  expect(screen.getByRole("combobox")).toHaveValue(
    '"project:project-1" project:other',
  );
  fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });
  fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
  expect(screen.getByTestId("query")).toBeEmptyDOMElement();
});

it("uses slash only outside editable/modal controls and ignores composed/modifier navigation", () => {
  render(
    <>
      <input aria-label="Other input" />
      <div contentEditable aria-label="Editor" />
      <SearchHarness />
    </>,
  );
  fireEvent.keyDown(screen.getByLabelText("Other input"), { key: "/" });
  fireEvent.keyDown(screen.getByLabelText("Editor"), { key: "/" });
  fireEvent.keyDown(window, { key: "/", ctrlKey: true });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  fireEvent.keyDown(window, { key: "/" });
  const input = screen.getByRole("combobox");
  fireEvent.keyDown(input, { key: "ArrowDown", isComposing: true });
  fireEvent.keyDown(input, { key: "ArrowDown", metaKey: true });
  expect(input).not.toHaveAttribute("aria-activedescendant");
  fireEvent.keyDown(input, { key: "Escape", isComposing: true });
  expect(screen.getByRole("dialog")).toBeVisible();
  fireEvent.keyDown(input, { key: "Escape" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("traps Tab at both modal boundaries and closes with the button or backdrop", () => {
  render(<SearchHarness />);
  const input = open();
  fireEvent.keyDown(input, { key: "Tab", shiftKey: true });
  expect(
    screen.getByRole("button", { name: "Search syntax tips" }),
  ).toHaveFocus();
  fireEvent.keyDown(document.activeElement!, { key: "Tab" });
  expect(input).toHaveFocus();
  fireEvent.click(screen.getByRole("button", { name: "Close search" }));
  expect(
    screen.getByRole("button", { name: "Search and filter sessions" }),
  ).toHaveFocus();
  open();
  fireEvent.click(document.querySelector('[aria-hidden="true"].fixed')!);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("preserves @autocomplete, one-agent notice and current agent-only routing", async () => {
  render(<SearchHarness initial="@other @y" />);
  const input = open();
  const option = await screen.findByRole("option", { name: /@yo.*@yo/ });
  expect(roster).toHaveBeenCalledWith("w1", expect.any(AbortSignal));
  fireEvent.click(option);
  expect(input).toHaveValue("@other @yo ");
  expect(screen.getByText(/One agent at a time: showing @other/)).toBeVisible();
  expect(listServerFilters("@other @yo ").agent).toBe("other");
  expect(listServerFilters("@yo")).toMatchObject({ agent: "yo", q: undefined });
  expect(listServerFilters("@builder@no*").agent).toBe("builder@no*");
});

it("shows roster loading, empty and error states without preventing a literal agent search", async () => {
  let resolve!: (names: string[]) => void;
  roster.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  render(<SearchHarness initial="@missing" busy />);
  open();
  expect(screen.getByText("Loading agent suggestions…")).toBeVisible();
  expect(screen.getByRole("search")).toHaveAttribute("aria-busy", "true");
  expect(screen.getByText("Searching conversations…")).toBeInTheDocument();
  await act(async () => resolve([]));
  expect(screen.getByText(/No matching agents/)).toBeVisible();
  fireEvent.submit(screen.getByRole("search"));
  expect(screen.getByTestId("query")).toHaveTextContent("@missing");
  roster.mockRejectedValueOnce(new Error("unavailable"));
  open();
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "" } });
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "@new" } });
  expect(
    await screen.findByText(/Agent suggestions unavailable/),
  ).toBeVisible();
});

it("never shows a previous workspace roster while a new workspace request is pending, including late results", async () => {
  let finishOld!: (names: string[]) => void;
  let finishNew!: (names: string[]) => void;
  roster.mockImplementation(
    (workspace) =>
      new Promise((done) => {
        if (workspace === "w1") finishOld = done;
        else finishNew = done;
      }),
  );
  const view = render(<SearchHarness initial="@" />);
  open();
  view.rerender(<SearchHarness initial="@" workspace="w2" />);
  await act(async () => finishOld(["private-old-agent"]));
  expect(screen.queryByText("@private-old-agent")).not.toBeInTheDocument();
  expect(screen.getByText("Loading agent suggestions…")).toBeVisible();
  await act(async () => finishNew(["new-agent"]));
  expect(
    within(screen.getByRole("listbox")).getByRole("option", {
      name: /@new-agent/,
    }),
  ).toBeVisible();
  expect(screen.queryByText("@private-old-agent")).not.toBeInTheDocument();
});

it("shows the empty filter-search state and does not select anything on an unhighlighted Enter", () => {
  render(<SearchHarness initial="unmatched-words" />);
  open();
  expect(
    screen.getByText("No filter suggestions. Press Enter to search."),
  ).toBeVisible();
  fireEvent.submit(screen.getByRole("search"));
  expect(screen.getByTestId("query")).toHaveTextContent("unmatched-words");
});

it.each(["click", "ArrowLeft"])(
  "removes a checked agent case-insensitively with %s",
  async (method) => {
    render(<SearchHarness initial="@Yo" />);
    const input = open();
    const option = await screen.findByRole("option", { name: /@yo.*@yo/ });
    expect(within(option).getByLabelText("Selected")).toBeInTheDocument();
    if (method === "click") fireEvent.click(option);
    else {
      fireEvent.keyDown(input, { key: "ArrowDown" });
      fireEvent.keyDown(input, { key: "ArrowLeft" });
    }
    expect(input).toHaveValue("");
  },
);

it("matches project/person labels but replaces drafts with exact stored IDs, keeping words and exclusions", () => {
  const projectId = "3c056abf-fb5b-4c63-b486-b7179543d1b1";
  const personId = "0d5e2f87-0637-4fa8-a4cb-edf73529827b";
  render(
    <SearchHarness
      initial="keep -project:other project:Tea"
      items={[{ ...rows[0]!, projectId }]}
      people={[{ id: personId, name: "Ada" }]}
    />,
  );
  const input = open();
  fireEvent.click(screen.getByRole("option", { name: /Team workspace/ }));
  expect(input).toHaveValue(`keep -project:other project:${projectId} `);
  fireEvent.change(input, {
    target: { value: `keep -project:other project:${projectId} person:Ad` },
  });
  fireEvent.keyDown(input, { key: "ArrowDown" });
  fireEvent.keyDown(input, { key: "ArrowRight" });
  expect(input).toHaveValue(
    `keep -project:other project:${projectId} person:${personId} `,
  );
});

it("clears an already settled workspace roster immediately on workspace switch", async () => {
  roster
    .mockResolvedValueOnce(["old-agent"])
    .mockImplementationOnce(() => new Promise(() => {}));
  const view = render(<SearchHarness initial="@" />);
  open();
  expect(
    await screen.findByRole("option", { name: /@old-agent/ }),
  ).toBeVisible();
  view.rerender(<SearchHarness initial="@" workspace="w2" />);
  expect(
    screen.queryByRole("option", { name: /@old-agent/ }),
  ).not.toBeInTheDocument();
  expect(screen.getByText("Loading agent suggestions…")).toBeVisible();
});
