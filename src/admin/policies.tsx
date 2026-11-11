import { useState, type FormEvent } from "react";
import { adminApi, ApiError } from "./api";
import {
  MAX_OOPS_WINDOW_SECONDS,
  type CapturePolicy,
  type CaptureSettings,
} from "./contracts";
import { message, useLoad } from "./use-load";

/** Served when upload_control is operator and no window is stored. */
const DEFAULT_OOPS_WINDOW_SECONDS = 900;
const UNSET = "unset";

type Option = { value: string; label: string; detail: string };

/** Agent Relay Desktop's Upload policy wording, in the operator's voice. */
const SHARING_MODE: Option[] = [
  {
    value: UNSET,
    label: "Let each person choose",
    detail: "Each person picks what gets uploaded in Agent Relay Desktop.",
  },
  {
    value: "selected",
    label: "Only sessions each person chooses",
    detail:
      "New sessions stay local until the person turns on Upload session. Once enabled, those sessions keep uploading changes until they turn it off.",
  },
  {
    value: "new",
    label: "Automatically upload new sessions",
    detail:
      "Upload new sessions automatically. Existing sessions stay local unless the person chooses to share them.",
  },
  {
    value: "all",
    label: "Automatically upload all sessions, past and future",
    detail:
      "Every existing and future local coding session uploads automatically, without anyone selecting it first.",
  },
];

const UPLOAD_CONTROL: Option[] = [
  {
    value: UNSET,
    label: "Let each person choose",
    detail: "Each person can pause and resume their own uploads.",
  },
  {
    value: "operator",
    label: "The organization",
    detail:
      "Uploads always run; people can't pause or resume them, and an earlier pause is resumed.",
  },
  {
    value: "user",
    label: "Each person",
    detail:
      "People can pause and resume their own uploads, as the organization's setting.",
  },
];

const USER_DELETE: Option[] = [
  {
    value: UNSET,
    label: "Let each person choose",
    detail: "Agent Relay Desktop keeps its usual delete controls.",
  },
  {
    value: "true",
    label: "Allowed",
    detail: "People can delete the uploaded copies of their sessions.",
  },
  {
    value: "false",
    label: "Not allowed",
    detail: "The controls that delete uploaded sessions are removed.",
  },
];

type Draft = {
  sharing_mode: string;
  upload_control: string;
  oops_mode: "unset" | "set";
  oops_seconds: string;
  user_retroactive_delete: string;
};

function draftFrom(settings: CaptureSettings): Draft {
  return {
    sharing_mode: settings.sharing_mode ?? UNSET,
    upload_control: settings.upload_control ?? UNSET,
    oops_mode: settings.oops_window_seconds === undefined ? "unset" : "set",
    oops_seconds: String(
      settings.oops_window_seconds ?? DEFAULT_OOPS_WINDOW_SECONDS,
    ),
    user_retroactive_delete:
      settings.user_retroactive_delete === undefined
        ? UNSET
        : String(settings.user_retroactive_delete),
  };
}

const KNOWN = new Set([
  "sharing_mode",
  "upload_control",
  "oops_window_seconds",
  "user_retroactive_delete",
]);

/** The full settings object a PUT replaces; unknown keys are kept as read. */
function settingsFrom(
  draft: Draft,
  current: CaptureSettings,
): CaptureSettings | string {
  const settings: CaptureSettings = Object.fromEntries(
    Object.entries(current).filter(([key]) => !KNOWN.has(key)),
  );
  if (draft.sharing_mode !== UNSET)
    settings.sharing_mode = draft.sharing_mode as CaptureSettings["sharing_mode"];
  if (draft.upload_control !== UNSET)
    settings.upload_control =
      draft.upload_control as CaptureSettings["upload_control"];
  if (draft.oops_mode === "set") {
    const text = draft.oops_seconds.trim();
    const seconds = Number(text);
    if (
      !/^[0-9]+$/.test(text) ||
      !Number.isInteger(seconds) ||
      seconds > MAX_OOPS_WINDOW_SECONDS
    )
      return `The "Oops" window must be a whole number of seconds from 0 to ${MAX_OOPS_WINDOW_SECONDS.toLocaleString("en-US")}.`;
    settings.oops_window_seconds = seconds;
  }
  if (draft.user_retroactive_delete !== UNSET)
    settings.user_retroactive_delete = draft.user_retroactive_delete === "true";
  return settings;
}

const same = (a: CaptureSettings, b: CaptureSettings) =>
  JSON.stringify(Object.entries(a).sort()) ===
  JSON.stringify(Object.entries(b).sort());

export function describeSeconds(seconds: number) {
  if (seconds === 0) return "no wait";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return [
    hours && `${hours} h`,
    minutes && `${minutes} min`,
    rest && `${rest} s`,
  ]
    .filter(Boolean)
    .join(" ");
}

type Notice = { kind: "status" | "alert"; text: string };

const NOT_ENTITLED =
  "Operator controls are turned off on this installation (SELFHOST_OPERATOR_CONTROLS on Control), so policies can be viewed but not changed. Ask whoever runs the installation to turn them on.";

export function PoliciesSection(props: { organizationId: string }) {
  const { data, error, reload } = useLoad((signal) =>
    adminApi.capturePolicy(props.organizationId, signal),
  );
  // A write's answer; whichever of it and the last load is newer is shown.
  const [written, setWritten] = useState<CapturePolicy | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [readOnly, setReadOnly] = useState(false);
  const policy =
    written && (!data || written.revision >= data.revision) ? written : data;

  function failed(failure: unknown) {
    if (failure instanceof ApiError && failure.status === 409) {
      setNotice({
        kind: "alert",
        text: "Someone changed the policy since you opened this page, so nothing was saved. The latest policy is shown below; make your change again.",
      });
      reload();
      return;
    }
    if (
      failure instanceof ApiError &&
      failure.code === "operator_controls_not_entitled"
    ) {
      setReadOnly(true);
      setNotice({
        kind: "alert",
        text: "Nothing was saved: operator controls are turned off on this installation.",
      });
      return;
    }
    if (failure instanceof ApiError && failure.code === "invalid_policy") {
      setNotice({
        kind: "alert",
        text: `Control refused the policy, and nothing was saved: ${failure.message}`,
      });
      return;
    }
    setNotice({ kind: "alert", text: message(failure) });
  }

  async function save(settings: CaptureSettings, revision: number) {
    setNotice(null);
    try {
      const next = await adminApi.putCapturePolicy(
        props.organizationId,
        settings,
        revision,
      );
      setWritten(next);
      setNotice({
        kind: "status",
        text: `Policy saved (revision ${next.revision}). Agent Relay Desktop applies it at the next sign-in or within 15 minutes.`,
      });
    } catch (failure) {
      failed(failure);
    }
  }

  async function clear(revision: number) {
    setNotice(null);
    try {
      const next = await adminApi.clearCapturePolicy(
        props.organizationId,
        revision,
      );
      setWritten(next);
      setNotice({
        kind: "status",
        text: `Every setting is back to each person's choice (revision ${next.revision}).`,
      });
    } catch (failure) {
      failed(failure);
    }
  }

  return (
    <section aria-labelledby="policies-title" className="card policies">
      <h2 id="policies-title">Session upload policy</h2>
      <p>
        Applies to everyone in this organization. A setting you choose here is
        locked in Agent Relay Desktop and shows “Managed by your
        organization.”; a setting left as “Let each person choose” stays each
        person’s choice. Desktop applies the policy; uploads are not checked
        against it on the server yet.
      </p>
      {error && !policy && (
        <p role="alert">
          {message(error)}{" "}
          <button type="button" onClick={reload}>
            Try again
          </button>
        </p>
      )}
      {!policy && !error && <p role="status">Loading policy…</p>}
      {policy && (
        <PolicyForm
          // A new revision (saved, reloaded or reset) starts a fresh draft.
          key={policy.revision}
          policy={policy}
          readOnly={readOnly}
          onSave={save}
          onClear={clear}
          onEdit={() => setNotice((value) => (value?.kind === "status" ? null : value))}
        />
      )}
      {notice && <p role={notice.kind}>{notice.text}</p>}
    </section>
  );
}

function PolicyForm(props: {
  policy: CapturePolicy;
  readOnly: boolean;
  onSave: (settings: CaptureSettings, revision: number) => Promise<void>;
  onClear: (revision: number) => Promise<void>;
  onEdit: () => void;
}) {
  const { policy } = props;
  const [draft, setDraft] = useState(() => draftFrom(policy.settings));
  const [busy, setBusy] = useState(false);
  const [invalid, setInvalid] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const next = settingsFrom(draft, policy.settings);
  const dirty = typeof next === "string" || !same(next, policy.settings);
  const empty = Object.keys(policy.settings).length === 0;
  const disabled = busy || props.readOnly;

  function change(patch: Partial<Draft>) {
    setDraft((value) => ({ ...value, ...patch }));
    setInvalid(null);
    props.onEdit();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (typeof next === "string") {
      setInvalid(next);
      return;
    }
    setBusy(true);
    try {
      await props.onSave(next, policy.revision);
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    setBusy(true);
    try {
      await props.onClear(policy.revision);
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  const operatorUploads = draft.upload_control === "operator";
  const seconds = Number(draft.oops_seconds);

  return (
    <form
      noValidate
      onSubmit={(event) => void submit(event)}
      aria-label="Session upload policy"
    >
      <dl className="facts">
        <dt>Revision</dt>
        <dd data-testid="policy-revision">{policy.revision}</dd>
        <dt>Settings locked</dt>
        <dd>
          {empty
            ? "None: everything is each person’s choice"
            : `${Object.keys(policy.settings).filter((key) => KNOWN.has(key)).length} of 4`}
        </dd>
      </dl>
      {props.readOnly && (
        <p className="note" data-testid="policy-read-only">
          Read only: {NOT_ENTITLED}
        </p>
      )}

      <RadioGroup
        name="sharing_mode"
        legend="What gets uploaded"
        options={SHARING_MODE}
        value={draft.sharing_mode}
        disabled={disabled}
        onChange={(value) => change({ sharing_mode: value })}
      />
      <RadioGroup
        name="upload_control"
        legend="Who controls uploading"
        options={UPLOAD_CONTROL}
        value={draft.upload_control}
        disabled={disabled}
        onChange={(value) => change({ upload_control: value })}
      />

      <fieldset className="policy-group" disabled={disabled}>
        <legend>“Oops” window before upload</legend>
        <p className="policy-help">
          Only applies when the organization controls uploading: a session
          uploads once it has been quiet for the whole window, and until then
          people can choose Don’t upload. 15 minutes when not set.
        </p>
        <label className="policy-option">
          <input
            type="radio"
            name="oops_window_seconds"
            value={UNSET}
            checked={draft.oops_mode === "unset"}
            onChange={() => change({ oops_mode: "unset" })}
          />
          <span>
            <strong>Not set</strong>
            <span>
              15 minutes while the organization controls uploading; otherwise
              sessions upload as they are captured.
            </span>
          </span>
        </label>
        <label className="policy-option">
          <input
            type="radio"
            name="oops_window_seconds"
            value="set"
            checked={draft.oops_mode === "set"}
            onChange={() => change({ oops_mode: "set" })}
          />
          <span>
            <strong>Set a window</strong>
            <span>Whole seconds from 0 (upload at once) to 86,400 (24 hours).</span>
          </span>
        </label>
        {draft.oops_mode === "set" && (
          <label className="policy-seconds">
            Seconds
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={MAX_OOPS_WINDOW_SECONDS}
              step={1}
              value={draft.oops_seconds}
              aria-describedby="oops-window-summary"
              aria-invalid={invalid ? true : undefined}
              onChange={(event) => change({ oops_seconds: event.target.value })}
            />
            <span id="oops-window-summary" className="policy-help">
              {Number.isInteger(seconds) &&
              seconds >= 0 &&
              seconds <= MAX_OOPS_WINDOW_SECONDS &&
              draft.oops_seconds.trim() !== ""
                ? describeSeconds(seconds)
                : "Enter 0 to 86,400"}
              {!operatorUploads &&
                " · has no effect unless the organization controls uploading"}
            </span>
          </label>
        )}
      </fieldset>

      <RadioGroup
        name="user_retroactive_delete"
        legend="People may delete uploaded sessions"
        options={USER_DELETE}
        value={draft.user_retroactive_delete}
        disabled={disabled}
        onChange={(value) => change({ user_retroactive_delete: value })}
      />

      {invalid && <p role="alert">{invalid}</p>}
      <div className="row policy-actions">
        <button className="primary" type="submit" disabled={disabled || !dirty}>
          {busy ? "Saving…" : "Save policy"}
        </button>
        {dirty && !busy && (
          <button
            type="button"
            onClick={() => {
              setDraft(draftFrom(policy.settings));
              setInvalid(null);
            }}
          >
            Discard changes
          </button>
        )}
        {confirming ? (
          <>
            <button
              type="button"
              className="danger"
              disabled={disabled}
              onClick={() => void clear()}
            >
              Confirm reset
            </button>
            <button type="button" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={disabled || empty}
            onClick={() => setConfirming(true)}
          >
            Reset all to let people choose
          </button>
        )}
      </div>
      {confirming && (
        <p className="note">
          This unlocks every setting in Agent Relay Desktop for everyone in the
          organization. Each person’s earlier choice is given back.
        </p>
      )}
    </form>
  );
}

function RadioGroup(props: {
  name: string;
  legend: string;
  options: Option[];
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <fieldset className="policy-group" disabled={props.disabled}>
      <legend>{props.legend}</legend>
      {props.options.map((option) => (
        <label key={option.value} className="policy-option">
          <input
            type="radio"
            name={props.name}
            value={option.value}
            checked={props.value === option.value}
            onChange={() => props.onChange(option.value)}
          />
          <span>
            <strong>{option.label}</strong>
            <span>{option.detail}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}
