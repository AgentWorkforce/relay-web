// A page's title and one line under it – the same on every v2 page, sized like the reference
// (a calm 18px title, a 13px muted line). The line says what the page is for and the period's numbers;
// it never depends on how many items there are.
import type { ReactNode } from "react";

export function PageHead({ title, sub }: { title: string; sub: ReactNode }) {
  return (
    <header className="v2-head">
      <h2 className="v2-head__title">{title}</h2>
      <p className="v2-head__sub">{sub}</p>
    </header>
  );
}
