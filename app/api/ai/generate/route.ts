import { after } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { flushLangfuse } from "@/lib/langfuse";
import { gradingSessions } from "@/db/schema";
import { classroomFor } from "@/lib/classroom";
import { aiEnabled, streamModel } from "@/lib/bedrock";
import { CANNED_SCHEME } from "@/lib/canned";
import { ocrDocument, ocrEnabled } from "@/lib/mistral";
import { isImage, isPdf, pdfToImages } from "@/lib/pdf";
import { loadPrompt } from "@/lib/prompts";
import { readFile } from "@/lib/storage";
import { cannedStream, textStreamResponse } from "@/lib/streaming";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  after(flushLangfuse); // ship traces once the stream finishes

  const session = await auth();
  if (!session?.user) return new Response("Unauthorized", { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { sessionId?: string };
  if (!body.sessionId) return new Response("sessionId required", { status: 400 });

  const gs = await db.query.gradingSessions.findFirst({
    where: eq(gradingSessions.id, body.sessionId),
    with: { files: true },
  });
  if (!gs || gs.teacherId !== session.user.id) return new Response("Not found", { status: 404 });

  if (!aiEnabled) {
    return textStreamResponse(
      cannedStream(`> ⚠️ AI is not configured — showing sample content.\n\n${CANNED_SCHEME}`)
    );
  }

  // Gather assignment context: description from Classroom + the brief itself,
  // as OCR'd Markdown where we have it and page images otherwise.
  let description = "";
  let images: Buffer[] = [];
  let brief = "";
  const api = classroomFor(session.user.id);
  try {
    const works = await api.listCourseWork(gs.courseId);
    description = works.find((w) => w.id === gs.courseWorkId)?.description ?? "";
  } catch {
    // classroom unreachable — still generate from the title
  }
  try {
    const uploaded = gs.files.find((f) => f.kind === "assignment");
    if (gs.assignmentSource === "upload" && uploaded) {
      if (uploaded.ocrStatus === "done" && uploaded.markdown?.trim()) {
        brief = uploaded.markdown; // already transcribed at upload time
      } else {
        const buf = await readFile(uploaded.path);
        if (isPdf(uploaded.mime, uploaded.originalName)) {
          images = (await pdfToImages(buf, { maxPages: 6 })).images;
        } else if (isImage(uploaded.mime)) {
          images = [buf];
        }
      }
    } else if (gs.assignmentDriveId) {
      const f = await api.downloadFile(gs.assignmentDriveId);
      if (ocrEnabled) {
        // a Classroom-attached brief has no uploaded_file row to cache into,
        // so read it here and fall back to rasters if that fails
        try {
          brief = (
            await ocrDocument(f.buf, {
              mime: f.mime,
              name: f.name,
              trace: { name: "ocr-brief", userId: session.user.id, sessionId: gs.id },
            })
          ).markdown;
        } catch {
          brief = "";
        }
      }
      if (!brief && isPdf(f.mime, f.name)) {
        images = (await pdfToImages(f.buf, { maxPages: 6 })).images;
      }
    }
  } catch {
    // no assignment content — generate from title/description alone
  }

  const prompt = await loadPrompt("generate-marking-scheme", {
    title: gs.courseWorkTitle,
    description: description.trim() || "(none provided)",
    maxPoints: gs.maxPoints ?? "an unspecified number of",
    assignmentText: brief.trim()
      ? `\n\n--- ASSIGNMENT PAPER (transcribed to Markdown) ---\n${brief}\n--- END OF ASSIGNMENT PAPER ---`
      : "",
  });
  return textStreamResponse(
    streamModel({
      text: prompt,
      images,
      maxTokens: 4096,
      temperature: 0.3,
      trace: {
        name: "generate-marking-scheme",
        userId: session.user.id,
        sessionId: gs.id,
        tags: ["generate", "marking-scheme"],
        metadata: {
          course: gs.courseName,
          assignment: gs.courseWorkTitle,
          pages: images.length,
          brief: brief ? "transcript" : images.length ? "images" : "none",
          maxPoints: gs.maxPoints ?? null,
        },
      },
    })
  );
}
