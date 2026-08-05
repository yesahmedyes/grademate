import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { uploadedFiles } from "@/db/schema";
import { FileMissingError, readFile } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;

  const rec = await db.query.uploadedFiles.findFirst({ where: eq(uploadedFiles.id, id) });
  // Owner, not session: a marking-scheme OCR figure has no parent session, and the
  // old session-join check silently served those files to any signed-in user.
  if (!rec || rec.ownerId !== session.user.id) {
    return new Response("Not found", { status: 404 });
  }

  try {
    const buf = await readFile(rec.path);
    return new Response(new Uint8Array(buf), {
      headers: {
        "content-type": rec.mime,
        "content-disposition": `inline; filename="${rec.originalName.replace(/["\r\n]/g, "")}"`,
      },
    });
  } catch (e) {
    // Only a genuinely absent object is a 410 — a credentials or connectivity
    // failure is ours, and must not be reported to the client as "deleted".
    if (e instanceof FileMissingError) {
      return new Response("File missing from storage", { status: 410 });
    }
    console.error("storage read failed", { id, path: rec.path, error: e });
    return new Response("Storage unavailable", { status: 500 });
  }
}
