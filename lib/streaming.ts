const enc = new TextEncoder();

/** Wrap an async generator of text chunks as a streaming plain-text Response. */
export function textStreamResponse(gen: AsyncGenerator<string>) {
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await gen.next();
        if (done) controller.close();
        else controller.enqueue(enc.encode(value));
      } catch (e) {
        controller.enqueue(enc.encode(`\n\n> ⚠️ ${e instanceof Error ? e.message : String(e)}`));
        controller.close();
      }
    },
    cancel() {
      gen.return(undefined as never).catch(() => {});
    },
  });
  return new Response(stream, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Stream canned text word-by-word so the UI demo still feels live without AI creds. */
export async function* cannedStream(text: string): AsyncGenerator<string> {
  for (const word of text.split(/(?<=\s)/)) {
    yield word;
    await sleep(12);
  }
}
