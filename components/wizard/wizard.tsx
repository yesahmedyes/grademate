"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Check, FileText, Loader2, ScanText, TriangleAlert, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ResultDTO, RosterEntry } from "@/components/wizard/grade-step";
import { Skeleton } from "@/components/skeleton";
import { cn } from "@/lib/utils";

// Steps 2 and 3 carry the heavy dependencies — react-markdown, KaTeX and
// highlight.js all ride in via MarkdownView. Loading them on demand keeps them
// out of the bundle for step 1, which is where every teacher lands first.
const StepFallback = () => (
  <div>
    <Skeleton className="h-5 w-40 rounded-md" />
    <Skeleton className="mt-2 h-3 w-72 rounded-md" />
    <Skeleton className="mt-4 h-[26rem] w-full rounded-card" />
  </div>
);

const SourceEditor = dynamic(
  () => import("@/components/wizard/source-editor").then((m) => m.SourceEditor),
  { loading: StepFallback }
);

const GradeStep = dynamic(() => import("@/components/wizard/grade-step").then((m) => m.GradeStep), {
  loading: StepFallback,
});

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

function Stepper({
  step,
  done,
  running,
  onGo,
}: {
  step: number;
  done: boolean[];
  /** A grading run is in flight — surfaced on step 3 so it stays visible from the other steps. */
  running: boolean;
  onGo: (i: number) => void;
}) {
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
              {i === 2 && running ? (
                <Loader2 size={15} className="animate-spin" />
              ) : done[i] && i !== step ? (
                <Check size={15} />
              ) : (
                i + 1
              )}
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

/** Stop polling after this long; lib/ocr-job.ts reports a dead job as `error` anyway. */
const OCR_POLL_TIMEOUT_MS = 120_000;

function AssignmentStep({
  session,
  onFile,
}: {
  session: WizardSession;
  onFile: (f: AssignmentFile) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [frameLoaded, setFrameLoaded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const file = session.assignmentFile;
  const waiting = file ? file.ocrStatus === "pending" || file.ocrStatus === "running" : false;
  const fileId = session.assignmentFile?.id;

  // Poll while the background OCR runs; the upload response returns before it
  // finishes. Backs off, pauses while the tab is hidden, and gives up rather
  // than hammering the endpoint forever on a job that died.
  useEffect(() => {
    if (!waiting || !fileId) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    let delay = 2000;
    const startedAt = Date.now();

    async function tick() {
      if (!alive) return;
      if (Date.now() - startedAt > OCR_POLL_TIMEOUT_MS) return;
      if (document.visibilityState === "hidden") {
        timer = setTimeout(tick, delay);
        return;
      }
      try {
        // ?fields=files skips the results relation — this used to drag every
        // graded student's feedback over the wire every two seconds.
        const res = await fetch(`/api/sessions/${session.id}?fields=files`);
        if (res.ok) {
          const j = (await res.json()) as {
            files?: { id: string; ocrStatus: string; ocrPages: number | null; originalName: string }[];
          };
          const fresh = j.files?.find((f) => f.id === fileId);
          if (!alive) return;
          if (fresh) {
            onFile({
              id: fresh.id,
              name: fresh.originalName,
              ocrStatus: fresh.ocrStatus,
              ocrPages: fresh.ocrPages,
            });
          }
        }
      } catch {
        // transient — the next tick tries again
      }
      if (!alive) return;
      delay = Math.min(Math.round(delay * 1.6), 10_000);
      timer = setTimeout(tick, delay);
    }

    // Coming back to the tab should feel immediate, not wait out the backoff.
    function onVisible() {
      if (document.visibilityState === "visible" && alive) {
        clearTimeout(timer);
        delay = 2000;
        timer = setTimeout(tick, 0);
      }
    }

    timer = setTimeout(tick, delay);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [waiting, session.id, fileId, onFile]);

  const previewSrc =
    session.assignmentSource === "upload" && session.assignmentFile
      ? `/api/files/${session.assignmentFile.id}`
      : session.assignmentDriveId
        ? `/api/drive/${session.assignmentDriveId}`
        : null;

  // The brief is fetched through /api/drive or /api/files and can take a beat —
  // show the placeholder again whenever the source changes.
  useEffect(() => {
    setFrameLoaded(false);
  }, [previewSrc]);

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

      <div className="relative mt-4 overflow-hidden rounded-card border border-ink/8 bg-panel/60">
        {previewSrc ? (
          <>
            <iframe
              key={previewSrc}
              title="Assignment preview"
              src={previewSrc}
              // An iframe fires `load` twice: once for the about:blank document it
              // gets on insertion, then again for the real response. Acting on the
              // first would hide the placeholder before anything had loaded.
              onLoad={(e) => {
                let href: string;
                try {
                  href = e.currentTarget.contentWindow?.location.href ?? "";
                } catch {
                  href = ""; // plugin/cross-origin document — real content
                }
                if (href !== "about:blank") setFrameLoaded(true);
              }}
              className={cn("h-[30rem] w-full", !frameLoaded && "invisible")}
            />
            {!frameLoaded && (
              <div className="absolute inset-0 flex flex-col gap-3 p-6">
                <Skeleton className="h-4 w-1/3 rounded-md" />
                <Skeleton className="h-3 w-2/3 rounded-md" />
                <Skeleton className="mt-2 flex-1 rounded-card" />
              </div>
            )}
          </>
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
  courseName,
  session: initial,
  initialResults,
  roster,
}: {
  courseName: string;
  session: WizardSession;
  initialResults: ResultDTO[];
  roster: RosterEntry[];
}) {
  const [step, setStep] = useState(0);
  const [session, setSession] = useState(initial);
  // Live signal from GradeStep — initialResults is the server snapshot and never
  // updates during a run, which used to leave the step-3 tick permanently unlit.
  const [hasGraded, setHasGraded] = useState(() => initialResults.some((r) => r.state === "done"));
  const [running, setRunning] = useState(false);

  // Steps are mounted on first visit and then kept mounted, hidden with CSS.
  // Unmounting step 3 mid-run threw away the live log and results (and left the
  // batch loop writing into a dead component), so switching tabs looked like the
  // run had vanished. Deferring the mount still keeps each step's chunk lazy.
  const [visited, setVisited] = useState<ReadonlySet<number>>(() => new Set([0]));
  const goTo = useCallback((i: number) => {
    setStep(i);
    setVisited((v) => (v.has(i) ? v : new Set(v).add(i)));
  }, []);

  // Stable so AssignmentStep's OCR poll isn't torn down and restarted every render.
  const setAssignmentFile = useCallback(
    (f: AssignmentFile) =>
      setSession((s) => ({ ...s, assignmentFile: f, assignmentSource: "upload" })),
    []
  );
  const setMarkingScheme = useCallback(
    (v: string) => setSession((s) => (s.markingScheme === v ? s : { ...s, markingScheme: v })),
    []
  );

  const hasAssignment = Boolean(session.assignmentDriveId || session.assignmentFile);
  const done = [hasAssignment, session.markingScheme.trim().length > 0, hasGraded];
  const ready = done[1];

  return (
    <div className="pb-10">
      <div className="mx-auto max-w-xl">
        <Stepper step={step} done={done} running={running} onGo={goTo} />
      </div>

      <div className="mt-8 rounded-card border border-ink/8 bg-white p-6">
        <div className={cn(step !== 0 && "hidden")}>
          <AssignmentStep session={session} onFile={setAssignmentFile} />
        </div>
        {visited.has(1) && (
          <div className={cn(step !== 1 && "hidden")}>
            <SourceEditor
              sessionId={session.id}
              kind="markingScheme"
              title="Marking Scheme"
              hint="Correct answers and points per step. Upload a document, paste, or let AI draft it from the assignment."
              value={session.markingScheme}
              onCommit={setMarkingScheme}
            />
          </div>
        )}
        {visited.has(2) && (
          <div className={cn(step !== 2 && "hidden")}>
            <GradeStep
              sessionId={session.id}
              maxPoints={session.maxPoints ?? 100}
              ready={ready}
              initialResults={initialResults}
              roster={roster}
              workTitle={session.courseWorkTitle}
              onGradedChange={setHasGraded}
              onRunningChange={setRunning}
            />
          </div>
        )}
      </div>

      <div className="mt-5 flex items-center justify-between">
        <Button variant="ghost" size="md" disabled={step === 0} onClick={() => goTo(step - 1)}>
          ← Back
        </Button>
        <p className="text-xs text-faint">
          {courseName} · {session.courseWorkTitle}
        </p>
        {step < 2 ? (
          <Button size="md" onClick={() => goTo(step + 1)}>
            Continue →
          </Button>
        ) : (
          <span className="w-24" />
        )}
      </div>
    </div>
  );
}
