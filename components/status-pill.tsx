import { cn } from "@/lib/utils";

const styles: Record<string, { label: string; cls: string }> = {
  TURNED_IN: { label: "Turned in", cls: "bg-leaf-soft text-[#4c7c53]" },
  RETURNED: { label: "Returned", cls: "bg-sky-soft text-[#3d6f96]" },
  CREATED: { label: "Assigned", cls: "bg-butter-soft text-[#9c7c1e]" },
  NEW: { label: "Not started", cls: "bg-panel text-faint" },
  RECLAIMED_BY_STUDENT: { label: "Unsubmitted", cls: "bg-coral-soft text-coral-deep" },
};

export function StatusPill({ state, late }: { state: string; late?: boolean }) {
  const s = styles[state] ?? { label: state, cls: "bg-panel text-faint" };
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap", s.cls)}>
        {s.label}
      </span>
      {late && (
        <span className="rounded-full bg-coral-soft px-2.5 py-1 text-xs font-medium text-coral-deep">
          Late
        </span>
      )}
    </span>
  );
}
