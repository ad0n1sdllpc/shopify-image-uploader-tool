import "server-only";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { LocalImage, ScanResult, TileFolder } from "@/types";

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp"
};

let allowedImagePaths = new Set<string>();

export function getAllowedImagePaths() {
  return allowedImagePaths;
}

export function resolveTileRoot(inputPath?: string) {
  const rawPath = inputPath?.trim() || "./TILES";
  return path.resolve(process.cwd(), rawPath);
}

function toId(value: string) {
  return crypto.createHash("sha1").update(value).digest("hex");
}

function imagePreviewUrl(absolutePath: string) {
  return `/api/images?path=${encodeURIComponent(absolutePath)}`;
}

async function safeDirectoryEntries(folderPath: string) {
  try {
    return await fs.readdir(folderPath, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export async function scanTilesFolder(inputPath?: string): Promise<ScanResult> {
  const rootPath = resolveTileRoot(inputPath);
  const rootStat = await fs.stat(rootPath).catch(() => null);

  if (!rootStat?.isDirectory()) {
    throw new Error(`TILES folder not found: ${rootPath}`);
  }

  const nextAllowedPaths = new Set<string>();
  const folders: TileFolder[] = [];
  const sizeEntries = await safeDirectoryEntries(rootPath);

  for (const sizeEntry of sizeEntries.filter((entry) => entry.isDirectory())) {
    const sizePath = path.join(rootPath, sizeEntry.name);
    const tileEntries = await safeDirectoryEntries(sizePath);

    for (const tileEntry of tileEntries.filter((entry) => entry.isDirectory())) {
      const tilePath = path.join(sizePath, tileEntry.name);
      const imageEntries = await safeDirectoryEntries(tilePath);
      const images: LocalImage[] = [];

      for (const imageEntry of imageEntries.filter((entry) => entry.isFile())) {
        const extension = path.extname(imageEntry.name).toLowerCase();
        if (!IMAGE_EXTENSIONS.has(extension)) continue;

        const absolutePath = path.join(tilePath, imageEntry.name);
        const stat = await fs.stat(absolutePath);
        nextAllowedPaths.add(absolutePath);
        images.push({
          id: toId(absolutePath),
          name: imageEntry.name,
          absolutePath,
          relativePath: path.relative(rootPath, absolutePath),
          previewUrl: imagePreviewUrl(absolutePath),
          sizeBytes: stat.size,
          modifiedAt: stat.mtime.toISOString(),
          mimeType: MIME_TYPES[extension] ?? "application/octet-stream"
        });
      }

      if (images.length > 0) {
        images.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
        folders.push({
          id: toId(tilePath),
          size: sizeEntry.name,
          tileName: tileEntry.name,
          absolutePath: tilePath,
          relativePath: path.relative(rootPath, tilePath),
          images
        });
      }
    }
  }

  folders.sort((a, b) => `${a.size}/${a.tileName}`.localeCompare(`${b.size}/${b.tileName}`));
  allowedImagePaths = nextAllowedPaths;

  return {
    rootPath,
    scannedAt: new Date().toISOString(),
    folders
  };
}
