import { after } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { flushLangfuse } from "@/lib/langfuse";
import { gradingSessions, studentResults, type StudentResult } from "@/db/schema";
import { classroomFor } from "@/lib/classroom";
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
export const maxDuration = 600;

const enc = new TextEncoder();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// OCR pages cost far less than vision tokens, so we can read further into a long
// submission than the 8-page raster cap allowed. Figures are still model input,
// so they stay capped.
const OCR_MAX_PAGES = 15;
const MAX_FIGURES = 6;

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

  const api = classroomFor(userId);
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
  const targets = only.length
    ? submissions.filter((s) => only.includes(s.userId))
    : submissions.filter((s) => states.includes(s.state));

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
        await db.update(gradingSessions).set({ status: "grading" }).where(eq(gradingSessions.id, gs.id));
        log(
          only.length
            ? `Re-grading ${targets.length} submission(s)…`
            : `Found ${targets.length} submission(s) in selected state${states.length > 1 ? "s" : ""} (${states.join(", ")}).`
        );
        if (!aiEnabled) log("⚠ AI credentials not configured — using demo grades.");

        // Built once per run from the editable /prompts templates. The user prompt
        // carries each student's transcript, so it's rebuilt per submission below.
        const systemPrompt = aiEnabled ? await loadPrompt("grade-system") : "";
        if (aiEnabled && !ocrEnabled) log("⚠ OCR not configured — reading submissions as images.");

        const alreadyDone = new Map(
          gs.results.filter((r) => r.state === "done").map((r) => [r.googleUserId, r])
        );
        const previous = new Map(gs.results.map((r) => [r.googleUserId, r]));
        const run = limiter(2);
        let graded = 0;
        let failed = 0;
        let skipped = 0;

        await Promise.all(
          targets.map((sub) =>
            run(async () => {
              // Teacher hit Stop (client disconnected) — don't start new work;
              // anything already in-flight finishes and persists to the DB.
              if (req.signal.aborted) return;

              const student = byUser.get(sub.userId);
              const name = student?.name ?? `Student …${sub.userId.slice(-4)}`;

              const prev = alreadyDone.get(sub.userId);
              if (prev && !force) {
                skipped++;
                send({ type: "result", result: serialize(prev) });
                log(`↷ ${name} is already graded — skipped (tick “re-grade” to redo).`);
                return;
              }

              const base = {
                name,
                email: student?.email ?? null,
                photoUrl: student?.photoUrl ?? null,
                maxPoints,
              };
              try {
                const att = sub.attachments.find((a) => a.driveFileId);
                if (!att?.driveFileId) throw new Error("No file attached to the submission");

                await db
                  .insert(studentResults)
                  .values({ sessionId: gs.id, googleUserId: sub.userId, state: "grading", driveFileId: att.driveFileId, ...base })
                  .onConflictDoUpdate({
                    target: [studentResults.sessionId, studentResults.googleUserId],
                    set: { state: "grading", error: null, driveFileId: att.driveFileId, ...base },
                  });

                log(`⬇ Fetching ${name}'s submission…`);
                const file = await api.downloadFile(att.driveFileId);

                let grade: Grade;
                if (!aiEnabled) {
                  await sleep(450);
                  grade = cannedGradeFor(name, maxPoints);
                } else {
                  const where = and(
                    eq(studentResults.sessionId, gs.id),
                    eq(studentResults.googleUserId, sub.userId)
                  );
                  const stored = previous.get(sub.userId);

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
                          metadata: { student: name, googleUserId: sub.userId, assignment: gs.courseWorkTitle },
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
                        googleUserId: sub.userId,
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
                  .where(
                    and(eq(studentResults.sessionId, gs.id), eq(studentResults.googleUserId, sub.userId))
                  )
                  .returning();
                graded++;
                send({ type: "result", result: serialize(rec) });
                log(`✓ ${name}: ${grade.score}/${maxPoints}`);
              } catch (e) {
                failed++;
                const msg = e instanceof Error ? e.message : String(e);
                const [rec] = await db
                  .insert(studentResults)
                  .values({ sessionId: gs.id, googleUserId: sub.userId, state: "error", error: msg, ...base })
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

        await db.update(gradingSessions).set({ status: "done" }).where(eq(gradingSessions.id, gs.id));
        send({ type: "done", graded, failed, skipped });
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
