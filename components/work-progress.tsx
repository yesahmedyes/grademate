import { listStudents, listSubmissions } from "@/lib/classroom-cached";
import { ProgressBar } from "@/components/progress-bar";
import { Skeleton } from "@/components/skeleton";

/**
 * The "n/m turned in" bar on an assignment row. Split out of the class page so
 * one Classroom call per assignment streams in independently instead of the
 * whole list waiting on all of them.
 */
export async function WorkProgress({
  userId,
  courseId,
  workId,
  barClass,
}: {
  userId: string;
  courseId: string;
  workId: string;
  barClass: string;
}) {
  const [students, submissions] = await Promise.all([
    listStudents(userId, courseId),
    listSubmissions(userId, courseId, workId),
  ]);

  // Classroom keeps submission rows for students who left the course, so count
  // only submissions from students still on the roster. If the roster call
  // failed we get an empty list — fall back to raw counts instead of zeros.
  const known = new Set(students.map((s) => s.userId));
  const subs = known.size ? submissions.filter((s) => known.has(s.userId)) : submissions;

  if (subs.length === 0) return null;

  const turnedIn = subs.filter((s) => s.state === "TURNED_IN" || s.state === "RETURNED").length;
  // Submission rows, not roster size: coursework can be assigned to a subset of
  // the class, and Classroom creates a row for each assigned student.
  const total = subs.length;

  return (
    <div className="hidden w-56 shrink-0 md:block">
      <p className="mb-1 text-right text-[11px] text-faint">
        {turnedIn}/{total} turned in
      </p>
      <ProgressBar value={turnedIn} total={total} barClass={barClass} softClass="bg-panel" />
    </div>
  );
}

export function WorkProgressSkeleton() {
  return (
    <div className="hidden w-56 shrink-0 md:block">
      <Skeleton className="ml-auto h-3 w-24 rounded-md" />
      <Skeleton className="mt-1.5 h-2 w-full rounded-full" />
    </div>
  );
}
