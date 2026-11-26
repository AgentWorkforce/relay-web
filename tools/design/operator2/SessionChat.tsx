// Session page, layout v2: the session as the chat it was – only the messages and the answers, the way a
// chat app shows them. The person's messages sit right in a filled bubble with what they attached above
// it; the agent's answers are plain text on the left, and what the agent did before answering is one
// folded line ("Read 3 files, edited 2 files, ran 1 command ›"). No names, times, costs or lines between
// messages – where you are is in the header's breadcrumbs, the facts about the session on the task page.
import { Fragment, useState, type ReactNode } from "react";
import { ChevronRight, FileText, FilePen, ImageIcon, Search, SquareTerminal, TextQuote } from "lucide-react";
import type { Overview, SessionItem } from "../operator/model";
import { HARNESS_LABELS } from "../operator/WeekPanel";
import { actionOf, artifactOf } from "./outcomes";
import { transcriptOf, type Attachment, type Step } from "./transcripts";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "Read 3 files, edited 2 files, ran 1 command" – what the agent did, in one line */
function summaryOf(steps: Step[], extra?: string) {
  const n = (k: Step["kind"]) => steps.filter((x) => x.kind === k).length;
  const parts = [
    n("read") && `read ${plural(n("read"), "file", "files")}`,
    n("search") && `searched ${plural(n("search"), "time", "times")}`,
    n("edit") && `edited ${plural(n("edit"), "file", "files")}`,
    n("run") && `ran ${plural(n("run"), "command", "commands")}`,
    extra,
  ].filter(Boolean) as string[];
  const line = parts.join(", ");
  return line.charAt(0).toUpperCase() + line.slice(1);
}

function StepRow({ step }: { step: Step }) {
  if (step.kind === "run")
    return (
      <li className="v2c-step v2c-step--run">
        <div className="v2-code">
          <div className="v2-code__head">
            <SquareTerminal size={14} aria-hidden="true" /> {step.command}
          </div>
          <pre className="v2-code__body">{step.output}</pre>
        </div>
      </li>
    );
  const [Icon, verb] = step.kind === "read" ? [FileText, "Read"] : step.kind === "search" ? [Search, "Searched for"] : [FilePen, "Edited"];
  return (
    <li className="v2c-step">
      <Icon size={14} aria-hidden="true" />
      <span>
        {verb} <code>{step.target}</code>
      </span>
      {step.kind === "edit" && (
        <span className="v2c-step__diff o2-num">
          <span data-sign="+">+{step.added}</span> <span data-sign="-">−{step.removed}</span>
        </span>
      )}
    </li>
  );
}

/** What the agent did before answering, folded into one muted line until opened */
function Activity({ steps, extra }: { steps: Step[]; extra?: string }) {
  const [open, setOpen] = useState(false);
  if (!steps.length && !extra) return null;
  return (
    <div className="v2c-activity" data-open={open || undefined}>
      <button type="button" data-slot="v2c-activity" className="v2c-activity__toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {summaryOf(steps, extra)}
        <ChevronRight size={14} aria-hidden="true" className="v2c-activity__chev" />
      </button>
      {open && (
        <ol className="v2c-steps">
          {steps.map((step, i) => (
            <StepRow key={i} step={step} />
          ))}
        </ol>
      )}
    </div>
  );
}

function AttachmentView({ a }: { a: Attachment }) {
  if (a.kind === "image")
    return (
      <figure className="v2c-image">
        <span className="v2c-image__preview" aria-hidden="true">
          <ImageIcon size={20} />
        </span>
        <figcaption>{a.name}</figcaption>
      </figure>
    );
  return (
    <span className="v2c-file">
      <span className="v2c-file__icon" aria-hidden="true">
        {a.kind === "file" ? <FileText size={16} /> : <TextQuote size={16} />}
      </span>
      <span className="v2c-file__main">
        <b>{a.kind === "file" ? a.name : "Pasted text"}</b>
        <span>{a.kind === "file" ? a.size : `${a.lines} lines`}</span>
      </span>
    </span>
  );
}

/** Inline `code` in a line of text */
function inline(text: string): ReactNode {
  return text.split(/(`[^`]+`)/).map((part, i) => (part.startsWith("`") && part.endsWith("`") ? <code key={i}>{part.slice(1, -1)}</code> : <Fragment key={i}>{part}</Fragment>));
}

/** The agent's text: paragraphs, and lists where lines start with "- " */
function Prose({ text }: { text: string }) {
  return (
    <div className="v2c-text">
      {text.split("\n\n").map((block, i) => {
        const lines = block.split("\n");
        const items = lines.filter((l) => l.startsWith("- "));
        const lead = lines.filter((l) => !l.startsWith("- "));
        return (
          <Fragment key={i}>
            {lead.length > 0 && <p>{inline(lead.join(" "))}</p>}
            {items.length > 0 && (
              <ul>
                {items.map((l, k) => (
                  <li key={k}>{inline(l.slice(2))}</li>
                ))}
              </ul>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}

export function SessionChat({ data, id }: { data: Overview; id: string }) {
  const s: SessionItem | undefined = data.initiatives.flatMap((i) => i.sessions).find((x) => x.id === id);
  if (!s)
    return (
      <div className="o2-empty">
        <h2>This session isn't in the current period</h2>
      </div>
    );
  const agent = HARNESS_LABELS[s.source] ?? s.source;
  const turns = transcriptOf(s);
  const lastAgent = turns.map((t) => t.role).lastIndexOf("agent");
  const pr = artifactOf(s);
  return (
    <article className="v2c" aria-label={s.title}>
      <ol className="v2c-thread">
        {turns.map((t, i) =>
          t.role === "user" ? (
            <li key={i} className="v2c-msg v2c-msg--user">
              {t.attachments && t.attachments.length > 0 && (
                <div className="v2c-attachments">
                  {t.attachments.map((a, k) => (
                    <AttachmentView key={k} a={a} />
                  ))}
                </div>
              )}
              {t.text && <div className="v2c-bubble">{t.text}</div>}
            </li>
          ) : (
            <li key={i} className="v2c-msg v2c-msg--agent">
              <Activity steps={t.steps ?? []} extra={i === lastAgent && pr ? actionOf(pr, s) : undefined} />
              <Prose text={t.text} />
            </li>
          ),
        )}
        {s.status === "active" && (
          <li className="v2c-working" aria-live="polite">
            {agent} is working…
          </li>
        )}
      </ol>
    </article>
  );
}
