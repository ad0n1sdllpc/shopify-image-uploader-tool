import { NextRequest, NextResponse } from "next/server";
import { deleteSelectedProductMedia } from "@/lib/mediaDeletion";
import type { MediaDeleteRequestItem } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { items?: MediaDeleteRequestItem[] };
    if (!Array.isArray(body.items)) {
      return NextResponse.json({ error: "Expected items array." }, { status: 400 });
    }

    const results = await deleteSelectedProductMedia(body.items);
    return NextResponse.json({ results });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
