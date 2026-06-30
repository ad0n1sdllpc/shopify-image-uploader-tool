import { describe, expect, it } from "vitest";
import {
  buildProductMigrationScan,
  buildUnifiedInventoryQuantities,
  extractMigrationMetafields,
  isIgnorableInventoryActivationError,
  metafieldInputs,
} from "@/lib/productMigration";

type MigrationProductNode = Parameters<
  typeof buildProductMigrationScan
>[0][number];

function product(
  prefix: "LUZ" | "VIS" | "MIN",
  overrides: Partial<MigrationProductNode> = {},
): MigrationProductNode {
  const baseSku = "YM6623";
  const sku = `${prefix}-${baseSku}`;
  const locationName =
    prefix === "LUZ"
      ? "Lusterplus Inc."
      : prefix === "VIS"
        ? "ARTEMISIA CEBU"
        : "ARTEMISIA DAVAO";

  return {
    id: overrides.id ?? `gid://shopify/Product/${prefix}`,
    title: overrides.title ?? sku,
    handle: overrides.handle ?? sku.toLowerCase(),
    descriptionHtml:
      overrides.descriptionHtml ??
      "<p>Porcelain Inkjet Print. Water absorption E&lt;0.5%. Thickness 8.2mm. Rectified. Traffic rating Moderate.</p>",
    tags: overrides.tags ?? ["60x60 cm", "Polished", "Floor", "Indoor"],
    productType: overrides.productType ?? "Tile",
    variants: overrides.variants ?? {
      nodes: [
        {
          id: `gid://shopify/ProductVariant/${prefix}`,
          sku,
          price: "1299.00",
          inventoryQuantity: 99,
          inventoryItem: {
            id: `gid://shopify/InventoryItem/${prefix}`,
            sku,
            tracked: true,
            requiresShipping: true,
            inventoryLevels: {
              nodes: [
                {
                  location: {
                    id: `gid://shopify/Location/${prefix}`,
                    name: locationName,
                  },
                  quantities: [
                    {
                      name: "available",
                      quantity: prefix === "LUZ" ? 3 : prefix === "VIS" ? 5 : 7,
                    },
                  ],
                },
              ],
            },
          },
        },
      ],
    },
    media: overrides.media ?? {
      nodes: [
        {
          id: `media-${prefix}-1`,
          image: { url: "https://cdn/shared.jpg" },
          preview: null,
        },
        {
          id: `media-${prefix}-2`,
          image: { url: `https://cdn/${prefix}.jpg` },
          preview: null,
        },
      ],
    },
    images: overrides.images ?? { nodes: [] },
  };
}

describe("product migration grouping", () => {
  it("builds a complete regional candidate with mapped inventory and canonical images", () => {
    const scan = buildProductMigrationScan([
      product("LUZ"),
      product("VIS"),
      product("MIN"),
    ]);

    expect(scan.issues).toEqual([]);
    expect(scan.candidates).toHaveLength(1);
    expect(scan.candidates[0]).toMatchObject({
      baseSku: "YM6623",
      title: "YM6623",
      price: "1299.00",
      productType: "Tile",
      missingFields: [],
    });
    expect(scan.candidates[0].imageUrls).toEqual([
      "https://cdn/shared.jpg",
      "https://cdn/LUZ.jpg",
    ]);
    expect(
      scan.candidates[0].regionalProducts.map((item) => [
        item.prefix,
        item.locationName,
        item.quantity,
      ]),
    ).toEqual([
      ["LUZ", "Lusterplus Inc.", 3],
      ["VIS", "ARTEMISIA CEBU", 5],
      ["MIN", "ARTEMISIA DAVAO", 7],
    ]);
  });

  it("flags incomplete regional groups for manual review", () => {
    const scan = buildProductMigrationScan([product("LUZ"), product("VIS")]);

    expect(scan.candidates).toEqual([]);
    expect(scan.issues).toHaveLength(1);
    expect(scan.issues[0].reason).toBe("Missing MIN product(s)");
  });

  it("marks candidates when a unified product already exists", () => {
    const unified = product("LUZ", {
      id: "gid://shopify/Product/unified",
      title: "YM6623",
      handle: "ym6623",
      variants: {
        nodes: [
          {
            ...product("LUZ").variants.nodes[0],
            sku: "YM6623",
          },
        ],
      },
    });

    const scan = buildProductMigrationScan([
      product("LUZ"),
      product("VIS"),
      product("MIN"),
      unified,
    ]);

    expect(scan.candidates[0].existingUnifiedProductId).toBe(
      "gid://shopify/Product/unified",
    );
    expect(scan.candidates[0].manualReviewFields).toContain(
      "existing_unified_product",
    );
  });
});

describe("product migration metafield extraction", () => {
  it("extracts tile attributes from tags and description HTML", () => {
    const metafields = extractMigrationMetafields(
      "YM6623",
      "<div>Material: Porcelain<br>Inkjet Print<br>Water Absorption: E&lt;0.5%<br>Thickness: 8.2mm<br>Rectified<br>Traffic Rating: Moderate</div>",
      ["60x60 cm", "Polished", "Floor", "Indoor"],
    );

    expect(metafields).toMatchObject({
      itemCode: "YM6623",
      tileSize: "60x60 cm",
      surfaceFinish: "Polished",
      materialType: "Porcelain",
      printTechnology: "Inkjet Print",
      waterAbsorption: "E<0.5%",
      thicknessMm: 8.2,
      rectified: true,
      trafficRating: "Moderate",
      applicationArea: "Floor; Indoor",
      regionAvailability: ["Luzon", "Visayas", "Mindanao"],
    });
    expect(metafields.productDescription).toContain("Material: Porcelain");
  });

  it("serializes list metafields as Shopify JSON array values", () => {
    const inputs = metafieldInputs({
      itemCode: "YM6623",
      tileSize: "60x60 cm",
      surfaceFinish: "Polished",
      materialType: "Porcelain",
      printTechnology: "Inkjet Print",
      waterAbsorption: "E<0.5%",
      thicknessMm: 8.2,
      rectified: true,
      trafficRating: "Moderate",
      applicationArea: "Floor; Indoor",
      regionAvailability: ["Luzon", "Visayas", "Mindanao"],
      productDescription: "Porcelain tile",
    });

    expect(
      inputs.find((input) => input.key === "surface_finish"),
    ).toMatchObject({
      type: "list.single_line_text_field",
      value: JSON.stringify(["Polished"]),
    });
    expect(
      inputs.find((input) => input.key === "application_area"),
    ).toMatchObject({
      type: "list.single_line_text_field",
      value: JSON.stringify(["Floor", "Indoor"]),
    });
    expect(
      inputs.find((input) => input.key === "region_availability"),
    ).toMatchObject({
      type: "list.single_line_text_field",
      value: JSON.stringify(["Luzon", "Visayas", "Mindanao"]),
    });
  });
});

describe("product migration inventory activation", () => {
  it("builds exact inventory quantities for each regional location", () => {
    const candidate = buildProductMigrationScan([
      product("LUZ"),
      product("VIS"),
      product("MIN"),
    ]).candidates[0];

    const quantities = buildUnifiedInventoryQuantities(
      "inventory-item-1",
      candidate,
    );

    expect(quantities).toEqual([
      {
        inventoryItemId: "inventory-item-1",
        locationId: "gid://shopify/Location/86389424402",
        quantity: 3,
        changeFromQuantity: null,
      },
      {
        inventoryItemId: "inventory-item-1",
        locationId: "gid://shopify/Location/101194629394",
        quantity: 5,
        changeFromQuantity: null,
      },
      {
        inventoryItemId: "inventory-item-1",
        locationId: "gid://shopify/Location/101194662162",
        quantity: 7,
        changeFromQuantity: null,
      },
    ]);
  });

  it("treats already active inventory activation errors as idempotent success", () => {
    expect(
      isIgnorableInventoryActivationError({
        message: "Inventory item is already stocked at this location.",
        code: "ITEM_ALREADY_STOCKED",
      }),
    ).toBe(true);
    expect(
      isIgnorableInventoryActivationError({
        message: "Inventory level is already active.",
        code: null,
      }),
    ).toBe(true);
  });

  it("does not ignore unrelated inventory activation errors", () => {
    expect(
      isIgnorableInventoryActivationError({
        message: "Location does not exist.",
        code: "LOCATION_NOT_FOUND",
      }),
    ).toBe(false);
  });
});
