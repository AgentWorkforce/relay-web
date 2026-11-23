// Who may read one session: view, change, reset and audit history. Self-host
// only. relaygate holds the policy and decides who is a session access
// administrator; Control resolves emails. The dashboard stores nothing and
// decides nothing: the checks below only save a round trip.
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { ShieldCheck } from "lucide-react";
import { SignedOut } from "../admin/api";
import { useProductCapabilities } from "../features/product-capabilities";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
} from "../shell/ui";
import { dateTime } from "./data";
import {
  accessProblem,
  PERMS,
  sessionAccessApi,
  type AccessChange,
  type AccessGroup,
  type AccessHistoryRow,
  type AccessPolicy,
  type AccessProblem,
  type AccessSnapshot,
  type Perm,
} from "./access-api";

type SessionAccessProps = {
  workspaceId: string;
  sessionId: string;
  onSignedOut?: () => void;
};

export function SessionAccess(props: SessionAccessProps) {
  const { status, capabilities } = useProductCapabilities();
  // Only a server capability admits this control; relaygate decides the rest.
  return status === "ready" && capabilities.session_access ? (
    <SessionAccessControl {...props} />
  ) : null;
}

// Control's rules (relaygate's SessionAccessPatch). Control's answer decides.
export const MAX_ACCESS_ENTRIES = 64;
export const MAX_REASON_LENGTH = 200;
const MAX_EMAIL_LENGTH = 320;
const MODE = /^[0246]{3}$/;
const LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9 ._-]{0,22}[A-Za-z0-9._-])?$/;
const GID = /^\d{1,10}$/;

const hasControlCharacter = (value: string) =>
  [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });

const NOT_ADMIN = "You are not a session access administrator.";
const UNAVAILABLE = "Session access is temporarily unavailable. Please try again.";
const OUTCOME_UNKNOWN =
  "The change may have been applied. This is the session access as it is now; check it before changing anything again.";

const notSaved = (problem: AccessProblem) =>
  `Your last change was not saved. ${problemText(problem)}`;

const PERM_LABEL: Record<Perm, string> = {
  r: "Read (r)",
  w: "Write (w)",
  rw: "Read and write (rw)",
};

const selectClass =
  "rounded-full border border-[var(--border-default)] bg-[var(--surface-soft)] px-3 py-1.5 text-xs text-foreground disabled:opacity-50";

type Step = "closed" | "loading" | "failed" | "view" | "edit" | "reset";

type History = {
  rows: AccessHistoryRow[];
  nextAfter: number | null;
  loading: boolean;
  error: string | null;
};

function SessionAccessControl({
  workspaceId,
  sessionId,
  onSignedOut,
}: SessionAccessProps) {
  const [hidden, setHidden] = useState(false);
  const [step, setStep] = useState<Step>("closed");
  const [policy, setPolicy] = useState<AccessPolicy | null>(null);
  const [problem, setProblem] = useState<AccessProblem | null>(null);
  const [writeProblem, setWriteProblem] = useState<AccessProblem | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<History | null>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const mounted = useRef(true);
  // A write is never sent twice: not on a double click, and not after the
  // dialog is closed and opened again while the first is unresolved.
  const inFlight = useRef(false);
  // Each opening is one generation; late answers from an earlier one are dropped.
  const generation = useRef(0);
  // Whether the dialog is open, for a write that settles after a reopening.
  const isOpen = useRef(false);
  // What a write that settled while the dialog was closed has to say; shown
  // on the next opening.
  const carried = useRef<string | null>(null);
  const reading = useRef<AbortController | null>(null);
  const historyReading = useRef<AbortController | null>(null);
  const descriptionId = useId();

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      reading.current?.abort();
      historyReading.current?.abort();
    };
  }, []);

  if (hidden) return null;

  const current = (opened: number) =>
    mounted.current && generation.current === opened;

  function close() {
    generation.current += 1;
    isOpen.current = false;
    reading.current?.abort();
    historyReading.current?.abort();
    setStep("closed");
    setProblem(null);
    setWriteProblem(null);
    setNotice(null);
    setHistory(null);
  }

  function signedOut() {
    close();
    onSignedOut?.();
  }

  function notConfigured() {
    close();
    setHidden(true);
  }

  async function load(note: string | null = null) {
    reading.current?.abort();
    const request = new AbortController();
    reading.current = request;
    const opened = generation.current;
    setStep("loading");
    setProblem(null);
    setWriteProblem(null);
    setNotice(note);
    try {
      const value = await sessionAccessApi.get(
        workspaceId,
        sessionId,
        request.signal,
      );
      if (request.signal.aborted || !current(opened)) return;
      setPolicy(value);
      setStep("view");
    } catch (error) {
      if (request.signal.aborted || !current(opened)) return;
      if (error instanceof SignedOut) return signedOut();
      const found = accessProblem(error, false);
      if (found.kind === "not_configured") return notConfigured();
      setProblem(found);
      setStep("failed");
    }
  }

  function open() {
    generation.current += 1;
    isOpen.current = true;
    setHistory(null);
    const note = carried.current;
    carried.current = null;
    void load(note);
  }

  async function write(
    send: () => Promise<AccessPolicy>,
    done: string,
  ): Promise<void> {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setWriteProblem(null);
    setNotice(null);
    const opened = generation.current;
    // True when this answer must not be shown as it is: the component is
    // gone, or the dialog was closed (and maybe opened again) while the write
    // was pending. A reopened dialog read the access before the write settled,
    // so it reads again now; a closed one reads on its next opening. Either
    // way a refusal or an unknown outcome is said beside that read.
    const reopened = (note: string | null) => {
      if (!mounted.current) return true;
      if (generation.current === opened) return false;
      if (isOpen.current) {
        setHistory(null);
        void load(note);
      } else {
        carried.current = note;
      }
      return true;
    };
    try {
      const value = await send();
      if (reopened(null)) return;
      setPolicy(value);
      setHistory(null);
      setNotice(done);
      setStep("view");
    } catch (error) {
      if (error instanceof SignedOut) {
        if (mounted.current) signedOut();
        return;
      }
      if (!mounted.current) return;
      const found = accessProblem(error, true);
      if (
        reopened(
          found.kind === "outcome_unknown" ? OUTCOME_UNKNOWN : notSaved(found),
        )
      ) {
        return;
      }
      if (found.kind === "not_configured") return notConfigured();
      if (found.kind === "outcome_unknown") {
        // Never resent: read the access again and show it as it is now.
        setHistory(null);
        void load(OUTCOME_UNKNOWN);
        return;
      }
      setWriteProblem(found);
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  function save(change: AccessChange) {
    void write(
      () => sessionAccessApi.set(workspaceId, sessionId, change),
      "Session access saved.",
    );
  }

  function reset(reason: string, expectedVersion: number) {
    void write(
      () =>
        sessionAccessApi.reset(workspaceId, sessionId, {
          reason,
          expectedVersion,
        }),
      "Session access reset to the installation defaults.",
    );
  }

  async function loadHistory(after: number | null) {
    historyReading.current?.abort();
    const request = new AbortController();
    historyReading.current = request;
    const opened = generation.current;
    setHistory((previous) => ({
      rows: after === null ? [] : (previous?.rows ?? []),
      nextAfter: after === null ? null : (previous?.nextAfter ?? null),
      loading: true,
      error: null,
    }));
    try {
      const page = await sessionAccessApi.history(
        workspaceId,
        sessionId,
        after,
        request.signal,
      );
      if (request.signal.aborted || !current(opened)) return;
      setHistory((previous) => ({
        rows: [...(after === null ? [] : (previous?.rows ?? [])), ...page.rows],
        nextAfter: page.nextAfter,
        loading: false,
        error: null,
      }));
    } catch (error) {
      if (request.signal.aborted || !current(opened)) return;
      if (error instanceof SignedOut) return signedOut();
      const found = accessProblem(error, false);
      if (found.kind === "not_configured") return notConfigured();
      setHistory((previous) => ({
        rows: previous?.rows ?? [],
        nextAfter: previous?.nextAfter ?? null,
        loading: false,
        error: problemText(found),
      }));
    }
  }

  return (
    <>
      <Button ref={opener} variant="ghost" size="sm" onClick={open}>
        <ShieldCheck aria-hidden="true" />
        Session access
      </Button>
      {step !== "closed" && (
        <AccessDialog
          onClose={close}
          opener={opener}
          busy={busy || step === "loading"}
          descriptionId={descriptionId}
        >
          <CardDescription id={descriptionId}>
            Who may read this session. Changes are versioned and kept in the
            access history.
          </CardDescription>
          {notice && (
            <p role="status" className="mt-3 text-sm text-muted-foreground">
              {notice}
            </p>
          )}
          {step === "loading" && (
            <p role="status" className="mt-3 text-sm text-muted-foreground">
              Loading session access…
            </p>
          )}
          {step === "failed" && problem && (
            <div className="mt-3 flex flex-col items-start gap-2">
              <p role="alert" className="text-sm">
                {problemText(problem)}
              </p>
              {problem.kind !== "not_admin" && problem.kind !== "not_found" && (
                <Button variant="outline" size="sm" onClick={() => void load()}>
                  Try again
                </Button>
              )}
            </div>
          )}
          {step === "view" && policy && (
            <>
              <PolicyView policy={policy} />
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    setNotice(null);
                    setWriteProblem(null);
                    setStep("edit");
                  }}
                >
                  Edit access
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    setNotice(null);
                    setWriteProblem(null);
                    setStep("reset");
                  }}
                >
                  Reset to defaults
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-expanded={history !== null}
                  onClick={() =>
                    history ? setHistory(null) : void loadHistory(null)
                  }
                >
                  {history ? "Hide history" : "Show history"}
                </Button>
              </div>
              {history && (
                <HistoryList
                  history={history}
                  onMore={() => void loadHistory(history.nextAfter)}
                />
              )}
            </>
          )}
          {step === "edit" && policy && (
            <AccessForm
              policy={policy}
              busy={busy}
              blocked={writeProblem?.kind === "conflict"}
              unknownEmails={
                writeProblem?.kind === "unknown_members"
                  ? writeProblem.emails
                  : []
              }
              onSave={save}
              onCancel={() => {
                setWriteProblem(null);
                setStep("view");
              }}
            >
              {writeProblem && (
                <WriteFeedback
                  problem={writeProblem}
                  onReload={() => void load()}
                />
              )}
            </AccessForm>
          )}
          {step === "reset" && policy && (
            <ResetForm
              busy={busy}
              blocked={writeProblem?.kind === "conflict"}
              onReset={(reason) => reset(reason, policy.version)}
              onCancel={() => {
                setWriteProblem(null);
                setStep("view");
              }}
            >
              {writeProblem && (
                <WriteFeedback
                  problem={writeProblem}
                  onReload={() => void load()}
                />
              )}
            </ResetForm>
          )}
        </AccessDialog>
      )}
    </>
  );
}

// The mode's middle digit is for the session's owning group, which the panel
// shows but cannot change.
const owningGroupText = (gid: number | null) =>
  gid === null ? "No owning group" : `Group ${gid}`;

function problemText(problem: AccessProblem): string {
  switch (problem.kind) {
    case "not_admin":
      return NOT_ADMIN;
    case "not_found":
    case "invalid":
    case "refused":
      return problem.message;
    case "conflict":
      return "Session access changed meanwhile.";
    case "unknown_members":
      return "Some emails are not current members of this organization.";
    case "outcome_unknown":
      return OUTCOME_UNKNOWN;
    case "not_configured":
    case "unavailable":
      return UNAVAILABLE;
  }
}

function WriteFeedback({
  problem,
  onReload,
}: {
  problem: AccessProblem;
  onReload: () => void;
}) {
  if (problem.kind === "conflict") {
    return (
      <div className="flex flex-col items-start gap-2">
        <p role="alert" className="text-sm">
          Session access changed meanwhile
          {problem.currentVersion !== null
            ? ` (it is now version ${problem.currentVersion})`
            : ""}
          , so nothing was saved. Your edits are still shown. Reload to see
          the current access; reloading discards these edits.
        </p>
        <Button variant="outline" size="sm" onClick={onReload}>
          Reload current access
        </Button>
      </div>
    );
  }
  if (problem.kind === "unknown_members") {
    return (
      <p role="alert" className="text-sm">
        Nothing was saved. These emails are not current members of this
        organization: {problem.emails.join(", ")}.
      </p>
    );
  }
  return (
    <p role="alert" className="text-sm">
      {problemText(problem)}
    </p>
  );
}

function PolicyView({ policy }: { policy: AccessPolicy }) {
  return (
    <div className="mt-4 flex flex-col gap-4 text-sm">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt className="text-muted-foreground">Mode</dt>
        <dd className="font-mono">{policy.mode}</dd>
        <dt className="text-muted-foreground">Owning group</dt>
        <dd>{owningGroupText(policy.gid)}</dd>
        <dt className="text-muted-foreground">Label</dt>
        <dd>{policy.label ?? "None"}</dd>
        <dt className="text-muted-foreground">Version</dt>
        <dd>{policy.version}</dd>
        <dt className="text-muted-foreground">Policy</dt>
        <dd>
          {policy.runtime
            ? "Set for this session"
            : "Installation defaults"}
        </dd>
        {policy.updatedAt && (
          <>
            <dt className="text-muted-foreground">Updated</dt>
            <dd>{dateTime(policy.updatedAt)}</dd>
          </>
        )}
      </dl>
      <section aria-label="Members">
        <h3 className="text-xs font-medium text-muted-foreground">Members</h3>
        {policy.members.length ? (
          <ul className="mt-1 flex flex-col gap-1">
            {policy.members.map((grant) => (
              <li key={grant.userId} className="flex flex-wrap gap-x-2">
                {grant.member ? (
                  <span>
                    {grant.email}
                    {grant.name ? ` (${grant.name})` : ""}
                  </span>
                ) : (
                  <span>
                    Former member{" "}
                    <span className="font-mono">{grant.userId}</span>
                  </span>
                )}
                <span className="text-muted-foreground">
                  {PERM_LABEL[grant.perm]}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-muted-foreground">No per-person entries.</p>
        )}
      </section>
      <section aria-label="Groups">
        <h3 className="text-xs font-medium text-muted-foreground">Groups</h3>
        {policy.groups.length ? (
          <ul className="mt-1 flex flex-col gap-1">
            {policy.groups.map((group) => (
              <li key={group.gid} className="flex flex-wrap gap-x-2">
                <span>Group {group.gid}</span>
                <span className="text-muted-foreground">
                  {PERM_LABEL[group.perm]}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-muted-foreground">No group entries.</p>
        )}
      </section>
    </div>
  );
}

type MemberRow = {
  key: string;
  /** Null for a former member: only the user id is known. */
  email: string | null;
  name: string | null;
  userId: string | null;
  perm: Perm;
};

const memberLabel = (row: MemberRow) =>
  row.email ?? `former member ${row.userId}`;

const membersKey = (rows: MemberRow[]) =>
  JSON.stringify(
    rows.map((row) => [
      row.email?.toLowerCase() ?? null,
      row.email === null ? row.userId : null,
      row.perm,
    ]),
  );

function rowsOf(policy: AccessPolicy): MemberRow[] {
  return policy.members.map((grant) =>
    grant.member
      ? {
          key: grant.userId,
          email: grant.email,
          name: grant.name,
          userId: grant.userId,
          perm: grant.perm,
        }
      : {
          key: grant.userId,
          email: null,
          name: null,
          userId: grant.userId,
          perm: grant.perm,
        },
  );
}

function reasonProblem(reason: string): string | null {
  const trimmed = reason.trim();
  return trimmed.length < 1 ||
    trimmed.length > MAX_REASON_LENGTH ||
    hasControlCharacter(trimmed)
    ? `Give a reason of 1 to ${MAX_REASON_LENGTH} characters.`
    : null;
}

function PermSelect({
  value,
  label,
  disabled,
  describedBy,
  invalid,
  onChange,
}: {
  value: Perm;
  label: string;
  disabled: boolean;
  describedBy?: string;
  invalid?: boolean;
  onChange: (perm: Perm) => void;
}) {
  return (
    <select
      aria-label={label}
      aria-describedby={describedBy}
      aria-invalid={invalid ? true : undefined}
      className={selectClass}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value as Perm)}
    >
      {PERMS.map((perm) => (
        <option key={perm} value={perm}>
          {PERM_LABEL[perm]}
        </option>
      ))}
    </select>
  );
}

function AccessForm({
  policy,
  busy,
  blocked,
  unknownEmails,
  onSave,
  onCancel,
  children,
}: {
  policy: AccessPolicy;
  busy: boolean;
  blocked: boolean;
  unknownEmails: string[];
  onSave: (change: AccessChange) => void;
  onCancel: () => void;
  children: ReactNode;
}) {
  const [mode, setMode] = useState(policy.mode);
  const [label, setLabel] = useState(policy.label ?? "");
  const [members, setMembers] = useState<MemberRow[]>(() => rowsOf(policy));
  const [groups, setGroups] = useState<AccessGroup[]>(policy.groups);
  const [reason, setReason] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newEmailPerm, setNewEmailPerm] = useState<Perm>("r");
  const [newGid, setNewGid] = useState("");
  const [newGidPerm, setNewGidPerm] = useState<Perm>("r");
  const [addProblem, setAddProblem] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const id = useId();
  const loadedMembers = useRef(membersKey(rowsOf(policy)));
  const unknown = new Set(unknownEmails.map((email) => email.toLowerCase()));

  function addMember() {
    const email = newEmail.trim();
    if (
      !email ||
      email.length > MAX_EMAIL_LENGTH ||
      hasControlCharacter(email)
    ) {
      setAddProblem("Enter the member's email.");
      return;
    }
    if (
      members.some((row) => row.email?.toLowerCase() === email.toLowerCase())
    ) {
      setAddProblem(`${email} is already in the list.`);
      return;
    }
    if (members.length >= MAX_ACCESS_ENTRIES) {
      setAddProblem(`At most ${MAX_ACCESS_ENTRIES} members.`);
      return;
    }
    setMembers((rows) => [
      ...rows,
      {
        key: `new:${email.toLowerCase()}`,
        email,
        name: null,
        userId: null,
        perm: newEmailPerm,
      },
    ]);
    setNewEmail("");
    setAddProblem(null);
  }

  function addGroup() {
    const gid = Number(newGid.trim());
    if (!GID.test(newGid.trim()) || !Number.isSafeInteger(gid)) {
      setAddProblem("A group id is a whole number from 0.");
      return;
    }
    if (groups.some((group) => group.gid === gid)) {
      setAddProblem(`Group ${gid} is already in the list.`);
      return;
    }
    if (groups.length >= MAX_ACCESS_ENTRIES) {
      setAddProblem(`At most ${MAX_ACCESS_ENTRIES} groups.`);
      return;
    }
    setGroups((rows) => [...rows, { gid, perm: newGidPerm }]);
    setNewGid("");
    setAddProblem(null);
  }

  // Enter in an add field adds the entry instead of saving the form.
  const addOnEnter =
    (add: () => void) => (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        add();
      }
    };

  function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || blocked) return;
    const found: string[] = [];
    if (!MODE.test(mode)) {
      found.push("Mode must be three digits, each 0, 2, 4 or 6.");
    }
    if (label !== "" && !LABEL.test(label)) {
      found.push(
        "Label must be empty, or 1 to 24 letters, digits, spaces, dots, underscores or hyphens, starting with a letter or digit and not ending with a space.",
      );
    }
    if (members.length > MAX_ACCESS_ENTRIES) {
      found.push(`At most ${MAX_ACCESS_ENTRIES} members.`);
    }
    if (groups.length > MAX_ACCESS_ENTRIES) {
      found.push(`At most ${MAX_ACCESS_ENTRIES} groups.`);
    }
    const reasonIssue = reasonProblem(reason);
    if (reasonIssue) found.push(reasonIssue);
    // Control names people by email, so a former member (user id only) can
    // be kept only by leaving the per-person list exactly as loaded.
    const membersChanged = membersKey(members) !== loadedMembers.current;
    const former = members.some((row) => row.email === null);
    if (former && membersChanged) {
      found.push(
        "Remove the former members before saving other changes to the members list: they can only be kept while the list is unchanged.",
      );
    }
    setProblems(found);
    if (found.length) return;
    onSave({
      mode,
      label: label === "" ? null : label,
      groups,
      ...(former
        ? {}
        : {
            members: members.map((row) => ({
              email: row.email!,
              perm: row.perm,
            })),
          }),
      reason: reason.trim(),
      expectedVersion: policy.version,
    });
  }

  const disabled = busy;
  return (
    <form noValidate className="mt-4 flex flex-col gap-4 text-sm" onSubmit={submit}>
      <p className="text-xs text-muted-foreground">
        The members and groups below are the full lists that will be saved:
        they replace the current lists, and anyone you remove loses this
        access.
      </p>
      <div className="flex flex-wrap gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-mode`}>Mode</label>
          <Input
            id={`${id}-mode`}
            className="w-24 font-mono"
            inputMode="numeric"
            maxLength={3}
            autoComplete="off"
            aria-describedby={`${id}-mode-help`}
            aria-invalid={MODE.test(mode) ? undefined : true}
            value={mode}
            disabled={disabled}
            onChange={(event) => setMode(event.target.value)}
          />
          <span id={`${id}-mode-help`} className="text-xs text-muted-foreground">
            Owner, owning group ({owningGroupText(policy.gid)}) and others;
            each 0, 2, 4 or 6. The owning group cannot be changed here.
          </span>
        </div>
        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor={`${id}-label`}>Label</label>
          <Input
            id={`${id}-label`}
            maxLength={24}
            autoComplete="off"
            aria-describedby={`${id}-label-help`}
            value={label}
            disabled={disabled}
            onChange={(event) => setLabel(event.target.value)}
          />
          <span id={`${id}-label-help`} className="text-xs text-muted-foreground">
            Optional. Up to 24 letters, digits, spaces, dots, underscores or
            hyphens.
          </span>
        </div>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="font-medium">Members</legend>
        {members.length === 0 && (
          <p className="text-muted-foreground">No per-person entries.</p>
        )}
        <ul className="flex flex-col gap-2">
          {members.map((row) => {
            const rejected =
              row.email !== null && unknown.has(row.email.toLowerCase());
            const noteId = `${id}-member-${row.key}`;
            return (
              <li key={row.key} className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 break-all">
                  {row.email === null ? (
                    <>
                      Former member{" "}
                      <span className="font-mono">{row.userId}</span>
                    </>
                  ) : (
                    <>
                      {row.email}
                      {row.name ? ` (${row.name})` : ""}
                    </>
                  )}
                  {rejected && (
                    <span
                      id={noteId}
                      className="block text-xs text-[var(--status-danger)]"
                    >
                      Not a current member of this organization
                    </span>
                  )}
                </span>
                <PermSelect
                  label={`Permission for ${memberLabel(row)}`}
                  value={row.perm}
                  disabled={disabled}
                  invalid={rejected}
                  describedBy={rejected ? noteId : undefined}
                  onChange={(perm) =>
                    setMembers((rows) =>
                      rows.map((item) =>
                        item.key === row.key ? { ...item, perm } : item,
                      ),
                    )
                  }
                />
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove ${memberLabel(row)}`}
                  disabled={disabled}
                  onClick={() =>
                    setMembers((rows) =>
                      rows.filter((item) => item.key !== row.key),
                    )
                  }
                >
                  Remove
                </Button>
              </li>
            );
          })}
        </ul>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-1 flex-col gap-1">
            Add member by email
            <Input
              type="email"
              autoComplete="off"
              value={newEmail}
              disabled={disabled}
              onChange={(event) => setNewEmail(event.target.value)}
              onKeyDown={addOnEnter(addMember)}
            />
          </label>
          <PermSelect
            label="Permission for the new member"
            value={newEmailPerm}
            disabled={disabled}
            onChange={setNewEmailPerm}
          />
          <Button variant="outline" size="sm" disabled={disabled} onClick={addMember}>
            Add member
          </Button>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="font-medium">Groups</legend>
        {groups.length === 0 && (
          <p className="text-muted-foreground">No group entries.</p>
        )}
        <ul className="flex flex-col gap-2">
          {groups.map((group) => (
            <li key={group.gid} className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1">Group {group.gid}</span>
              <PermSelect
                label={`Permission for group ${group.gid}`}
                value={group.perm}
                disabled={disabled}
                onChange={(perm) =>
                  setGroups((rows) =>
                    rows.map((item) =>
                      item.gid === group.gid ? { ...item, perm } : item,
                    ),
                  )
                }
              />
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Remove group ${group.gid}`}
                disabled={disabled}
                onClick={() =>
                  setGroups((rows) =>
                    rows.filter((item) => item.gid !== group.gid),
                  )
                }
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-1 flex-col gap-1">
            Add group by id
            <Input
              inputMode="numeric"
              autoComplete="off"
              value={newGid}
              disabled={disabled}
              onChange={(event) => setNewGid(event.target.value)}
              onKeyDown={addOnEnter(addGroup)}
            />
          </label>
          <PermSelect
            label="Permission for the new group"
            value={newGidPerm}
            disabled={disabled}
            onChange={setNewGidPerm}
          />
          <Button variant="outline" size="sm" disabled={disabled} onClick={addGroup}>
            Add group
          </Button>
        </div>
      </fieldset>
      {addProblem && <p role="alert">{addProblem}</p>}

      <ReasonField
        value={reason}
        disabled={disabled}
        onChange={setReason}
      />
      {problems.length > 0 && (
        <ul role="alert" className="list-disc pl-5">
          {problems.map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ul>
      )}
      {children}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={busy || blocked}>
          {busy ? "Saving…" : "Save access"}
        </Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {busy && (
        <p role="status" className="text-sm text-muted-foreground">
          Saving session access…
        </p>
      )}
    </form>
  );
}

function ReasonField({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={`${id}-reason`}>Reason (required)</label>
      <textarea
        id={`${id}-reason`}
        className="min-h-16 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
        rows={2}
        maxLength={MAX_REASON_LENGTH}
        aria-describedby={`${id}-reason-help`}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
      <span id={`${id}-reason-help`} className="text-xs text-muted-foreground">
        1 to {MAX_REASON_LENGTH} characters, kept in the access history. Do
        not include anything from the session itself.
      </span>
    </div>
  );
}

function ResetForm({
  busy,
  blocked,
  onReset,
  onCancel,
  children,
}: {
  busy: boolean;
  blocked: boolean;
  onReset: (reason: string) => void;
  onCancel: () => void;
  children: ReactNode;
}) {
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || blocked) return;
    const found = reasonProblem(reason);
    setProblem(found);
    if (!found) onReset(reason.trim());
  }
  return (
    <form noValidate className="mt-4 flex flex-col gap-4 text-sm" onSubmit={submit}>
      <p>
        Remove this session&apos;s own access settings so the installation&apos;s
        default policy applies again?
      </p>
      <ReasonField value={reason} disabled={busy} onChange={setReason} />
      {problem && <p role="alert">{problem}</p>}
      {children}
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          variant="destructive"
          size="sm"
          disabled={busy || blocked}
        >
          Yes, reset access
        </Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {busy && (
        <p role="status" className="text-sm text-muted-foreground">
          Resetting session access…
        </p>
      )}
    </form>
  );
}

function actorText(row: AccessHistoryRow): string {
  if (row.actor?.member) {
    return row.actor.name
      ? `${row.actor.email} (${row.actor.name})`
      : row.actor.email;
  }
  if (row.actor) return `Former member ${row.actor.userId}`;
  return row.actorName ?? "Unknown";
}

function snapshotText(snapshot: NonNullable<AccessSnapshot>): string {
  if (snapshot.reset) return "installation defaults";
  const members = snapshot.members.map((grant) =>
    grant.member
      ? `${grant.email} ${grant.perm}`
      : `former member ${grant.userId} ${grant.perm}`,
  );
  const groups = snapshot.groups.map(
    (group) => `group ${group.gid} ${group.perm}`,
  );
  return [
    `mode ${snapshot.mode ?? "unset"}`,
    `owning group ${snapshot.gid ?? "none"}`,
    `label ${snapshot.label ?? "none"}`,
    `members: ${members.join(", ") || "none"}`,
    `groups: ${groups.join(", ") || "none"}`,
  ].join("; ");
}

function HistoryList({
  history,
  onMore,
}: {
  history: History;
  onMore: () => void;
}) {
  return (
    <section aria-label="Access history" className="mt-4 text-sm">
      <h3 className="text-xs font-medium text-muted-foreground">
        Access history
      </h3>
      {history.rows.length > 0 && (
        <ol className="mt-2 flex flex-col gap-3">
          {history.rows.map((row) => (
            <li
              key={row.seq}
              className="flex flex-col gap-0.5 border-b border-border pb-2"
            >
              <span>
                <time dateTime={row.at}>{dateTime(row.at)}</time> ·{" "}
                {actorText(row)} · version {row.version}
              </span>
              <span>Reason: {row.reason ?? "none recorded"}</span>
              {row.before && (
                <span className="text-xs text-muted-foreground">
                  Before: {snapshotText(row.before)}
                </span>
              )}
              {row.after && (
                <span className="text-xs text-muted-foreground">
                  After: {snapshotText(row.after)}
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
      {!history.loading && !history.error && history.rows.length === 0 && (
        <p className="mt-2 text-muted-foreground">No changes recorded.</p>
      )}
      {history.loading && (
        <p role="status" className="mt-2 text-muted-foreground">
          Loading history…
        </p>
      )}
      {history.error && (
        <p role="alert" className="mt-2">
          {history.error}
        </p>
      )}
      {history.nextAfter !== null && !history.loading && (
        <Button variant="outline" size="sm" className="mt-2" onClick={onMore}>
          Load more history
        </Button>
      )}
    </section>
  );
}

// DeleteSession's portal, background isolation and focus behavior, for a
// dialog with form fields. There is no shared Dialog primitive here.
function AccessDialog({
  onClose,
  opener,
  busy,
  descriptionId,
  children,
}: {
  onClose: () => void;
  opener: RefObject<HTMLButtonElement | null>;
  busy: boolean;
  descriptionId: string;
  children: ReactNode;
}) {
  const overlay = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  const titleId = useId();
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const panel = dialog.current!;
    const trigger = opener.current;
    const closeButton = panel.querySelector<HTMLButtonElement>(
      "[data-close-access]",
    )!;
    const background = [...document.body.children]
      .filter(
        (element): element is HTMLElement =>
          element instanceof HTMLElement && element !== overlay.current,
      )
      .map((element) => ({
        element,
        hidden: element.getAttribute("aria-hidden"),
        inert: element.hasAttribute("inert"),
      }));
    for (const { element } of background) {
      element.setAttribute("aria-hidden", "true");
      element.setAttribute("inert", "");
    }
    closeButton.focus();
    function onFocus(event: FocusEvent) {
      if (!panel.contains(event.target as Node)) closeButton.focus();
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        close.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [
        ...panel.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ];
      if (!focusable.length) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !panel.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (active === last || !panel.contains(active))
      ) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("focusin", onFocus);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("focusin", onFocus);
      for (const { element, hidden, inert } of background) {
        if (hidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", hidden);
        if (!inert) element.removeAttribute("inert");
      }
      if (trigger?.isConnected) trigger.focus();
    };
  }, [opener]);
  return createPortal(
    <div
      ref={overlay}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <div
        className="absolute inset-0 bg-[var(--overlay)] backdrop-blur-sm"
        aria-hidden="true"
      />
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-busy={busy}
        className="relative max-h-full w-full max-w-2xl overflow-y-auto"
      >
        <Card>
          <CardHeader className="bg-[var(--surface-strong)]">
            <div className="flex items-start justify-between gap-3">
              <CardTitle id={titleId}>Session access</CardTitle>
              <Button
                variant="ghost"
                size="sm"
                data-close-access
                onClick={onClose}
              >
                Close
              </Button>
            </div>
          </CardHeader>
          <CardContent className="pt-4">{children}</CardContent>
        </Card>
      </div>
    </div>,
    document.body,
  );
}
