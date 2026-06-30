import { NextRequest, NextResponse } from "next/server";
import { getEnvironmentStatus } from "@/lib/shopify";
import { migrateRegionalProducts, scanProductMigrations } from "@/lib/productMigration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    if (!getEnvironmentStatus().hasStoreDomain || !getEnvironmentStatus().hasAdminToken) {
      return NextResponse.json({ scan: null, environment: getEnvironmentStatus(), error: "Shopify environment variables are missing." }, { status: 400 });
    }

    const scan = await scanProductMigrations();
    return NextResponse.json({ scan, environment: getEnvironmentStatus() });
  } catch (error) {
    return NextResponse.json({ scan: null, environment: getEnvironmentStatus(), error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!getEnvironmentStatus().hasStoreDomain || !getEnvironmentStatus().hasAdminToken) {
      return NextResponse.json({ results: [], environment: getEnvironmentStatus(), error: "Shopify environment variables are missing." }, { status: 400 });
    }

    const body = (await request.json()) as { baseSkus?: string[] };
    const results = await migrateRegionalProducts(body.baseSkus ?? []);
    return NextResponse.json({ results, environment: getEnvironmentStatus() });
  } catch (error) {
    return NextResponse.json({ results: [], environment: getEnvironmentStatus(), error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
