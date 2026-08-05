import sharp from "sharp";

export type RasterizeOptions = {
  maxPages?: number;
  maxWidth?: number;
};

/**
 * Rasterize a PDF into PNG page images sized for the vision model.
 * Real submissions include 16 MB phone scans — downscale and cap pages
 * to keep tokens and latency sane.
 */
export async function pdfToImages(
  buf: Buffer,
  { maxPages = 8, maxWidth = 1280 }: RasterizeOptions = {}
): Promise<{ images: Buffer[]; pageCount: number; truncated: boolean }> {
  const { pdf } = await import("pdf-to-img");
  const doc = await pdf(new Uint8Array(buf), { scale: 2 });
  const images: Buffer[] = [];
  let pageCount = 0;
  for await (const page of doc) {
    pageCount++;
    if (images.length < maxPages) {
      let img: Buffer = Buffer.from(page);
      const meta = await sharp(img).metadata();
      if ((meta.width ?? 0) > maxWidth) {
        img = await sharp(img).resize({ width: maxWidth }).png().toBuffer();
      }
      images.push(img);
    }
  }
  return { images, pageCount, truncated: pageCount > images.length };
}

export function isPdf(mime: string | undefined | null, name?: string | null) {
  return (mime ?? "").includes("pdf") || (name ?? "").toLowerCase().endsWith(".pdf");
}

export function isImage(mime: string | undefined | null) {
  return (mime ?? "").startsWith("image/");
}
