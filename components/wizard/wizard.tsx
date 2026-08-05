"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, FileText, Loader2, ScanText, TriangleAlert, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SourceEditor } from "@/components/wizard/source-editor";
import { GradeStep, type ResultDTO } from "@/components/wizard/grade-step";
import { cn } from "@/lib/utils";

export type AssignmentFile = {
  id: string;
  name: string;
  /** pending | running | done | error | skipped — Mistral OCR of the brief. */
  ocrStatus: string;
  ocrPages: number | null;
};

export type WizardSession = {
  id: string;
  markingScheme: string;
  assignmentSource: string;
  assignmentDriveId: string | null;
  maxPoints: number | null;
  courseWorkTitle: string;
  assignmentFile: AssignmentFile | null;
};

const STEPS = ["Assignment", "Marking Scheme", "Grades"] as const;

function Stepper({ step, done, onGo }: { step: number; done: boolean[]; onGo: (i: number) => void }) {
  return (
    <div className="flex items-center">
      {STEPS.map((label, i) => (
        <div key={label} className={cn("flex items-center", i > 0 && "flex-1")}>
          {i > 0 && (
            <div
              className={cn("mx-3 h-1 flex-1 rounded-full", i <= step ? "bg-coral" : "bg-panel")}
            />
          )}
          <button
            onClick={() => onGo(i)}
            className="flex cursor-pointer flex-col items-center gap-1.5"
          >
            <span
              className={cn(
                "flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold transition-colors",
                i === step
                  ? "bg-coral text-white shadow-[0_6px_14px_-6px_rgba(233,124,82,0.6)]"
                  : done[i]
                    ? "bg-coral-soft text-coral-deep"
                    : "bg-panel text-faint"
              )}
            >
              {done[i] && i !== step ? <Check size={15} /> : i + 1}
            </span>
            <span
              className={cn(
                "text-[11px] font-medium whitespace-nowrap",
                i === step ? "text-ink" : "text-faint"
              )}
            >
              {label}
            </span>
          </button>
        </div>
      ))}
    </div>
  );
}

/**
 * Progress of the background OCR pass kicked off by /api/files/upload. Purely
 * informational — grading falls back to reading the pages directly, so nothing
 * here ever blocks the teacher from moving on.
 */
function OcrStatus({ file }: { file: AssignmentFile }) {
  if (file.ocrStatus === "skipped") return null;
  if (file.ocrStatus === "pending" || file.ocrStatus === "running") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-faint">
        <Loader2 size={12} className="animate-spin" />
        Reading the document…
      </span>
    );
  }
  if (file.ocrStatus === "done") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-faint">
        <ScanText size={12} className="text-leaf" />
        Text extracted{file.ocrPages ? ` · ${file.ocrPages} page${file.ocrPages === 1 ? "" : "s"}` : ""}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-faint">
      <TriangleAlert size={12} className="text-coral" />
      Couldn&rsquo;t extract text — the AI will read the pages directly.
    </span>
  );
}

function AssignmentStep({
  session,
  onFile,
}: {
  session: WizardSession;
  onFile: (f: AssignmentFile) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const file = session.assignmentFile;
  const waiting = file ? file.ocrStatus === "pending" || file.ocrStatus === "running" : false;

  // Poll while the background OCR runs; the upload response returns before it finishes.
  useEffect(() => {
    if (!waiting) return;
    let alive = true;
    const t = setInterval(async () => {
      try {
        const res = await fetch(`/api/sessions/${session.id}`);
        if (!res.ok) return;
        const j = (await res.json()) as {
          files?: { id: string; ocrStatus: string; ocrPages: number | null; originalName: string }[];
        };
        const fresh = j.files?.find((f) => f.id === session.assignmentFile?.id);
        if (!alive || !fresh) return;
        onFile({
          id: fresh.id,
          name: fresh.originalName,
          ocrStatus: fresh.ocrStatus,
          ocrPages: fresh.ocrPages,
        });
      } catch {
        // transient — the next tick tries again
      }
    }, 2000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [waiting, session.id, session.assignmentFile?.id, onFile]);

  const previewSrc =
    session.assignmentSource === "upload" && session.assignmentFile
      ? `/api/files/${session.assignmentFile.id}`
      : session.assignmentDriveId
        ? `/api/drive/${session.assignmentDriveId}`
        : null;

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("kind", "assignment");
      fd.append("sessionId", session.id);
      const res = await fetch("/api/files/upload", { method: "POST", body: fd });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Upload failed");
      onFile({ id: j.id, name: j.originalName, ocrStatus: j.ocrStatus ?? "skipped", ocrPages: null });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">Assignment brief</h3>
          <p className="mt-0.5 text-xs text-faint">
            {previewSrc
              ? session.assignmentSource === "upload"
                ? `Using your upload — ${session.assignmentFile?.name}`
                : "Using the file attached to this assignment in Classroom"
              : "No file found in Classroom — upload the assignment brief (PDF or image)"}
          </p>
          {session.assignmentSource === "upload" && file && (
            <p className="mt-1.5">
              <OcrStatus file={file} />
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,image/*,.pdf"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
          />
          <Button
            variant={previewSrc ? "outline" : "primary"}
            size="sm"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            {previewSrc ? "Replace with upload" : "Upload assignment"}
          </Button>
        </div>
      </div>
      {error && (
        <p className="mt-3 rounded-xl bg-coral-soft px-4 py-2.5 text-xs font-medium text-coral-deep">
          {error}
        </p>
      )}

      <div className="mt-4 overflow-hidden rounded-card border border-ink/8 bg-panel/60">
        {previewSrc ? (
          <iframe title="Assignment preview" src={previewSrc} className="h-[30rem] w-full" />
        ) : (
          <button
            onClick={() => inputRef.current?.click()}
            className="flex h-[30rem] w-full cursor-pointer flex-col items-center justify-center gap-3 text-faint transition-colors hover:text-ink"
          >
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-coral-soft">
              <FileText size={24} className="text-coral" />
            </span>
            <span className="text-sm font-medium">Click to upload the assignment PDF</span>
            <span className="text-xs">It gives the AI context when generating the marking scheme</span>
          </button>
        )}
      </div>
    </div>
  );
}

export function GradeWizard({
  courseId,
  workId,
  courseName,
  session: initial,
  initialResults,
  subCounts,
}: {
  courseId: string;
  workId: string;
  courseName: string;
  session: WizardSession;
  initialResults: ResultDTO[];
  subCounts: Record<string, number>;
}) {
  const [step, setStep] = useState(0);
  const [session, setSession] = useState(initial);
  // Stable so AssignmentStep's OCR poll isn't torn down and restarted every render.
  const setAssignmentFile = useCallback(
    (f: AssignmentFile) =>
      setSession((s) => ({ ...s, assignmentFile: f, assignmentSource: "upload" })),
    []
  );

  const hasAssignment = Boolean(session.assignmentDriveId || session.assignmentFile);
  const done = [
    hasAssignment,
    session.markingScheme.trim().length > 0,
    initialResults.some((r) => r.state === "done"),
  ];
  const ready = done[1];

  return (
    <div className="pb-10">
      <div className="mx-auto max-w-xl">
        <Stepper step={step} done={done} onGo={setStep} />
      </div>

      <div className="mt-8 rounded-card border border-ink/8 bg-white p-6">
        {step === 0 && <AssignmentStep session={session} onFile={setAssignmentFile} />}
        {step === 1 && (
          <SourceEditor
            sessionId={session.id}
            kind="markingScheme"
            title="Marking Scheme"
            hint="Correct answers and points per step. Upload a document, paste, or let AI draft it from the assignment."
            value={session.markingScheme}
            onChange={(v) => setSession((s) => ({ ...s, markingScheme: v }))}
          />
        )}
        {step === 2 && (
          <GradeStep
            sessionId={session.id}
            maxPoints={session.maxPoints ?? 100}
            ready={ready}
            initialResults={initialResults}
            subCounts={subCounts}
            workTitle={session.courseWorkTitle}
          />
        )}
      </div>

      <div className="mt-5 flex items-center justify-between">
        <Button variant="ghost" size="md" disabled={step === 0} onClick={() => setStep(step - 1)}>
          ← Back
        </Button>
        <p className="text-xs text-faint">
          {courseName} · {session.courseWorkTitle}
        </p>
        {step < 2 ? (
          <Button size="md" onClick={() => setStep(step + 1)}>
            Continue →
          </Button>
        ) : (
          <span className="w-24" />
        )}
      </div>
    </div>
  );
}
