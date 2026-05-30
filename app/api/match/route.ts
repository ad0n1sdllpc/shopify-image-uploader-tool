import { NextRequest, NextResponse } from "next/server";
import { matchTileFolders } from "@/lib/matcher";
import type { ShopifyProduct, TileFolder } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { folders: TileFolder[]; products: ShopifyProduct[] };
    return NextResponse.json({ matches: matchTileFolders(body.folders ?? [], body.products ?? []) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
