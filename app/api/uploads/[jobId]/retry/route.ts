import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_request: NextRequest) {
  return NextResponse.json(
    { error: "Retry needs the original selections from the current review session. Use the Review page retry button after reloading or reselecting failed products." },
    { status: 409 }
  );
}
