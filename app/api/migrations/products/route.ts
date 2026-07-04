import { NextRequest, NextResponse } from "next/server";
import { getEnvironmentStatus } from "@/lib/shopify";
import {
  migrateRegionalProducts,
  scanProductMigrations,
} from "@/lib/productMigration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    if (
      !getEnvironmentStatus().hasStoreDomain ||
      !getEnvironmentStatus().hasAdminToken
    ) {
      return NextResponse.json(
        {
          scan: null,
          environment: getEnvironmentStatus(),
          error: "Shopify environment variables are missing.",
        },
        { status: 400 },
      );
    }

    const scan = await scanProductMigrations();
    return NextResponse.json({ scan, environment: getEnvironmentStatus() });
  } catch (error) {
    return NextResponse.json(
      {
        scan: null,
        environment: getEnvironmentStatus(),
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    if (
      !getEnvironmentStatus().hasStoreDomain ||
      !getEnvironmentStatus().hasAdminToken
    ) {
      return NextResponse.json(
        {
          results: [],
          environment: getEnvironmentStatus(),
          error: "Shopify environment variables are missing.",
        },
        { status: 400 },
      );
    }

    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const intent = String(formData.get("intent") ?? "run");
      const workbook = await workbookBufferFromFormData(formData);

      if (intent === "scan") {
        const scan = await scanProductMigrations(workbook);
        return NextResponse.json({ scan, environment: getEnvironmentStatus() });
      }

      const baseSkus = parseBaseSkus(formData.get("baseSkus"));
      const results = await migrateRegionalProducts(baseSkus, workbook);
      return NextResponse.json({
        results,
        environment: getEnvironmentStatus(),
      });
    }

    const body = (await request.json()) as { baseSkus?: string[] };
    const results = await migrateRegionalProducts(body.baseSkus ?? []);
    return NextResponse.json({ results, environment: getEnvironmentStatus() });
  } catch (error) {
    return NextResponse.json(
      {
        results: [],
        environment: getEnvironmentStatus(),
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 400 },
    );
  }
}

async function workbookBufferFromFormData(formData: FormData) {
  const file = formData.get("descriptionWorkbook");
  if (!(file instanceof File) || file.size === 0) return null;
  return Buffer.from(await file.arrayBuffer());
}

function parseBaseSkus(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return [];
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed)
    ? parsed.filter((item): item is string => typeof item === "string")
    : [];
}
