import { useEffect, useId, useState, type ReactNode } from "react";
import { Download, Monitor, Terminal } from "lucide-react";
import { appPath } from "../app-path";
import { branding } from "../shell/branding";
import { Badge, Button, Skeleton } from "../shell/ui";
import { desktopFeedApi, ApiError } from "./api";
import type { FeedAsset, FeedChannel, FeedManifest, FeedProfile } from "./contracts";
import { formatDate, message, useLoad } from "./use-load";
import s from "./downloads.module.css";

/** The page Desktop links to, `<app path>/downloads`. */
export function isDownloadsPath(pathname: string): boolean {
  return pathname.replace(/\/+$/, "") === `${appPath()}downloads`;
}

type ProfileReleases = {
  profile: FeedProfile;
  releases: Array<{ channel: FeedChannel; manifest: FeedManifest }>;
};

const CHANNELS: FeedChannel[] = ["stable", "beta"];

async function loadReleases(signal: AbortSignal): Promise<ProfileReleases[]> {
  const profiles = await desktopFeedApi.profiles(signal);
  return Promise.all(
    profiles.map(async (profile) => {
      const manifests = await Promise.all(
        CHANNELS.map((channel) => desktopFeedApi.manifest(profile.id, channel, signal)),
      );
      return {
        profile,
        releases: CHANNELS.flatMap((channel, index) => {
          const manifest = manifests[index];
          return manifest ? [{ channel, manifest }] : [];
        }),
      };
    }),
  );
}

// ---------------------------------------------------------------------------
// Platform detection and asset selection (pure, exported for tests).

export type Os = "macOS" | "Windows" | "Linux";
export type Arch = "arm64" | "x64";
export type DetectedPlatform = { os: Os | null; arch: Arch | null };

export type PlatformHints = {
  userAgent: string;
  /** navigator.userAgentData.platform, where the browser has it. */
  platform?: string;
  /** High-entropy client hints: "arm" / "x86", "64" / "32". */
  architecture?: string;
  bitness?: string;
  maxTouchPoints?: number;
};

const OS_ORDER: Os[] = ["macOS", "Windows", "Linux"];

/**
 * The visitor's OS and CPU, or null where the browser does not say. macOS
 * browsers other than Chromium always claim "Intel", so a Mac's CPU is only
 * known from client hints; phones, tablets and ChromeOS get no OS.
 */
export function detectPlatform(hints: PlatformHints): DetectedPlatform {
  const ua = hints.userAgent;
  let os: Os | null = null;
  const platform = hints.platform?.trim().toLowerCase();
  if (platform) {
    if (platform === "macos") os = "macOS";
    else if (platform === "windows") os = "Windows";
    else if (platform === "linux") os = "Linux";
  } else if (/android|iphone|ipad|ipod|cros/i.test(ua)) {
    os = null;
  } else if (/macintosh|mac os x/i.test(ua)) {
    // iPadOS asks for the desktop site as a touch "Macintosh".
    os = (hints.maxTouchPoints ?? 0) > 1 ? null : "macOS";
  } else if (/windows/i.test(ua)) {
    os = "Windows";
  } else if (/linux|x11/i.test(ua)) {
    os = "Linux";
  }
  if (!os) return { os: null, arch: null };

  let arch: Arch | null = null;
  const architecture = hints.architecture?.toLowerCase();
  if (architecture === "arm") arch = "arm64";
  else if (architecture === "x86") arch = "x64";
  else if (os !== "macOS") {
    if (/arm64|aarch64|armv8/i.test(ua)) arch = "arm64";
    else if (/x86_64|x64|win64|wow64|amd64|i686/i.test(ua)) arch = "x64";
  }
  return { os, arch };
}

/** Installer kinds per OS, most recommended first. */
const PREFERENCE: Record<Os, string[]> = {
  macOS: ["image"],
  Windows: ["setup", "zip"],
  Linux: ["deb", "tarball"],
};

const KIND_LABEL: Record<string, string> = {
  image: "macOS app (.dmg)",
  setup: "Windows installer (.exe)",
  zip: "Windows portable (.zip)",
  deb: "Linux package (.deb)",
  tarball: "Linux archive (.tar.gz)",
};

const KIND_SHORT: Record<string, string> = {
  image: ".dmg",
  setup: ".exe installer",
  zip: ".zip",
  deb: ".deb",
  tarball: ".tar.gz",
};

function isOs(value: string): value is Os {
  return (OS_ORDER as string[]).includes(value);
}

export function archLabel(platform: string, arch: string): string {
  if (platform === "macOS") return arch === "arm64" ? "Apple Silicon" : arch === "x64" ? "Intel" : arch;
  return arch === "arm64" ? "ARM64" : arch;
}

export function kindLabel(asset: FeedAsset): string {
  return KIND_LABEL[asset.kind] ?? asset.name;
}

function isProbe(asset: FeedAsset): boolean {
  return asset.kind === "probe" || asset.name.toLowerCase().includes("-probe");
}

function isInstallScript(asset: FeedAsset): boolean {
  return asset.kind === "install-script" || /^install\.(sh|ps1)$/i.test(asset.name);
}

/** What a person installs: no bare cores (probes) and no install scripts. */
export function installers(assets: readonly FeedAsset[]): FeedAsset[] {
  return assets.filter((asset) => !isProbe(asset) && !isInstallScript(asset));
}

export function installScripts(assets: readonly FeedAsset[]): FeedAsset[] {
  return assets.filter((asset) => !isProbe(asset) && isInstallScript(asset));
}

function archOrder(os: string): string[] {
  return os === "macOS" ? ["arm64", "x64"] : ["x64", "arm64"];
}

/** Sort key: preferred kind, then arch, then the lowest macOS floor (none first). */
function compareAssets(a: FeedAsset, b: FeedAsset): number {
  const prefs = isOs(a.platform) ? PREFERENCE[a.platform] : [];
  const rank = (asset: FeedAsset) => {
    const index = prefs.indexOf(asset.kind);
    return index === -1 ? prefs.length : index;
  };
  const arches = archOrder(a.platform);
  const archRank = (asset: FeedAsset) => {
    const index = arches.indexOf(asset.arch);
    return index === -1 ? arches.length : index;
  };
  return (
    rank(a) - rank(b) ||
    archRank(a) - archRank(b) ||
    (a.os_floor ?? 0) - (b.os_floor ?? 0) ||
    a.name.localeCompare(b.name)
  );
}

export type DownloadGroup = { os: string; assets: FeedAsset[] };

/** Installers grouped macOS, Windows, Linux (then anything else), each sorted. */
export function groupByOs(assets: readonly FeedAsset[]): DownloadGroup[] {
  const groups = new Map<string, FeedAsset[]>();
  for (const asset of installers(assets)) {
    const list = groups.get(asset.platform) ?? [];
    list.push(asset);
    groups.set(asset.platform, list);
  }
  const order = (os: string) => {
    const index = (OS_ORDER as string[]).indexOf(os);
    return index === -1 ? OS_ORDER.length : index;
  };
  return [...groups.entries()]
    .sort(([a], [b]) => order(a) - order(b) || a.localeCompare(b))
    .map(([os, list]) => ({ os, assets: list.sort(compareAssets) }));
}

export type Recommendation = {
  asset: FeedAsset;
  /** The other format for the same OS and CPU (Linux .tar.gz, Windows .zip). */
  alternative: FeedAsset | null;
  /** The button text, e.g. "Download for macOS (Apple Silicon)". */
  label: string;
};

/**
 * The primary download(s) for the visitor. With the CPU unknown, a Mac is
 * offered both builds (Apple Silicon first); Windows and Linux default to
 * x64. An OS without a build here, or no OS at all, gets none.
 */
export function recommend(
  assets: readonly FeedAsset[],
  detected: DetectedPlatform,
): Recommendation[] {
  const os = detected.os;
  if (!os) return [];
  const forOs = installers(assets)
    .filter((asset) => asset.platform === os && PREFERENCE[os].includes(asset.kind))
    .sort(compareAssets);
  if (!forOs.length) return [];
  const available = archOrder(os).filter((arch) => forOs.some((asset) => asset.arch === arch));
  let arches: string[] = detected.arch
    ? [detected.arch]
    : os === "macOS"
      ? available
      : ["x64"];
  arches = arches.filter((arch) => available.includes(arch));
  // The visitor's CPU has no build: offer what there is.
  if (!arches.length) arches = available;
  const many = arches.length > 1;
  return arches.map((arch) => {
    const builds = forOs.filter((asset) => asset.arch === arch);
    const asset = builds[0]!;
    const alternative = builds.find((other) => other.kind !== asset.kind) ?? null;
    // Name the CPU when it is not the one detected (no build for it here).
    const fallback = detected.arch !== null && detected.arch !== arch;
    const showArch = os === "macOS" || many || fallback || arch !== "x64";
    return {
      asset,
      alternative,
      label: `Download for ${os}${showArch ? ` (${archLabel(os, arch)})` : ""}`,
    };
  });
}

type NavigatorWithHints = Navigator & {
  userAgentData?: {
    platform?: string;
    getHighEntropyValues?: (
      hints: string[],
    ) => Promise<{ architecture?: string; bitness?: string }>;
  };
};

function navigatorHints(): PlatformHints {
  if (typeof navigator === "undefined") return { userAgent: "" };
  const nav = navigator as NavigatorWithHints;
  return {
    userAgent: nav.userAgent ?? "",
    platform: nav.userAgentData?.platform || undefined,
    maxTouchPoints: nav.maxTouchPoints,
  };
}

function useDetectedPlatform(override: DetectedPlatform | undefined): DetectedPlatform {
  const [detected, setDetected] = useState<DetectedPlatform>(
    () => override ?? detectPlatform(navigatorHints()),
  );
  const fixed = override !== undefined;
  useEffect(() => {
    if (fixed) return;
    const data = (navigator as NavigatorWithHints).userAgentData;
    if (!data?.getHighEntropyValues) return;
    let live = true;
    data.getHighEntropyValues(["architecture", "bitness"]).then(
      (values) => {
        if (live) setDetected(detectPlatform({ ...navigatorHints(), ...values }));
      },
      () => {
        /* Keep the low-entropy guess. */
      },
    );
    return () => {
      live = false;
    };
  }, [fixed]);
  return override ?? detected;
}

// ---------------------------------------------------------------------------
// UI

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function productName(): string {
  const name = branding().productName;
  return /desktop$/i.test(name) ? name : `${name} Desktop`;
}

/** Asks Control for a short-lived signed link, then goes to it. */
function useDownload(profile: string, asset: FeedAsset, navigate: (url: string) => void) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  async function start() {
    setBusy(true);
    setFailure(null);
    try {
      const { url } = await desktopFeedApi.downloadUrl(profile, asset.id);
      if (new URL(url).protocol !== "https:") throw new Error("The download link was not secure.");
      navigate(url);
    } catch (error) {
      setFailure(
        error instanceof ApiError && error.status === 501
          ? "This deployment does not offer direct downloads."
          : message(error),
      );
    } finally {
      setBusy(false);
    }
  }
  return { busy, failure, start };
}

function DownloadButton(props: {
  profile: string;
  asset: FeedAsset;
  navigate: (url: string) => void;
  variant: "default" | "outline";
  size: "lg" | "sm";
  children: ReactNode;
  /** Set when the visible text alone does not name the file. */
  ariaLabel?: string;
}) {
  const { busy, failure, start } = useDownload(props.profile, props.asset, props.navigate);
  return (
    <span className={s.action}>
      <Button
        variant={props.variant}
        size={props.size}
        disabled={busy}
        aria-label={busy ? undefined : props.ariaLabel}
        onClick={() => void start()}
      >
        <Download aria-hidden="true" />
        {busy ? "Preparing…" : props.children}
      </Button>
      {failure && (
        <span role="alert" className={s.failure}>
          {failure}
        </span>
      )}
    </span>
  );
}

function Recommended(props: {
  profile: string;
  manifest: FeedManifest;
  channel: FeedChannel;
  detected: DetectedPlatform;
  navigate: (url: string) => void;
}) {
  const picks = recommend(props.manifest.assets, props.detected);
  const titleId = useId();
  const unsureMac = props.detected.os === "macOS" && !props.detected.arch && picks.length > 1;
  return (
    <section className={s.hero} aria-labelledby={titleId}>
      <div className={s.heroHead}>
        <span className={s.heroIcon} aria-hidden="true">
          <Monitor />
        </span>
        <div>
          <h2 id={titleId} className={s.heroTitle}>
            {productName()}
            {props.channel === "beta" && (
              <Badge variant="warning" className={s.badge}>
                Beta
              </Badge>
            )}
          </h2>
          <p className={s.meta}>
            Version {props.manifest.version} · Published {formatDate(props.manifest.published_at)}
          </p>
        </div>
      </div>
      {picks.length > 0 ? (
        <>
          <ul className={s.picks}>
            {picks.map((pick) => (
              <li key={pick.asset.id} className={s.pick}>
                <DownloadButton
                  profile={props.profile}
                  asset={pick.asset}
                  navigate={props.navigate}
                  variant="default"
                  size="lg"
                >
                  {pick.label}
                </DownloadButton>
                <p className={s.caption}>
                  {kindLabel(pick.asset)}
                  {pick.asset.os_floor !== undefined && ` · macOS ${pick.asset.os_floor} or later`} ·{" "}
                  {formatSize(pick.asset.size)}
                </p>
                {pick.alternative && (
                  <DownloadButton
                    profile={props.profile}
                    asset={pick.alternative}
                    navigate={props.navigate}
                    variant="outline"
                    size="sm"
                  >
                    Or {KIND_SHORT[pick.alternative.kind] ?? pick.alternative.name}
                  </DownloadButton>
                )}
              </li>
            ))}
          </ul>
          {unsureMac && (
            <p className={s.hint}>
              Not sure which Mac you have? Open the Apple menu and choose About This Mac: an
              Apple M-series chip means Apple Silicon.
            </p>
          )}
        </>
      ) : (
        <p className={s.hint}>
          {props.detected.os
            ? `There is no ${props.detected.os} build in this release. Choose a download below.`
            : "Desktop runs on macOS, Windows and Linux. Choose a download below."}
        </p>
      )}
    </section>
  );
}

function AllDownloads(props: {
  profile: string;
  manifest: FeedManifest;
  navigate: (url: string) => void;
}) {
  const groups = groupByOs(props.manifest.assets);
  const titleId = useId();
  if (!groups.length) return null;
  return (
    <section className={s.panel} aria-labelledby={titleId}>
      <h2 id={titleId} className={s.panelTitle}>
        All downloads
      </h2>
      {groups.map((group) => (
        <div key={group.os} className={s.group} role="group" aria-label={group.os}>
          <h3 className={s.groupTitle}>{group.os}</h3>
          <ul className={s.rows}>
            {group.assets.map((asset) => (
              <li key={asset.id} className={s.row}>
                <div className={s.rowMain}>
                  <p className={s.rowTitle}>
                    {kindLabel(asset)}
                    <span className={s.chip}>{archLabel(asset.platform, asset.arch)}</span>
                    {asset.os_floor !== undefined && (
                      <span className={s.chip}>macOS {asset.os_floor}+</span>
                    )}
                  </p>
                  <p className={s.rowMeta}>
                    <span className={s.fileName}>{asset.name}</span> · {formatSize(asset.size)}
                  </p>
                  <details className={s.checksum}>
                    <summary>SHA-256</summary>
                    <code>{asset.sha256}</code>
                  </details>
                </div>
                <DownloadButton
                  profile={props.profile}
                  asset={asset}
                  navigate={props.navigate}
                  variant="outline"
                  size="sm"
                  ariaLabel={`Download ${asset.name}`}
                >
                  Download
                </DownloadButton>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function CommandLine(props: {
  profile: string;
  manifest: FeedManifest;
  navigate: (url: string) => void;
}) {
  const scripts = installScripts(props.manifest.assets);
  if (!scripts.length) return null;
  return (
    <aside className={s.note} aria-label="Command-line install">
      <Terminal aria-hidden="true" className={s.noteIcon} />
      <div className={s.noteBody}>
        <p className={s.noteTitle}>Command-line install</p>
        <p>
          For a server without a desktop, download the install script and run it there. It
          checks each download against this site&rsquo;s signed release feed.
        </p>
        <div className={s.noteActions}>
          {scripts.map((script) => (
            <DownloadButton
              key={script.id}
              profile={props.profile}
              asset={script}
              navigate={props.navigate}
              variant="outline"
              size="sm"
            >
              {script.name}
              {` (${script.name.endsWith(".ps1") || script.platform === "Windows" ? "Windows" : "Linux"})`}
            </DownloadButton>
          ))}
        </div>
      </div>
    </aside>
  );
}

type Release = {
  key: string;
  profile: FeedProfile;
  channel: FeedChannel;
  manifest: FeedManifest;
};

function releaseLabel(release: Release, showProfile: boolean): string {
  const channel = release.channel === "beta" ? "Beta" : "Stable";
  return `${channel} · ${release.manifest.version}${showProfile ? ` · ${release.profile.asset_prefix}` : ""}`;
}

export function DownloadsPage(props: {
  navigate?: (url: string) => void;
  /** Tests fix the visitor's platform; the browser's is detected otherwise. */
  platform?: DetectedPlatform;
}) {
  const navigate = props.navigate ?? ((url: string) => window.location.assign(url));
  const detected = useDetectedPlatform(props.platform);
  const { data, error, reload } = useLoad(loadReleases);
  const releases: Release[] =
    data?.flatMap(({ profile, releases: items }) =>
      items.map((item) => ({ key: `${profile.id}:${item.channel}`, profile, ...item })),
    ) ?? [];
  const [chosen, setChosen] = useState<string | null>(null);
  const current = releases.find((release) => release.key === chosen) ?? releases[0];
  const showProfile = (data?.length ?? 0) > 1;
  return (
    <div className={s.page}>
      <div className={s.detail}>
        <p className={s.intro}>
          Install {productName()} to connect the agents on your computer to this workspace.
        </p>
        {error && (
          <div role="alert" className={s.error}>
            {message(error)}{" "}
            <Button variant="outline" size="sm" onClick={reload}>
              Try again
            </Button>
          </div>
        )}
        {!error && !data && (
          <div role="status" aria-label="Loading downloads…" className={s.stack}>
            <span className="sr-only">Loading downloads…</span>
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        )}
        {data && !current && (
          <div className={s.empty}>
            <Monitor aria-hidden="true" />
            <p>There are no Desktop downloads for this workspace.</p>
            <span>Ask a workspace admin if you expected one.</span>
          </div>
        )}
        {current && (
          <div className={s.stack}>
            {releases.length > 1 && (
              <div
                className={s.channels}
                role="radiogroup"
                aria-label="Release"
                onKeyDown={(event) => {
                  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
                  const step: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
                  const at = releases.findIndex((release) => release.key === current.key);
                  const next =
                    event.key === "Home" ? 0
                    : event.key === "End" ? releases.length - 1
                    : event.key in step ? (at + step[event.key]! + releases.length) % releases.length
                    : -1;
                  if (next === -1) return;
                  event.preventDefault();
                  setChosen(releases[next]!.key);
                  event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
                }}
              >
                {releases.map((release) => (
                  <button
                    key={release.key}
                    type="button"
                    role="radio"
                    aria-checked={release.key === current.key}
                    tabIndex={release.key === current.key ? 0 : -1}
                    className={s.channel}
                    onClick={() => setChosen(release.key)}
                  >
                    {releaseLabel(release, showProfile)}
                  </button>
                ))}
              </div>
            )}
            <Recommended
              key={current.key}
              profile={current.profile.id}
              channel={current.channel}
              manifest={current.manifest}
              detected={detected}
              navigate={navigate}
            />
            <AllDownloads
              key={`all:${current.key}`}
              profile={current.profile.id}
              manifest={current.manifest}
              navigate={navigate}
            />
            <CommandLine
              key={`cli:${current.key}`}
              profile={current.profile.id}
              manifest={current.manifest}
              navigate={navigate}
            />
          </div>
        )}
      </div>
    </div>
  );
}
