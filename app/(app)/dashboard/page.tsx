import { Suspense } from "react";
import { auth } from "@/lib/auth";
import { listCourses } from "@/lib/classroom-cached";
import { ClassCard } from "@/components/class-card";
import { ClassRoster } from "@/components/class-roster";
import { AvatarStackSkeleton } from "@/components/skeleton";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = (await auth())!;
  const userId = session.user.id;

  let error: string | null = null;
  let courses: Awaited<ReturnType<typeof listCourses>> = [];
  try {
    courses = await listCourses(userId);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

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
          {/* Cards paint as soon as the course list lands; the per-class roster
              calls stream into their own boundaries instead of blocking the grid. */}
          {courses.map((c) => (
            <ClassCard
              key={c.id}
              course={c}
              roster={
                <Suspense fallback={<AvatarStackSkeleton />}>
                  <ClassRoster userId={userId} courseId={c.id} />
                </Suspense>
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
