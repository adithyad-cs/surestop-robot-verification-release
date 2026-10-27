// Canonical JSON and SHA-256 for provenance hashes. Pure; no scene, label or evaluator access.
//
// Canonical form (CANONICAL_JSON_VERSION):
// - object keys sorted by UTF-16 code unit (Array.prototype.sort default); properties whose value
//   is `undefined` are omitted, as JSON.stringify does;
// - numbers must be finite; -0 is written as 0; other numbers use JSON.stringify (the shortest
//   round-trip decimal form, identical in browsers and Node);
// - strings, booleans and null as JSON.stringify writes them;
// - arrays keep their order; `undefined`, functions, symbols and bigints anywhere are refused.
// Refusing instead of coercing means a hash can never silently describe a different value.

export const CANONICAL_JSON_VERSION = "surestop.canonical-json/1";

export function canonicalJson(value: unknown): string {
  return write(value, "$");
}

function write(v: unknown, path: string): string {
  if (v === null) return "null";
  switch (typeof v) {
    case "boolean":
      return v ? "true" : "false";
    case "number":
      if (!Number.isFinite(v)) throw new Error(`canonicalJson: non-finite number at ${path}`);
      return Object.is(v, -0) ? "0" : JSON.stringify(v);
    case "string":
      return JSON.stringify(v);
    case "object": {
      if (Array.isArray(v)) return `[${v.map((x, i) => write(x, `${path}[${i}]`)).join(",")}]`;
      const proto = Object.getPrototypeOf(v);
      if (proto !== Object.prototype && proto !== null) throw new Error(`canonicalJson: unsupported object at ${path}`);
      const o = v as Record<string, unknown>;
      const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${write(o[k], `${path}.${k}`)}`).join(",")}}`;
    }
    default:
      throw new Error(`canonicalJson: unsupported ${typeof v} at ${path}`);
  }
}

/** SHA-256 of the UTF-8 bytes of `text`, lower-case hex; null when Web Crypto is unavailable. */
export async function sha256Hex(text: string): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  const buf = await subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** SHA-256 of the canonical JSON of `value`; null when Web Crypto is unavailable. */
export function hashCanonical(value: unknown): Promise<string | null> {
  return sha256Hex(canonicalJson(value));
}
