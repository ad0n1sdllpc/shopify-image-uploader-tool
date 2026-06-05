import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scanImageFolders } from "@/lib/scanner";

let tempDir: string | null = null;

afterEach(async () => {
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe("scanner", () => {
  it("discovers image files inside product folders", async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "image-scan-"));
    const imageFolder = path.join(tempDir, "60x60", "LUZ-14MEA");
    await fs.mkdir(imageFolder, { recursive: true });
    await fs.writeFile(path.join(imageFolder, "image2.png"), "png");
    await fs.writeFile(path.join(imageFolder, "image1.jpg"), "jpg");
    await fs.writeFile(path.join(imageFolder, "notes.txt"), "skip");

    const scan = await scanImageFolders(tempDir);

    expect(scan.folders).toHaveLength(1);
    expect(scan.folders[0].name).toBe("LUZ-14MEA");
    expect(scan.folders[0].category).toBe("60x60");
    expect(scan.folders[0].images.map((image) => image.name)).toEqual(["image1.jpg", "image2.png"]);
  });

  it("discovers product image folders under any category path", async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "product-scan-"));
    const productFolder = path.join(tempDir, "SANITARY WARES", "- FAUCET", "FC-2877");
    await fs.mkdir(productFolder, { recursive: true });
    await fs.writeFile(path.join(productFolder, "FC-2877 faucet Angles.jpg"), "jpg");
    await fs.writeFile(path.join(productFolder, "FC-2877.jpg"), "jpg");

    const scan = await scanImageFolders(tempDir);

    expect(scan.folders).toHaveLength(1);
    expect(scan.folders[0].category).toBe("- FAUCET");
    expect(scan.folders[0].productCode).toBe("FC-2877");
    expect(scan.folders[0].relativePath).toBe(path.join("SANITARY WARES", "- FAUCET", "FC-2877"));
  });
});
