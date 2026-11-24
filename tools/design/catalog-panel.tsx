import { ArrowUpRight, Check, Copy, Download } from "lucide-react";
import { Button } from "../../src/shell/ui";
import { catalog } from "./catalog";
import type { ScenarioId } from "./scenarios";

export function CatalogPanel({
  scenario,
  entryId,
  copy,
  onSelect,
  onCopy: copyText,
  onDownload: download,
}: {
  scenario: ScenarioId;
  entryId: string;
  copy: string;
  onSelect: (id: string) => void;
  onCopy: (text: string) => Promise<void>;
  onDownload: (value: unknown, name: string, raw?: boolean) => void;
}) {
  const entry = catalog.find((item) => item.id === entryId)!;
  const sample = entry.example(scenario);
  const json = entry.rawExport?.text ?? JSON.stringify(sample, null, 2);
  return (
    <section className="design-catalog" aria-label="Data catalog">
      <nav aria-label="Data domains">
        {catalog.map((item) => (
          <button
            key={item.id}
            aria-current={entry.id === item.id ? "page" : undefined}
            onClick={() => onSelect(item.id)}
          >
            <span>{item.title}</span>
            <small>{item.availability}</small>
          </button>
        ))}
      </nav>
      <article>
        <div className="design-inline design-between">
          <span
            className={`design-pill design-availability-${entry.availability.toLowerCase()}`}
          >
            {entry.availability}
          </span>
          {entry.source && (
            <a href={entry.source} target="_blank" rel="noreferrer">
              Source contract <ArrowUpRight size={13} />
            </a>
          )}
        </div>
        <h2>{entry.title}</h2>
        <p>{entry.description}</p>
        <dl className="design-contract">
          <dt>Owner</dt>
          <dd>{entry.owner}</dd>
          <dt>Endpoint</dt>
          <dd>
            <code>{entry.endpoint}</code>
          </dd>
          <dt>Coverage</dt>
          <dd>
            {entry.availability === "Proposed"
              ? "Design proposal only. No server contract or deployed capability is asserted."
              : "Source contract inspected 23 Nov 2026. Deployed availability is unverified."}
          </dd>
        </dl>
        <div className="design-notice">
          <strong>Design with this limit</strong>
          <p>{entry.limitation}</p>
        </div>
        <h3>Fields that matter</h3>
        <dl className="design-fields">
          {entry.fields.map((field) => (
            <div key={field.name}>
              <dt>
                <code>{field.name}</code>
              </dt>
              <dd>{field.meaning}</dd>
            </div>
          ))}
        </dl>
        <div className="design-inline design-between">
          <h3>Synthetic example</h3>
          <div className="design-inline">
            <Button variant="ghost" size="sm" onClick={() => copyText(json)}>
              {copy === "Copied" ? <Check size={14} /> : <Copy size={14} />}{" "}
              Copy JSON
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                entry.rawExport
                  ? download(entry.rawExport.text, entry.rawExport.name, true)
                  : download(sample, `relay-${scenario}-${entry.id}.json`)
              }
            >
              <Download size={14} /> JSON
            </Button>
          </div>
        </div>
        <pre tabIndex={0} aria-label="JSON response">
          {json}
        </pre>
      </article>
    </section>
  );
}
