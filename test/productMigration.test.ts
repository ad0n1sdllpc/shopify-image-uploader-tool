import { describe, expect, it } from "vitest";
import {
  buildProductMigrationScan,
  buildPublicationInputs,
  buildUnifiedInventoryQuantities,
  extractMigrationMetafields,
  isIgnorableInventoryActivationError,
  metafieldInputs,
  parseMigrationDescriptionWorkbook,
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

function workbookBuffer(rows: Record<string, string>[]) {
  const headers = [
    "Item Code",
    "SIZE",
    "Category",
    "Description",
    "Features",
    "Finish",
    "Application",
    "Suitable For",
    "Surface",
    "Disclaimer",
    "Item Price",
  ];
  const sheetRows = [
    headers,
    ...rows.map((row) => headers.map((header) => row[header] ?? "")),
  ];
  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows
    .map(
      (row, rowIndex) =>
        `<row r="${rowIndex + 1}">${row
          .map(
            (value, columnIndex) =>
              `<c r="${columnName(columnIndex)}${rowIndex + 1}" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`,
          )
          .join("")}</row>`,
    )
    .join("")}</sheetData></worksheet>`;

  return zipBuffer({
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    "xl/worksheets/sheet1.xml": sheetXml,
  });
}

function columnName(index: number) {
  return String.fromCharCode("A".charCodeAt(0) + index);
}

function xmlEscape(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function zipBuffer(files: Record<string, string>) {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const [name, content] of Object.entries(files)) {
    const nameBuffer = Buffer.from(name);
    const contentBuffer = Buffer.from(content);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt32LE(contentBuffer.length, 18);
    localHeader.writeUInt32LE(contentBuffer.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localParts.push(localHeader, nameBuffer, contentBuffer);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt32LE(contentBuffer.length, 20);
    centralHeader.writeUInt32LE(contentBuffer.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, nameBuffer);
    offset += localHeader.length + nameBuffer.length + contentBuffer.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const localFiles = Buffer.concat(localParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localFiles.length, 16);
  return Buffer.concat([localFiles, centralDirectory, end]);
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
      missingFields: [
        "custom.color_tone",
        "custom.suitable_for",
        "custom.disclaimer",
      ],
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
      surfaceFinish: ["Polished"],
      features: ["Rectified"],
      materialType: ["Porcelain"],
      printTechnology: ["Inkjet Print"],
      colorTone: [],
      waterAbsorption: "E<0.5%",
      thicknessMm: 8.2,
      rectified: true,
      trafficRating: ["Moderate"],
      applicationArea: ["Floor", "Indoor"],
      suitableFor: [],
      regionAvailability: ["Luzon", "Visayas", "Mindanao"],
      disclaimer: null,
    });
  });

  it("serializes list metafields as Shopify JSON array values", () => {
    const inputs = metafieldInputs({
      itemCode: "YM6623",
      tileSize: "60x60 cm",
      surfaceFinish: ["Polished"],
      features: [],
      materialType: ["Porcelain"],
      printTechnology: ["Inkjet Print"],
      colorTone: [],
      waterAbsorption: "E<0.5%",
      thicknessMm: 8.2,
      rectified: true,
      trafficRating: ["Moderate"],
      applicationArea: ["Floor", "Indoor"],
      suitableFor: [],
      regionAvailability: ["Luzon", "Visayas", "Mindanao"],
      disclaimer: null,
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
    expect(inputs.find((input) => input.key === "disclaimer")).toBeUndefined();
    expect(inputs.some((input) => input.key === "product_description")).toBe(
      false,
    );
  });
});

describe("product migration Excel description enrichment", () => {
  it("parses workbook rows by normalized item code", () => {
    const catalog = parseMigrationDescriptionWorkbook(
      workbookBuffer([
        {
          "Item Code": "YM6623",
          SIZE: "Tiles - 60x60 CM",
          Category: "Category: Tiles",
          Description: "Description: Porcelain tile",
          Application: "Application: Floor/Wall; Indoor/Outdoor",
          "Suitable For": "Suitable For: Bathroom and Kitchen",
          Surface: "Surface: Matte",
          Disclaimer: "Disclaimer: Sample",
          "Item Price": "999999",
        },
      ]),
    );

    expect(catalog.rowsByItemCode.get("YM6623")).toMatchObject({
      itemCode: "YM6623",
      size: "Tiles - 60x60 CM",
      category: "Category: Tiles",
    });
  });

  it("matches prefixed SKUs to Excel item code and enriches metafields", () => {
    const catalog = parseMigrationDescriptionWorkbook(
      workbookBuffer([
        {
          "Item Code": "YM6623",
          SIZE: "Tiles - 60x60 CM",
          Category: "Category: Tiles",
          Description:
            "Description: Porcelain Inkjet Print. Thickness: 8.2mm. Water Absorption: E<0.5%. Rectified. Surface: Matte and Glossy.",
          Application: "Application: Floor/Wall; Indoor/Outdoor",
          "Suitable For": "Suitable For: Bathroom, Kitchen and Residential",
          Surface: "Surface: Matte/Glossy",
          Disclaimer: "Disclaimer: Color may vary.",
          "Item Price": "999999",
        },
      ]),
    );
    const scan = buildProductMigrationScan(
      [product("LUZ"), product("VIS"), product("MIN")],
      { descriptionCatalog: catalog },
    );

    expect(scan.candidates[0]).toMatchObject({
      baseSku: "YM6623",
      price: "1299.00",
      productType: "Tiles",
      descriptionDataStatus: "matched",
      descriptionDataWarnings: [],
    });
    expect(scan.candidates[0].descriptionHtml).toBe(
      "<p>Porcelain Inkjet Print. Thickness: 8.2mm. Water Absorption: E&lt;0.5%. Rectified. Surface: Matte and Glossy.</p>",
    );
    expect(scan.candidates[0].metafields).toMatchObject({
      itemCode: "YM6623",
      tileSize: "60x60 cm",
      surfaceFinish: ["Matte", "Glossy"],
      features: ["Rectified"],
      materialType: ["Porcelain"],
      printTechnology: ["Inkjet Print"],
      colorTone: [],
      waterAbsorption: "E<0.5%",
      thicknessMm: 8.2,
      rectified: true,
      applicationArea: [
        "Floor",
        "Wall",
        "Indoor",
        "Outdoor",
      ],
      suitableFor: ["Bathroom", "Kitchen"],
      disclaimer: "Color may vary.",
    });
    expect(scan.candidates[0].missingFields).not.toContain(
      "custom.application_area",
    );
  });

  it("categorizes sample text into description, color tone, finish, application, and suitable-for metafields", () => {
    const catalog = parseMigrationDescriptionWorkbook(
      workbookBuffer([
        {
          "Item Code": "YM6623",
          SIZE: "Tiles - 60x60 CM",
          Category: "Category: Tiles",
          Description:
            "Description: 60x60cm Dark Gray Concrete Look Large Square Tile With Semi Polished Surface",
          Features:
            "Features: Stain Resistant, Non Water Appearance, Glazed, 0.07% Water Absorption ,Good for High Traffic Areas, 9.5mm Thickness, Inkjet Print Technology, Rectified,",
          Application: "Application: Floor or wall / Indoor",
          "Suitable For":
            "Suitable For: living rooms, bedrooms, bathrooms, kitchens, dining room, hallways churches, hospitals, offices, shopping malls, hotels, condominiums, restaurants and airports",
          Surface: "Surface: Semi Polished",
          Disclaimer:
            "Disclaimer: Color of website images may vary slightly from actual products.",
        },
      ]),
    );
    const scan = buildProductMigrationScan(
      [product("LUZ"), product("VIS"), product("MIN")],
      { descriptionCatalog: catalog },
    );
    const candidate = scan.candidates[0];

    expect(candidate.descriptionHtml).toBe(
      "<p>60x60cm Dark Gray Concrete Look Large Square Tile With Semi Polished Surface</p>",
    );
    expect(candidate.metafields.surfaceFinish).toEqual(["Semi Polished"]);
    expect(candidate.metafields.features).toEqual([
      "Stain Resistant",
      "Non Water Appearance",
      "Glazed",
      "Rectified",
      "Inkjet Print Technology",
    ]);
    expect(candidate.metafields.colorTone).toEqual(["Dark Gray"]);
    expect(candidate.metafields.waterAbsorption).toBe("0.07%");
    expect(candidate.metafields.trafficRating).toEqual(["High"]);
    expect(candidate.metafields.materialType).toEqual([]);
    expect(candidate.metafields.printTechnology).toEqual(["Inkjet Print"]);
    expect(candidate.metafields.thicknessMm).toBe(9.5);
    expect(candidate.metafields.rectified).toBe(true);
    expect(candidate.metafields.applicationArea).toEqual([
      "Floor",
      "Wall",
      "Indoor",
    ]);
    expect(candidate.metafields.suitableFor).toEqual([
      "Living Room",
      "Bedroom",
      "Bathroom",
      "Kitchen",
      "Dining Room",
      "Hallway",
      "Church",
      "Hospital",
      "Office",
      "Shopping Mall",
      "Hotel",
      "Condominium",
      "Restaurant",
      "Airport",
    ]);
    expect(candidate.metafields.disclaimer).toBe(
      "Color of website images may vary slightly from actual products.",
    );
    expect(
      metafieldInputs(candidate.metafields).find(
        (input) => input.key === "features",
      ),
    ).toMatchObject({
      type: "list.single_line_text_field",
      value: JSON.stringify([
        "Stain Resistant",
        "Non Water Appearance",
        "Glazed",
        "Rectified",
        "Inkjet Print Technology",
      ]),
    });
    expect(
      metafieldInputs(candidate.metafields).find(
        (input) => input.key === "disclaimer",
      ),
    ).toMatchObject({
      type: "single_line_text_field",
      value: "Color of website images may vary slightly from actual products.",
    });
    expect(
      metafieldInputs(candidate.metafields).some(
        (input) => input.key === "product_description",
      ),
    ).toBe(false);
  });

  it("recognizes taxonomy phrases from both description and features", () => {
    const catalog = parseMigrationDescriptionWorkbook(
      workbookBuffer([
        {
          "Item Code": "YM6623",
          SIZE: "Tiles - 60x60 CM",
          Category: "Category: Tiles",
          Description:
            "Description: Light Gray Porcelain tile with Semi Polished surface and Stain Resistant finish",
          Features:
            "Features: Digital Print Technology, Good for High Traffic Areas, 0.07% Water Absorption",
          Application: "Application: Floor / Indoor",
          Surface: "Surface: Semi Polished",
          Disclaimer: "Disclaimer: Color may vary.",
        },
      ]),
    );
    const scan = buildProductMigrationScan(
      [product("LUZ"), product("VIS"), product("MIN")],
      { descriptionCatalog: catalog },
    );
    const metafields = scan.candidates[0].metafields;

    expect(metafields.surfaceFinish).toEqual(["Semi Polished"]);
    expect(metafields.colorTone).toEqual(["Light Gray"]);
    expect(metafields.materialType).toEqual(["Porcelain"]);
    expect(metafields.features).toEqual([
      "Stain Resistant",
      "Digital Print Technology",
    ]);
    expect(metafields.printTechnology).toEqual(["Digital Print"]);
    expect(metafields.trafficRating).toEqual(["High"]);
    expect(metafields.waterAbsorption).toBe("0.07%");
  });

  it("matches regional title fallback to Excel item code", () => {
    const catalog = parseMigrationDescriptionWorkbook(
      workbookBuffer([
        {
          "Item Code": "YM6623",
          SIZE: "Tiles - 60x60 CM",
          Category: "Category: Tiles",
          Description: "Description: Ceramic Digital Print Thickness 8mm",
          Application: "Application: Wall and Indoor",
          Surface: "Surface: Polished",
        },
      ]),
    );
    const scan = buildProductMigrationScan(
      [
        product("LUZ", { variants: { nodes: [product("LUZ").variants.nodes[0]] } }),
        product("VIS", { title: "VIS YM6623" }),
        product("MIN", { title: "MIN_YM6623" }),
      ],
      { descriptionCatalog: catalog },
    );

    expect(scan.candidates[0].descriptionDataStatus).toBe("matched");
  });

  it("flags unmatched workbook rows without changing Shopify price", () => {
    const catalog = parseMigrationDescriptionWorkbook(
      workbookBuffer([
        {
          "Item Code": "OTHER",
          Description: "Description: Matte Floor",
          "Item Price": "1.00",
        },
      ]),
    );
    const scan = buildProductMigrationScan(
      [product("LUZ"), product("VIS"), product("MIN")],
      { descriptionCatalog: catalog },
    );

    expect(scan.candidates[0]).toMatchObject({
      descriptionDataStatus: "missing",
      price: "1299.00",
    });
    expect(scan.candidates[0].manualReviewFields).toContain(
      "description_data_missing",
    );
  });
});

describe("product migration inventory activation", () => {
  it("builds publication inputs for every publication id", () => {
    expect(
      buildPublicationInputs([
        "gid://shopify/Publication/1",
        "gid://shopify/Publication/2",
      ]),
    ).toEqual([
      { publicationId: "gid://shopify/Publication/1" },
      { publicationId: "gid://shopify/Publication/2" },
    ]);
  });

  it("builds exact inventory quantities for each regional location", () => {
    const candidate = buildProductMigrationScan([
      product("LUZ"),
      product("VIS"),
      product("MIN"),
    ]).candidates[0];

    const quantities = buildUnifiedInventoryQuantities(
      "inventory-item-1",
      candidate,
      new Map([
        ["LUZ", 2],
        ["VIS", 0],
        ["MIN", 7],
      ]),
    );

    expect(quantities).toEqual([
      {
        inventoryItemId: "inventory-item-1",
        locationId: "gid://shopify/Location/86389424402",
        quantity: 3,
        changeFromQuantity: 2,
      },
      {
        inventoryItemId: "inventory-item-1",
        locationId: "gid://shopify/Location/101194629394",
        quantity: 5,
        changeFromQuantity: 0,
      },
      {
        inventoryItemId: "inventory-item-1",
        locationId: "gid://shopify/Location/101194662162",
        quantity: 7,
        changeFromQuantity: 7,
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
