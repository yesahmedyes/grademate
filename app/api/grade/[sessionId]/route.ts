import { after } from "next/server";
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { flushLangfuse } from "@/lib/langfuse";
import { gradingSessions, studentResults, type StudentResult } from "@/db/schema";
import { classroomFor, type Submission } from "@/lib/classroom";
import { aiEnabled, callModel, extractJson } from "@/lib/bedrock";
import { cannedGradeFor } from "@/lib/canned";
import {
  discardFigures,
  figuresFromMarkdown,
  figuresToPng,
  ocrDocument,
  ocrEnabled,
  persistFigures,
} from "@/lib/mistral";
import { isImage, isPdf, pdfToImages } from "@/lib/pdf";
import { loadPrompt } from "@/lib/prompts";
import { limiter } from "@/lib/utils";

export const dynamic = "force-dynamic";
// Vercel's Hobby ceiling, and far more headroom than one batch needs: DEFAULT_BATCH
// students at CONCURRENCY at a time is a couple of rounds. A whole class no longer
// depends on this number — it's spread over as many requests as it takes.
export const maxDuration = 300;

const enc = new TextEncoder();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// OCR pages cost far less than vision tokens, so we can read further into a long
// submission than the 8-page raster cap allowed. Figures are still model input,
// so they stay capped.
const OCR_MAX_PAGES = 15;
const MAX_FIGURES = 6;

// One POST grades at most this many students and then reports how many are left,
// so the client can come back for the next batch. Every invocation finishes well
// inside a serverless request timeout no matter how big the class is.
const DEFAULT_BATCH = 10;
// Most of a submission's wall time is spent waiting on Mistral/Bedrock/Drive
// rather than burning CPU, so several can be in flight for roughly the price of one.
const CONCURRENCY = 5;

type PerCriterion = { criterion: string; points: number; maxPoints: number; comment: string };
type Grade = { score: number; perCriterion: PerCriterion[]; feedback: string };

function num(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function normalizeGrade(parsed: Record<string, unknown>, maxPoints: number): Grade {
  const perCriterion: PerCriterion[] = Array.isArray(parsed.perCriterion)
    ? (parsed.perCriterion as Record<string, unknown>[])
        .map((c) => ({
          criterion: String(c.criterion ?? c.name ?? "Criterion"),
          points: num(c.points ?? c.score) ?? 0,
          maxPoints: num(c.maxPoints ?? c.max) ?? 0,
          comment: String(c.comment ?? ""),
        }))
        .slice(0, 12)
    : [];

  let score = num(parsed.score);
  if (score == null) score = perCriterion.reduce((a, c) => a + c.points, 0);
  score = Math.max(0, Math.min(maxPoints, score));

  let feedback = String(parsed.feedback ?? "").trim();
  const flags = Array.isArray(parsed.flags) ? parsed.flags.map(String).filter(Boolean) : [];
  if (flags.length) feedback = flags.map((f) => `> ⚑ ${f}`).join("\n") + "\n\n" + feedback;

  return { score, perCriterion, feedback };
}

function serialize(r: StudentResult) {
  let perCriterion: PerCriterion[] = [];
  try {
    perCriterion = JSON.parse(r.perCriterion || "[]");
  } catch {}
  return {
    googleUserId: r.googleUserId,
    name: r.name,
    email: r.email,
    photoUrl: r.photoUrl,
    driveFileId: r.driveFileId,
    state: r.state,
    score: r.score,
    maxPoints: r.maxPoints,
    perCriterion,
    feedback: r.feedback,
    error: r.error,
  };
}

// Classroom stamps updateTime as RFC 3339 UTC, so string order is time order.
// Missing stamps sort oldest, which keeps the choice deterministic either way.
function isNewer(a: Submission, b: Submission) {
  return (a.updateTime ?? "") > (b.updateTime ?? "");
}

export async function POST(req: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  // Send any traces produced during this run once the response has finished.
  after(flushLangfuse);

  const session = await auth();
  if (!session?.user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;
  const { sessionId } = await params;

  const gs = await db.query.gradingSessions.findFirst({
    where: eq(gradingSessions.id, sessionId),
    with: { results: true },
  });
  if (!gs || gs.teacherId !== userId)
    return Response.json({ error: "Not found" }, { status: 404 });
  if (!gs.markingScheme.trim())
    return Response.json(
      { error: "Add a marking scheme before grading." },
      { status: 400 }
    );

  const body = (await req.json().catch(() => ({}))) as {
    states?: string[];
    force?: boolean;
    userIds?: string[];
    reOcr?: boolean;
    limit?: number;
    resume?: boolean;
  };
  const states =
    Array.isArray(body.states) && body.states.length ? body.states.map(String) : ["TURNED_IN"];
  // When specific students are named (e.g. a single "regenerate"), grade only
  // those, regardless of state toggles, and always re-run them.
  const only = (Array.isArray(body.userIds) ? body.userIds.map(String) : []).filter(Boolean);
  const force = only.length > 0 ? true : Boolean(body.force);
  // Discard stored transcripts and read every submission again.
  const reOcr = Boolean(body.reOcr);
  const maxPoints = gs.maxPoints ?? 100;
  const limit =
    Number.isFinite(body.limit) && Number(body.limit) > 0
      ? Math.floor(Number(body.limit))
      : DEFAULT_BATCH;
  // Later batches of a run read the roster back out of `student_result`, so a whole
  // class costs one round-trip to Classroom instead of one per batch. It is only a
  // hint — a client that never sets it just re-snapshots and still grades exactly the
  // same students, because the work list is always read from our own tables.
  const resume = Boolean(body.resume) && only.length === 0;

  const api = classroomFor(userId);

  // Rows to snapshot on the first request of a run; empty on a resume.
  let snapshot: (typeof studentResults.$inferInsert)[] = [];
  // Stale submission records dropped by the collapse below, reported in the log.
  let duplicates = 0;
  // Submissions dropped because their student has left the course, likewise reported.
  let offRoster = 0;
  // The current roster; empty on a resume, where the run's students are read back
  // out of our own tables instead of from Classroom.
  let known = new Set<string>();
  if (!resume) {
    let students, submissions;
    try {
      [students, submissions] = await Promise.all([
        api.listStudents(gs.courseId),
        api.listSubmissions(gs.courseId, gs.courseWorkId),
      ]);
    } catch (e) {
      return Response.json(
        { error: `Could not reach Google Classroom: ${e instanceof Error ? e.message : e}` },
        { status: 502 }
      );
    }
    const byUser = new Map(students.map((s) => [s.userId, s]));
    known = new Set(byUser.keys());
    // Classroom keeps a student's submissions after they leave the course, so the
    // submission list runs ahead of the roster. Grading those spends OCR and model
    // calls on people who are no longer in the class and files the result under a
    // placeholder name, so keep a run to the students the teacher can actually see.
    // A named re-grade is explicit and stays exempt.
    const inState = submissions.filter((s) => states.includes(s.state));
    const targets = only.length
      ? submissions.filter((s) => only.includes(s.userId))
      : known.size
        ? inState.filter((s) => known.has(s.userId))
        : inState;
    if (!only.length) offRoster = inState.length - targets.length;
    // Classroom can hand back more than one submission for the same student. One
    // student is one row here, and Postgres refuses an upsert that would touch the
    // same row twice, so collapse them first: only the newest is graded. Grading a
    // superseded attempt would mark work the student has already replaced — and if
    // that newest record turns out to carry no file, the student is reported as an
    // error rather than quietly scored off a stale one.
    const perStudent = new Map<string, Submission>();
    for (const sub of targets) {
      const prev = perStudent.get(sub.userId);
      if (!prev || isNewer(sub, prev)) perStudent.set(sub.userId, sub);
    }
    duplicates = targets.length - perStudent.size;
    snapshot = [...perStudent.values()].map((sub) => {
      const student = byUser.get(sub.userId);
      return {
        sessionId: gs.id,
        googleUserId: sub.userId,
        name: student?.name ?? `Student …${sub.userId.slice(-4)}`,
        email: student?.email ?? null,
        photoUrl: student?.photoUrl ?? null,
        // Comes from Classroom and never from the request body: this is the id the
        // server hands to Drive under the teacher's own credentials.
        driveFileId: sub.attachments.find((a) => a.driveFileId)?.driveFileId ?? null,
        maxPoints,
        state: "pending",
      };
    });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (o: unknown) => {
        try {
          controller.enqueue(enc.encode(JSON.stringify(o) + "\n"));
        } catch {
          // client went away — keep grading, results persist in the DB
        }
      };
      const log = (message: string) => send({ type: "log", message, ts: Date.now() });

      try {
        let graded = 0;
        let failed = 0;
        let skipped = 0;

        // ---- Snapshot the Classroom roster into our own tables (first request only) ----
        if (snapshot.length) {
          if (duplicates)
            log(`Ignored ${duplicates} duplicate submission record(s) from Classroom.`);
          const ids = snapshot.map((r) => r.googleUserId);
          // Identity and attachment details are refreshed from Classroom; grading state
          // deliberately is not, so a student already graded stays graded.
          await db
            .insert(studentResults)
            .values(snapshot)
            .onConflictDoUpdate({
              target: [studentResults.sessionId, studentResults.googleUserId],
              set: {
                name: sql`excluded."name"`,
                email: sql`excluded."email"`,
                photoUrl: sql`excluded."photoUrl"`,
                driveFileId: sql`excluded."driveFileId"`,
                maxPoints: sql`excluded."maxPoints"`,
              },
            });
          // Re-queue whatever still needs work. A row left in `grading` is one whose
          // batch was killed mid-flight; `force` re-queues the finished ones as well.
          await db
            .update(studentResults)
            .set({ state: "pending", error: null })
            .where(
              and(
                eq(studentResults.sessionId, gs.id),
                inArray(studentResults.googleUserId, ids),
                force ? undefined : inArray(studentResults.state, ["error", "grading"])
              )
            );
        }

        // A run abandoned part-way leaves its untouched students pending, and a resume
        // trusts that queue without re-reading the roster. Clear anyone who is no longer
        // on it while we still have it in hand — a pending row holds no grade to lose.
        // Skipped for a named re-grade, which is exempt from the roster filter above and
        // would otherwise delete the very row it just queued.
        if (!resume && !only.length && known.size) {
          const dropped = await db
            .delete(studentResults)
            .where(
              and(
                eq(studentResults.sessionId, gs.id),
                eq(studentResults.state, "pending"),
                notInArray(studentResults.googleUserId, [...known])
              )
            )
            .returning({ id: studentResults.id });
          if (dropped.length)
            log(`Cleared ${dropped.length} queued submission(s) from students who have left the course.`);
        }

        // ---- What's left to grade. Read from our own tables either way, so a batch
        // ---- never has to be told where the previous one stopped — it just asks.
        let pending: StudentResult[] = [];
        if (resume || snapshot.length) {
          pending = await db
            .select()
            .from(studentResults)
            .where(
              and(
                eq(studentResults.sessionId, gs.id),
                eq(studentResults.state, "pending"),
                // A first request stays inside the set it just snapshotted, so it can't
                // wander into rows left pending by some earlier, abandoned run.
                resume
                  ? undefined
                  : inArray(
                      studentResults.googleUserId,
                      snapshot.map((r) => r.googleUserId)
                    )
              )
            )
            .orderBy(studentResults.googleUserId);
        }
        // A named re-grade is explicit and small — run it whole rather than batching it.
        const batch = only.length ? pending : pending.slice(0, limit);

        await db.update(gradingSessions).set({ status: "grading" }).where(eq(gradingSessions.id, gs.id));

        if (!resume) {
          const inRun = new Set(snapshot.map((r) => r.googleUserId));
          const queued = new Set(pending.map((p) => p.googleUserId));
          // Replay the grades this run won't be touching, so the table is complete from
          // the first batch rather than filling in only as students are reached.
          const carried = gs.results.filter(
            (r) => r.state === "done" && inRun.has(r.googleUserId) && !queued.has(r.googleUserId)
          );
          skipped = carried.length;
          for (const r of carried) send({ type: "result", result: serialize(r) });
          log(
            only.length
              ? `Re-grading ${pending.length} submission(s)…`
              : `Found ${snapshot.length} submission(s) in selected state${states.length > 1 ? "s" : ""} (${states.join(", ")}).`
          );
          if (offRoster)
            log(`↷ ${offRoster} submission(s) from students no longer on the roster — skipped.`);
          if (skipped) log(`↷ ${skipped} already graded — skipped (tick “re-grade” to redo).`);
        }
        log(
          batch.length
            ? `Grading ${batch.length} of ${pending.length} remaining, ${CONCURRENCY} at a time…`
            : "Nothing left to grade."
        );
        if (!aiEnabled && batch.length) log("⚠ AI credentials not configured — using demo grades.");

        // Built once per batch from the editable /prompts templates. The user prompt
        // carries each student's transcript, so it's rebuilt per submission below.
        const systemPrompt = aiEnabled && batch.length ? await loadPrompt("grade-system") : "";
        if (aiEnabled && !ocrEnabled && batch.length)
          log("⚠ OCR not configured — reading submissions as images.");

        const run = limiter(CONCURRENCY);

        await Promise.all(
          batch.map((row) =>
            run(async () => {
              // Teacher hit Stop (client disconnected) — don't start new work;
              // anything already in-flight finishes and persists to the DB.
              if (req.signal.aborted) return;

              const name = row.name;
              const base = { name, email: row.email, photoUrl: row.photoUrl, maxPoints };
              const where = and(
                eq(studentResults.sessionId, gs.id),
                eq(studentResults.googleUserId, row.googleUserId)
              );
              try {
                if (!row.driveFileId) throw new Error("No file attached to the submission");

                await db.update(studentResults).set({ state: "grading", error: null }).where(where);

                log(`⬇ Fetching ${name}'s submission…`);
                const file = await api.downloadFile(row.driveFileId);

                let grade: Grade;
                if (!aiEnabled) {
                  await sleep(450);
                  grade = cannedGradeFor(name, maxPoints);
                } else {
                  // The row we picked up already carries the previous run's transcript.
                  const stored = row;

                  // ---- 1. Read the submission into Markdown, and save it, before grading ----
                  let transcript = "";
                  let images: Buffer[] = [];
                  let ocrPages: number | null = null;

                  // Re-grading almost always means the marking scheme changed, not that
                  // the transcript was wrong — so `force` alone reuses it and only the
                  // explicit `reOcr` flag pays to read the submission again.
                  if (!reOcr && stored?.ocrStatus === "done" && stored.markdown?.trim()) {
                    transcript = stored.markdown;
                    ocrPages = stored.ocrPages;
                    images = await figuresFromMarkdown(transcript, MAX_FIGURES);
                    log(`↷ ${name}: reusing the stored transcript.`);
                  } else if (ocrEnabled) {
                    try {
                      await db.update(studentResults).set({ ocrStatus: "running" }).where(where);
                      log(`⌕ Reading ${name}'s submission…`);
                      const out = await ocrDocument(file.buf, {
                        mime: file.mime,
                        name: file.name,
                        maxPages: OCR_MAX_PAGES,
                        trace: {
                          name: "ocr-submission",
                          metadata: { student: name, googleUserId: row.googleUserId, assignment: gs.courseWorkTitle },
                        },
                      });
                      // The transcript replaces the old one — drop the figures it owned.
                      await discardFigures(stored?.markdown ?? null);
                      transcript = await persistFigures(out.markdown, out.figures, gs.id, userId);
                      await db
                        .update(studentResults)
                        .set({ markdown: transcript, ocrStatus: "done", ocrPages: out.pages })
                        .where(where);
                      images = await figuresToPng(out.figures, MAX_FIGURES);
                      ocrPages = out.pages;
                      log(
                        `✓ ${name}: transcribed ${out.pages} page${out.pages === 1 ? "" : "s"}` +
                          (images.length ? ` and ${images.length} figure${images.length === 1 ? "" : "s"}` : "") +
                          `.`
                      );
                    } catch (e) {
                      const why = e instanceof Error ? e.message : String(e);
                      await db.update(studentResults).set({ ocrStatus: "error" }).where(where);
                      log(`⚠ ${name}: OCR failed (${why}) — grading from page images instead.`);
                    }
                  }

                  // ---- 2. No transcript? fall back to the page-image path ----
                  if (!transcript) {
                    if (isPdf(file.mime, file.name)) {
                      const r = await pdfToImages(file.buf, { maxPages: 8 });
                      if (!r.images.length) throw new Error("Could not rasterize the PDF");
                      if (r.truncated)
                        log(`… ${name}: ${r.pageCount} pages — grading the first ${r.images.length}.`);
                      images = r.images;
                    } else if (isImage(file.mime)) {
                      images = [file.buf];
                    } else {
                      throw new Error(`Unsupported file type (${file.mime || "unknown"})`);
                    }
                    if (!ocrEnabled) {
                      await db.update(studentResults).set({ ocrStatus: "skipped" }).where(where);
                    }
                  }

                  // ---- 3. Grade ----
                  const gradeUserPrompt = await loadPrompt("grade", {
                    title: gs.courseWorkTitle,
                    maxPoints,
                    markingScheme: gs.markingScheme,
                    transcript:
                      transcript ||
                      "(not available — read the attached page images of the submission instead)",
                  });

                  log(
                    transcript
                      ? `✦ Grading ${name} from the transcript…`
                      : `✦ Grading ${name} (${images.length} page${images.length > 1 ? "s" : ""})…`
                  );
                  const raw = await callModel({
                    system: systemPrompt,
                    text: gradeUserPrompt,
                    images,
                    maxTokens: 4096, // room for detailed per-student feedback
                    trace: {
                      name: "grade-submission",
                      traceName: "grade-run", // one POST = one run = one trace of N student generations
                      userId,
                      sessionId: gs.id, // groups every student of this run in Langfuse Sessions
                      tags: ["grading"],
                      metadata: {
                        // name + googleUserId identify the student; email left out to keep PII out of telemetry
                        student: name,
                        googleUserId: row.googleUserId,
                        course: gs.courseName,
                        assignment: gs.courseWorkTitle,
                        images: images.length,
                        ocr: Boolean(transcript),
                        ocrPages,
                        maxPoints,
                      },
                    },
                  });
                  const parsed = extractJson(raw);
                  if (!parsed) throw new Error("Model did not return valid JSON");
                  grade = normalizeGrade(parsed, maxPoints);
                }

                const [rec] = await db
                  .update(studentResults)
                  .set({
                    state: "done",
                    score: grade.score,
                    perCriterion: JSON.stringify(grade.perCriterion),
                    feedback: grade.feedback,
                    mime: file.mime,
                    error: null,
                    gradedAt: new Date(),
                  })
                  .where(where)
                  .returning();
                graded++;
                send({ type: "result", result: serialize(rec) });
                log(`✓ ${name}: ${grade.score}/${maxPoints}`);
              } catch (e) {
                failed++;
                const msg = e instanceof Error ? e.message : String(e);
                const [rec] = await db
                  .insert(studentResults)
                  .values({ sessionId: gs.id, googleUserId: row.googleUserId, state: "error", error: msg, ...base })
                  .onConflictDoUpdate({
                    target: [studentResults.sessionId, studentResults.googleUserId],
                    set: { state: "error", error: msg },
                  })
                  .returning();
                send({ type: "result", result: serialize(rec) });
                log(`✗ ${name}: ${msg}`);
              }
            })
          )
        );

        // Recounted rather than subtracted: a batch cut short by Stop leaves its
        // untouched students pending, and the client needs the true number.
        const [{ left }] = await db
          .select({ left: sql<number>`count(*)::int` })
          .from(studentResults)
          .where(and(eq(studentResults.sessionId, gs.id), eq(studentResults.state, "pending")));
        await db
          .update(gradingSessions)
          .set({ status: left > 0 ? "grading" : "done" })
          .where(eq(gradingSessions.id, gs.id));
        if (left > 0) log(`… ${left} submission(s) still to grade.`);
        send({ type: "done", graded, failed, skipped, remaining: left });
      } catch (e) {
        send({ type: "fatal", message: e instanceof Error ? e.message : String(e) });
      } finally {
        try {
          controller.close();
        } catch {}
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
