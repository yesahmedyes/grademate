"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ChevronDown, Download, Loader2, Play, RefreshCw, Square } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/status-pill";
import { cn } from "@/lib/utils";

// Only rendered inside an expanded feedback panel, so keep react-markdown +
// KaTeX + highlight.js out of the grading bundle until someone opens one.
const MarkdownView = dynamic(
  () => import("@/components/markdown-view").then((m) => m.MarkdownView),
  { loading: () => <p className="text-xs text-faint">Loading feedback…</p> }
);

export type ResultDTO = {
  googleUserId: string;
  name: string;
  email?: string | null;
  photoUrl?: string | null;
  state: string;
  score?: number | null;
  maxPoints?: number | null;
  perCriterion: { criterion: string; points: number; maxPoints: number; comment: string }[];
  feedback: string;
  error?: string | null;
};

type LogLine = { message: string; ts: number };

/** The `done` event closing one batch. `remaining` is what's still queued server-side. */
type BatchDone = { graded: number; failed: number; skipped: number; remaining: number };

/** Most recent N log lines kept in state; older ones are dropped. */
const LOG_LIMIT = 300;

/** One roster entry — a student plus the state of their submission for this coursework. */
export type RosterEntry = {
  googleUserId: string;
  name: string;
  email?: string | null;
  photoUrl?: string | null;
  /** Classroom submission state: NEW | CREATED | TURNED_IN | RETURNED | RECLAIMED_BY_STUDENT */
  state: string;
  late: boolean;
};

const STATE_OPTIONS = [
  { value: "TURNED_IN", label: "Turned in" },
  { value: "RETURNED", label: "Returned" },
  { value: "CREATED", label: "Assigned" },
  { value: "NEW", label: "Not started" },
  { value: "RECLAIMED_BY_STUDENT", label: "Unsubmitted" },
];

const ALL_STATES = STATE_OPTIONS.map((o) => o.value);

function scoreTone(pct: number) {
  if (pct >= 80) return "bg-leaf-soft text-[#4c7c53]";
  if (pct >= 60) return "bg-butter-soft text-[#9c7c1e]";
  return "bg-coral-soft text-coral-deep";
}

/**
 * Memoized: a result event replaces the results Map, so without this every
 * student's card re-renders each time any one student finishes.
 */
const ResultCard = memo(function ResultCard({
  r,
  onRetry,
  retryDisabled,
}: {
  r: ResultDTO;
  onRetry?: (googleUserId: string) => void;
  retryDisabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const max = r.maxPoints ?? 100;
  const pct = r.score != null && max > 0 ? (r.score / max) * 100 : 0;

  return (
    <div
      className={cn(
        "rounded-card border bg-white p-4",
        r.state === "error" ? "border-coral/40" : "border-ink/8"
      )}
    >
      <div className="flex items-center gap-3">
        <Avatar name={r.name} src={r.photoUrl} size={36} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{r.name}</p>
          {r.email && <p className="truncate text-xs text-faint">{r.email}</p>}
        </div>
        {r.state === "done" && r.score != null ? (
          <span className={cn("rounded-full px-3 py-1.5 text-xs font-bold", scoreTone(pct))}>
            {r.score}/{max}
          </span>
        ) : r.state === "error" ? (
          <div className="flex items-center gap-1.5">
            <span className="rounded-full bg-coral-soft px-3 py-1.5 text-xs font-semibold text-coral-deep">
              Error
            </span>
            {onRetry && (
              <button
                onClick={() => onRetry(r.googleUserId)}
                disabled={retryDisabled}
                title="Regenerate this grade"
                aria-label="Regenerate this grade"
                className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full text-faint transition-colors hover:bg-panel hover:text-ink disabled:pointer-events-none disabled:opacity-40"
              >
                <RefreshCw size={14} />
              </button>
            )}
          </div>
        ) : (
          <Loader2 size={16} className="animate-spin text-faint" />
        )}
      </div>

      {r.state === "error" && r.error && (
        <p className="mt-3 rounded-xl bg-coral-soft/60 px-3 py-2 text-xs text-coral-deep">
          {r.error}
        </p>
      )}

      {r.state === "done" && r.perCriterion.length > 0 && (
        <div className="mt-3 flex flex-col gap-1.5">
          {r.perCriterion.map((c, i) => {
            const cp = c.maxPoints > 0 ? Math.min(100, (c.points / c.maxPoints) * 100) : 0;
            return (
              <div key={i} className="flex items-center gap-2 text-[11px]">
                <span className="w-32 truncate text-faint" title={c.comment || c.criterion}>
                  {c.criterion}
                </span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-panel">
                  <div className="h-full rounded-full bg-sky" style={{ width: `${cp}%` }} />
                </div>
                <span className="w-12 text-right font-medium text-ink/70">
                  {c.points}/{c.maxPoints}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {r.state === "done" && r.feedback && (
        <div className="mt-3">
          <button
            onClick={() => setOpen(!open)}
            className="flex cursor-pointer items-center gap-1 text-xs font-medium text-ink/60 hover:text-ink"
          >
            Feedback <ChevronDown size={13} className={cn("transition-transform", open && "rotate-180")} />
          </button>
          {open && (
            <div className="mt-2 rounded-xl bg-panel/60 px-4 py-3">
              <MarkdownView className="prose-xs text-[13px]">{r.feedback}</MarkdownView>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

/**
 * A student who has no grade yet — shown so the roster is visible before and
 * during a run, instead of an empty panel until results start landing.
 */
const RosterCard = memo(function RosterCard({ s }: { s: RosterEntry }) {
  return (
    <div className="rounded-card border border-dashed border-ink/10 bg-white/60 p-4">
      <div className="flex items-center gap-3">
        <Avatar name={s.name} src={s.photoUrl} size={36} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{s.name}</p>
          {s.email && <p className="truncate text-xs text-faint">{s.email}</p>}
        </div>
        <StatusPill state={s.state} late={s.late} />
      </div>
    </div>
  );
});

/** Memoized alongside ResultCard — this recomputed on every streamed log line. */
const Stats = memo(function Stats({ results, max }: { results: ResultDTO[]; max: number }) {
  const stats = useMemo(() => {
    const scores = results
      .filter((r) => r.state === "done" && r.score != null)
      .map((r) => r.score as number)
      .sort((a, b) => a - b);
    if (!scores.length) return null;

    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    const median =
      scores.length % 2
        ? scores[(scores.length - 1) / 2]
        : (scores[scores.length / 2 - 1] + scores[scores.length / 2]) / 2;

    const buckets = [
      { label: "90–100%", lo: 90, cls: "bg-leaf" },
      { label: "80–89%", lo: 80, cls: "bg-sky" },
      { label: "70–79%", lo: 70, cls: "bg-lilac" },
      { label: "60–69%", lo: 60, cls: "bg-butter" },
      { label: "< 60%", lo: 0, cls: "bg-coral" },
    ].map((b, i, arr) => {
      const hi = i === 0 ? 101 : arr[i - 1].lo;
      const count = scores.filter((s) => {
        const p = max > 0 ? (s / max) * 100 : 0;
        return p >= b.lo && p < hi;
      }).length;
      return { ...b, count };
    });

    return { scores, avg, median, buckets, most: Math.max(1, ...buckets.map((b) => b.count)) };
  }, [results, max]);

  if (!stats) return null;
  const { scores, avg, median, buckets, most } = stats;

  return (
    <div className="rounded-card border border-ink/8 bg-white p-5">
      <h4 className="text-sm font-semibold">
        Class <span className="font-light">overview</span>
      </h4>
      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        <span className="rounded-full bg-panel px-3 py-1.5 font-medium">
          Average <b>{avg.toFixed(1)}</b>
        </span>
        <span className="rounded-full bg-panel px-3 py-1.5 font-medium">
          Median <b>{median.toFixed(1)}</b>
        </span>
        <span className="rounded-full bg-panel px-3 py-1.5 font-medium">
          High <b>{scores[scores.length - 1]}</b>
        </span>
        <span className="rounded-full bg-panel px-3 py-1.5 font-medium">
          Low <b>{scores[0]}</b>
        </span>
      </div>
      <div className="mt-4 flex flex-col gap-2">
        {buckets.map((b) => (
          <div key={b.label} className="flex items-center gap-3 text-[11px]">
            <span className="w-16 text-faint">{b.label}</span>
            <div className="h-4 flex-1 overflow-hidden rounded-full bg-panel">
              <div
                className={cn("h-full rounded-full", b.cls)}
                style={{ width: `${(b.count / most) * 100}%` }}
              />
            </div>
            <span className="w-6 text-right font-semibold text-ink/70">{b.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
});

function toCsv(results: ResultDTO[], max: number) {
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = [
    ["Name", "Email", "Score", "Max points", "Percent", "Status", "Feedback"].join(","),
    ...results.map((r) =>
      [
        esc(r.name),
        esc(r.email),
        r.score ?? "",
        r.maxPoints ?? max,
        r.score != null ? (((r.score / (r.maxPoints ?? max)) * 100) || 0).toFixed(1) : "",
        esc(r.state === "done" ? "graded" : r.state),
        esc(r.feedback || r.error || ""),
      ].join(",")
    ),
  ];
  return rows.join("\n");
}

export function GradeStep({
  sessionId,
  maxPoints,
  ready,
  initialResults,
  roster,
  workTitle,
  onGradedChange,
  onRunningChange,
}: {
  sessionId: string;
  maxPoints: number;
  ready: boolean;
  initialResults: ResultDTO[];
  /** Every student on the roster with a submission row, whether graded yet or not. */
  roster: RosterEntry[];
  workTitle: string;
  /** Lets the wizard light the step-3 tick from live results, not the server snapshot. */
  onGradedChange?: (hasGraded: boolean) => void;
  /** Lets the wizard show a run is still going while the teacher is on another step. */
  onRunningChange?: (running: boolean) => void;
}) {
  const [selected, setSelected] = useState<string[]>(["TURNED_IN"]);
  const [force, setForce] = useState(false);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<LogLine[]>([]);
  const [results, setResults] = useState<Map<string, ResultDTO>>(
    () => new Map(initialResults.map((r) => [r.googleUserId, r]))
  );
  const [summary, setSummary] = useState<{ graded: number; failed: number; skipped: number } | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log]);

  /**
   * Apply a whole chunk's worth of events in one pass. The server emits a line
   * per student per stage, and one setState each meant hundreds of full re-renders
   * over a class-sized run.
   */
  function applyEvents(evs: Record<string, unknown>[]) {
    const lines: LogLine[] = [];
    const fresh: ResultDTO[] = [];
    for (const ev of evs) {
      if (ev.type === "log") {
        lines.push({ message: String(ev.message), ts: Number(ev.ts) || Date.now() });
      } else if (ev.type === "fatal") {
        lines.push({ message: `✗ ${ev.message}`, ts: Date.now() });
      } else if (ev.type === "result") {
        fresh.push(ev.result as ResultDTO);
      }
    }
    if (lines.length) {
      setLog((l) => {
        const next = l.concat(lines);
        // The log is a transcript, not a record — keep it bounded so a large
        // class doesn't grow an unbounded list that re-renders on every append.
        return next.length > LOG_LIMIT ? next.slice(next.length - LOG_LIMIT) : next;
      });
    }
    if (fresh.length) {
      setResults((m) => {
        const next = new Map(m);
        for (const r of fresh) next.set(r.googleUserId, r);
        return next;
      });
    }
  }

  function handleEvent(ev: Record<string, unknown>) {
    applyEvents([ev]);
  }

  /** Read an NDJSON grading stream line-by-line; resolves with the batch's `done` event. */
  async function consume(res: Response): Promise<BatchDone | null> {
    if (!res.ok || !res.body) {
      const j = await res.json().catch(() => null);
      handleEvent({ type: "fatal", message: (j as { error?: string })?.error ?? res.statusText });
      return null;
    }
    let batchDone: BatchDone | null = null;
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const pending: Record<string, unknown>[] = [];
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        try {
          const ev = JSON.parse(line) as Record<string, unknown>;
          if (ev.type === "done") {
            batchDone = {
              graded: Number(ev.graded) || 0,
              failed: Number(ev.failed) || 0,
              skipped: Number(ev.skipped) || 0,
              remaining: Number(ev.remaining) || 0,
            };
          } else {
            pending.push(ev);
          }
        } catch {}
      }
      if (pending.length) applyEvents(pending);
    }
    return batchDone;
  }

  async function start() {
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setSummary(null);
    setLog([{ message: "Starting grading run…", ts: Date.now() }]);
    const total = { graded: 0, failed: 0, skipped: 0 };
    try {
      // The route grades one batch per request and reports what's left, so a class of
      // any size is a series of short requests instead of one long one that a
      // serverless host would cut off. Each request picks up where the last stopped.
      for (let batch = 0; ; batch++) {
        const res = await fetch(`/api/grade/${sessionId}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ states: selected, force, resume: batch > 0 }),
          signal: controller.signal,
        });
        const done = await consume(res);
        if (!done) return; // fatal — consume has already logged it
        total.graded += done.graded;
        total.failed += done.failed;
        total.skipped += done.skipped;
        if (done.remaining <= 0) break;
        // A batch that moved nothing would otherwise loop forever.
        if (done.graded + done.failed === 0) {
          handleEvent({
            type: "fatal",
            message: `Stopped with ${done.remaining} left — nothing could be graded this round.`,
          });
          break;
        }
      }
      setSummary(total);
    } catch (e) {
      if (controller.signal.aborted) {
        setLog((l) => [...l, { message: "■ Grading stopped. Already-graded students were saved.", ts: Date.now() }]);
      } else {
        handleEvent({ type: "fatal", message: e instanceof Error ? e.message : String(e) });
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }

  function stop() {
    abortRef.current?.abort();
    setLog((l) => [...l, { message: "Stopping — finishing submissions already in progress…", ts: Date.now() }]);
  }

  /** Regenerate a single student's grade (used by the retry button on error cards). */
  async function regrade(googleUserId: string) {
    setResults((m) => {
      const cur = m.get(googleUserId);
      return cur ? new Map(m).set(googleUserId, { ...cur, state: "grading", error: null }) : m;
    });
    try {
      const res = await fetch(`/api/grade/${sessionId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userIds: [googleUserId], force: true }),
      });
      await consume(res);
    } catch (e) {
      handleEvent({ type: "fatal", message: e instanceof Error ? e.message : String(e) });
    } finally {
      // If the stream ended without a fresh result for this student, don't leave a stuck spinner.
      setResults((m) => {
        const cur = m.get(googleUserId);
        return cur && cur.state === "grading"
          ? new Map(m).set(googleUserId, { ...cur, state: "error", error: "No submission found to re-grade." })
          : m;
      });
    }
  }

  // Stable identity so the memoized ResultCards aren't invalidated every render.
  const regradeRef = useRef(regrade);
  useEffect(() => {
    regradeRef.current = regrade;
  });
  const onRetry = useCallback((googleUserId: string) => regradeRef.current(googleUserId), []);

  const resultList = useMemo(
    () => [...results.values()].sort((a, b) => a.name.localeCompare(b.name)),
    [results]
  );

  const subCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const s of roster) c[s.state] = (c[s.state] ?? 0) + 1;
    return c;
  }, [roster]);

  const allSelected = ALL_STATES.every((v) => selected.includes(v));

  /**
   * The roster filtered to the selected states, each paired with its grade if one
   * exists. Students graded in an earlier run whose submission row has since gone
   * (left the course) are appended so their results aren't silently dropped.
   */
  const rows = useMemo(() => {
    const inScope = roster
      .filter((s) => selected.includes(s.state))
      .map((s) => ({ student: s, result: results.get(s.googleUserId) ?? null }));

    const rosterIds = new Set(roster.map((s) => s.googleUserId));
    const orphans = [...results.values()]
      .filter((r) => !rosterIds.has(r.googleUserId))
      .map((r) => ({ student: null as RosterEntry | null, result: r }));

    return [...inScope, ...orphans].sort((a, b) =>
      (a.student?.name ?? a.result!.name).localeCompare(b.student?.name ?? b.result!.name)
    );
  }, [roster, selected, results]);

  const doneCount = useMemo(
    () => resultList.filter((r) => r.state === "done").length,
    [resultList]
  );

  // The log/stats column only exists once a run has produced something; before
  // that the roster takes the full width instead of sitting next to a blank gap.
  const hasSidebar = log.length > 0 || doneCount > 0;

  // Report upward so the wizard's step-3 tick tracks the live run.
  useEffect(() => {
    onGradedChange?.(doneCount > 0);
  }, [doneCount, onGradedChange]);

  // Keeps the stepper's spinner accurate while the teacher is on another step.
  useEffect(() => {
    onRunningChange?.(running);
  }, [running, onRunningChange]);

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold">Start grading</h3>
          <p className="mt-0.5 text-xs text-faint">
            Each selected submission is fetched, read into text and diagrams, then graded by AI
            against your marking scheme.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {/* These chips pick both what you see below and what Start Grading runs on. */}
            <button
              onClick={() => setSelected(allSelected ? ["TURNED_IN"] : ALL_STATES)}
              className={cn(
                "cursor-pointer rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors",
                allSelected
                  ? "border-coral bg-coral-soft text-coral-deep"
                  : "border-ink/10 bg-white text-faint hover:border-ink/25"
              )}
            >
              All · {roster.length}
            </button>
            {STATE_OPTIONS.map((o) => {
              const on = selected.includes(o.value);
              const count = subCounts[o.value] ?? 0;
              // A state nobody is in is noise — including when "All" selects it.
              if (count === 0) return null;
              return (
                <button
                  key={o.value}
                  title={`Show ${o.label.toLowerCase()} — ⌘/Ctrl-click to add to the selection`}
                  // Plain click isolates the state so the list answers "who is
                  // in this category"; modifier-click keeps the old additive
                  // behaviour for grading several states in one run.
                  onClick={(e) => {
                    if (e.metaKey || e.ctrlKey) {
                      setSelected((s) =>
                        on ? (s.length > 1 ? s.filter((x) => x !== o.value) : s) : [...s, o.value]
                      );
                    } else {
                      setSelected([o.value]);
                    }
                  }}
                  className={cn(
                    "cursor-pointer rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors",
                    on
                      ? "border-coral bg-coral-soft text-coral-deep"
                      : "border-ink/10 bg-white text-faint hover:border-ink/25"
                  )}
                >
                  {o.label} · {count}
                </button>
              );
            })}
            <label className="ml-1 flex cursor-pointer items-center gap-1.5 text-xs text-faint">
              <input
                type="checkbox"
                checked={force}
                onChange={(e) => setForce(e.target.checked)}
                className="accent-coral"
              />
              re-grade already graded
            </label>
          </div>
        </div>
        {running ? (
          <Button
            size="lg"
            variant="outline"
            onClick={stop}
            className="border-coral/40 text-coral-deep hover:bg-coral-soft"
          >
            <Square size={14} className="fill-current" /> Stop
          </Button>
        ) : (
          <Button size="lg" onClick={start} disabled={!ready || selected.length === 0}>
            <Play size={16} /> Start Grading
          </Button>
        )}
      </div>
      {!ready && (
        <p className="mt-3 rounded-xl bg-butter-soft px-4 py-2.5 text-xs font-medium text-[#9c7c1e]">
          Add a marking scheme (step 2) before grading.
        </p>
      )}

      {(hasSidebar || rows.length > 0) && (
        <div
          className={cn(
            "mt-6 grid items-start gap-5",
            hasSidebar && "lg:grid-cols-[2fr_3fr]"
          )}
        >
          <div className={cn("flex flex-col gap-4", !hasSidebar && "hidden")}>
            {log.length > 0 && (
              <div
                ref={logRef}
                className="thin-scroll h-[24rem] overflow-y-auto rounded-card bg-navy p-4 font-mono text-[11.5px] leading-relaxed text-white/75"
              >
                {log.map((l, i) => (
                  <p key={i} className="whitespace-pre-wrap">
                    <span className="mr-2 text-white/35">
                      {new Date(l.ts).toLocaleTimeString("en-US", { hour12: false })}
                    </span>
                    {l.message}
                  </p>
                ))}
                {running && <p className="animate-pulse text-white/50">▋</p>}
              </div>
            )}
            {doneCount > 0 && <Stats results={resultList} max={maxPoints} />}
          </div>

          <div className="flex flex-col gap-3">
            {summary && (
              <div className="flex items-center justify-between rounded-card border border-leaf/40 bg-leaf-soft px-5 py-3 text-sm">
                <span className="font-medium text-[#4c7c53]">
                  Done — {summary.graded} graded
                  {summary.failed > 0 && `, ${summary.failed} failed`}
                  {summary.skipped > 0 && `, ${summary.skipped} skipped`}
                </span>
                <Button
                  variant="navy"
                  size="sm"
                  onClick={() => {
                    const blob = new Blob([toCsv(resultList, maxPoints)], {
                      type: "text/csv;charset=utf-8",
                    });
                    const a = document.createElement("a");
                    a.href = URL.createObjectURL(blob);
                    a.download = `grades-${workTitle.replace(/[^\w-]+/g, "_")}.csv`;
                    a.click();
                    URL.revokeObjectURL(a.href);
                  }}
                >
                  <Download size={14} /> Export CSV
                </Button>
              </div>
            )}
            {rows.map(({ student, result }) =>
              result ? (
                <ResultCard
                  key={result.googleUserId}
                  r={result}
                  onRetry={onRetry}
                  retryDisabled={running}
                />
              ) : (
                <RosterCard key={student!.googleUserId} s={student!} />
              )
            )}
            {rows.length === 0 && (
              <p className="rounded-card border border-ink/8 bg-panel/60 p-8 text-center text-sm text-faint">
                {roster.length === 0
                  ? "No students with a submission row for this assignment."
                  : "No students match the selected states."}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
