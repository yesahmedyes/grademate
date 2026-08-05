import { after } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { gradingSessions, uploadedFiles } from "@/db/schema";
import { discardFigures, ocrEnabled } from "@/lib/mistral";
import { runUploadOcr } from "@/lib/ocr-job";
import { deleteFile, saveFile } from "@/lib/storage";

export const dynamic = "force-dynamic";

const KINDS = new Set(["assignment", "markingScheme"]);

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const form = await req.formData();
  const file = form.get("file");
  const kind = String(form.get("kind") ?? "");
  const sessionId = form.get("sessionId") ? String(form.get("sessionId")) : null;

  if (!(file instanceof File)) return Response.json({ error: "No file" }, { status: 400 });
  if (!KINDS.has(kind)) return Response.json({ error: "Bad kind" }, { status: 400 });
  if (file.size > 50 * 1024 * 1024)
    return Response.json({ error: "File too large (max 50 MB)" }, { status: 400 });

  if (sessionId) {
    const gs = await db.query.gradingSessions.findFirst({
      where: eq(gradingSessions.id, sessionId),
    });
    if (!gs || gs.teacherId !== session.user.id)
      return Response.json({ error: "Session not found" }, { status: 404 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const mime = file.type || "application/octet-stream";
  const rel = await saveFile(buf, file.name || kind, mime);

  if (sessionId) {
    // one live file per kind per session — take its OCR figures down with it
    const old = await db.query.uploadedFiles.findMany({
      where: and(eq(uploadedFiles.sessionId, sessionId), eq(uploadedFiles.kind, kind)),
    });
    for (const o of old) {
      await discardFigures(o.markdown);
      await deleteFile(o.path);
    }
    await db
      .delete(uploadedFiles)
      .where(and(eq(uploadedFiles.sessionId, sessionId), eq(uploadedFiles.kind, kind)));
  }
  const [rec] = await db
    .insert(uploadedFiles)
    .values({
      ownerId: session.user.id,
      sessionId,
      kind,
      path: rel,
      originalName: file.name || kind,
      mime,
      ocrStatus: ocrEnabled ? "pending" : "skipped",
    })
    .returning();

  if (sessionId && kind === "assignment") {
    await db
      .update(gradingSessions)
      .set({ assignmentSource: "upload" })
      .where(eq(gradingSessions.id, sessionId));
  }

  // Transcribe after the response — a multi-page brief takes seconds, and the
  // client watches `ocrStatus` rather than waiting on the upload.
  if (ocrEnabled) after(() => runUploadOcr(rec.id));

  return Response.json({
    id: rec.id,
    originalName: rec.originalName,
    mime: rec.mime,
    ocrStatus: rec.ocrStatus,
  });
}
