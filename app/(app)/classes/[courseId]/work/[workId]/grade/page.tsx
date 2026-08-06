import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { ChevronLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { gradingSessions } from "@/db/schema";
import { getCourse, getCourseWork, listStudents, listSubmissions } from "@/lib/classroom-cached";
import type { Course, CourseWork } from "@/lib/classroom";
import { isStaleOcr } from "@/lib/ocr-job";
import { GradeWizard, type WizardSession } from "@/components/wizard/wizard";
import type { ResultDTO, RosterEntry } from "@/components/wizard/grade-step";
import { Skeleton } from "@/components/skeleton";

export const dynamic = "force-dynamic";

/**
 * Owns everything slow on this page: the grading-session upsert, the relational
 * read, and the Classroom roster/submission counts. Behind Suspense so the
 * breadcrumb, title and stepper paint without waiting on any of it.
 */
async function GradeWizardLoader({
  userId,
  courseId,
  workId,
  course,
  work,
}: {
  userId: string;
  courseId: string;
  workId: string;
  course: Course;
  work: CourseWork;
}) {
  const materialDriveId = work.materials.find((m) => m.driveFileId)?.driveFileId ?? null;

  // Upsert on the (teacher, course, coursework) unique index. The COALESCE picks
  // up a Classroom file that appeared after the session was first created,
  // without the extra follow-up UPDATE this used to need.
  const [row] = await db
    .insert(gradingSessions)
    .values({
      teacherId: userId,
      courseId,
      courseName: course.name,
      courseWorkId: workId,
      courseWorkTitle: work.title,
      maxPoints: work.maxPoints ?? null,
      assignmentDriveId: materialDriveId,
      assignmentSource: materialDriveId ? "classroom" : "upload",
    })
    .onConflictDoUpdate({
      target: [gradingSessions.teacherId, gradingSessions.courseId, gradingSessions.courseWorkId],
      set: {
        courseName: course.name,
        courseWorkTitle: work.title,
        maxPoints: work.maxPoints ?? null,
        assignmentDriveId: sql`COALESCE(${gradingSessions.assignmentDriveId}, CASE WHEN ${gradingSessions.assignmentSource} = 'classroom' THEN ${materialDriveId} END)`,
      },
    })
    .returning({ id: gradingSessions.id });

  const [gs, students, submissions] = await Promise.all([
    db.query.gradingSessions.findFirst({
      where: eq(gradingSessions.id, row.id),
      with: { results: true, files: true },
    }),
    listStudents(userId, courseId),
    listSubmissions(userId, courseId, workId),
  ]);
  if (!gs) notFound();

  const assignmentFile = gs.files.find((f) => f.kind === "assignment") ?? null;
  const wizardSession: WizardSession = {
    id: gs.id,
    markingScheme: gs.markingScheme,
    assignmentSource: gs.assignmentSource,
    assignmentDriveId: gs.assignmentDriveId,
    maxPoints: gs.maxPoints,
    courseWorkTitle: gs.courseWorkTitle,
    assignmentFile: assignmentFile
      ? {
          id: assignmentFile.id,
          name: assignmentFile.originalName,
          // A `running` row whose process died never resolves — show it as failed
          // rather than spinning forever; grading falls back to page images anyway.
          ocrStatus: isStaleOcr(assignmentFile.ocrStatus, assignmentFile.createdAt)
            ? "error"
            : assignmentFile.ocrStatus,
          ocrPages: assignmentFile.ocrPages,
        }
      : null,
  };

  const initialResults: ResultDTO[] = gs.results.map((r) => {
    let perCriterion: ResultDTO["perCriterion"] = [];
    try {
      perCriterion = JSON.parse(r.perCriterion || "[]");
    } catch {}
    return {
      googleUserId: r.googleUserId,
      name: r.name,
      email: r.email,
      photoUrl: r.photoUrl,
      state: r.state,
      score: r.score,
      maxPoints: r.maxPoints,
      perCriterion,
      feedback: r.feedback,
      error: r.error,
    };
  });

  // One entry per submission row, matching the set the grade run will pick up.
  // Rows for students no longer on the roster are dropped; if the roster call
  // came back empty we keep every row rather than showing nothing.
  const byId = new Map(students.map((s) => [s.userId, s]));
  const roster: RosterEntry[] = (byId.size
    ? submissions.filter((s) => byId.has(s.userId))
    : submissions
  )
    .map((sub) => {
      const student = byId.get(sub.userId);
      return {
        googleUserId: sub.userId,
        name: student?.name ?? "Unknown student",
        email: student?.email ?? null,
        photoUrl: student?.photoUrl ?? null,
        state: sub.state,
        late: sub.late,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <GradeWizard
      courseName={course.name}
      session={wizardSession}
      initialResults={initialResults}
      roster={roster}
    />
  );
}

function WizardSkeleton() {
  return (
    <div className="pb-10">
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
  );
}

export default async function GradePage({
  params,
}: {
  params: Promise<{ courseId: string; workId: string }>;
}) {
  const { courseId, workId } = await params;
  const session = (await auth())!;
  const userId = session.user.id;

  const [course, work] = await Promise.all([
    getCourse(userId, courseId),
    getCourseWork(userId, courseId, workId),
  ]);
  if (!course || !work) notFound();

  return (
    <div>
      <Link
        href={`/classes/${courseId}/work/${workId}`}
        className="inline-flex items-center gap-1 text-xs font-medium text-faint hover:text-ink"
      >
        <ChevronLeft size={14} /> {work.title}
      </Link>
      <h1 className="mt-2 mb-8 text-[1.75rem] font-light tracking-tight">
        Grade <span className="font-semibold">All</span>
      </h1>
      <Suspense fallback={<WizardSkeleton />}>
        <GradeWizardLoader
          userId={userId}
          courseId={courseId}
          workId={workId}
          course={course}
          work={work}
        />
      </Suspense>
    </div>
  );
}
