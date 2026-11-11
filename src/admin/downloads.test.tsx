import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import {
  DownloadsPage,
  detectPlatform,
  groupByOs,
  installScripts,
  installers,
  isDownloadsPath,
  recommend,
  type DetectedPlatform,
} from "./downloads";
import { WorkspaceChrome } from "../shell/workspace-chrome";

const FEED = "/cloud/api/v1/desktop/feed";
const sha = "ab".repeat(32);

type AssetExtra = Partial<{ platform: string; arch: string; os_floor: number; size: number }>;

function asset(id: string, name: string, kind: string, extra: AssetExtra = {}) {
  return { id, name, platform: "Linux", arch: "x64", kind, size: 64 * 1024 * 1024, sha256: sha, ...extra };
}

function envelope(version: string, channel: string, assets: unknown[]) {
  return {
    manifest: {
      schema: 1, profile: "x7k2q", channel, version, published_at: "2026-11-08T10:00:00Z", notes: "", download_hosts: [], assets,
    },
    signature: "s".repeat(86),
    key_id: "fk_x7k2q_k1",
  };
}

const LINUX: DetectedPlatform = { os: "Linux", arch: "x64" };

const RELEASE = [
  asset("a_dmgarm01", "Desktop-2026.11.9-macOS-arm64.dmg", "image", { platform: "macOS", arch: "arm64", os_floor: 13 }),
  asset("a_dmgx6401", "Desktop-2026.11.9-macOS-x64.dmg", "image", { platform: "macOS", arch: "x64", os_floor: 13 }),
  asset("a_exe00001", "Desktop-2026.11.9-Windows-x64-Setup.exe", "setup", { platform: "Windows" }),
  asset("a_zip00001", "Desktop-2026.11.9-Windows-x64.zip", "zip", { platform: "Windows" }),
  asset("a_tgz00001", "Desktop-2026.11.9-Linux-x64.tar.gz", "tarball"),
  asset("a_deb00001", "Desktop-2026.11.9-Linux-x64.deb", "deb"),
  asset("a_debarm01", "Desktop-2026.11.9-Linux-arm64.deb", "deb", { arch: "arm64" }),
  asset("a_probe001", "Desktop-2026.11.9-Linux-x64-probe.tar.gz", "probe"),
  asset("a_probe002", "Desktop-2026.11.9-macOS-arm64-probe.zip", "zip", { platform: "macOS", arch: "arm64" }),
  asset("a_insh0001", "install.sh", "install-script", { size: 4096 }),
  asset("a_inps0001", "install.ps1", "install-script", { platform: "Windows", size: 4096 }),
];

type Reply = { status: number; body: unknown };
type Seen = { path: string; method: string; headers: Record<string, string> };

let replies: Record<string, Reply>;
let seen: Seen[];

beforeEach(() => {
  seen = [];
  replies = {
    "/cloud/api/v1/desktop/profiles": { status: 200, body: { profiles: [{ id: "x7k2q", asset_prefix: "Desktop" }] } },
    [`${FEED}/manifest?channel=stable`]: {
      status: 200,
      body: envelope("2026.11.9", "stable", [
        asset("a_deb00001", "Desktop-2026.11.9-Linux-x64.deb", "deb"),
        asset("a_probe001", "Desktop-2026.11.9-Linux-x64-probe.tar.gz", "probe"),
      ]),
    },
    [`${FEED}/manifest?channel=beta`]: { status: 404, body: { error: "no_release", message: "No release" } },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init: RequestInit) => {
      seen.push({ path: input, method: init.method ?? "GET", headers: init.headers as Record<string, string> });
      const reply = replies[input] ?? { status: 500, body: { error: "unexpected" } };
      return new Response(JSON.stringify(reply.body), { status: reply.status });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it("lists the workspace's installers with version, size and sha256, without probes", async () => {
  render(<DownloadsPage navigate={() => undefined} platform={LINUX} />);
  expect(await screen.findByText(/Version 2026\.11\.9/)).toBeInTheDocument();
  expect(screen.getByText("Desktop-2026.11.9-Linux-x64.deb")).toBeInTheDocument();
  expect(screen.getAllByText(/64\.0 MB/).length).toBeGreaterThan(0);
  expect(screen.getByText(sha)).toBeInTheDocument();
  expect(screen.queryByText("Desktop-2026.11.9-Linux-x64-probe.tar.gz")).toBeNull();
  // The topbar owns the page heading.
  expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  const manifest = seen.find((call) => call.path.endsWith("channel=stable"));
  expect(manifest?.headers["X-Agent-Relay-Profile"]).toBe("x7k2q");
});

it("recommends the visitor's build first, with the other format beside it", async () => {
  replies[`${FEED}/manifest?channel=stable`] = { status: 200, body: envelope("2026.11.9", "stable", RELEASE) };
  render(<DownloadsPage navigate={() => undefined} platform={LINUX} />);
  expect(await screen.findByRole("button", { name: "Download for Linux" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Or .tar.gz" })).toBeInTheDocument();
  const all = screen.getByRole("region", { name: "All downloads" });
  // <details> is a group too; the OS groups are the labelled ones.
  const osGroups = within(all)
    .getAllByRole("group")
    .map((group) => group.getAttribute("aria-label"))
    .filter(Boolean);
  expect(osGroups).toEqual([
    "macOS",
    "Windows",
    "Linux",
  ]);
  expect(within(all).queryByText("install.sh")).toBeNull();
  expect(within(all).queryByText(/probe/)).toBeNull();
  const cli = screen.getByRole("complementary", { name: "Command-line install" });
  expect(within(cli).getByRole("button", { name: "install.sh (Linux)" })).toBeInTheDocument();
  expect(within(cli).getByRole("button", { name: "install.ps1 (Windows)" })).toBeInTheDocument();
});

it("offers both Mac builds when the chip is unknown", async () => {
  replies[`${FEED}/manifest?channel=stable`] = { status: 200, body: envelope("2026.11.9", "stable", RELEASE) };
  render(<DownloadsPage navigate={() => undefined} platform={{ os: "macOS", arch: null }} />);
  expect(await screen.findByRole("button", { name: "Download for macOS (Apple Silicon)" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Download for macOS (Intel)" })).toBeInTheDocument();
  expect(screen.getByText(/Not sure which Mac you have/)).toBeInTheDocument();
});

it("switches between stable and beta", async () => {
  replies[`${FEED}/manifest?channel=beta`] = {
    status: 200,
    body: envelope("2026.11.10-beta.1", "beta", [asset("a_debbeta1", "Desktop-2026.11.10-beta.1-Linux-x64.deb", "deb")]),
  };
  render(<DownloadsPage navigate={() => undefined} platform={LINUX} />);
  const beta = await screen.findByRole("radio", { name: "Beta · 2026.11.10-beta.1" });
  expect(screen.getByRole("radio", { name: "Stable · 2026.11.9" })).toHaveAttribute("aria-checked", "true");
  fireEvent.click(beta);
  expect(beta).toHaveAttribute("aria-checked", "true");
  expect(screen.getByText("Desktop-2026.11.10-beta.1-Linux-x64.deb")).toBeInTheDocument();
});

it("detects the platform from client hints, then the user agent", () => {
  const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15";
  expect(detectPlatform({ userAgent: mac })).toEqual({ os: "macOS", arch: null });
  expect(detectPlatform({ userAgent: mac, platform: "macOS", architecture: "arm" })).toEqual({ os: "macOS", arch: "arm64" });
  expect(detectPlatform({ userAgent: mac, platform: "macOS", architecture: "x86" })).toEqual({ os: "macOS", arch: "x64" });
  expect(detectPlatform({ userAgent: mac, maxTouchPoints: 5 })).toEqual({ os: null, arch: null });
  expect(detectPlatform({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" })).toEqual({ os: "Windows", arch: "x64" });
  expect(detectPlatform({ userAgent: "Mozilla/5.0 (X11; Linux aarch64)" })).toEqual({ os: "Linux", arch: "arm64" });
  expect(detectPlatform({ userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8)" })).toEqual({ os: null, arch: null });
  expect(detectPlatform({ userAgent: "Mozilla/5.0 (X11; CrOS x86_64 15000.0.0)" })).toEqual({ os: null, arch: null });
});

it("picks a recommendation per OS and CPU", () => {
  const pick = (detected: DetectedPlatform) =>
    recommend(RELEASE, detected).map((r) => [r.label, r.asset.name, r.alternative?.name ?? null]);
  expect(pick({ os: "macOS", arch: "arm64" })).toEqual([
    ["Download for macOS (Apple Silicon)", "Desktop-2026.11.9-macOS-arm64.dmg", null],
  ]);
  expect(pick({ os: "Windows", arch: null })).toEqual([
    ["Download for Windows", "Desktop-2026.11.9-Windows-x64-Setup.exe", "Desktop-2026.11.9-Windows-x64.zip"],
  ]);
  expect(pick({ os: "Linux", arch: "arm64" })).toEqual([
    ["Download for Linux (ARM64)", "Desktop-2026.11.9-Linux-arm64.deb", null],
  ]);
  // Windows on ARM has no build here: offer what there is.
  expect(pick({ os: "Windows", arch: "arm64" })).toEqual([
    ["Download for Windows", "Desktop-2026.11.9-Windows-x64-Setup.exe", "Desktop-2026.11.9-Windows-x64.zip"],
  ]);
  expect(pick({ os: null, arch: null })).toEqual([]);
});

it("groups installers by OS and keeps probes and scripts out", () => {
  expect(installers(RELEASE).some((a) => a.name.includes("probe") || a.name.startsWith("install."))).toBe(false);
  expect(installScripts(RELEASE).map((a) => a.name)).toEqual(["install.sh", "install.ps1"]);
  expect(groupByOs(RELEASE).map((g) => [g.os, g.assets.map((a) => a.id)])).toEqual([
    ["macOS", ["a_dmgarm01", "a_dmgx6401"]],
    ["Windows", ["a_exe00001", "a_zip00001"]],
    ["Linux", ["a_deb00001", "a_debarm01", "a_tgz00001"]],
  ]);
});

it("puts Downloads in the workspace nav for every member", () => {
  render(
    <WorkspaceChrome rail="Downloads" label="Downloads">
      <p>content</p>
    </WorkspaceChrome>,
  );
  const views = screen.getByRole("navigation", { name: "Workspace views" });
  const link = within(views).getByRole("link", { name: "Downloads" });
  expect(link).toHaveAttribute("href", "#/downloads");
  expect(link).toHaveAttribute("aria-current", "page");
  expect(within(views).getByRole("link", { name: "Sessions" })).not.toHaveAttribute("aria-current");
  expect(screen.getAllByRole("heading", { name: "Downloads" })).toHaveLength(1);
});

it("asks for a signed URL and then goes to it", async () => {
  const url = "https://feed-bucket.s3.eu-west-2.amazonaws.com/a?X-Amz-Expires=300";
  replies[`${FEED}/assets/a_deb00001/download-url`] = {
    status: 200,
    body: { url, expires_at: "2026-11-08T10:05:00.000Z" },
  };
  const navigate = vi.fn();
  render(<DownloadsPage navigate={navigate} platform={LINUX} />);
  fireEvent.click(await screen.findByRole("button", { name: "Download Desktop-2026.11.9-Linux-x64.deb" }));
  await waitFor(() => expect(navigate).toHaveBeenCalledWith(url));
  const call = seen.find((entry) => entry.path.endsWith("/download-url"));
  expect(call?.method).toBe("POST");
  expect(call?.headers["X-Agent-Relay-Profile"]).toBe("x7k2q");
});

it("refuses a download link that is not https", async () => {
  replies[`${FEED}/assets/a_deb00001/download-url`] = {
    status: 200,
    body: { url: "http://feed.example.test/a", expires_at: "2026-11-08T10:05:00.000Z" },
  };
  const navigate = vi.fn();
  render(<DownloadsPage navigate={navigate} platform={LINUX} />);
  fireEvent.click(await screen.findByRole("button", { name: "Download for Linux" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("not secure");
  expect(navigate).not.toHaveBeenCalled();
});

it("says so when the site only streams", async () => {
  replies[`${FEED}/assets/a_deb00001/download-url`] = { status: 501, body: { error: "no_object_storage", message: "x" } };
  render(<DownloadsPage navigate={() => undefined} platform={LINUX} />);
  fireEvent.click(await screen.findByRole("button", { name: "Download for Linux" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("does not offer direct downloads");
});

it("shows an empty state without an entitlement or when the feed is off", async () => {
  replies["/cloud/api/v1/desktop/profiles"] = { status: 200, body: { profiles: [] } };
  const first = render(<DownloadsPage navigate={() => undefined} platform={LINUX} />);
  expect(await screen.findByText("There are no Desktop downloads for this workspace.")).toBeInTheDocument();
  first.unmount();
  replies["/cloud/api/v1/desktop/profiles"] = { status: 404, body: { error: "not_found", message: "Not found" } };
  render(<DownloadsPage navigate={() => undefined} platform={LINUX} />);
  expect(await screen.findByText("There are no Desktop downloads for this workspace.")).toBeInTheDocument();
});

it("reports a refused manifest", async () => {
  replies[`${FEED}/manifest?channel=stable`] = {
    status: 403,
    body: { error: "not_entitled", message: "Not entitled to this profile" },
  };
  render(<DownloadsPage navigate={() => undefined} platform={LINUX} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Not entitled to this profile");
});

it("matches only the downloads path under the app path", () => {
  window.__AGENT_RELAY_DASHBOARD_CONFIG__ = { appPath: "/cloud/dashboard/" };
  try {
    expect(isDownloadsPath("/cloud/dashboard/downloads")).toBe(true);
    expect(isDownloadsPath("/cloud/dashboard/downloads/")).toBe(true);
    expect(isDownloadsPath("/cloud/dashboard/")).toBe(false);
    expect(isDownloadsPath("/cloud/dashboard/sessions/downloads")).toBe(false);
  } finally {
    delete window.__AGENT_RELAY_DASHBOARD_CONFIG__;
  }
});
