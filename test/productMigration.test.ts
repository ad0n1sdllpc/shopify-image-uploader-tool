import { describe, expect, it } from "vitest";
import {
  buildProductMigrationScan,
  buildPublicationInputs,
  buildUnifiedInventoryQuantities,
  extractMigrationMetafields,
  isIgnorableInventoryActivationError,
  metafieldInputs,
  parseMigrationDescriptionFile,
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
    "Tile Size",
    "Surface finish",
    "Product Category",
    "Description (clean)",
    "Color Tone",
    "Weight",
    "Number of Pieces per box",
    "Thickness(mm)",
    "Water absorption",
    "Traffic rating",
    "Slip resistant",
    "Rectified",
    "Application area",
    "Material Type",
    "Print Technology",
  ];
  return workbookBufferWithHeaders(headers, rows);
}

function workbookBufferWithHeaders(
  headers: string[],
  rows: Record<string, string>[],
) {
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

function workbookBufferWithNamespacedXml(
  headers: string[],
  rows: Record<string, string>[],
) {
  const sheetRows = [
    headers,
    ...rows.map((row) => headers.map((header) => row[header] ?? "")),
  ];
  const sheetXml = `<?xml version="1.0" encoding="utf-8"?><x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData>${sheetRows
    .map(
      (row, rowIndex) =>
        `<x:row r="${rowIndex + 1}">${row
          .map(
            (value, columnIndex) =>
              `<x:c r="${columnName(columnIndex)}${rowIndex + 1}" t="str">${value ? `<x:v>${xmlEscape(value)}</x:v>` : ""}</x:c>`,
          )
          .join("")}</x:row>`,
    )
    .join("")}</x:sheetData></x:worksheet>`;

  return zipBuffer({
    "xl/workbook.xml": `<?xml version="1.0" encoding="utf-8"?><x:workbook xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheets><x:sheet name="products_plain" sheetId="1" r:id="Rid1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" /></x:sheets></x:workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="utf-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/sheet1.xml" Id="Rid1" /></Relationships>`,
    "xl/worksheets/sheet1.xml": sheetXml,
    "xl/sharedStrings.xml": `<?xml version="1.0" encoding="utf-8"?><x:sst xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main" />`,
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

function csvBuffer(headers: string[], rows: Record<string, string>[]) {
  const escapeCsv = (value: string) =>
    /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

  const lines = [
    headers.map(escapeCsv).join(","),
    ...rows.map((row) =>
      headers.map((header) => escapeCsv(row[header] ?? "")).join(","),
    ),
  ];
  return Buffer.from(lines.join("\r\n"), "utf8");
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
        "custom.unit_type",
        "custom.pieces_per_box",
        "custom.color_tone",
        "custom.slip_resistant",
        "custom.suitable_for",
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

  it("keeps incomplete regional groups selectable with missing-region review fields", () => {
    const scan = buildProductMigrationScan([product("LUZ"), product("VIS")]);

    expect(scan.candidates).toHaveLength(1);
    expect(scan.issues).toEqual([]);
    expect(
      scan.candidates[0].regionalProducts.map((item) => item.prefix),
    ).toEqual(["LUZ", "VIS"]);
    expect(scan.candidates[0].metafields.regionAvailability).toEqual([
      "Luzon",
      "Visayas",
    ]);
    expect(scan.candidates[0].manualReviewFields).toContain("missing_MIN");
  });

  it("keeps one-location regional groups selectable", () => {
    const scan = buildProductMigrationScan([product("LUZ")]);

    expect(scan.candidates).toHaveLength(1);
    expect(scan.issues).toEqual([]);
    expect(
      scan.candidates[0].regionalProducts.map((item) => item.prefix),
    ).toEqual(["LUZ"]);
    expect(scan.candidates[0].metafields.regionAvailability).toEqual([
      "Luzon",
    ]);
    expect(scan.candidates[0].manualReviewFields).toEqual(
      expect.arrayContaining(["missing_VIS", "missing_MIN"]),
    );
  });

  it("uses only present regional products for Excel-enriched region availability", () => {
    const catalog = parseMigrationDescriptionWorkbook(
      workbookBuffer([
        {
          "Item Code": "YM6623",
          Description: "Description: Dark Gray Semi Polished Tile",
          Application: "Application: Floor / Indoor",
          Surface: "Surface: Semi Polished",
        },
      ]),
    );
    const scan = buildProductMigrationScan([product("LUZ"), product("MIN")], {
      descriptionCatalog: catalog,
    });

    expect(scan.candidates).toHaveLength(1);
    expect(scan.candidates[0].metafields.regionAvailability).toEqual([
      "Luzon",
      "Mindanao",
    ]);
    expect(scan.candidates[0].manualReviewFields).toContain("missing_VIS");
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
      unitType: null,
      piecesPerBox: null,
      surfaceFinish: ["Polished"],
      features: ["Rectified"],
      materialType: ["Porcelain"],
      printTechnology: ["Inkjet Print"],
      colorTone: [],
      waterAbsorption: "E<0.5%",
      thicknessMm: "8.2",
      slipResistant: null,
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
      unitType: null,
      piecesPerBox: null,
      surfaceFinish: ["Polished"],
      features: [],
      materialType: ["Porcelain"],
      printTechnology: ["Inkjet Print"],
      colorTone: [],
      waterAbsorption: "E<0.5%",
      thicknessMm: "8.2",
      slipResistant: null,
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
    expect(inputs.find((input) => input.key === "pieces_per_box")).toBeUndefined();
    expect(inputs.find((input) => input.key === "unit_type")).toBeUndefined();
    expect(inputs.find((input) => input.key === "disclaimer")).toBeUndefined();
    expect(inputs.some((input) => input.key === "product_description")).toBe(
      false,
    );
  });

  it("serializes pieces_per_box as a Shopify integer metafield", () => {
    const inputs = metafieldInputs({
      itemCode: "YM6623",
      tileSize: "60x60 cm",
      unitType: "Box",
      piecesPerBox: "10",
      surfaceFinish: [],
      features: [],
      materialType: [],
      printTechnology: [],
      colorTone: [],
      waterAbsorption: null,
      thicknessMm: null,
      slipResistant: null,
      rectified: null,
      trafficRating: [],
      applicationArea: [],
      suitableFor: [],
      regionAvailability: ["Luzon", "Visayas", "Mindanao"],
      disclaimer: null,
    });

    expect(inputs.find((input) => input.key === "pieces_per_box")).toMatchObject({
      type: "number_integer",
      value: "10",
    });
  });

  it("serializes metafields in the workbook column order", () => {
    const inputs = metafieldInputs({
      itemCode: "ORDER1",
      tileSize: "30x90 cm",
      surfaceFinish: ["Matte"],
      colorTone: ["White"],
      unitType: "box",
      piecesPerBox: "6",
      thicknessMm: "9",
      waterAbsorption: "E<0.5%",
      trafficRating: ["High"],
      slipResistant: true,
      rectified: true,
      applicationArea: ["Wall", "Indoor"],
      suitableFor: ["Bathroom"],
      materialType: ["Porcelain"],
      printTechnology: ["Inkjet Print"],
      features: ["Stain Resistant"],
      regionAvailability: ["Luzon"],
      disclaimer: "Color may vary.",
    });

    expect(inputs.map((input) => input.key)).toEqual([
      "item_code",
      "tile_size",
      "surface_finish",
      "color_tone",
      "unit_type",
      "pieces_per_box",
      "thickness_mm",
      "water_absorption",
      "traffic_rating",
      "slip_resistant",
      "rectified",
      "application_area",
      "suitable_for",
      "material_type",
      "print_technology",
      "features",
      "region_availability",
      "disclaimer",
    ]);
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
      features: [],
      materialType: [],
      printTechnology: [],
      colorTone: [],
      waterAbsorption: null,
      thicknessMm: null,
      rectified: null,
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

  it("prefers structured workbook columns and parses shipping weight", () => {
    const catalog = parseMigrationDescriptionWorkbook(
      workbookBuffer([
        {
          "Item Code": "MILAN18",
          "Tile Size": "30x60 CM",
          "Surface finish": "Polished",
          "Product Category": "Tiles",
          "Description (clean)": "Light Gray marble",
          "Color Tone": "Light Gray; Gray",
          Weight: "2.7 kg per piece",
          "Number of Pieces per box": "10",
          "Thickness(mm)": "7.1+/-2.0",
          "Water absorption": "E<0.5%",
          "Traffic rating": "High",
          Rectified: "Yes",
          "Application area": "Wall; Indoor",
          "Suitable For": "Living rooms; Swimming pool",
          "Material Type": "Porcelain",
          "Print Technology": "Inkjet Print",
          Features: "Stain-resistant",
        },
      ]),
    );
    const scan = buildProductMigrationScan(
      [
        product("LUZ", {
          variants: {
            nodes: [
              {
                ...product("LUZ").variants.nodes[0],
                sku: "LUZ-MILAN18",
              },
            ],
          },
        }),
      ],
      { descriptionCatalog: catalog },
    );
    const candidate = scan.candidates[0];

    expect(candidate).toMatchObject({
      baseSku: "MILAN18",
      productType: "Tiles",
      shippingWeight: {
        value: 2.7,
        unit: "KILOGRAMS",
        source: "2.7 kg per piece",
      },
    });
    expect(candidate.descriptionHtml).toBe("<p>Light Gray marble</p>");
    expect(candidate.metafields).toMatchObject({
      tileSize: "30x60 cm",
      surfaceFinish: ["Polished"],
      piecesPerBox: "10",
      unitType: null,
      colorTone: ["Light Gray", "Gray"],
      waterAbsorption: "E<0.5%",
      thicknessMm: "7.1+/-2.0",
      slipResistant: null,
      rectified: true,
      trafficRating: ["High"],
      applicationArea: ["Wall", "Indoor"],
      suitableFor: ["Living Room", "Swimming Pool"],
      materialType: ["Porcelain"],
      printTechnology: ["Inkjet Print"],
      features: ["Stain-Resistant"],
    });
    expect(
      metafieldInputs(candidate.metafields).find(
        (input) => input.key === "application_area",
      ),
    ).toMatchObject({
      type: "list.single_line_text_field",
      value: JSON.stringify(["Wall", "Indoor"]),
    });
    expect(candidate.metafields.disclaimer).toBe(
      "Color of website images may vary slightly from actual products.",
    );
  });

  it("adds the default disclaimer for vinyl when the workbook leaves it blank", () => {
    const catalog = parseMigrationDescriptionWorkbook(
      workbookBuffer([
        {
          "Item Code": "VINYL1",
          "Product Category": "Vinyl",
          "Description (clean)": "Brown wood plank",
        },
      ]),
    );
    const scan = buildProductMigrationScan(
      [
        product("LUZ", {
          variants: {
            nodes: [
              {
                ...product("LUZ").variants.nodes[0],
                sku: "LUZ-VINYL1",
              },
            ],
          },
        }),
      ],
      { descriptionCatalog: catalog },
    );

    expect(scan.candidates[0].metafields.disclaimer).toBe(
      "Color of website images may vary slightly from actual products.",
    );
  });

  it("splits workbook feature lists, keeps blank rectified false, and reads pieces per box header variants", () => {
    const catalog = parseMigrationDescriptionWorkbook(
      workbookBufferWithHeaders(
        [
          "Item Code",
          "Product Category",
          "Description (clean)",
          "No. of Pieces per Box",
          "Features",
          "Rectified",
        ],
        [
          {
            "Item Code": "LIST1",
            "Product Category": "Tiles",
            "Description (clean)": "Neutral tile",
            "No. of Pieces per Box": "12",
            Features: "Porcelain; Stain-resistant; Non-water appearance.",
            Rectified: "",
          },
        ],
      ),
    );
    const scan = buildProductMigrationScan(
      [
        product("LUZ", {
          variants: {
            nodes: [
              {
                ...product("LUZ").variants.nodes[0],
                sku: "LUZ-LIST1",
              },
            ],
          },
        }),
      ],
      { descriptionCatalog: catalog },
    );
    const metafields = scan.candidates[0].metafields;

    expect(metafields.piecesPerBox).toBe("12");
    expect(metafields.unitType).toBe(null);
    expect(metafields.features).toEqual([
      "Porcelain",
      "Stain-Resistant",
      "Non-Water Appearance",
    ]);
    expect(metafields.rectified).toBe(null);
  });

  it("reads alternate features headers and splits newline-separated feature cells", () => {
    const catalog = parseMigrationDescriptionWorkbook(
      workbookBufferWithHeaders(
        [
          "Item Code",
          "Product Category",
          "Description (clean)",
          "Product Features",
        ],
        [
          {
            "Item Code": "LIST2",
            "Product Category": "Tiles",
            "Description (clean)": "Neutral tile",
            "Product Features":
              "Porcelain\r\nStain-resistant\r\nNon-water appearance",
          },
        ],
      ),
    );
    const scan = buildProductMigrationScan(
      [
        product("LUZ", {
          variants: {
            nodes: [
              {
                ...product("LUZ").variants.nodes[0],
                sku: "LUZ-LIST2",
              },
            ],
          },
        }),
      ],
      { descriptionCatalog: catalog },
    );

    expect(scan.candidates[0].metafields.features).toEqual([
      "Porcelain",
      "Stain-Resistant",
      "Non-Water Appearance",
    ]);
  });

  it("reads snake_case workbook headers used by the sample file", () => {
    const catalog = parseMigrationDescriptionWorkbook(
      workbookBufferWithHeaders(
        [
          "item_code",
          "tile_size",
          "product_category",
          "description_clean",
          "features",
        ],
        [
          {
            item_code: "SAMPLE1",
            tile_size: "20x30 CM",
            product_category: "Tiles",
            description_clean: "Dark white",
            features: "Stain-resistant",
          },
        ],
      ),
    );
    const scan = buildProductMigrationScan(
      [
        product("LUZ", {
          variants: {
            nodes: [
              {
                ...product("LUZ").variants.nodes[0],
                sku: "LUZ-SAMPLE1",
              },
            ],
          },
        }),
      ],
      { descriptionCatalog: catalog },
    );

    expect(scan.candidates[0].descriptionDataStatus).toBe("matched");
    expect(scan.candidates[0].metafields.tileSize).toBe("20x30 cm");
    expect(scan.candidates[0].metafields.features).toEqual(["Stain-Resistant"]);
  });

  it("reads namespaced workbook XML used by external xlsx generators", () => {
    const catalog = parseMigrationDescriptionWorkbook(
      workbookBufferWithNamespacedXml(
        [
          "item_code",
          "tile_size",
          "product_category",
          "description_clean",
          "features",
        ],
        [
          {
            item_code: "NS1",
            tile_size: "20x30 CM",
            product_category: "Tiles",
            description_clean: "Dark white",
            features: "Stain-resistant",
          },
        ],
      ),
    );
    const scan = buildProductMigrationScan(
      [
        product("LUZ", {
          variants: {
            nodes: [
              {
                ...product("LUZ").variants.nodes[0],
                sku: "LUZ-NS1",
              },
            ],
          },
        }),
      ],
      { descriptionCatalog: catalog },
    );

    expect(scan.candidates[0].descriptionDataStatus).toBe("matched");
    expect(scan.candidates[0].metafields.features).toEqual(["Stain-Resistant"]);
  });

  it("reads CSV files with the custom metafield headers", () => {
    const catalog = parseMigrationDescriptionFile(
      csvBuffer(
        [
          "custom.item_code",
          "custom.tile_size",
          "custom.surface_finish",
          "custom.color_tone",
          "custom.unit_type",
          "custom.pieces_per_box",
          "custom.thickness_mm",
          "custom.water_absorption",
          "custom.traffic_rating",
          "custom.slip_resistant",
          "custom.rectified",
          "custom.application_area",
          "custom.suitable_for",
          "custom.material_type",
          "custom.print_technology",
          "custom.features",
          "weight",
          "product_category",
          "description",
        ],
        [
          {
            "custom.item_code": "16MEA",
            "custom.tile_size": "30x90 CM",
            "custom.surface_finish": "Matte",
            "custom.color_tone": "",
            "custom.unit_type": "",
            "custom.pieces_per_box": "",
            "custom.thickness_mm": "",
            "custom.water_absorption": "",
            "custom.traffic_rating": "",
            "custom.slip_resistant": "",
            "custom.rectified": "Yes",
            "custom.application_area": "Wall; Indoor; Outdoor",
            "custom.suitable_for":
              "Living rooms; Bedrooms; Bathrooms; Kitchens",
            "custom.material_type": "Porcelain",
            "custom.print_technology": "",
            "custom.features":
              "Porcelain; Stain-resistant; Non-water appearance",
            weight: "",
            product_category: "Tiles",
            description: "Woven patterned",
          },
        ],
      ),
    );
    const scan = buildProductMigrationScan(
      [
        product("LUZ", {
          variants: {
            nodes: [
              {
                ...product("LUZ").variants.nodes[0],
                sku: "LUZ-16MEA",
              },
            ],
          },
        }),
      ],
      { descriptionCatalog: catalog },
    );
    const metafields = scan.candidates[0].metafields;

    expect(metafields.tileSize).toBe("30x90 cm");
    expect(metafields.surfaceFinish).toEqual(["Matte"]);
    expect(metafields.rectified).toBe(true);
    expect(metafields.applicationArea).toEqual(["Wall", "Indoor", "Outdoor"]);
    expect(metafields.materialType).toEqual(["Porcelain"]);
    expect(metafields.features).toEqual([
      "Porcelain",
      "Stain-Resistant",
      "Non-Water Appearance",
    ]);
  });

  it("maps custom metafield headers without crossing features into print technology", () => {
    const catalog = parseMigrationDescriptionWorkbook(
      workbookBufferWithHeaders(
        [
          "custom.item_code",
          "custom.tile_size",
          "custom.rectified",
          "custom.features",
          "custom.print_technology",
          "product_category",
          "description",
        ],
        [
          {
            "custom.item_code": "CUSTOM1",
            "custom.tile_size": "60x60 CM",
            "custom.rectified": "Yes",
            "custom.features": "Stain resistant; Non-water appearance",
            "custom.print_technology": "Inkjet print",
            product_category: "Tiles",
            description: "Sample description",
          },
        ],
      ),
    );
    const scan = buildProductMigrationScan(
      [
        product("LUZ", {
          variants: {
            nodes: [
              {
                ...product("LUZ").variants.nodes[0],
                sku: "LUZ-CUSTOM1",
              },
            ],
          },
        }),
      ],
      { descriptionCatalog: catalog },
    );
    const metafields = scan.candidates[0].metafields;

    expect(scan.candidates[0].descriptionDataStatus).toBe("matched");
    expect(metafields.rectified).toBe(true);
    expect(metafields.features).toEqual([
      "Stain Resistant",
      "Non-Water Appearance",
    ]);
    expect(metafields.printTechnology).toEqual(["Inkjet Print"]);
  });

  it("leaves workbook metafields blank when their custom columns are blank", () => {
    const catalog = parseMigrationDescriptionWorkbook(
      workbookBufferWithHeaders(
        [
          "custom.item_code",
          "custom.tile_size",
          "custom.features",
          "custom.print_technology",
          "custom.material_type",
          "custom.traffic_rating",
          "custom.color_tone",
          "custom.rectified",
          "product_category",
          "description",
        ],
        [
          {
            "custom.item_code": "CUSTOM2",
            "custom.tile_size": "30x90 CM",
            "custom.features":
              "Porcelain; Stain-resistant; Non-water appearance; Inkjet print",
            "custom.print_technology": "",
            "custom.material_type": "",
            "custom.traffic_rating": "",
            "custom.color_tone": "",
            "custom.rectified": "",
            product_category: "Tiles",
            description: "Woven patterned",
          },
        ],
      ),
    );
    const scan = buildProductMigrationScan(
      [
        product("LUZ", {
          variants: {
            nodes: [
              {
                ...product("LUZ").variants.nodes[0],
                sku: "LUZ-CUSTOM2",
              },
            ],
          },
        }),
      ],
      { descriptionCatalog: catalog },
    );
    const metafields = scan.candidates[0].metafields;

    expect(metafields.features).toEqual([
      "Porcelain",
      "Stain-Resistant",
      "Non-Water Appearance",
      "Inkjet Print",
    ]);
    expect(metafields.printTechnology).toEqual([]);
    expect(metafields.materialType).toEqual([]);
    expect(metafields.trafficRating).toEqual([]);
    expect(metafields.colorTone).toEqual([]);
    expect(metafields.rectified).toBe(null);
  });

  it("splits application area from semicolon variants into a Shopify list", () => {
    const catalog = parseMigrationDescriptionWorkbook(
      workbookBuffer([
        {
          "Item Code": "APP1",
          "Product Category": "Tiles",
          "Description (clean)": "Wall tile",
          "Application area": "Wall； Indoor &#59; Outdoor",
        },
      ]),
    );
    const scan = buildProductMigrationScan(
      [
        product("LUZ", {
          variants: {
            nodes: [
              {
                ...product("LUZ").variants.nodes[0],
                sku: "LUZ-APP1",
              },
            ],
          },
        }),
      ],
      { descriptionCatalog: catalog },
    );
    const input = metafieldInputs(scan.candidates[0].metafields).find(
      (item) => item.key === "application_area",
    );

    expect(scan.candidates[0].metafields.applicationArea).toEqual([
      "Wall",
      "Indoor",
      "Outdoor",
    ]);
    expect(input).toMatchObject({
      type: "list.single_line_text_field",
      value: JSON.stringify(["Wall", "Indoor", "Outdoor"]),
    });
  });

  it("does not populate text metafields from raw Excel serial numbers", () => {
    const catalog = parseMigrationDescriptionWorkbook(
      workbookBuffer([
        {
          "Item Code": "SERIAL1",
          "Product Category": "Tiles",
          "Description (clean)": "45678",
          "Color Tone": "45679",
          "Surface finish": "45680",
          "Application area": "Wall; Indoor",
        },
      ]),
    );
    const scan = buildProductMigrationScan(
      [
        product("LUZ", {
          variants: {
            nodes: [
              {
                ...product("LUZ").variants.nodes[0],
                sku: "LUZ-SERIAL1",
              },
            ],
          },
        }),
      ],
      { descriptionCatalog: catalog },
    );

    expect(scan.candidates[0].descriptionHtml).toBe("");
    expect(scan.candidates[0].metafields.colorTone).toEqual([]);
    expect(scan.candidates[0].metafields.surfaceFinish).toEqual([]);
  });

  it("maps workbook text into description, taxonomy, and list metafields", () => {
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
      "0.07% Water Absorption",
      "Good For High Traffic Areas",
      "9.5mm Thickness",
      "Inkjet Print Technology",
      "Rectified",
    ]);
    expect(candidate.metafields.colorTone).toEqual([]);
    expect(candidate.metafields.waterAbsorption).toBe(null);
    expect(candidate.metafields.trafficRating).toEqual([]);
    expect(candidate.metafields.materialType).toEqual([]);
    expect(candidate.metafields.printTechnology).toEqual([]);
    expect(candidate.metafields.thicknessMm).toBe(null);
    expect(candidate.metafields.rectified).toBe(null);
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
        "0.07% Water Absorption",
        "Good For High Traffic Areas",
        "9.5mm Thickness",
        "Inkjet Print Technology",
        "Rectified",
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

  it("keeps direct workbook features as list items", () => {
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
    expect(metafields.colorTone).toEqual([]);
    expect(metafields.materialType).toEqual([]);
    expect(metafields.features).toEqual([
      "Digital Print Technology",
      "Good For High Traffic Areas",
      "0.07% Water Absorption",
    ]);
    expect(metafields.printTechnology).toEqual([]);
    expect(metafields.trafficRating).toEqual([]);
    expect(metafields.waterAbsorption).toBe(null);
  });

  it("does not split grout color names into tile material values", () => {
    const catalog = parseMigrationDescriptionWorkbook(
      workbookBuffer([
        {
          "Item Code": "01",
          Category: "Category: Grout",
          Description: "Description: Epoxy Grout, Color: Porcelain White, 400ml",
        },
      ]),
    );
    const scan = buildProductMigrationScan(
      [
        product("LUZ", {
          title: "LUZ 01 PORCELAIN WHITE",
          variants: {
            nodes: [
              {
                ...product("LUZ").variants.nodes[0],
                sku: "LUZ-01",
              },
            ],
          },
        }),
      ],
      { descriptionCatalog: catalog },
    );
    const metafields = scan.candidates[0].metafields;

    expect(metafields.colorTone).toEqual([]);
    expect(metafields.materialType).toEqual([]);
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
