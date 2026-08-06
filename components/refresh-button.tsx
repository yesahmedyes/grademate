"use client";

import { useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Busts the Classroom cache for this teacher. The action revalidates the tag;
 * the transition keeps the spinner up until the re-rendered page has streamed in.
 */
export function RefreshButton({ action }: { action: () => Promise<void> }) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      onClick={() => startTransition(async () => void (await action()))}
      disabled={pending}
      title="Refresh from Google Classroom"
      aria-label="Refresh from Google Classroom"
      className="flex h-9 w-9 items-center justify-center rounded-full text-ink/50 transition-colors hover:bg-panel hover:text-ink disabled:cursor-default"
    >
      <RefreshCw size={16} className={cn(pending && "animate-spin text-coral")} />
    </button>
  );
}
