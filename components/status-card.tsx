interface StatusCardProps {
  label: string;
  hint?: string;
  tone: "blue" | "emerald" | "rose" | "slate" | "violet";
  value: number | string;
}

const tones = {
  blue: "text-[#174ea6]",
  emerald: "text-emerald-700",
  rose: "text-rose-700",
  slate: "text-slate-800",
  violet: "text-violet-700",
} as const;

export function StatusCard({ hint, label, tone, value }: StatusCardProps) {
  return (
    <div className="min-w-0 border-l border-slate-200 px-4 py-1 first:border-l-0">
      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <p className={`mt-1 text-xl font-semibold tracking-tight tabular-nums ${tones[tone]}`}>{value}</p>
      {hint ? <p className="mt-1 truncate text-[11px] text-slate-500">{hint}</p> : null}
    </div>
  );
}
