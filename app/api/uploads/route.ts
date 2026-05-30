import { NextRequest, NextResponse } from "next/server";
import { saveUploadJob } from "@/lib/db";
import { runUploadJob } from "@/lib/uploader";
import type { UploadSelection } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { selections: UploadSelection[] };
    const job = await runUploadJob(body.selections ?? [], async (nextJob) => saveUploadJob(nextJob));
    return NextResponse.json({ job });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
