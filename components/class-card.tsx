import Link from "next/link";
import { ArrowRight, BookOpen } from "lucide-react";
import type { Course } from "@/lib/classroom";
import { LinkPending } from "@/components/link-pending";
import { accentFor, cn } from "@/lib/utils";

/**
 * Presentational only. The roster is passed in as a node so the caller can wrap
 * it in Suspense and let it stream (see components/class-roster.tsx).
 */
export function ClassCard({ course, roster }: { course: Course; roster: React.ReactNode }) {
  const accent = accentFor(course.id);

  return (
    <Link
      href={`/classes/${course.id}`}
      className="group flex flex-col rounded-card border border-ink/8 bg-white p-6 transition-all hover:-translate-y-0.5 hover:border-ink/15 hover:shadow-card"
    >
      <span className={cn("flex h-12 w-12 items-center justify-center rounded-2xl", accent.soft)}>
        <BookOpen size={22} strokeWidth={1.8} className={accent.text} />
      </span>

      <h3 className="mt-5 text-base font-semibold leading-snug">{course.name}</h3>
      {course.section && <p className="mt-1 text-xs text-faint">{course.section}</p>}

      <div className="mt-5 flex items-center justify-between">
        {roster}
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-panel text-ink/50 transition-colors group-hover:bg-coral group-hover:text-white">
          <LinkPending size={15}>
            <ArrowRight size={15} />
          </LinkPending>
        </span>
      </div>
    </Link>
  );
}
