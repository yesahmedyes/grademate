import { cn } from "@/lib/utils";

export function ProgressBar({
  value,
  total,
  barClass,
  softClass,
  className,
}: {
  value: number;
  total: number;
  barClass: string;
  softClass: string;
  className?: string;
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div className={cn("h-2.5 flex-1 overflow-hidden rounded-full", softClass)}>
        <div
          className={cn("h-full rounded-full transition-[width]", barClass)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-11 text-right text-xs font-semibold text-ink/70">{pct}%</span>
    </div>
  );
}
