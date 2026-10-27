// D8: the App Router favicon exists at the convention path and is a well-formed ICO file.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const FILE = path.resolve(__dirname, "../../src/app/favicon.ico");

describe("favicon (D8)", () => {
  it("src/app/favicon.ico is an ICO with 16, 32 and 48 px images", () => {
    const b = fs.readFileSync(FILE);
    expect(b.readUInt16LE(0)).toBe(0); // reserved
    expect(b.readUInt16LE(2)).toBe(1); // type 1 = icon
    const n = b.readUInt16LE(4);
    const sizes = Array.from({ length: n }, (_, i) => b[6 + i * 16] || 256);
    expect(sizes).toEqual([16, 32, 48]);
    for (let i = 0; i < n; i++) {
      const bytes = b.readUInt32LE(6 + i * 16 + 8);
      const offset = b.readUInt32LE(6 + i * 16 + 12);
      expect(offset + bytes).toBeLessThanOrEqual(b.length);
    }
  });
});
