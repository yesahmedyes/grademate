import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  HelpCircle,
  Layers,
} from "lucide-react";
import { auth } from "@/lib/auth";
import { getCourse, listCourseWork } from "@/lib/classroom-cached";
import { LinkPending } from "@/components/link-pending";
import { WorkProgress, WorkProgressSkeleton } from "@/components/work-progress";
import { ACCENTS, cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const GRADEABLE = new Set([
  "ASSIGNMENT",
  "SHORT_ANSWER_QUESTION",
  "MULTIPLE_CHOICE_QUESTION",
]);

function workIcon(type: string) {
  if (type === "ASSIGNMENT") return FileText;
  if (type === "COURSEWORK_MATERIAL") return Layers;
  return HelpCircle;
}

export default async function ClassPage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const { courseId } = await params;
  const session = (await auth())!;
  const userId = session.user.id;

  // Only what the header and notFound() need — the per-assignment submission
  // counts stream in via WorkProgress below.
  const [course, works] = await Promise.all([
    getCourse(userId, courseId),
    listCourseWork(userId, courseId),
  ]);
  if (!course) notFound();

  const [name0, ...nameRest] = course.name.split(" ");

  return (
    <div>
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-1 text-xs font-medium text-faint hover:text-ink"
      >
        <ChevronLeft size={14} /> Your classes
      </Link>
      <h1 className="mt-2 text-[1.75rem] font-light tracking-tight">
        {name0} <span className="font-semibold">{nameRest.join(" ")}</span>
      </h1>
      {course.section && (
        <p className="mt-1 text-sm text-faint">{course.section}</p>
      )}

      <h2 className="mt-9 text-lg font-light">Assignments &amp; Quizzes</h2>

      {works.length === 0 ? (
        <div className="mt-5 max-w-lg rounded-card border border-ink/8 bg-panel p-8 text-center text-sm text-faint">
          Nothing posted in this class yet.
        </div>
      ) : (
        <div className="mt-5 flex flex-col gap-3">
          {works.map((w, i) => {
            const Icon = workIcon(w.workType);
            const accent = ACCENTS[i % ACCENTS.length];
            const clickable = GRADEABLE.has(w.workType);

            const inner = (
              <div
                className={cn(
                  "flex items-center gap-5 rounded-card border border-ink/8 bg-white px-5 py-4",
                  clickable &&
                    "transition-all group-hover:border-ink/15 group-hover:shadow-card",
                )}
              >
                <span
                  className={cn(
                    "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl",
                    accent.soft,
                  )}
                >
                  <Icon size={20} strokeWidth={1.8} className={accent.text} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{w.title}</p>
                  <p className="mt-0.5 text-xs text-faint">
                    {w.workType === "COURSEWORK_MATERIAL"
                      ? "Material"
                      : `${w.maxPoints ?? "—"} pts`}
                    {w.dueDate && ` · due ${w.dueDate}`}
                  </p>
                </div>
                {clickable && (
                  <Suspense fallback={<WorkProgressSkeleton />}>
                    <WorkProgress
                      userId={userId}
                      courseId={courseId}
                      workId={w.id}
                      barClass={accent.bg}
                    />
                  </Suspense>
                )}
                {clickable && (
                  <span className="shrink-0 text-ink/30 group-hover:text-ink/60">
                    <LinkPending size={18}>
                      <ChevronRight size={18} />
                    </LinkPending>
                  </span>
                )}
              </div>
            );

            return clickable ? (
              <Link
                key={w.id}
                href={`/classes/${courseId}/work/${w.id}`}
                className="group"
              >
                {inner}
              </Link>
            ) : (
              <div key={w.id}>{inner}</div>
            );
          })}
        </div>
      )}
    </div>
  );
}
