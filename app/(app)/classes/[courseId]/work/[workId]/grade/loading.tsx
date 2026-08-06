import { PageHeadSkeleton, Skeleton } from "@/components/skeleton";

/** Mirrors grade/page.tsx: breadcrumb, title, 3-step stepper, tall wizard card. */
export default function GradeLoading() {
  return (
    <div>
      <PageHeadSkeleton titleWidth="w-44" />

      <div className="mt-8 pb-10">
        <div className="mx-auto flex max-w-xl items-center">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className={i > 0 ? "flex flex-1 items-center" : "flex items-center"}>
              {i > 0 && <Skeleton className="mx-3 h-1 flex-1 rounded-full" />}
              <div className="flex flex-col items-center gap-1.5">
                <Skeleton className="h-9 w-9 rounded-full" />
                <Skeleton className="h-3 w-16 rounded-md" />
              </div>
            </div>
          ))}
        </div>

        <div className="mt-8 rounded-card border border-ink/8 bg-white p-6">
          <Skeleton className="h-5 w-40 rounded-md" />
          <Skeleton className="mt-2 h-3 w-72 rounded-md" />
          <Skeleton className="mt-4 h-[30rem] w-full rounded-card" />
        </div>
      </div>
    </div>
  );
}
