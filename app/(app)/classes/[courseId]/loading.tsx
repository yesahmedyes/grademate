import { PageHeadSkeleton, Skeleton } from "@/components/skeleton";

/** Mirrors the assignment rows in classes/[courseId]/page.tsx. */
export default function ClassLoading() {
  return (
    <div>
      <PageHeadSkeleton titleWidth="w-72" />
      <Skeleton className="mt-2 h-4 w-40 rounded-md" />

      <Skeleton className="mt-9 h-6 w-56 rounded-md" />

      <div className="mt-5 flex flex-col gap-3">
        {Array.from({ length: 5 }, (_, i) => (
          <div
            key={i}
            className="flex items-center gap-5 rounded-card border border-ink/8 bg-white px-5 py-4"
          >
            <Skeleton className="h-11 w-11 shrink-0 rounded-2xl" />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-4 w-1/2 rounded-md" />
              <Skeleton className="mt-2 h-3 w-28 rounded-md" />
            </div>
            <div className="hidden w-56 shrink-0 md:block">
              <Skeleton className="ml-auto h-3 w-24 rounded-md" />
              <Skeleton className="mt-1.5 h-2 w-full rounded-full" />
            </div>
            <Skeleton className="h-4 w-4 shrink-0 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
