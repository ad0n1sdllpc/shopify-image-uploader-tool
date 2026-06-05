import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { removeWhiteBackground } from "@/lib/backgroundTransparency";

describe("white background transparency", () => {
  it("turns white and near-white pixels transparent while preserving product colors", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "image-transparency-"));
    const sourcePath = path.join(directory, "product.jpg");

    const pixels = Buffer.from([
      255, 255, 255, 255,
      248, 248, 248, 255,
      120, 80, 40, 255,
      244, 244, 244, 255
    ]);

    await sharp(pixels, {
      raw: {
        width: 2,
        height: 2,
        channels: 4
      }
    }).png().toFile(sourcePath);

    const upload = await removeWhiteBackground(sourcePath);
    const output = await sharp(upload.bytes).raw().toBuffer();

    expect(upload.fileName).toBe("product.png");
    expect(upload.mimeType).toBe("image/png");
    expect(output[3]).toBe(0);
    expect(output[7]).toBe(0);
    expect(output[11]).toBe(255);
    expect(output[15]).toBe(255);
  });
});
