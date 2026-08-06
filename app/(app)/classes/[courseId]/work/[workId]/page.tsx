import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { getCourse, getCourseWork, listStudents, listSubmissions } from "@/lib/classroom-cached";
import type { CourseWork } from "@/lib/classroom";
import { Avatar } from "@/components/avatar";
import { SubmissionsView } from "@/components/submissions-view";
import { AvatarStackSkeleton, Skeleton } from "@/components/skeleton";

export const dynamic = "force-dynamic";

/**
 * The header pill and the table sit in different places in the layout, so they
 * get their own Suspense boundaries. Both read the same two cached calls —
 * React cache() in lib/classroom-cached.ts dedupes them into one fetch each.
 */
async function load(userId: string, courseId: string, workId: string) {
  const [students, submissions] = await Promise.all([
    listStudents(userId, courseId),
    listSubmissions(userId, courseId, workId),
  ]);
  // Only show submissions from identifiable students (roster is filtered to name + email).
  const known = new Set(students.map((s) => s.userId));
  return { students, visibleSubs: submissions.filter((s) => known.has(s.userId)) };
}

async function SubmissionsStats({
  userId,
  courseId,
  workId,
}: {
  userId: string;
  courseId: string;
  workId: string;
}) {
  const { students, visibleSubs } = await load(userId, courseId, workId);
  const turnedIn = visibleSubs.filter((s) => s.state === "TURNED_IN" || s.state === "RETURNED");
  const stacked = students.slice(0, 5);

  return (
    <div className="flex items-center gap-4">
      <span className="flex items-center -space-x-2">
        {stacked.map((s) => (
          <Avatar key={s.userId} name={s.name} src={s.photoUrl} size={30} />
        ))}
        {students.length > stacked.length && (
          <span className="z-10 flex h-[30px] w-[30px] items-center justify-center rounded-full bg-butter text-[10px] font-semibold text-navy ring-2 ring-white">
            +{students.length - stacked.length}
          </span>
        )}
      </span>
      <span className="rounded-full bg-leaf-soft px-3.5 py-1.5 text-xs font-semibold text-[#4c7c53]">
        {turnedIn.length}/{visibleSubs.length} turned in
      </span>
    </div>
  );
}

async function SubmissionsTable({
  userId,
  courseId,
  work,
}: {
  userId: string;
  courseId: string;
  work: CourseWork;
}) {
  const { students, visibleSubs } = await load(userId, courseId, work.id);
  return (
    <SubmissionsView
      courseId={courseId}
      work={work}
      students={students}
      submissions={visibleSubs}
    />
  );
}

function StatsSkeleton() {
  return (
    <div className="flex items-center gap-4">
      <AvatarStackSkeleton count={5} size={30} />
      <Skeleton className="h-7 w-28 rounded-full" />
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="overflow-hidden rounded-card border border-ink/8 bg-white">
      <div className="border-b border-ink/8 bg-panel/60 px-5 py-3">
        <Skeleton className="h-3 w-24 rounded-md" />
      </div>
      {Array.from({ length: 8 }, (_, i) => (
        <div
          key={i}
          className="flex items-center gap-5 border-b border-ink/5 px-5 py-3.5 last:border-0"
        >
          <Skeleton className="h-[34px] w-[34px] shrink-0 rounded-full" />
          <div className="min-w-0 flex-1">
            <Skeleton className="h-4 w-40 rounded-md" />
            <Skeleton className="mt-1.5 h-3 w-52 rounded-md" />
          </div>
          <Skeleton className="h-6 w-24 shrink-0 rounded-full" />
          <Skeleton className="hidden h-4 w-32 shrink-0 rounded-md md:block" />
        </div>
      ))}
    </div>
  );
}

export default async function WorkPage({
  params,
}: {
  params: Promise<{ courseId: string; workId: string }>;
}) {
  const { courseId, workId } = await params;
  const session = (await auth())!;
  const userId = session.user.id;

  // Two single-resource calls — enough for the header and notFound(). Everything
  // that needs the roster or submissions streams in below.
  const [course, work] = await Promise.all([
    getCourse(userId, courseId),
    getCourseWork(userId, courseId, workId),
  ]);
  if (!course || !work) notFound();

  return (
    <div className="pb-20">
      <Link
        href={`/classes/${courseId}`}
        className="inline-flex items-center gap-1 text-xs font-medium text-faint hover:text-ink"
      >
        <ChevronLeft size={14} /> {course.name}
      </Link>

      <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[1.75rem] font-light tracking-tight">
            Student <span className="font-semibold">Submissions</span>
          </h1>
          <p className="mt-1 text-sm text-faint">
            {work.title}
            {work.maxPoints != null && ` · ${work.maxPoints} pts`}
            {work.dueDate && ` · due ${work.dueDate}`}
          </p>
        </div>
        <Suspense fallback={<StatsSkeleton />}>
          <SubmissionsStats userId={userId} courseId={courseId} workId={workId} />
        </Suspense>
      </div>

      <div className="mt-6">
        <Suspense fallback={<TableSkeleton />}>
          <SubmissionsTable userId={userId} courseId={courseId} work={work} />
        </Suspense>
      </div>
    </div>
  );
}
