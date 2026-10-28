import { HandoffError } from "./errors";

/** v1 accepts PDF, PNG, JPEG, plain text and Markdown. The type is decided from the bytes, not the label. */
export const ALLOWED_TYPES = ["application/pdf", "image/png", "image/jpeg", "text/plain", "text/markdown"] as const;
export type AllowedType = (typeof ALLOWED_TYPES)[number];

const starts = (b: Uint8Array, sig: number[]): boolean => sig.every((v, i) => b[i] === v);

function sniffBinary(b: Uint8Array): AllowedType | null {
  if (starts(b, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf"; // %PDF-
  if (starts(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (starts(b, [0xff, 0xd8, 0xff])) return "image/jpeg";
  return null;
}

function isUtf8Text(b: Uint8Array): boolean {
  if (b.length === 0) return false;
  const sample = b.subarray(0, Math.min(b.length, 1 << 20));
  for (const x of sample) if (x === 0) return false;
  try {
    new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(b);
    return true;
  } catch {
    return false;
  }
}

const normalise = (m: string | null | undefined): string | null => {
  if (!m) return null;
  const base = m.split(";")[0]?.trim().toLowerCase() ?? "";
  if (base === "image/jpg") return "image/jpeg";
  if (base === "text/x-markdown") return "text/markdown";
  return base || null;
};

/**
 * The type a client may declare for an upload: one accepted type in its canonical spelling, or
 * application/octet-stream when none was given (the server then decides from the bytes). Anything else is refused,
 * so the value is safe to place in a header or a command.
 */
export function declaredUploadType(declared: string | null | undefined): AllowedType | "application/octet-stream" {
  if (declared === undefined || declared === null || declared.trim() === "") return "application/octet-stream";
  const n = normalise(declared);
  const hit = ALLOWED_TYPES.find((t) => t === n);
  if (!hit) throw new HandoffError("unsupported_type", `mime_type must be one of: ${ALLOWED_TYPES.join(", ")}`);
  return hit;
}

/**
 * Returns the verified type. Throws unsupported_type when the bytes are not an accepted type,
 * or when a declared type names a different accepted type than the bytes show.
 */
export function verifyType(bytes: Uint8Array, declared: string | null | undefined, filename: string): AllowedType {
  const decl = normalise(declared);
  const sniffed = sniffBinary(bytes);
  let actual: AllowedType | null = sniffed;
  if (!actual && isUtf8Text(bytes)) {
    actual = decl === "text/markdown" || /\.(md|markdown)$/i.test(filename) ? "text/markdown" : "text/plain";
  }
  if (!actual) {
    throw new HandoffError(
      "unsupported_type",
      `content is not an accepted type (accepted: ${ALLOWED_TYPES.join(", ")}); the bytes do not look like PDF, PNG, JPEG or UTF-8 text`,
    );
  }
  const declaredIsText = decl === "text/plain" || decl === "text/markdown";
  const actualIsText = actual === "text/plain" || actual === "text/markdown";
  if (decl && decl !== actual && !(declaredIsText && actualIsText) && !(decl === "application/octet-stream")) {
    throw new HandoffError("unsupported_type", `declared type ${decl} but the content is ${actual}`);
  }
  return actual;
}
