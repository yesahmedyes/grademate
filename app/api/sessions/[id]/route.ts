import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { gradingSessions } from "@/db/schema";
import { isStaleOcr } from "@/lib/ocr-job";

export const dynamic = "force-dynamic";

async function owned(id: string, userId: string) {
  const gs = await db.query.gradingSessions.findFirst({
    where: eq(gradingSessions.id, id),
    with: { results: true, files: true },
  });
  return gs && gs.teacherId === userId ? gs : null;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const gs = await owned((await params).id, session.user.id);
  if (!gs) return Response.json({ error: "Not found" }, { status: 404 });
  // The wizard polls this every couple of seconds while OCR runs, so leave the
  // transcripts out of the payload and don't report a dead job as still running.
  return Response.json({
    ...gs,
    files: gs.files.map(({ markdown, ...f }) => ({
      ...f,
      hasMarkdown: Boolean(markdown?.trim()),
      ocrStatus: isStaleOcr(f.ocrStatus, f.createdAt) ? "error" : f.ocrStatus,
    })),
  });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const gs = await owned((await params).id, session.user.id);
  if (!gs) return Response.json({ error: "Not found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const data: Partial<typeof gradingSessions.$inferInsert> = {};
  if (typeof body.markingScheme === "string") data.markingScheme = body.markingScheme;
  if (typeof body.assignmentSource === "string") data.assignmentSource = body.assignmentSource;
  if (typeof body.assignmentDriveId === "string") data.assignmentDriveId = body.assignmentDriveId;
  if (typeof body.status === "string") data.status = body.status;
  if (Object.keys(data).length === 0)
    return Response.json({ error: "Nothing to update" }, { status: 400 });

  const [updated] = await db
    .update(gradingSessions)
    .set(data)
    .where(eq(gradingSessions.id, gs.id))
    .returning();
  return Response.json(updated);
}
