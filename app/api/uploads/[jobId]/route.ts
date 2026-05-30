import { NextRequest, NextResponse } from "next/server";
import { getUploadJob } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, { params }: { params: { jobId: string } }) {
  const job = await getUploadJob(params.jobId);
  if (!job) return NextResponse.json({ error: "Upload job not found." }, { status: 404 });
  return NextResponse.json({ job });
}
