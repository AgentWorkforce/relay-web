import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Compass,
  GitBranch,
  Loader2,
  Plus,
  ScanSearch,
  ShieldCheck,
  Users,
} from "lucide-react";
import { getAccount, SignedOut } from "../api/client";
import { adminApi, SignedOut as AdminSignedOut } from "../admin/api";
import { loginHref, redirectBrowser } from "../app-path";
import { Badge, Button, ButtonLink, Input, PageSurface } from "../shell/ui";
import { WorkspaceViewSlot } from "../shell/view-slots";
import {
  chiefApi,
  type ChiefList,
  type ProjectChief,
  type SetupInput,
  type GithubRepository,
} from "./api";
import { RepositoryPicker } from "./repository-picker";
import s from "./chief.module.css";

const actions = [
  {
    id: "investigate",
    label: "Investigate follow-ups",
    description: "Route actionable findings to an execution agent.",
  },
  {
    id: "coordinate",
    label: "Coordinate overlapping work",
    description: "Resolve duplicate assignments and conflicting ownership.",
  },
  {
    id: "unblock",
    label: "Unblock existing work",
    description:
      "Ask an execution agent to investigate blockers and failed checks.",
  },
];
const statusLabels: Record<string, string> = {
  ready: "Active",
  preparing: "Setting up",
  awaiting_approval: "Awaiting approval",
  failed: "Needs attention",
  interrupted: "Interrupted",
  reserved: "Assigned",
  sending: "Sending",
  uncertain: "Delivery unconfirmed",
  delivered: "Delivered",
  accepted: "Accepted",
  running: "In progress",
  awaiting_verification: "Verifying",
  needs_attention: "Needs attention",
  completed: "Verified complete",
  canceled: "Canceled",
};
const reasonLabels: Record<string, string> = {
  gates_passed: "Policy checks passed — assignment created",
  objective_already_assigned:
    "Duplicate objective — existing assignment retained",
  resource_claimed: "Overlapping resource — work deferred",
  budget_exhausted: "Budget allocation reached",
  capacity_exhausted: "Execution capacity reached",
  no_eligible_worker: "Waiting for an eligible execution agent",
  stale_evidence: "Evidence is out of date",
  classification_uncertain: "Finding needs inspection",
};
const dollars = (micros: number) =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
  }).format(micros / 1_000_000);

export function ChiefPage({ path }: { path: string }) {
  const [workspace, setWorkspace] = useState<string | null>(null);
  const [manage, setManage] = useState(false);
  const [data, setData] = useState<ChiefList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [version, setVersion] = useState(0);
  const selected = path.split("/")[2] ?? "";
  useEffect(() => {
    document.querySelector("main")?.scrollTo?.(0, 0);
  }, [path]);
  useEffect(() => {
    const abort = new AbortController();
    Promise.all([getAccount(abort.signal), adminApi.context(abort.signal)])
      .then(([account, context]) => {
        if (abort.signal.aborted) return;
        setWorkspace(account.currentWorkspace?.id ?? null);
        setManage(
          ["owner", "admin"].includes(context.currentOrganization.role),
        );
        if (!account.currentWorkspace)
          setError("Choose a workspace to set up a chief.");
      })
      .catch((failure) => {
        if (abort.signal.aborted) return;
        if (failure instanceof SignedOut || failure instanceof AdminSignedOut)
          redirectBrowser(loginHref());
        else setError("Could not load your workspace. Please try again.");
      });
    return () => abort.abort();
  }, []);
  useEffect(() => {
    if (!workspace) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const value = await chiefApi.list(workspace, abort.signal);
        if (!abort.signal.aborted) {
          setData(value);
          setError(null);
        }
      } catch (failure) {
        if (!abort.signal.aborted) {
          if (failure instanceof SignedOut) redirectBrowser(loginHref());
          else
            setError(
              failure instanceof Error
                ? failure.message
                : "Could not load your chiefs.",
            );
        }
      } finally {
        if (!abort.signal.aborted) timer = setTimeout(poll, 1000);
      }
    };
    void poll();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [workspace, version]);
  const chief = data?.chiefs.find((value) => value.id === selected);
  return (
    <PageSurface>
      <WorkspaceViewSlot name="heading">
        <div>
          <h1 className={s.shellTitle}>Chief</h1>
          <p className={s.muted}>Project coordination, with clear ownership.</p>
        </div>
      </WorkspaceViewSlot>
      <div className={s.page}>
        {error && (
          <p role="alert" className={s.error}>
            {error}
          </p>
        )}
        {data?.mode === "local" && (
          <div className={s.notice}>
            <ShieldCheck size={18} aria-hidden="true" />
            <div>
              <strong>Local validation environment</strong>
              <p>
                Setup runs on this workspace. GitHub selection uses a local App
                fixture. Scans use an isolated test project and execution
                worker. No EC2 instances or customer repositories are changed.
              </p>
            </div>
          </div>
        )}
        {!data && !error && (
          <p role="status" className={s.loading}>
            <Loader2 size={18} className={s.spin} /> Loading project chiefs…
          </p>
        )}
        {data && selected === "new" && workspace && (
          <SetupForm
            mode={data.mode}
            workspace={workspace}
            manage={manage}
            onCreate={async (input) => {
              const created = await chiefApi.create(workspace, input);
              setData((current) =>
                current
                  ? {
                      ...current,
                      chiefs: [
                        created,
                        ...current.chiefs.filter((c) => c.id !== created.id),
                      ],
                    }
                  : current,
              );
              window.location.hash = `/chief/${created.id}`;
            }}
          />
        )}
        {data && !selected && (
          <>
            <div className={s.heading}>
              <div>
                <p className={s.eyebrow}>RELAY CHIEF</p>
                <h2>A coordinator for every project.</h2>
                <p className={s.muted}>
                  Spot blockers, avoid duplicate work, and route the next step
                  through Relay.
                </p>
              </div>
              <ButtonLink
                href="#/chief/new"
                aria-disabled={!manage}
                className={!manage ? s.disabledLink : undefined}
              >
                <Plus size={16} /> Set up a chief
              </ButtonLink>
            </div>
            {!data.chiefs.length ? (
              <div className={s.empty}>
                <Compass size={38} strokeWidth={1.3} />
                <h3>Keep the work moving.</h3>
                <p>
                  Your chief watches project activity and coordinates your
                  execution agents.
                  <br />
                  You set the scope, policy, and budget.
                </p>
                <ButtonLink
                  href="#/chief/new"
                  aria-disabled={!manage}
                  className={!manage ? s.disabledLink : undefined}
                >
                  Set up your first chief <ArrowRight size={16} />
                </ButtonLink>
              </div>
            ) : (
              <div className={s.chiefGrid}>
                {data.chiefs.map((value) => (
                  <a
                    href={`#/chief/${value.id}`}
                    className={s.chiefCard}
                    key={value.id}
                  >
                    <div className={s.cardHeading}>
                      <Compass size={22} />
                      <Badge
                        variant={
                          value.status === "ready" ? "success" : "warning"
                        }
                      >
                        {statusLabels[value.status] ?? value.status}
                      </Badge>
                    </div>
                    <h3>{value.name}</h3>
                    <p className={s.repository}>
                      <GitBranch size={14} />{" "}
                      {(value.repositories ?? [value.repository]).join(", ")}
                    </p>
                    <div className={s.cardFooter}>
                      <span>{value.tasks.length} assignments</span>
                      <span>
                        Open chief <ArrowRight size={14} />
                      </span>
                    </div>
                  </a>
                ))}
              </div>
            )}
          </>
        )}
        {chief && workspace && (
          <ChiefDetail
            chief={chief}
            manage={manage}
            pending={pending}
            onScan={async () => {
              setPending(true);
              setError(null);
              try {
                await chiefApi.scan(workspace, chief.id);
                setVersion((v) => v + 1);
              } catch (failure) {
                setError(
                  failure instanceof Error
                    ? failure.message
                    : "Could not scan sessions.",
                );
              } finally {
                setPending(false);
              }
            }}
          />
        )}
        {data && selected && selected !== "new" && !chief && (
          <p role="alert">
            This chief is not available in this workspace.{" "}
            <a href="#/chief">Return to your chiefs</a>.
          </p>
        )}
      </div>
    </PageSurface>
  );
}

function SetupForm({
  mode,
  workspace,
  manage,
  onCreate,
}: {
  mode: ChiefList["mode"];
  workspace: string;
  manage: boolean;
  onCreate(input: SetupInput): Promise<void>;
}) {
  const [step, setStep] = useState(0);
  const [repositories, setRepositories] = useState<GithubRepository[]>([]);
  const [repositoriesReady, setRepositoriesReady] = useState(false);
  const [budget, setBudget] = useState(10);
  const [capacity, setCapacity] = useState(2);
  const [allowed, setAllowed] = useState(actions.map((a) => a.id));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(crypto.randomUUID());
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (step === 0 && (!repositoriesReady || !repositories.length)) return;
    if (step < 2) {
      setStep(step + 1);
      return;
    }
    setPending(true);
    setError(null);
    try {
      await onCreate({
        requestId: requestId.current,
        repositoryIds: repositories.map((repo) => repo.id),
        region: "us-east-1",
        budgetDollars: budget,
        maxConcurrentTasks: capacity,
        allowedActions: allowed,
      });
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Setup failed. Please try again.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <a className={s.back} href="#/chief">
        <ArrowLeft size={14} /> Your chiefs
      </a>
      <div className={s.setupHeading}>
        <p className={s.eyebrow}>SET UP RELAY CHIEF</p>
        <h2>Give your project a coordinator.</h2>
        <p className={s.muted}>
          Choose its scope. Set its boundaries. Keep the work in view.
        </p>
      </div>
      <ol className={s.steps} aria-label="Setup progress">
        {["Project", "Operating policy", "Review"].map((label, i) => (
          <li
            key={label}
            aria-current={step === i ? "step" : undefined}
            data-active={step >= i}
          >
            <span>{step > i ? <Check size={14} /> : i + 1}</span>
            {label}
          </li>
        ))}
      </ol>
      <form className={s.form} onSubmit={submit}>
        {step === 0 && (
          <>
            <h3>Where should your chief focus?</h3>
            <p className={s.muted}>
              Choose one or more repositories. Your chief coordinates work
              across this project.
            </p>
            <RepositoryPicker
              workspace={workspace}
              disabled={!manage}
              selected={repositories}
              onChange={setRepositories}
              onReady={setRepositoriesReady}
            />
          </>
        )}
        {step === 1 && (
          <>
            <h3>Set the operating boundaries.</h3>
            <p className={s.muted}>
              The chief coordinates through Relay. Execution agents do the
              implementation.
            </p>
            <fieldset>
              <legend>Allowed coordination</legend>
              {actions.map((action) => (
                <label className={s.checkLabel} key={action.id}>
                  <input
                    type="checkbox"
                    checked={allowed.includes(action.id)}
                    onChange={(event) =>
                      setAllowed((current) =>
                        event.target.checked
                          ? [...current, action.id]
                          : current.filter((id) => id !== action.id),
                      )
                    }
                  />
                  <span>
                    <strong>{action.label}</strong>
                    <small>{action.description}</small>
                  </span>
                </label>
              ))}
            </fieldset>
            <div className={s.fieldGrid}>
              <label>
                Task budget allocation (USD)
                <Input
                  type="number"
                  min={1}
                  max={10000}
                  step={1}
                  required
                  value={budget}
                  onChange={(event) => setBudget(Number(event.target.value))}
                />
                <small>
                  Admission uses $1 reservations per assignment. Provider spend
                  is reported separately.
                </small>
              </label>
              <label>
                Concurrent assignments
                <Input
                  type="number"
                  min={1}
                  max={10}
                  step={1}
                  required
                  value={capacity}
                  onChange={(event) => setCapacity(Number(event.target.value))}
                />
              </label>
            </div>
            <div className={s.rule}>
              <ShieldCheck size={18} />
              <p>
                Deployments, IAM, and secret changes retain their human approval
                gates.
              </p>
            </div>
          </>
        )}
        {step === 2 && (
          <>
            <h3>Review your chief.</h3>
            <p className={s.muted}>
              {mode === "local"
                ? "This creates a local coordinator so you can validate the complete flow."
                : "This saves a provisioning request. Cloud infrastructure must be approved before it runs."}
            </p>
            <dl className={s.review}>
              <div>
                <dt>Repositories</dt>
                <dd>
                  {repositories.map((repo) => (
                    <div key={repo.id}>{repo.fullName}</div>
                  ))}
                </dd>
              </div>
              <div>
                <dt>Budget allocation</dt>
                <dd>{dollars(budget * 1_000_000)}</dd>
              </div>
              <div>
                <dt>Concurrency</dt>
                <dd>{capacity} assignments</dd>
              </div>
              <div>
                <dt>Allowed coordination</dt>
                <dd>
                  {actions
                    .filter((a) => allowed.includes(a.id))
                    .map((a) => a.label)
                    .join(", ")}
                </dd>
              </div>
            </dl>
            <div className={s.rule}>
              <Users size={18} />
              <p>
                Your chief routes work to execution agents through Relay and
                independently verifies their results.
              </p>
            </div>
          </>
        )}
        {error && (
          <p role="alert" className={s.error}>
            {error}
          </p>
        )}
        <div className={s.formFooter}>
          {step > 0 ? (
            <Button
              variant="ghost"
              disabled={pending}
              onClick={() => setStep(step - 1)}
            >
              <ArrowLeft size={14} /> Back
            </Button>
          ) : (
            <span />
          )}
          <Button
            type="submit"
            disabled={
              !manage ||
              pending ||
              (step === 0 && (!repositoriesReady || !repositories.length)) ||
              (step === 1 && !allowed.length)
            }
          >
            {pending ? (
              <>
                <Loader2 size={15} className={s.spin} /> Creating…
              </>
            ) : step === 2 ? (
              <>
                Create chief <ArrowRight size={15} />
              </>
            ) : (
              <>
                Continue <ArrowRight size={15} />
              </>
            )}
          </Button>
        </div>
      </form>
    </>
  );
}

function ChiefDetail({
  chief,
  manage,
  pending,
  onScan,
}: {
  chief: ProjectChief;
  manage: boolean;
  pending: boolean;
  onScan(): Promise<void>;
}) {
  const scanning = chief.scanStatus === "running";
  return (
    <>
      <a className={s.back} href="#/chief">
        <ArrowLeft size={14} /> Your chiefs
      </a>
      <div className={s.heading}>
        <div>
          <div className={s.titleRow}>
            <h2>{chief.name}</h2>
            <Badge variant={chief.status === "ready" ? "success" : "warning"}>
              {statusLabels[chief.status] ?? chief.status}
            </Badge>
          </div>
          <p className={s.repository}>
            <GitBranch size={14} />{" "}
            {(chief.repositories ?? [chief.repository]).join(", ")}
          </p>
        </div>
        <Button
          onClick={() => void onScan()}
          disabled={!manage || pending || scanning || chief.status !== "ready"}
        >
          {scanning ? (
            <Loader2 size={16} className={s.spin} />
          ) : (
            <ScanSearch size={16} />
          )}
          {scanning ? "Scanning sessions…" : "Scan sessions"}
        </Button>
      </div>
      <section className={s.readiness} aria-label="Setup readiness">
        {chief.setupSteps.map((step) => (
          <div key={step.label}>
            {step.complete ? (
              <CheckCircle2 size={17} />
            ) : (
              <span className={s.circle} />
            )}
            <span>{step.label}</span>
          </div>
        ))}
      </section>
      {(chief.scanStatus === "failed" ||
        chief.scanStatus === "interrupted") && (
        <p role="alert" className={s.error}>
          The last scan did not finish. Existing assignments are retained. You
          can scan again to reconcile their reports.
        </p>
      )}
      <div className={s.metrics}>
        <div>
          <span>Execution assignments</span>
          <strong>{chief.tasks.length}</strong>
          <small>Limit {chief.maxConcurrentTasks} concurrent</small>
        </div>
        <div>
          <span>Verified outcomes</span>
          <strong>{chief.tasks.filter((task) => task.verified).length}</strong>
          <small>Independently checked</small>
        </div>
        <div>
          <span>Committed reservations</span>
          <strong>
            {dollars(chief.accounting.committedReservationMicros)}
          </strong>
          <small>
            Of {dollars(chief.budgetDollars * 1_000_000)} allocation
          </small>
        </div>
        <div>
          <span>Measured provider spend</span>
          <strong>
            {chief.accounting.events
              ? dollars(chief.accounting.knownCostMicros)
              : "—"}
          </strong>
          <small>
            {chief.accounting.events
              ? `${chief.accounting.unknownCostEvents} unpriced usage events`
              : "No billing data reported"}
          </small>
        </div>
      </div>
      <section className={s.section}>
        <div className={s.sectionHeading}>
          <h3>Assignments</h3>
          <span>Delegated through Relay</span>
        </div>
        {!chief.tasks.length ? (
          <div className={s.quiet}>
            <Compass size={23} />
            <p>
              No assignments yet. Scan sessions to find the next coordination
              step.
            </p>
          </div>
        ) : (
          chief.tasks.map((task) => (
            <article className={s.task} key={task.id}>
              <div>
                <Badge variant={task.verified ? "success" : "info"}>
                  {statusLabels[task.status] ?? task.status}
                </Badge>
                <h4>{task.title}</h4>
                <p>
                  {actions.find((a) => a.id === task.action)?.label} ·{" "}
                  {task.worker}
                </p>
                {task.verified && (
                  <p className={s.verified}>
                    <CheckCircle2 size={14} /> Execution result independently
                    verified
                  </p>
                )}
              </div>
              <details>
                <summary>Task receipt and checks</summary>
                <p className={s.code}>{task.id}</p>
                {task.checks.map((check) => (
                  <p className={s.code} key={check}>
                    {check}
                  </p>
                ))}
              </details>
            </article>
          ))
        )}
      </section>
      <section className={s.section}>
        <div className={s.sectionHeading}>
          <h3>Coordination decisions</h3>
          <span>
            {chief.lastScanAt
              ? `Last scan ${new Date(chief.lastScanAt).toLocaleTimeString()}`
              : "No scans yet"}
          </span>
        </div>
        {!chief.decisions.length ? (
          <p className={s.quiet}>
            Policy and ownership decisions will appear here.
          </p>
        ) : (
          chief.decisions.map((decision, i) => (
            <div className={s.decision} key={`${decision.evidenceDigest}-${i}`}>
              <ShieldCheck size={16} />
              <div>
                <strong>
                  {reasonLabels[decision.reason] ??
                    decision.reason.replaceAll("_", " ")}
                </strong>
                <p>
                  {decision.kind.replaceAll("_", " ")} · {decision.outcome}
                </p>
              </div>
              <Badge
                variant={
                  decision.outcome === "reserved" ? "success" : "default"
                }
              >
                {decision.outcome}
              </Badge>
            </div>
          ))
        )}
      </section>
    </>
  );
}
