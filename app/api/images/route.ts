import fs from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { getAllowedImagePaths } from "@/lib/scanner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

async function isReadableImageFile(imagePath: string) {
  if (!path.isAbsolute(imagePath) || !IMAGE_EXTENSIONS.has(path.extname(imagePath).toLowerCase())) {
    return false;
  }

  const stat = await fs.stat(imagePath).catch(() => null);
  return Boolean(stat?.isFile());
}

export async function GET(request: NextRequest) {
  const imagePath = request.nextUrl.searchParams.get("path");
  if (!imagePath || (!getAllowedImagePaths().has(imagePath) && !(await isReadableImageFile(imagePath)))) {
    return NextResponse.json({ error: "Image path is not available from the latest scan." }, { status: 403 });
  }

  try {
    const file = await fs.readFile(imagePath);
    const extension = imagePath.split(".").pop()?.toLowerCase();
    const contentType = extension === "png" ? "image/png" : extension === "webp" ? "image/webp" : "image/jpeg";
    return new NextResponse(file, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=120"
      }
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 404 });
  }
}
