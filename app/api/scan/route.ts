import { NextRequest, NextResponse } from "next/server";
import { scanTilesFolder } from "@/lib/scanner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const rootPath = request.nextUrl.searchParams.get("path") ?? "./TILES";
    const scan = await scanTilesFolder(rootPath);
    return NextResponse.json(scan);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
