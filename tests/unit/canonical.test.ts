import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalJson, hashCanonical, sha256Hex } from "@/lib/canonical";

describe("canonical JSON", () => {
  it("is independent of key order, at every depth", () => {
    const a = { b: 1, a: { d: [1, { y: 2, x: 1 }], c: "s" } };
    const b = { a: { c: "s", d: [1, { x: 1, y: 2 }] }, b: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(canonicalJson(a)).toBe('{"a":{"c":"s","d":[1,{"x":1,"y":2}]},"b":1}');
  });

  it("keeps array order, omits undefined properties, writes -0 as 0", () => {
    expect(canonicalJson([2, 1])).not.toBe(canonicalJson([1, 2]));
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
    expect(canonicalJson({ z: -0, n: null, t: true })).toBe('{"n":null,"t":true,"z":0}');
    expect(canonicalJson(0.1 + 0.2)).toBe("0.30000000000000004");
  });

  it("refuses values that cannot be hashed unambiguously", () => {
    expect(() => canonicalJson({ a: NaN })).toThrow(/non-finite number at \$\.a/);
    expect(() => canonicalJson([Infinity])).toThrow(/non-finite/);
    expect(() => canonicalJson([undefined])).toThrow(/unsupported undefined/);
    expect(() => canonicalJson({ f: () => 1 })).toThrow(/unsupported function/);
    expect(() => canonicalJson(new Date(0))).toThrow(/unsupported object/);
  });
});

describe("SHA-256", () => {
  it("matches Node's implementation and the standard test vector", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    const text = canonicalJson({ é: "ü", n: [1.5, -2] });
    expect(await sha256Hex(text)).toBe(createHash("sha256").update(text, "utf8").digest("hex"));
    expect(await hashCanonical({ b: 1, a: 2 })).toBe(await hashCanonical({ a: 2, b: 1 }));
  });
});
