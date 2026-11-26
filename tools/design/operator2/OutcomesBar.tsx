// "What came out of it": one bar split by result, with its legend below. Bar and legend are linked –
// pointing at a part of the bar highlights its legend entry, pointing at an entry highlights its part,
// and everything else fades back.
import { useState } from "react";
type Count = { id: string; label: string; n: number };

export function OutcomesBar({ counts }: { counts: Count[] }) {
  const [hot, setHot] = useState<string | null>(null);
  const dim = (id: string) => (hot !== null && hot !== id) || undefined;
  return (
    <div className="v2-outcomes" data-hot={hot ?? undefined} onMouseLeave={() => setHot(null)}>
      <span className="v2-outcomes__bar">
        {counts.map((c) =>
          c.n ? (
            <span
              key={c.id}
              data-outcome={c.id}
              data-dim={dim(c.id)}
              style={{ flexGrow: c.n }}
              aria-label={`${c.n} ${c.label}`}
              onMouseEnter={() => setHot(c.id)}
            />
          ) : null,
        )}
      </span>
      <ul className="v2-outcomes__legend">
        {counts.map((c) => (
          <li
            key={c.id}
            data-empty={c.n === 0 || undefined}
            data-dim={dim(c.id)}
            onMouseEnter={() => c.n > 0 && setHot(c.id)}
            onMouseLeave={() => setHot(null)}
          >
            <span className="v2-outcomes__swatch" data-outcome={c.id} />
            <b className="o2-num">{c.n}</b> {c.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
