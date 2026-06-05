import "server-only";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { ImageFolder, LocalImage, ScanResult } from "@/types";

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

export function resolveImageRoot(inputPath?: string) {
  const rawPath = inputPath?.trim() || ".";
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

export async function scanImageFolders(inputPath?: string): Promise<ScanResult> {
  const rootPath = resolveImageRoot(inputPath);
  const rootStat = await fs.stat(rootPath).catch(() => null);

  if (!rootStat?.isDirectory()) {
    throw new Error(`Image folder not found: ${rootPath}`);
  }

  const nextAllowedPaths = new Set<string>();
  const folders: ImageFolder[] = [];

  async function walk(folderPath: string) {
    const entries = await safeDirectoryEntries(folderPath);
    const images: LocalImage[] = [];

    for (const imageEntry of entries.filter((entry) => entry.isFile())) {
      const extension = path.extname(imageEntry.name).toLowerCase();
      if (!IMAGE_EXTENSIONS.has(extension)) continue;

      const absolutePath = path.join(folderPath, imageEntry.name);
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
      const relativePath = path.relative(rootPath, folderPath);
      const parts = relativePath.split(path.sep).filter(Boolean);
      const productCode = parts.at(-1) ?? path.basename(folderPath);
      const category = parts.at(-2) ?? "";
      images.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      folders.push({
        id: toId(folderPath),
        name: productCode,
        category,
        productCode,
        absolutePath: folderPath,
        relativePath,
        images
      });
    }

    for (const directoryEntry of entries.filter((entry) => entry.isDirectory())) {
      await walk(path.join(folderPath, directoryEntry.name));
    }
  }

  await walk(rootPath);

  folders.sort((a, b) => a.relativePath.localeCompare(b.relativePath, undefined, { numeric: true }));
  allowedImagePaths = nextAllowedPaths;

  return {
    rootPath,
    scannedAt: new Date().toISOString(),
    folders
  };
}
