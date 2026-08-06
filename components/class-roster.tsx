import { listStudents } from "@/lib/classroom-cached";
import { Avatar } from "@/components/avatar";

/**
 * The avatar stack on a class card. Split out of ClassCard so the dashboard can
 * render every card immediately and stream the rosters in behind Suspense —
 * one Classroom call per class used to block the whole grid.
 */
export async function ClassRoster({ userId, courseId }: { userId: string; courseId: string }) {
  const students = await listStudents(userId, courseId);
  const shown = students.slice(0, 4);
  const extra = students.length - shown.length;

  if (shown.length === 0) return <span className="text-xs text-faint">No students yet</span>;

  return (
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
  );
}
