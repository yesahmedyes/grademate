import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { uploadedFiles } from "@/db/schema";
import { flushLangfuse } from "@/lib/langfuse";
import { ocrDocument, ocrEnabled, persistFigures } from "@/lib/mistral";
import { readFile } from "@/lib/storage";

/** A run left in `running` for longer than this is assumed dead (server restart). */
export const OCR_STALE_MS = 2 * 60 * 1000;

/**
 * OCR an already-stored upload in the background.
 *
 * Called from `after()` so the upload response isn't held open; the client watches
 * `ocrStatus` on the file row instead. Never throws — a failure is recorded on the
 * row and every consumer falls back to the rasterize + vision path.
 */
export async function runUploadOcr(fileId: string): Promise<void> {
  const rec = await db.query.uploadedFiles.findFirst({ where: eq(uploadedFiles.id, fileId) });
  if (!rec) return;

  if (!ocrEnabled) {
    await db
      .update(uploadedFiles)
      .set({ ocrStatus: "skipped" })
      .where(eq(uploadedFiles.id, fileId));
    return;
  }

  try {
    await db.update(uploadedFiles).set({ ocrStatus: "running" }).where(eq(uploadedFiles.id, fileId));

    const buf = await readFile(rec.path);
    const out = await ocrDocument(buf, {
      mime: rec.mime,
      name: rec.originalName,
      trace: {
        name: "ocr-upload",
        metadata: { kind: rec.kind, sessionId: rec.sessionId, filename: rec.originalName },
      },
    });
    const markdown = await persistFigures(out.markdown, out.figures, rec.sessionId, rec.ownerId);

    await db
      .update(uploadedFiles)
      .set({ markdown, ocrStatus: "done", ocrPages: out.pages, ocrError: null })
      .where(eq(uploadedFiles.id, fileId));
  } catch (e) {
    await db
      .update(uploadedFiles)
      .set({ ocrStatus: "error", ocrError: e instanceof Error ? e.message : String(e) })
      .where(eq(uploadedFiles.id, fileId))
      .catch(() => {});
  } finally {
    await flushLangfuse();
  }
}

/** A `running` row from a process that died never finishes — surface it as an error. */
export function isStaleOcr(status: string, createdAt: Date): boolean {
  return status === "running" && Date.now() - createdAt.getTime() > OCR_STALE_MS;
}
