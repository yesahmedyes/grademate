import Link from "next/link";
import { ArrowRight, BookOpen } from "lucide-react";
import type { Course, Student } from "@/lib/classroom";
import { Avatar } from "@/components/avatar";
import { accentFor, cn } from "@/lib/utils";

export function ClassCard({ course, students }: { course: Course; students: Student[] }) {
  const accent = accentFor(course.id);
  const shown = students.slice(0, 4);
  const extra = students.length - shown.length;

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
        {shown.length > 0 ? (
          <span className="flex items-center -space-x-2">
            {shown.map((s) => (
              <Avatar key={s.userId} name={s.name} src={s.photoUrl} size={28} />
            ))}
            {extra > 0 && (
              <span className="z-10 flex h-7 w-7 items-center justify-center rounded-full bg-butter text-[10px] font-semibold text-navy ring-2 ring-white">
                +{extra}
              </span>
            )}
          </span>
        ) : (
          <span className="text-xs text-faint">No students yet</span>
        )}
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-panel text-ink/50 transition-colors group-hover:bg-coral group-hover:text-white">
          <ArrowRight size={15} />
        </span>
      </div>
    </Link>
  );
}
