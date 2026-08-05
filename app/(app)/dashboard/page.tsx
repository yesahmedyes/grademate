import { auth } from "@/lib/auth";
import { classroomFor, type Student } from "@/lib/classroom";
import { ClassCard } from "@/components/class-card";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = (await auth())!;
  const api = classroomFor(session.user.id);

  let error: string | null = null;
  let courses: Awaited<ReturnType<typeof api.listCourses>> = [];
  try {
    courses = await api.listCourses();
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  const rosters = await Promise.allSettled(courses.map((c) => api.listStudents(c.id)));
  const studentsFor = (i: number): Student[] =>
    rosters[i]?.status === "fulfilled" ? (rosters[i] as PromiseFulfilledResult<Student[]>).value : [];

  const first = (session.user.name ?? "there").split(" ")[0];

  return (
    <div>
      <p className="text-sm text-faint">Hello, {first} 👋</p>
      <h1 className="mt-1 text-[1.75rem] font-light tracking-tight">
        Your <span className="font-semibold">Classes</span>
      </h1>

      {error ? (
        <div className="mt-8 max-w-lg rounded-card border border-coral/30 bg-coral-soft p-6 text-sm">
          <p className="font-semibold text-coral-deep">Couldn&apos;t load your classes</p>
          <p className="mt-1 text-ink/70">{error}</p>
          <p className="mt-3 text-ink/70">
            Your Google access may have expired (test-mode tokens last 7 days).{" "}
            <a href="/login" className="font-medium text-coral-deep underline">
              Sign in again
            </a>
          </p>
        </div>
      ) : courses.length === 0 ? (
        <div className="mt-8 max-w-lg rounded-card border border-ink/8 bg-panel p-8 text-center text-sm text-faint">
          No active classes found where you&apos;re a teacher. Create one in Google Classroom and
          refresh.
        </div>
      ) : (
        <div className="mt-7 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {courses.map((c, i) => (
            <ClassCard key={c.id} course={c} students={studentsFor(i)} />
          ))}
        </div>
      )}
    </div>
  );
}
