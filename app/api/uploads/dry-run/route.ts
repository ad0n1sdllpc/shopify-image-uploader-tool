import { NextRequest, NextResponse } from "next/server";
import { saveUploadJob } from "@/lib/db";
import { createDryRunJob } from "@/lib/uploader";
import type { UploadOptions, UploadSelection } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { selections: UploadSelection[]; options?: Partial<UploadOptions> };
    const job = createDryRunJob(body.selections ?? [], { removeWhiteBackground: Boolean(body.options?.removeWhiteBackground) });
    await saveUploadJob(job);
    return NextResponse.json({ job });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
