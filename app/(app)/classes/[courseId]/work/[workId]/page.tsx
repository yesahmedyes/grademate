import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { classroomFor } from "@/lib/classroom";
import { Avatar } from "@/components/avatar";
import { SubmissionsView } from "@/components/submissions-view";

export const dynamic = "force-dynamic";

export default async function WorkPage({
  params,
}: {
  params: Promise<{ courseId: string; workId: string }>;
}) {
  const { courseId, workId } = await params;
  const session = (await auth())!;
  const api = classroomFor(session.user.id);

  const [courses, works, students, submissions] = await Promise.all([
    api.listCourses(),
    api.listCourseWork(courseId),
    api.listStudents(courseId).catch(() => []),
    api.listSubmissions(courseId, workId).catch(() => []),
  ]);
  const course = courses.find((c) => c.id === courseId);
  const work = works.find((w) => w.id === workId);
  if (!course || !work) notFound();

  // Only show submissions from identifiable students (roster is filtered to name + email).
  const known = new Set(students.map((s) => s.userId));
  const visibleSubs = submissions.filter((s) => known.has(s.userId));

  const turnedIn = visibleSubs.filter((s) => s.state === "TURNED_IN" || s.state === "RETURNED");
  const stacked = students.slice(0, 5);

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
      </div>

      <div className="mt-6">
        <SubmissionsView
          courseId={courseId}
          work={work}
          students={students}
          submissions={visibleSubs}
        />
      </div>
    </div>
  );
}
