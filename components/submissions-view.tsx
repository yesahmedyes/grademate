"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import * as Dialog from "@radix-ui/react-dialog";
import { FileText, Sparkles, X } from "lucide-react";
import type { CourseWork, Student, Submission } from "@/lib/classroom";
import { Avatar } from "@/components/avatar";
import { LinkPending } from "@/components/link-pending";
import { StatusPill } from "@/components/status-pill";

type Props = {
  courseId: string;
  work: CourseWork;
  students: Student[];
  submissions: Submission[];
};

function fmtDate(iso?: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function SubmissionsView({ courseId, work, students, submissions }: Props) {
  const [open, setOpen] = useState<Submission | null>(null);

  // Memoized so opening/closing the preview dialog doesn't rebuild the map and
  // re-sort every row.
  const byUser = useMemo(() => new Map(students.map((s) => [s.userId, s])), [students]);

  const rows = useMemo(
    () =>
      submissions
        .map((sub) => ({ sub, student: byUser.get(sub.userId) }))
        .sort((a, b) =>
          (a.student?.name ?? a.sub.userId).localeCompare(b.student?.name ?? b.sub.userId)
        ),
    [submissions, byUser]
  );

  const openStudent = open ? byUser.get(open.userId) : null;
  const openFile = open?.attachments.find((a) => a.driveFileId);

  return (
    <>
      <div className="overflow-hidden rounded-card border border-ink/8 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-ink/8 bg-panel/60 text-left text-xs text-faint">
              <th className="px-5 py-3 font-medium">Student</th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="hidden px-5 py-3 font-medium md:table-cell">Submission</th>
              <th className="hidden px-5 py-3 font-medium sm:table-cell">Updated</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ sub, student }) => {
              const name = student?.name ?? "Unknown student";
              const file = sub.attachments.find((a) => a.driveFileId);
              return (
                <tr
                  key={sub.id}
                  onClick={() => setOpen(sub)}
                  className="cursor-pointer border-b border-ink/5 transition-colors last:border-0 hover:bg-panel/50"
                >
                  <td className="px-5 py-3.5">
                    <span className="flex items-center gap-3">
                      <Avatar name={name} src={student?.photoUrl} size={34} />
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{name}</span>
                        {student?.email && (
                          <span className="block truncate text-xs text-faint">{student.email}</span>
                        )}
                      </span>
                    </span>
                  </td>
                  <td className="px-5 py-3.5">
                    <StatusPill state={sub.state} late={sub.late} />
                  </td>
                  <td className="hidden max-w-[16rem] px-5 py-3.5 md:table-cell">
                    {file ? (
                      <span className="flex items-center gap-2 text-ink/80">
                        <FileText size={15} className="shrink-0 text-faint" />
                        <span className="truncate">{file.title ?? "Untitled file"}</span>
                      </span>
                    ) : sub.attachments.length > 0 ? (
                      <span className="text-faint">Link attachment</span>
                    ) : (
                      <span className="text-faint">—</span>
                    )}
                  </td>
                  <td className="hidden px-5 py-3.5 text-faint sm:table-cell">
                    {fmtDate(sub.updateTime)}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-5 py-10 text-center text-faint">
                  No submissions yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Dialog.Root open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-navy/45 backdrop-blur-[2px]" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[92vh] w-[min(60rem,94vw)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-card bg-white shadow-card focus:outline-none">
            <div className="flex items-center gap-4 border-b border-ink/8 px-6 py-4">
              {openStudent && <Avatar name={openStudent.name} src={openStudent.photoUrl} size={40} />}
              <div className="min-w-0 flex-1">
                <Dialog.Title className="truncate text-sm font-semibold">
                  {openStudent?.name ?? "Unknown student"}
                </Dialog.Title>
                <Dialog.Description className="truncate text-xs text-faint">
                  {work.title}
                  {openFile?.title ? ` · ${openFile.title}` : ""}
                </Dialog.Description>
              </div>
              {open && <StatusPill state={open.state} late={open.late} />}
              <Dialog.Close
                aria-label="Close"
                className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full text-faint hover:bg-panel hover:text-ink"
              >
                <X size={16} />
              </Dialog.Close>
            </div>
            <div className="flex-1 bg-panel/60">
              {openFile?.driveFileId ? (
                <iframe
                  title="Submission preview"
                  src={`/api/drive/${openFile.driveFileId}`}
                  className="h-[72vh] w-full"
                />
              ) : (
                <div className="flex h-[40vh] items-center justify-center text-sm text-faint">
                  No file attached to this submission.
                </div>
              )}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Link
        href={`/classes/${courseId}/work/${work.id}/grade`}
        className="fixed bottom-8 right-8 z-40 inline-flex h-12 items-center gap-2 rounded-full bg-coral px-6 text-sm font-semibold text-white shadow-[0_10px_24px_-8px_rgba(233,124,82,0.7)] transition-colors hover:bg-coral-deep"
      >
        <LinkPending size={17}>
          <Sparkles size={17} />
        </LinkPending>{" "}
        Grade All
      </Link>
    </>
  );
}
