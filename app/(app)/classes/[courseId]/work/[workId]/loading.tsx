import { AvatarStackSkeleton, PageHeadSkeleton, Skeleton } from "@/components/skeleton";

/** Mirrors work/[workId]/page.tsx + the SubmissionsView table. */
export default function WorkLoading() {
  return (
    <div className="pb-20">
      <PageHeadSkeleton titleWidth="w-80" />

      <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
        <Skeleton className="h-4 w-56 rounded-md" />
        <div className="flex items-center gap-4">
          <AvatarStackSkeleton count={5} size={30} />
          <Skeleton className="h-7 w-28 rounded-full" />
        </div>
      </div>

      <div className="mt-6 overflow-hidden rounded-card border border-ink/8 bg-white">
        <div className="border-b border-ink/8 bg-panel/60 px-5 py-3">
          <Skeleton className="h-3 w-24 rounded-md" />
        </div>
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="flex items-center gap-5 border-b border-ink/5 px-5 py-3.5 last:border-0">
            <Skeleton className="h-[34px] w-[34px] shrink-0 rounded-full" />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-4 w-40 rounded-md" />
              <Skeleton className="mt-1.5 h-3 w-52 rounded-md" />
            </div>
            <Skeleton className="h-6 w-24 shrink-0 rounded-full" />
            <Skeleton className="hidden h-4 w-32 shrink-0 rounded-md md:block" />
            <Skeleton className="hidden h-4 w-14 shrink-0 rounded-md sm:block" />
          </div>
        ))}
      </div>
    </div>
  );
}
