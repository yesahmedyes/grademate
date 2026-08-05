import { auth } from "@/lib/auth";
import { classroomFor } from "@/lib/classroom";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ fileId: string }> }) {
  const session = await auth();
  if (!session?.user) return new Response("Unauthorized", { status: 401 });
  const { fileId } = await params;

  try {
    const api = classroomFor(session.user.id);
    const { buf, mime, name } = await api.downloadFile(fileId);
    return new Response(new Uint8Array(buf), {
      headers: {
        "content-type": mime,
        "content-disposition": `inline; filename="${name.replace(/["\r\n]/g, "")}"`,
        "cache-control": "private, max-age=300",
      },
    });
  } catch (e) {
    return new Response(`Could not fetch file: ${e instanceof Error ? e.message : e}`, {
      status: 502,
    });
  }
}
