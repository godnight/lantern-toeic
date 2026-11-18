import actualManifest from "./natural-media-manifest.json";

// This is a fixed public release, never a visitor-selected URL or live branch.
export const NATURAL_MEDIA_UPSTREAM_COMMIT = "ea3b729174763ac5a63e86bcb729a5ff865e3cbb";
export const NATURAL_MEDIA_UPSTREAM_BASE = `https://raw.githubusercontent.com/godnight/lantern-toeic/${NATURAL_MEDIA_UPSTREAM_COMMIT}/public`;
const PREFIX = "/audio/natural/";
const MAX_FILE_BYTES = 16 * 1024 * 1024;

interface MediaEntry {
  path: string;
  bytes: number;
  sha256: string;
  contentType: string;
}
interface MediaManifest {
  schemaVersion: number;
  upstreamCommit: string;
  upstreamBase: string;
  entries: readonly MediaEntry[];
}
type UpstreamFetch = (request: Request) => Promise<Response>;
type ByteRange = { start: number; end: number };

function parseRange(value: string, size: number): ByteRange | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2])) return null;
  const first = match[1] ? Number(match[1]) : null;
  const last = match[2] ? Number(match[2]) : null;
  if ((first !== null && !Number.isSafeInteger(first)) || (last !== null && !Number.isSafeInteger(last))) return null;
  if (first === null) {
    if (last === null || last <= 0) return null;
    return { start: Math.max(0, size - last), end: size - 1 };
  }
  if (first >= size || (last !== null && last < first)) return null;
  return { start: first, end: Math.min(last ?? size - 1, size - 1) };
}

function errorResponse(request: Request, status: number, message: string, extra?: Record<string, string>): Response {
  return new Response(request.method === "HEAD" ? null : message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...extra },
  });
}

function validateUpstream(response: Response, entry: MediaEntry): void {
  if (response.status !== 200 || response.redirected) throw new Error("Unexpected upstream status");
  const contentType = response.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase();
  const acceptedType = entry.contentType === "audio/mpeg"
    ? contentType === "audio/mpeg"
    : contentType === "application/json" || contentType === "text/plain";
  if (!acceptedType) throw new Error("Unexpected upstream MIME type");
  const length = response.headers.get("Content-Length");
  if (!length || !/^\d+$/.test(length) || Number(length) !== entry.bytes) throw new Error("Unexpected upstream length");
  const encoding = response.headers.get("Content-Encoding");
  if (encoding && encoding.toLowerCase() !== "identity") throw new Error("Unexpected upstream content encoding");
}

async function readExactBody(response: Response, expectedBytes: number, controller: AbortController): Promise<Uint8Array<ArrayBuffer>> {
  if (!response.body) throw new Error("Missing upstream body");
  const reader = response.body.getReader();
  const result = new Uint8Array(expectedBytes);
  let used = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (used + value.byteLength > expectedBytes) throw new Error("Upstream body exceeds manifest length");
      result.set(value, used);
      used += value.byteLength;
    }
    if (used !== expectedBytes) throw new Error("Truncated upstream body");
    return result;
  } catch (error) {
    controller.abort();
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}

/** The injection seam is for tests; production always uses the imported sealed manifest. */
export function createNaturalMediaHandler(
  manifest: MediaManifest,
  fetchUpstream: UpstreamFetch = (request) => fetch(request),
  timeoutMs = 20_000,
): (request: Request) => Promise<Response | null> {
  if (manifest.schemaVersion !== 1 || manifest.upstreamCommit !== NATURAL_MEDIA_UPSTREAM_COMMIT ||
      manifest.upstreamBase !== NATURAL_MEDIA_UPSTREAM_BASE || !Array.isArray(manifest.entries) ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) throw new Error("Invalid fixed media manifest");
  const entries = new Map<string, MediaEntry>();
  for (const entry of manifest.entries) {
    if (!/^\/audio\/natural\/[a-zA-Z0-9_-]+\/(?:[a-f0-9]{64}\.mp3|manifest\.json|admission\.json)$/.test(entry.path) ||
        !Number.isSafeInteger(entry.bytes) || entry.bytes <= 0 || entry.bytes > MAX_FILE_BYTES ||
        !/^[a-f0-9]{64}$/.test(entry.sha256) ||
        entry.contentType !== (entry.path.endsWith(".mp3") ? "audio/mpeg" : "application/json") || entries.has(entry.path)) {
      throw new Error("Invalid or duplicate media entry");
    }
    entries.set(entry.path, Object.freeze({ ...entry }));
  }

  return async (request) => {
    const pathname = new URL(request.url).pathname;
    if (!pathname.startsWith(PREFIX) && pathname !== "/audio/natural") return null;
    const entry = entries.get(pathname);
    if (!entry) return errorResponse(request, 404, "Media not found");
    if (request.method !== "GET" && request.method !== "HEAD") return errorResponse(request, 405, "Method not allowed", { Allow: "GET, HEAD" });

    const etag = `"sha256-${entry.sha256}"`;
    const rangeHeader = request.headers.get("Range");
    const ifRange = request.headers.get("If-Range");
    const useRange = rangeHeader !== null && (ifRange === null || ifRange === etag);
    const range = useRange ? parseRange(rangeHeader, entry.bytes) : null;
    if (useRange && !range) return errorResponse(request, 416, "Range not satisfiable", { "Content-Range": `bytes */${entry.bytes}`, "Accept-Ranges": "bytes" });

    const controller = new AbortController();
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      deadline = setTimeout(() => { controller.abort(); reject(new Error("Media upstream timeout")); }, timeoutMs);
    });
    const work = async (): Promise<Response> => {
      // Construct all upstream headers here. No cookies, authorization, visitor,
      // origin, range or other caller headers can reach the public media host.
      const upstream = await fetchUpstream(new Request(NATURAL_MEDIA_UPSTREAM_BASE + entry.path, {
        method: request.method,
        headers: { Accept: entry.contentType, "Accept-Encoding": "identity" },
        redirect: "manual",
        signal: controller.signal,
      }));
      validateUpstream(upstream, entry);
      let body: Uint8Array<ArrayBuffer> | null = null;
      if (request.method === "GET") {
        body = await readExactBody(upstream, entry.bytes, controller);
        const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", body));
        const sha256 = Array.from(digest, (value) => value.toString(16).padStart(2, "0")).join("");
        if (sha256 !== entry.sha256) throw new Error("Upstream SHA256 mismatch");
      }
      const headers = new Headers({
        "Content-Type": entry.contentType,
        "Content-Length": String(range ? range.end - range.start + 1 : entry.bytes),
        "Accept-Ranges": "bytes",
        ETag: etag,
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      });
      if (range) {
        headers.set("Content-Range", `bytes ${range.start}-${range.end}/${entry.bytes}`);
        if (body) body = body.slice(range.start, range.end + 1);
      }
      return new Response(body, { status: range ? 206 : 200, headers });
    };
    try {
      return await Promise.race([work(), timeout]);
    } catch {
      controller.abort();
      return errorResponse(request, 502, "Media upstream unavailable");
    } finally {
      if (deadline !== undefined) clearTimeout(deadline);
    }
  };
}

export const handleNaturalMediaRequest = createNaturalMediaHandler(actualManifest);
