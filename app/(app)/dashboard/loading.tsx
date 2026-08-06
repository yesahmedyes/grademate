import { AvatarStackSkeleton, Skeleton } from "@/components/skeleton";

/** Mirrors dashboard/page.tsx + components/class-card.tsx geometry so nothing shifts on swap. */
export default function DashboardLoading() {
  return (
    <div>
      <Skeleton className="h-4 w-32 rounded-full" />
      <Skeleton className="mt-2 h-8 w-52 rounded-xl" />

      <div className="mt-7 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex flex-col rounded-card border border-ink/8 bg-white p-6">
            <Skeleton className="h-12 w-12 rounded-2xl" />
            <Skeleton className="mt-5 h-5 w-3/4 rounded-md" />
            <Skeleton className="mt-2 h-3 w-1/3 rounded-md" />
            <div className="mt-5 flex items-center justify-between">
              <AvatarStackSkeleton />
              <Skeleton className="h-8 w-8 rounded-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
