import { useState } from "react";
import { appPath } from "../app-path";
import { desktopFeedApi, ApiError } from "./api";
import type { FeedAsset, FeedChannel, FeedManifest, FeedProfile } from "./contracts";
import { formatDate, message, useLoad } from "./use-load";
import "./admin.css";

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

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function target(asset: FeedAsset): string {
  const floor = asset.os_floor === undefined ? "" : ` ${asset.os_floor}+`;
  return `${asset.platform}${floor}, ${asset.arch}`;
}

function DownloadButton(props: {
  profile: string;
  asset: FeedAsset;
  navigate: (url: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  async function download() {
    setBusy(true);
    setFailure(null);
    try {
      const { url } = await desktopFeedApi.downloadUrl(props.profile, props.asset.id);
      if (new URL(url).protocol !== "https:") throw new Error("The download link was not secure.");
      props.navigate(url);
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
  return (
    <>
      <button
        type="button"
        disabled={busy}
        aria-label={`Download ${props.asset.name}`}
        onClick={() => void download()}
      >
        {busy ? "Preparing…" : "Download"}
      </button>
      {failure && <p role="alert">{failure}</p>}
    </>
  );
}

function Release(props: {
  profile: string;
  channel: FeedChannel;
  manifest: FeedManifest;
  navigate: (url: string) => void;
}) {
  // Probes are bare cores for tooling, not something a person installs.
  const assets = props.manifest.assets.filter((asset) => asset.kind !== "probe");
  return (
    <section className="card" aria-label={`Version ${props.manifest.version}`}>
      <h2>
        Version {props.manifest.version}
        {props.channel === "beta" ? " (Beta)" : ""}
      </h2>
      <p>Published {formatDate(props.manifest.published_at)}</p>
      <table>
        <thead>
          <tr>
            <th>Installer</th>
            <th>For</th>
            <th>Size</th>
            <th>SHA-256</th>
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {assets.map((asset) => (
            <tr key={asset.id}>
              <td>{asset.name}</td>
              <td>{target(asset)}</td>
              <td>{formatSize(asset.size)}</td>
              <td>
                <code>{asset.sha256}</code>
              </td>
              <td>
                <DownloadButton profile={props.profile} asset={asset} navigate={props.navigate} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function DownloadsPage(props: { navigate?: (url: string) => void }) {
  const navigate = props.navigate ?? ((url: string) => window.location.assign(url));
  const { data, error } = useLoad(loadReleases);
  const releases = data?.flatMap(({ profile, releases: items }) =>
    items.map((item) => ({ profile: profile.id, ...item })),
  );
  return (
    <main>
      <h1>Downloads</h1>
      {error && <p role="alert">{message(error)}</p>}
      {!error && !data && <p>Loading…</p>}
      {data && releases?.length === 0 && <p>There are no Desktop downloads for this workspace.</p>}
      {releases?.map((item) => (
        <Release
          key={`${item.profile}:${item.channel}`}
          profile={item.profile}
          channel={item.channel}
          manifest={item.manifest}
          navigate={navigate}
        />
      ))}
    </main>
  );
}
