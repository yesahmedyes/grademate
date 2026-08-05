import sharp from "sharp";
import { inArray } from "drizzle-orm";
import { startObservation } from "@langfuse/tracing";
import { db } from "@/lib/db";
import { uploadedFiles } from "@/db/schema";
import { deleteFile, readFile, saveFile } from "@/lib/storage";

const KEY = process.env.MISTRAL_API_KEY ?? "";
const OCR_URL = "https://api.mistral.ai/v1/ocr";
export const OCR_MODEL = process.env.MISTRAL_OCR_MODEL ?? "mistral-ocr-latest";

/** True when Mistral is configured; otherwise every caller falls back to the vision path. */
export const ocrEnabled = Boolean(KEY);

/** Mistral's own hard limits — reject early rather than burn a round trip. */
const MAX_BYTES = 50 * 1024 * 1024;
const TIMEOUT_MS = 90_000;

export type OcrFigure = { id: string; buf: Buffer; mime: string };
export type OcrResult = { markdown: string; figures: OcrFigure[]; pages: number };

type OcrImage = { id?: string; image_base64?: string };
type OcrPage = { index?: number; markdown?: string; images?: OcrImage[] };
type OcrResponse = {
  pages?: OcrPage[];
  usage_info?: { pages_processed?: number; doc_size_bytes?: number };
};

/** Mistral takes documents as base64 data URIs, so buffers need no Files API round trip. */
function documentPart(buf: Buffer, mime: string, name: string) {
  const b64 = buf.toString("base64");
  if (mime.includes("pdf") || name.toLowerCase().endsWith(".pdf")) {
    return { type: "document_url", document_url: `data:application/pdf;base64,${b64}` };
  }
  if (mime.startsWith("image/")) {
    return { type: "image_url", image_url: `data:${mime};base64,${b64}` };
  }
  throw new Error(`OCR does not support ${mime || "this file type"}`);
}

/**
 * `image_base64` comes back either bare or as a full data URI depending on the
 * document — accept both and recover the real mime when it's there.
 */
function decodeFigure(id: string, raw: string): OcrFigure | null {
  const m = raw.match(/^data:([^;,]+);base64,(.*)$/s);
  const mime = m ? m[1] : "image/jpeg";
  const b64 = (m ? m[2] : raw).trim();
  if (!b64) return null;
  const buf = Buffer.from(b64, "base64");
  return buf.length ? { id, buf, mime } : null;
}

async function post(body: unknown, attempt = 0): Promise<OcrResponse> {
  let res: Response;
  try {
    res = await fetch(OCR_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    // network error or timeout — one retry, then give up so the caller can fall back
    if (attempt === 0) return post(body, 1);
    throw new Error(`Mistral OCR unreachable: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    // 429/5xx are worth one retry; 4xx won't get better by asking again
    if (attempt === 0 && (res.status === 429 || res.status >= 500)) {
      await new Promise((r) => setTimeout(r, 1500));
      return post(body, 1);
    }
    throw new Error(`Mistral OCR ${res.status}: ${detail || res.statusText}`);
  }
  return (await res.json()) as OcrResponse;
}

export type OcrOptions = {
  mime: string;
  name: string;
  maxPages?: number;
  /** Langfuse context — matches the shape used by lib/bedrock.ts. */
  trace?: {
    name?: string;
    userId?: string;
    sessionId?: string;
    metadata?: Record<string, unknown>;
  };
};

/**
 * Convert a PDF or image to Markdown (LaTeX equations, Markdown tables) plus the
 * figures it contains. Throws on any failure — callers are expected to fall back
 * to the rasterize + vision path rather than fail the request.
 */
export async function ocrDocument(buf: Buffer, opts: OcrOptions): Promise<OcrResult> {
  if (!ocrEnabled) throw new Error("MISTRAL_API_KEY is not configured");
  if (buf.length > MAX_BYTES) throw new Error("File is larger than the 50 MB OCR limit");

  const { mime, name, maxPages = 15 } = opts;
  const body = {
    model: OCR_MODEL,
    document: documentPart(buf, mime, name),
    // 0-indexed; caps cost on a long document rather than letting it run away
    pages: Array.from({ length: maxPages }, (_, i) => i),
    include_image_base64: true,
    table_format: "markdown",
  };

  const span = startObservation(
    opts.trace?.name ?? "mistral-ocr",
    {
      model: OCR_MODEL,
      input: { file: name, mime, bytes: buf.length, maxPages },
      metadata: opts.trace?.metadata,
    },
    { asType: "generation" }
  );

  try {
    const json = await post(body);
    const pages = json.pages ?? [];
    if (!pages.length) throw new Error("Mistral OCR returned no pages");

    const figures: OcrFigure[] = [];
    for (const page of pages) {
      for (const img of page.images ?? []) {
        if (!img.id || !img.image_base64) continue;
        const fig = decodeFigure(img.id, img.image_base64);
        if (fig) figures.push(fig);
      }
    }

    // Page breaks matter for grading ("question 3 is on page 2"), so keep them visible.
    const markdown = pages
      .map((p) => (p.markdown ?? "").trim())
      .filter(Boolean)
      .join("\n\n---\n\n");
    if (!markdown) throw new Error("Mistral OCR returned no text");

    const pagesProcessed = json.usage_info?.pages_processed ?? pages.length;
    span.update({
      output: { chars: markdown.length, figures: figures.length, pages: pagesProcessed },
      usageDetails: { pages: pagesProcessed },
    });
    return { markdown, figures, pages: pagesProcessed };
  } catch (e) {
    span.update({ level: "ERROR", statusMessage: e instanceof Error ? e.message : String(e) });
    throw e;
  } finally {
    span.end();
  }
}

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

/**
 * Persist OCR figures to storage and repoint the Markdown at them.
 *
 * Mistral emits `![img-0.jpeg](img-0.jpeg)` where the target is the figure id, which
 * means nothing outside the response. Each figure becomes an `uploaded_file` row of
 * kind `ocrImage`, so the existing `/api/files/[id]` handler serves it with the same
 * ownership check as any other upload. `sessionId` is null for a marking-scheme
 * transcribe, which is why `ownerId` — not the session — is what that check reads.
 */
export async function persistFigures(
  markdown: string,
  figures: OcrFigure[],
  sessionId: string | null,
  ownerId: string
): Promise<string> {
  let out = markdown;
  for (const fig of figures) {
    try {
      const ext = EXT[fig.mime] ?? "png";
      const path = await saveFile(fig.buf, `${fig.id}.${ext}`, fig.mime);
      const [rec] = await db
        .insert(uploadedFiles)
        .values({
          ownerId,
          sessionId,
          kind: "ocrImage",
          path,
          originalName: fig.id,
          mime: fig.mime,
          ocrStatus: "skipped", // a figure is OCR output, never OCR input
        })
        .returning();
      // Replace the bare id wherever it is used as a link/image target.
      out = out.split(`(${fig.id})`).join(`(/api/files/${rec.id})`);
    } catch {
      // A figure that won't save shouldn't cost us the whole transcript —
      // leave its original reference in place and move on.
    }
  }
  return out;
}

/** The figure ids a stored transcript points at — its own links are the record of what belongs to it. */
function figureIds(markdown: string): string[] {
  return [...markdown.matchAll(/\/api\/files\/([0-9a-fA-F-]{36})/g)].map((m) => m[1]);
}

/**
 * Reload a stored transcript's figures as PNG buffers for the model.
 *
 * `lib/bedrock.ts` labels every image `image/png` in its data URI, and Mistral
 * usually hands back JPEG, so convert rather than lie about the mime.
 */
export async function figuresFromMarkdown(markdown: string, limit: number): Promise<Buffer[]> {
  const ids = figureIds(markdown).slice(0, limit);
  if (!ids.length) return [];
  const rows = await db.query.uploadedFiles.findMany({ where: inArray(uploadedFiles.id, ids) });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out: Buffer[] = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (!row || row.kind !== "ocrImage") continue;
    try {
      out.push(await sharp(await readFile(row.path)).png().toBuffer());
    } catch {
      // figure unreadable from storage — grade without it
    }
  }
  return out;
}

/** Convert freshly extracted figures to PNG for the model (see figuresFromMarkdown). */
export async function figuresToPng(figures: OcrFigure[], limit: number): Promise<Buffer[]> {
  const out: Buffer[] = [];
  for (const fig of figures.slice(0, limit)) {
    try {
      out.push(await sharp(fig.buf).png().toBuffer());
    } catch {
      // undecodable figure — skip it
    }
  }
  return out;
}

/** Drop the figures a superseded transcript owned, so re-runs don't pile up files. */
export async function discardFigures(markdown: string | null): Promise<void> {
  const ids = markdown ? figureIds(markdown) : [];
  if (!ids.length) return;
  try {
    const rows = await db.query.uploadedFiles.findMany({ where: inArray(uploadedFiles.id, ids) });
    const stale = rows.filter((r) => r.kind === "ocrImage");
    if (!stale.length) return;
    await Promise.all(stale.map((r) => deleteFile(r.path)));
    await db.delete(uploadedFiles).where(
      inArray(
        uploadedFiles.id,
        stale.map((r) => r.id)
      )
    );
  } catch {
    // cleanup is best-effort; never block the run that's replacing them
  }
}
