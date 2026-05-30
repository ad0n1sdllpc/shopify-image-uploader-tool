import { NextResponse } from "next/server";
import { fetchProducts, getEnvironmentStatus } from "@/lib/shopify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    if (!getEnvironmentStatus().hasStoreDomain || !getEnvironmentStatus().hasAdminToken) {
      return NextResponse.json({ products: [], environment: getEnvironmentStatus(), error: "Shopify environment variables are missing." }, { status: 400 });
    }

    const products = await fetchProducts();
    return NextResponse.json({ products, environment: getEnvironmentStatus() });
  } catch (error) {
    return NextResponse.json({ products: [], environment: getEnvironmentStatus(), error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
