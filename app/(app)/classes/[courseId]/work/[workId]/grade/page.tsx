import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { gradingSessions } from "@/db/schema";
import { classroomFor } from "@/lib/classroom";
import { isStaleOcr } from "@/lib/ocr-job";
import { GradeWizard, type WizardSession } from "@/components/wizard/wizard";
import type { ResultDTO } from "@/components/wizard/grade-step";

export const dynamic = "force-dynamic";

export default async function GradePage({
  params,
}: {
  params: Promise<{ courseId: string; workId: string }>;
}) {
  const { courseId, workId } = await params;
  const session = (await auth())!;
  const api = classroomFor(session.user.id);

  const [courses, works, submissions] = await Promise.all([
    api.listCourses(),
    api.listCourseWork(courseId),
    api.listSubmissions(courseId, workId).catch(() => []),
  ]);
  const course = courses.find((c) => c.id === courseId);
  const work = works.find((w) => w.id === workId);
  if (!course || !work) notFound();

  const materialDriveId = work.materials.find((m) => m.driveFileId)?.driveFileId ?? null;

  // Upsert on the (teacher, course, coursework) unique index, then read back with relations.
  await db
    .insert(gradingSessions)
    .values({
      teacherId: session.user.id,
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
      },
    });

  let gs = (await db.query.gradingSessions.findFirst({
    where: and(
      eq(gradingSessions.teacherId, session.user.id),
      eq(gradingSessions.courseId, courseId),
      eq(gradingSessions.courseWorkId, workId)
    ),
    with: { results: true, files: true },
  }))!;

  // a Classroom file appeared since the session was created
  if (!gs.assignmentDriveId && materialDriveId && gs.assignmentSource === "classroom") {
    await db
      .update(gradingSessions)
      .set({ assignmentDriveId: materialDriveId })
      .where(eq(gradingSessions.id, gs.id));
    gs = { ...gs, assignmentDriveId: materialDriveId };
  }

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

  const subCounts: Record<string, number> = {};
  for (const s of submissions) subCounts[s.state] = (subCounts[s.state] ?? 0) + 1;

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
      <GradeWizard
        courseId={courseId}
        workId={workId}
        courseName={course.name}
        session={wizardSession}
        initialResults={initialResults}
        subCounts={subCounts}
      />
    </div>
  );
}
