import fs from "fs";
import path from "path";
import crypto from "crypto";
import { getDbPath, readJsonDb, writeJsonDb } from "../queries/jsonDb";

// Call recordings used to be stored inline in db.json as base64 data: URLs.
// On production that grew db.json to 73 MB — and the JSON store re-reads and
// re-parses the whole file for every query and rewrites it for every save,
// so ordinary requests (the dialer's config included) took long enough to hit
// the PHP proxy's 30 s timeout. Large data: URLs now live as files next to
// db.json (same persistent dir, survives deploys) and db.json keeps only a
// short /api/media/<file> link.

export const MEDIA_ROUTE = "/api/media/";
const INLINE_LIMIT = 4096; // smaller data: URLs aren't worth a file
const NAME_RE = /^[a-f0-9-]{36}\.[a-z0-9]{1,8}$/;

const EXT_BY_MIME: Record<string, string> = {
  "audio/webm": "webm", "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/mp3": "mp3",
  "audio/wav": "wav", "audio/x-wav": "wav", "audio/mp4": "m4a", "audio/aac": "aac",
  "video/webm": "webm", "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif",
  "image/webp": "webp", "application/pdf": "pdf",
};
const MIME_BY_EXT: Record<string, string> = {
  webm: "audio/webm", ogg: "audio/ogg", mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4",
  aac: "audio/aac", png: "image/png", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  pdf: "application/pdf", bin: "application/octet-stream",
};

export function mediaDir(): string {
  return path.join(path.dirname(getDbPath()), "media");
}

/** Move a large data: URL into a file and return its link; anything else is returned unchanged. */
export function externalizeDataUrl<T>(value: T): T | string {
  if (typeof value !== "string" || value.length < INLINE_LIMIT || !value.startsWith("data:")) return value;
  const comma = value.indexOf(",");
  if (comma < 0) return value;
  const meta = value.slice(5, comma); // e.g. "audio/webm;codecs=opus;base64"
  const mime = (meta.split(";")[0] || "application/octet-stream").toLowerCase();
  const isBase64 = /;base64$/i.test(meta);
  const payload = value.slice(comma + 1);
  const buf = isBase64 ? Buffer.from(payload, "base64") : Buffer.from(decodeURIComponent(payload));
  const name = `${crypto.randomUUID()}.${EXT_BY_MIME[mime] ?? "bin"}`;
  fs.mkdirSync(mediaDir(), { recursive: true });
  fs.writeFileSync(path.join(mediaDir(), name), buf);
  return MEDIA_ROUTE + name;
}

export function readMedia(name: string): { body: Buffer; mime: string } | null {
  if (!NAME_RE.test(name)) return null;
  const file = path.join(mediaDir(), name);
  if (!fs.existsSync(file)) return null;
  const ext = name.slice(name.lastIndexOf(".") + 1);
  return { body: fs.readFileSync(file), mime: MIME_BY_EXT[ext] ?? "application/octet-stream" };
}

function externalizeDeep(node: unknown, depth: number): { value: unknown; moved: number } {
  if (typeof node === "string") {
    const next = externalizeDataUrl(node);
    return { value: next, moved: next === node ? 0 : 1 };
  }
  if (!node || typeof node !== "object" || depth > 6) return { value: node, moved: 0 };
  let moved = 0;
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      const r = externalizeDeep(node[i], depth + 1);
      node[i] = r.value;
      moved += r.moved;
    }
  } else {
    const obj = node as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      const r = externalizeDeep(obj[key], depth + 1);
      obj[key] = r.value;
      moved += r.moved;
    }
  }
  return { value: node, moved };
}

/** One-time shrink of an existing db.json: move every inline media blob to a file. */
export function migrateInlineMedia(): number {
  const store = readJsonDb();
  const { moved } = externalizeDeep(store, 0);
  if (moved > 0) writeJsonDb(store);
  return moved;
}
