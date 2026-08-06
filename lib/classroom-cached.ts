import { cache } from "react";
import { unstable_cache } from "next/cache";
import { classroomFor, type Course, type CourseWork, type Student, type Submission } from "@/lib/classroom";

/**
 * Cached, read-only views of the Classroom API for page rendering.
 *
 * IMPORTANT: these are for *display* only. Anything that writes back to
 * Classroom or snapshots state it will act on — notably the grading run in
 * app/api/grade/[sessionId]/route.ts — must keep calling `classroomFor()`
 * directly, so it never grades against a stale roster.
 *
 * Two layers:
 *   unstable_cache — survives across requests for `revalidate` seconds.
 *   React cache()  — dedupes repeat calls inside a single render pass, so the
 *                    N Suspense boundaries on a page share one roster fetch.
 *
 * `userId` is always an explicit argument and always part of the cache key:
 * unstable_cache callbacks may not read request-scoped APIs (so no `auth()`
 * inside), and keying on the user is what keeps one teacher's roster out of
 * another's cache entry.
 */

export const classroomTag = (userId: string) => `classroom:${userId}`;

/** Seconds. Tuned to how often each resource actually changes. */
const TTL = {
  course: 300, // classes are near-static
  courseWork: 300, // assignments are posted rarely
  students: 120, // roster changes are rare
  submissions: 30, // volatile — students turn work in continuously
} as const;

export const getCourse = cache(
  (userId: string, courseId: string): Promise<Course | null> =>
    unstable_cache(
      () => classroomFor(userId).getCourse(courseId),
      ["classroom", "course", userId, courseId],
      { revalidate: TTL.course, tags: [classroomTag(userId)] }
    )()
);

export const listCourses = cache(
  (userId: string): Promise<Course[]> =>
    unstable_cache(() => classroomFor(userId).listCourses(), ["classroom", "courses", userId], {
      revalidate: TTL.course,
      tags: [classroomTag(userId)],
    })()
);

export const getCourseWork = cache(
  (userId: string, courseId: string, workId: string): Promise<CourseWork | null> =>
    unstable_cache(
      () => classroomFor(userId).getCourseWork(courseId, workId),
      ["classroom", "courseWork", userId, courseId, workId],
      { revalidate: TTL.courseWork, tags: [classroomTag(userId)] }
    )()
);

export const listCourseWork = cache(
  (userId: string, courseId: string): Promise<CourseWork[]> =>
    unstable_cache(
      () => classroomFor(userId).listCourseWork(courseId),
      ["classroom", "courseWorkList", userId, courseId],
      { revalidate: TTL.courseWork, tags: [classroomTag(userId)] }
    )()
);

/** Never throws — a failed roster call degrades to an empty list, matching the pages' existing `.catch(() => [])`. */
export const listStudents = cache(
  (userId: string, courseId: string): Promise<Student[]> =>
    unstable_cache(
      () => classroomFor(userId).listStudents(courseId).catch(() => [] as Student[]),
      ["classroom", "students", userId, courseId],
      { revalidate: TTL.students, tags: [classroomTag(userId)] }
    )()
);

/** Never throws — see listStudents. */
export const listSubmissions = cache(
  (userId: string, courseId: string, workId: string): Promise<Submission[]> =>
    unstable_cache(
      () => classroomFor(userId).listSubmissions(courseId, workId).catch(() => [] as Submission[]),
      ["classroom", "submissions", userId, courseId, workId],
      { revalidate: TTL.submissions, tags: [classroomTag(userId)] }
    )()
);
