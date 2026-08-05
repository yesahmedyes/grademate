import sharp from "sharp";
import { after } from "next/server";
import { auth } from "@/lib/auth";
import { flushLangfuse } from "@/lib/langfuse";
import { aiEnabled, streamModel } from "@/lib/bedrock";
import { CANNED_SCHEME } from "@/lib/canned";
import { ocrDocument, ocrEnabled, persistFigures } from "@/lib/mistral";
import { isImage, isPdf, pdfToImages } from "@/lib/pdf";
import { loadPrompt } from "@/lib/prompts";
import { cannedStream, textStreamResponse } from "@/lib/streaming";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  after(flushLangfuse); // ship traces once the stream finishes

  const session = await auth();
  if (!session?.user) return new Response("Unauthorized", { status: 401 });

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return new Response("No file", { status: 400 });
  if (file.size > 25 * 1024 * 1024) return new Response("File too large", { status: 400 });

  const buf = Buffer.from(await file.arrayBuffer());
  const mime = file.type || "";

  // plain text / markdown: no AI needed
  if (mime.startsWith("text/") || /\.(md|txt|markdown)$/i.test(file.name)) {
    return textStreamResponse(cannedStream(buf.toString("utf8")));
  }

  // Mistral OCR reads equations and tables far better than a vision pass, so it's
  // the preferred path; anything it can't do falls through to the model below.
  if (ocrEnabled && (isPdf(mime, file.name) || isImage(mime))) {
    try {
      const out = await ocrDocument(buf, {
        mime,
        name: file.name,
        trace: { name: "ocr-transcribe", userId: session.user.id, metadata: { filename: file.name } },
      });
      const markdown = await persistFigures(out.markdown, out.figures, null, session.user.id);
      return textStreamResponse(cannedStream(markdown));
    } catch {
      // fall through to the vision transcription below
    }
  }

  if (!aiEnabled) {
    return textStreamResponse(
      cannedStream(`> ⚠️ AI is not configured — showing sample content.\n\n${CANNED_SCHEME}`)
    );
  }

  let images: Buffer[];
  if (isPdf(mime, file.name)) {
    images = (await pdfToImages(buf, { maxPages: 6 })).images;
  } else if (isImage(mime)) {
    images = [await sharp(buf).resize({ width: 1280, withoutEnlargement: true }).png().toBuffer()];
  } else {
    return new Response("Unsupported file type — upload a PDF, image, or text/Markdown file", {
      status: 415,
    });
  }

  const prompt = await loadPrompt("transcribe");
  return textStreamResponse(
    streamModel({
      text: prompt,
      images,
      maxTokens: 4096,
      temperature: 0,
      trace: {
        name: "transcribe-document",
        userId: session.user.id,
        tags: ["transcribe", "marking-scheme"],
        metadata: { filename: file.name, mime, pages: images.length },
      },
    })
  );
}
