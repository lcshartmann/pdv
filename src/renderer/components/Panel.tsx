import type { ReactNode } from "react";

interface PanelProps {
  title: string;
  children: ReactNode;
}

export default function Panel({ title, children }: PanelProps): JSX.Element {
  return (
    <section className="rounded-xl border border-[#2a2d35] bg-[#22262f] p-4">
      <h2 className="mb-3 text-base font-medium">{title}</h2>
      {children}
    </section>
  );
}
