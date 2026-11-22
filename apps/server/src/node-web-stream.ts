import type { Readable } from "node:stream";

/**
 * Exposes a Node byte stream (a file or an incoming request) as a Fetch API
 * `ReadableStream`. `Readable.toWeb()` does the same at runtime, but its result
 * is typed as `node:stream/web`'s stream, which TypeScript will not accept as a
 * `BodyInit`. Chunks are pulled on demand, so backpressure is kept, and
 * cancelling the web stream destroys the Node one.
 */
export function nodeReadableToWeb(source: Readable): ReadableStream<Uint8Array> {
  const chunks = source[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await chunks.next();
      if (next.done) {
        controller.close();
        return;
      }
      const chunk: unknown = next.value;
      if (chunk instanceof Uint8Array) controller.enqueue(chunk);
      else if (typeof chunk === "string") controller.enqueue(Buffer.from(chunk));
      else throw new TypeError("Expected a byte stream");
    },
    cancel(reason) {
      source.destroy(reason instanceof Error ? reason : undefined);
    },
  });
}
