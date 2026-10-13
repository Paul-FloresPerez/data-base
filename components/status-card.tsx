interface StatusCardProps {
  label: string;
  hint?: string;
  tone: "blue" | "emerald" | "rose" | "slate" | "violet";
  value: number | string;
}

const tones = {
  blue: "bg-blue-50 text-blue-700 ring-blue-100",
  emerald: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  rose: "bg-rose-50 text-rose-700 ring-rose-100",
  slate: "bg-slate-100 text-slate-700 ring-slate-200",
  violet: "bg-violet-50 text-violet-700 ring-violet-100",
} as const;

export function StatusCard({ hint, label, tone, value }: StatusCardProps) {
  return (
    <div className="min-w-0 rounded-xl border border-slate-200 bg-white px-4 py-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-2 inline-flex rounded-md px-2 py-0.5 text-2xl font-semibold tracking-tight ring-1 ${tones[tone]}`}>
        {value}
      </p>
      {hint ? <p className="mt-2 truncate text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}
