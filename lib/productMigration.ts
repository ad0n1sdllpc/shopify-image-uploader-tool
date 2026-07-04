import "server-only";
import crypto from "node:crypto";
import zlib from "node:zlib";
import migrationTaxonomy from "@/lib/migrationTaxonomy.json";
import { shopifyGraphql } from "@/lib/shopify";
import type {
  ProductMigrationCandidate,
  ProductMigrationIssue,
  ProductMigrationLocationName,
  ProductMigrationMetafields,
  ProductMigrationRegionalProduct,
  ProductMigrationRunResult,
  ProductMigrationScanResult,
  RegionalPrefix,
} from "@/types";

export const regionalPrefixes: RegionalPrefix[] = ["LUZ", "VIS", "MIN"];

export const migrationLocationByPrefix: Record<
  RegionalPrefix,
  ProductMigrationLocationName
> = {
  LUZ: "Lusterplus Inc.",
  VIS: "ARTEMISIA CEBU",
  MIN: "ARTEMISIA DAVAO",
};

const migrationLocationIdByPrefix: Record<RegionalPrefix, string> = {
  LUZ: "gid://shopify/Location/86389424402",
  VIS: "gid://shopify/Location/101194629394",
  MIN: "gid://shopify/Location/101194662162",
};

const regionAvailabilityByPrefix: Record<RegionalPrefix, string> = {
  LUZ: "Luzon",
  VIS: "Visayas",
  MIN: "Mindanao",
};

const METAFIELD_KEYS = {
  itemCode: "custom.item_code",
  tileSize: "custom.tile_size",
  surfaceFinish: "custom.surface_finish",
  features: "custom.features",
  materialType: "custom.material_type",
  printTechnology: "custom.print_technology",
  colorTone: "custom.color_tone",
  waterAbsorption: "custom.water_absorption",
  thicknessMm: "custom.thickness_mm",
  rectified: "custom.rectified",
  trafficRating: "custom.traffic_rating",
  applicationArea: "custom.application_area",
  suitableFor: "custom.suitable_for",
  regionAvailability: "custom.region_availability",
  disclaimer: "custom.disclaimer",
} as const;

type ShopifyUserError = {
  field?: string[] | null;
  message: string;
  code?: string | null;
};

type MigrationProductVariantNode = {
  id: string;
  sku: string | null;
  price: string;
  inventoryQuantity: number | null;
  inventoryItem: {
    id: string;
    sku: string | null;
    tracked: boolean;
    requiresShipping: boolean;
    inventoryLevels?: {
      nodes: {
        location: { id: string; name: string };
        quantities: { name: string; quantity: number }[];
      }[];
    };
  };
};

type MigrationProductIndexNode = {
  id: string;
  title: string;
  handle: string;
  descriptionHtml: string;
  tags: string[];
  productType: string;
  variants: {
    nodes: {
      id: string;
      sku: string | null;
      price: string;
      inventoryQuantity: number | null;
      inventoryItem: {
        id: string;
        sku: string | null;
        tracked: boolean;
        requiresShipping: boolean;
      };
    }[];
  };
};

type MigrationProductNode = {
  id: string;
  title: string;
  handle: string;
  descriptionHtml: string;
  tags: string[];
  productType: string;
  variants: { nodes: MigrationProductVariantNode[] };
  media: {
    nodes: {
      id: string;
      image?: { url: string | null } | null;
      preview?: { image?: { url: string | null } | null } | null;
    }[];
  };
  images: { nodes: { url: string | null }[] };
};

type MigrationSourceProduct = MigrationProductNode & {
  identity: RegionalProductIdentity;
  variant: MigrationProductVariantNode;
};

type RegionalProductIdentity = {
  prefix: RegionalPrefix;
  baseSku: string;
  sku: string;
};

export type ProductMigrationDescriptionRow = {
  itemCode: string;
  size: string | null;
  category: string | null;
  description: string | null;
  features: string | null;
  finish: string | null;
  application: string | null;
  suitableFor: string | null;
  surface: string | null;
  disclaimer: string | null;
};

export type ProductMigrationDescriptionCatalog = {
  rowsByItemCode: Map<string, ProductMigrationDescriptionRow>;
  duplicateItemCodes: Set<string>;
};

export type ProductMigrationBuildOptions = {
  descriptionCatalog?: ProductMigrationDescriptionCatalog | null;
};

type PublicationNode = {
  id: string;
  name: string;
};

type PublicationsResponse = {
  publications: {
    nodes: PublicationNode[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
};

type PublishablePublishResponse = {
  publishablePublish: {
    publishable: {
      availablePublicationsCount: { count: number };
      resourcePublicationsCount: { count: number };
    } | null;
    userErrors: ShopifyUserError[];
  };
};

type ProductCreateResponse = {
  productCreate: {
    product: {
      id: string;
      title: string;
      status: string;
      mediaCount: { count: number };
      variants: {
        nodes: {
          id: string;
          price: string;
          inventoryItem: {
            id: string;
            sku: string | null;
            tracked: boolean;
            requiresShipping: boolean;
          };
        }[];
      };
      metafields: {
        nodes: {
          namespace: string;
          key: string;
          value: string;
          type: string;
        }[];
      };
    } | null;
    userErrors: ShopifyUserError[];
  };
};

type MigrationProductsResponse = {
  products: {
    nodes: MigrationProductNode[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
};

type MigrationLocationsResponse = {
  locations: {
    nodes: { id: string; name: string }[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
};

type MigrationProductIndexResponse = {
  products: {
    nodes: MigrationProductIndexNode[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
};

type MigrationProductSourceDetailsResponse = {
  product: MigrationProductNode | null;
};

const PUBLICATIONS_QUERY = `
  query MigrationPublications($cursor: String) {
    publications(first: 100, after: $cursor) {
      nodes {
        id
        name
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const PUBLISHABLE_PUBLISH_MUTATION = `
  mutation PublishUnifiedMigrationProduct($id: ID!, $input: [PublicationInput!]!) {
    publishablePublish(id: $id, input: $input) {
      publishable {
        availablePublicationsCount { count }
        resourcePublicationsCount { count }
      }
      userErrors { field message }
    }
  }
`;

type MigrationProductDetailsResponse = {
  product: {
    id: string;
    title: string;
    status: string;
    mediaCount: { count: number };
    variants: {
      nodes: {
        id: string;
        sku: string | null;
        price: string;
        inventoryItem: {
          id: string;
          sku: string | null;
          tracked: boolean;
          requiresShipping: boolean;
          inventoryLevels: {
            nodes: {
              location: { id: string; name: string };
              quantities: { name: string; quantity: number }[];
            }[];
          };
        };
      }[];
    };
    metafields: {
      nodes: { namespace: string; key: string; value: string; type: string }[];
    };
  } | null;
};

const MIGRATION_PRODUCT_INDEX_QUERY = `
  query MigrationProductIndex($cursor: String) {
    products(first: 100, after: $cursor, sortKey: TITLE) {
      nodes {
        id
        title
        handle
        descriptionHtml
        tags
        productType
        variants(first: 1) {
          nodes {
            id
            sku
            price
            inventoryQuantity
            inventoryItem {
              id
              sku
              tracked
              requiresShipping
            }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const MIGRATION_SOURCE_PRODUCT_QUERY = `
  query MigrationSourceProduct($id: ID!) {
    product(id: $id) {
      id
      title
      handle
      descriptionHtml
      tags
      productType
      variants(first: 10) {
        nodes {
          id
          sku
          price
          inventoryQuantity
          inventoryItem {
            id
            sku
            tracked
            requiresShipping
            inventoryLevels(first: 100) {
              nodes {
                location { id name }
                quantities(names: ["available"]) { name quantity }
              }
            }
          }
        }
      }
      media(first: 100, sortKey: POSITION) {
        nodes {
          id
          preview { image { url } }
          ... on MediaImage { image { url } }
        }
      }
      images(first: 100) {
        nodes { url }
      }
    }
  }
`;

const LEGACY_MIGRATION_PRODUCTS_QUERY = `
  query MigrationProducts($cursor: String) {
    products(first: 25, after: $cursor, sortKey: TITLE) {
      nodes {
        id
        title
        handle
        descriptionHtml
        tags
        productType
        variants(first: 10) {
          nodes {
            id
            sku
            price
            inventoryQuantity
          inventoryItem {
            id
            sku
            tracked
            requiresShipping
          }
        }
        }
        media(first: 100, sortKey: POSITION) {
          nodes {
            id
            preview { image { url } }
            ... on MediaImage { image { url } }
          }
        }
        images(first: 100) {
          nodes { url }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const LOCATIONS_QUERY = `
  query MigrationLocations($cursor: String) {
    locations(first: 100, after: $cursor) {
      nodes { id name }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const PRODUCT_CREATE_MUTATION = `
  mutation CreateUnifiedMigrationProduct($product: ProductCreateInput!, $media: [CreateMediaInput!]) {
    productCreate(product: $product, media: $media) {
      product {
        id
        title
        status
        mediaCount { count }
        variants(first: 1) {
          nodes {
            id
            price
            inventoryItem { id sku tracked requiresShipping }
          }
        }
        metafields(first: 50, namespace: "custom") {
          nodes { namespace key value type }
        }
      }
      userErrors { field message }
    }
  }
`;

const VARIANT_UPDATE_MUTATION = `
  mutation UpdateUnifiedMigrationVariant($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants {
        id
        price
        inventoryItem { id sku tracked requiresShipping }
      }
      userErrors { field message }
    }
  }
`;

const INVENTORY_BULK_TOGGLE_MUTATION = `
  mutation ActivateUnifiedMigrationInventory($inventoryItemId: ID!, $inventoryItemUpdates: [InventoryBulkToggleActivationInput!]!) {
    inventoryBulkToggleActivation(inventoryItemId: $inventoryItemId, inventoryItemUpdates: $inventoryItemUpdates) {
      inventoryItem { id }
      inventoryLevels {
        location { id name }
        quantities(names: ["available"]) { name quantity }
      }
      userErrors { field message code }
    }
  }
`;

const INVENTORY_ADJUST_MUTATION = `
  mutation SetUnifiedMigrationInventory($input: InventorySetQuantitiesInput!, $idempotencyKey: String!) {
    inventorySetQuantities(input: $input) @idempotent(key: $idempotencyKey) {
      inventoryAdjustmentGroup {
        id
      }
      userErrors { field message }
    }
  }
`;

const PRODUCT_DETAILS_QUERY = `
  query MigrationProductDetails($id: ID!) {
    product(id: $id) {
      id
      title
      status
      mediaCount { count }
      variants(first: 1) {
        nodes {
          id
          sku
          price
          inventoryItem {
            id
            sku
            tracked
            requiresShipping
            inventoryLevels(first: 100) {
              nodes {
                location { id name }
                quantities(names: ["available"]) { name quantity }
              }
            }
          }
        }
      }
      metafields(first: 50, namespace: "custom") {
        nodes { namespace key value type }
      }
    }
  }
`;

export async function scanProductMigrations(
  descriptionWorkbook?: Buffer | null,
): Promise<ProductMigrationScanResult> {
  const products = await fetchMigrationProducts([]);
  const descriptionCatalog = descriptionWorkbook
    ? parseMigrationDescriptionWorkbook(descriptionWorkbook)
    : null;
  return {
    scannedAt: new Date().toISOString(),
    ...buildProductMigrationScan(products, { descriptionCatalog }),
  };
}

export async function migrateRegionalProducts(
  baseSkus: string[],
  descriptionWorkbook?: Buffer | null,
): Promise<ProductMigrationRunResult[]> {
  const normalizedBaseSkus = baseSkus
    .map((baseSku) => baseSku.trim().toUpperCase())
    .filter(Boolean);
  if (normalizedBaseSkus.length === 0) return [];

  const products = await fetchMigrationProducts(normalizedBaseSkus);
  const descriptionCatalog = descriptionWorkbook
    ? parseMigrationDescriptionWorkbook(descriptionWorkbook)
    : null;
  const locationsByName = await fetchLocationsByName();
  const publicationIds = await fetchPublicationIds();
  const scan = buildProductMigrationScan(products, { descriptionCatalog });
  const candidatesBySku = new Map(
    scan.candidates.map((candidate) => [
      candidate.baseSku.toUpperCase(),
      candidate,
    ]),
  );
  const results: ProductMigrationRunResult[] = [];

  for (const baseSku of normalizedBaseSkus) {
    const candidate = candidatesBySku.get(baseSku);
    if (!candidate) {
      results.push({
        baseSku,
        status: "skipped",
        newProductGid: null,
        inventorySet: [],
        missingFields: [],
        imagesAttached: 0,
        metafieldsPopulated: 0,
        originalProductGids: [],
        error: "No regional migration product was found for this SKU.",
      });
      continue;
    }

    results.push(
      await migrateProductCandidate(candidate, locationsByName, publicationIds),
    );
  }

  return results;
}

export function buildProductMigrationScan(
  products: MigrationProductNode[],
  options: ProductMigrationBuildOptions = {},
): Omit<ProductMigrationScanResult, "scannedAt"> {
  const sourceProducts: MigrationSourceProduct[] = [];
  const existingUnifiedProductsBySku = new Map<string, string>();

  for (const product of products) {
    const regional = migrationSourceProduct(product);
    if (regional) sourceProducts.push(regional);

    const unifiedSku = product.variants.nodes
      .find((variant) => {
        const sku = variant.sku?.trim();
        return sku && !regionalSkuIdentity(sku) && sku.length > 0;
      })
      ?.sku?.trim()
      .toUpperCase();
    if (unifiedSku) existingUnifiedProductsBySku.set(unifiedSku, product.id);
  }

  const grouped = new Map<
    string,
    Partial<Record<RegionalPrefix, MigrationSourceProduct[]>>
  >();
  for (const product of sourceProducts) {
    const group = grouped.get(product.identity.baseSku) ?? {};
    group[product.identity.prefix] = [
      ...(group[product.identity.prefix] ?? []),
      product,
    ];
    grouped.set(product.identity.baseSku, group);
  }

  const candidates: ProductMigrationCandidate[] = [];
  const issues: ProductMigrationIssue[] = [];

  for (const [baseSku, group] of grouped.entries()) {
    const missingPrefixes = regionalPrefixes.filter(
      (prefix) => !group[prefix]?.length,
    );
    const duplicatePrefixes = regionalPrefixes.filter(
      (prefix) => (group[prefix]?.length ?? 0) > 1,
    );
    const regionalProducts = regionalPrefixes.flatMap((prefix) =>
      (group[prefix] ?? []).map((product) => regionalProductSummary(product)),
    );

    if (duplicatePrefixes.length) {
      issues.push({
        baseSku,
        reason: `Duplicate ${duplicatePrefixes.join(", ")} product(s)`,
        products: regionalProducts,
      });
      continue;
    }

    const productsInOrder = regionalPrefixes
      .map((prefix) => group[prefix]?.[0])
      .filter((product): product is MigrationSourceProduct => Boolean(product));
    const candidate = candidateFromSourceProducts(
      baseSku,
      productsInOrder,
      existingUnifiedProductsBySku.get(baseSku) ?? null,
      options.descriptionCatalog ?? null,
    );
    const missingRegionFields = missingPrefixes.map(
      (prefix) => `missing_${prefix}`,
    );
    candidates.push({
      ...candidate,
      manualReviewFields: Array.from(
        new Set([...candidate.manualReviewFields, ...missingRegionFields]),
      ),
    });
  }

  return {
    candidates: candidates.sort((first, second) =>
      first.baseSku.localeCompare(second.baseSku),
    ),
    issues: issues.sort((first, second) =>
      first.baseSku.localeCompare(second.baseSku),
    ),
  };
}

export function extractMigrationMetafields(
  baseSku: string,
  descriptionHtml: string,
  tags: string[],
  availablePrefixes: RegionalPrefix[] = [...regionalPrefixes],
): ProductMigrationMetafields {
  const productDescription = plainTextFromHtml(descriptionHtml);
  const searchableText = [productDescription, tags.join(" ")].join(" ");

  return {
    itemCode: baseSku,
    tileSize: extractTileSize(tags, searchableText),
    surfaceFinish: extractSurfaceFinishes(tags, searchableText),
    features: extractFeatures(searchableText),
    materialType: extractMaterialTypes(productDescription),
    printTechnology: extractPrintTechnologies(productDescription),
    colorTone: extractColorTones(productDescription),
    waterAbsorption: extractWaterAbsorption(productDescription),
    thicknessMm: extractThicknessMm(productDescription),
    rectified: /\brectified\b/i.test(productDescription),
    trafficRating: extractTrafficRatings(productDescription),
    applicationArea: extractApplicationAreas(tags.join("; ")),
    suitableFor: [],
    regionAvailability: regionAvailabilityFromPrefixes(availablePrefixes),
    disclaimer: null,
  };
}

export function plainTextFromHtml(descriptionHtml: string) {
  return descriptionHtml
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseMigrationDescriptionWorkbook(
  workbookBuffer: Buffer,
): ProductMigrationDescriptionCatalog {
  const files = unzipWorkbookFiles(workbookBuffer);
  const sharedStrings = parseSharedStrings(files.get("xl/sharedStrings.xml"));
  const sheetPath = firstWorksheetPath(files);
  const sheetXml = files.get(sheetPath);
  if (!sheetXml) throw new Error("Description workbook has no worksheet data.");

  const rows = worksheetRows(sheetXml, sharedStrings);
  const rowsByItemCode = new Map<string, ProductMigrationDescriptionRow>();
  const duplicateItemCodes = new Set<string>();

  for (const rawRow of rows) {
    const row = descriptionRowFromWorksheetRow(rawRow);
    if (!row.itemCode) continue;

    const key = normalizeDescriptionLookupKey(row.itemCode);
    if (rowsByItemCode.has(key)) {
      duplicateItemCodes.add(key);
      continue;
    }
    rowsByItemCode.set(key, row);
  }

  return { rowsByItemCode, duplicateItemCodes };
}

function unzipWorkbookFiles(buffer: Buffer) {
  const files = new Map<string, string>();
  const directoryOffset = endOfCentralDirectoryOffset(buffer);
  let offset = directoryOffset;

  while (buffer.readUInt32LE(offset) === 0x02014b50) {
    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const fileName = normalizeZipPath(
      buffer
        .subarray(offset + 46, offset + 46 + fileNameLength)
        .toString("utf8"),
    );
    const content = readZipEntry(
      buffer,
      localHeaderOffset,
      compressionMethod,
      compressedSize,
      uncompressedSize,
    );
    files.set(fileName, content.toString("utf8"));
    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return files;
}

function endOfCentralDirectoryOffset(buffer: Buffer) {
  for (let offset = buffer.length - 22; offset >= 0; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50)
      return buffer.readUInt32LE(offset + 16);
  }

  throw new Error("Description workbook is not a valid .xlsx file.");
}

function readZipEntry(
  buffer: Buffer,
  localHeaderOffset: number,
  compressionMethod: number,
  compressedSize: number,
  uncompressedSize: number,
) {
  if (buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50)
    throw new Error("Description workbook has an invalid ZIP entry.");

  const fileNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
  const extraLength = buffer.readUInt16LE(localHeaderOffset + 28);
  const dataOffset = localHeaderOffset + 30 + fileNameLength + extraLength;
  const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize);

  if (compressionMethod === 0) return compressed;
  if (compressionMethod === 8) {
    const inflated = zlib.inflateRawSync(compressed);
    if (inflated.length !== uncompressedSize) return inflated;
    return inflated;
  }

  throw new Error("Description workbook uses an unsupported ZIP compression.");
}

function firstWorksheetPath(files: Map<string, string>) {
  const workbookXml = files.get("xl/workbook.xml");
  const workbookRelsXml = files.get("xl/_rels/workbook.xml.rels");
  if (!workbookXml || !workbookRelsXml)
    throw new Error("Description workbook is missing workbook metadata.");

  const firstSheet = workbookXml.match(/<sheet\b[^>]*r:id="([^"]+)"/);
  if (!firstSheet) throw new Error("Description workbook has no sheets.");

  const relationship = new RegExp(
    `<Relationship\\b[^>]*Id="${escapeRegExp(firstSheet[1])}"[^>]*Target="([^"]+)"`,
  ).exec(workbookRelsXml);
  if (!relationship)
    throw new Error("Description workbook is missing worksheet metadata.");

  return normalizeZipPath(
    relationship[1].startsWith("/")
      ? relationship[1].slice(1)
      : `xl/${relationship[1]}`,
  );
}

function normalizeZipPath(value: string) {
  return value.replace(/\\/g, "/").replace(/\/+/g, "/");
}

function parseSharedStrings(xml: string | undefined) {
  if (!xml) return [];
  return Array.from(xml.matchAll(/<si\b[\s\S]*?<\/si>/g)).map((match) =>
    Array.from(match[0].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g))
      .map((textMatch) => decodeXml(textMatch[1]))
      .join(""),
  );
}

function worksheetRows(
  sheetXml: string,
  sharedStrings: string[],
): Record<string, string>[] {
  const rawRows = Array.from(sheetXml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g))
    .map((rowMatch) =>
      Array.from(rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)).map(
        (cellMatch) => ({
          column: cellColumn(cellMatch[1]),
          value: cellValue(cellMatch[1], cellMatch[2], sharedStrings),
        }),
      ),
    )
    .filter((row) => row.length > 0);
  const headerRow = rawRows[0] ?? [];
  const headers = new Map(
    headerRow.map((cell) => [cell.column, cell.value.trim()]),
  );

  return rawRows.slice(1).map((row) => {
    const record: Record<string, string> = {};
    for (const cell of row) {
      const header = headers.get(cell.column);
      if (header) record[header] = cell.value;
    }
    return record;
  });
}

function cellColumn(attributes: string) {
  const ref = attributes.match(/\br="([A-Z]+)\d+"/);
  return ref?.[1] ?? "";
}

function cellValue(
  attributes: string,
  cellXml: string,
  sharedStrings: string[],
) {
  const type = attributes.match(/\bt="([^"]+)"/)?.[1];
  if (type === "inlineStr") {
    return Array.from(cellXml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g))
      .map((match) => decodeXml(match[1]))
      .join("");
  }

  const value = cellXml.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "";
  if (type === "s") return sharedStrings[Number(value)] ?? "";
  return decodeXml(value);
}

function descriptionRowFromWorksheetRow(
  row: Record<string, unknown>,
): ProductMigrationDescriptionRow {
  const finish = nullableWorksheetString(row, "Finish");
  const features =
    nullableWorksheetString(row, "Features") ??
    (finish && /^features\s*:/i.test(finish) ? finish : null);

  return {
    itemCode: worksheetString(row, "Item Code"),
    size: nullableWorksheetString(row, "SIZE"),
    category: nullableWorksheetString(row, "Category"),
    description: nullableWorksheetString(row, "Description"),
    features,
    finish: features === finish ? null : finish,
    application: nullableWorksheetString(row, "Application"),
    suitableFor: nullableWorksheetString(row, "Suitable For"),
    surface: nullableWorksheetString(row, "Surface"),
    disclaimer: nullableWorksheetString(row, "Disclaimer"),
  };
}

function worksheetString(row: Record<string, unknown>, header: string) {
  const value = row[header];
  return value === null || value === undefined ? "" : String(value).trim();
}

function nullableWorksheetString(row: Record<string, unknown>, header: string) {
  const value = worksheetString(row, header);
  return value.length ? value : null;
}

function descriptionRowForCandidate(
  baseSku: string,
  products: MigrationSourceProduct[],
  catalog: ProductMigrationDescriptionCatalog,
) {
  const lookupKeys = new Set<string>([normalizeDescriptionLookupKey(baseSku)]);

  for (const product of products) {
    lookupKeys.add(normalizeDescriptionLookupKey(product.identity.baseSku));
    lookupKeys.add(normalizeDescriptionLookupKey(product.identity.sku));
    lookupKeys.add(normalizeDescriptionLookupKey(product.variant.sku ?? ""));
    lookupKeys.add(normalizeDescriptionLookupKey(product.title));
    lookupKeys.add(normalizeDescriptionLookupKey(product.handle));
  }

  for (const key of lookupKeys) {
    if (!key) continue;
    const row = catalog.rowsByItemCode.get(key);
    if (!row) continue;

    const warnings = catalog.duplicateItemCodes.has(key)
      ? ["duplicate_item_code"]
      : [];
    return { row, warnings };
  }

  return null;
}

function normalizeDescriptionLookupKey(value: string) {
  return value
    .trim()
    .toUpperCase()
    .replace(/^(LUZ|VIS|MIN)[\s\-_]+/i, "")
    .replace(/\s+/g, " ");
}

function descriptionHtmlFromDescriptionRow(row: ProductMigrationDescriptionRow) {
  const description = cleanLabeledValue(row.description, "Description");
  return description ? `<p>${escapeHtml(description)}</p>` : "";
}

function metafieldsFromDescriptionRow(
  baseSku: string,
  row: ProductMigrationDescriptionRow,
  availablePrefixes: RegionalPrefix[],
): ProductMigrationMetafields {
  const productDescription = plainTextFromHtml(
    descriptionHtmlFromDescriptionRow(row),
  );
  const descriptionText = [
    row.description,
    row.features,
    row.finish,
    row.application,
    row.suitableFor,
    row.surface,
    row.category,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ");

  return {
    itemCode: row.itemCode || baseSku,
    tileSize: extractTileSize([row.size ?? ""], descriptionText),
    surfaceFinish: extractSurfaceFinishes(
      [row.surface ?? "", row.finish ?? ""],
      descriptionText,
    ),
    features: extractFeatures(descriptionText),
    materialType: extractMaterialTypes(
      descriptionText,
      [row.category, row.description].filter(Boolean).join(" "),
    ),
    printTechnology: extractPrintTechnologies(descriptionText),
    colorTone: extractColorTones(descriptionText),
    waterAbsorption: extractWaterAbsorption(descriptionText),
    thicknessMm: extractThicknessMm(descriptionText),
    rectified: /\brectified\b/i.test(descriptionText),
    trafficRating: extractTrafficRatings(descriptionText),
    applicationArea: extractApplicationAreas(
      [row.application, row.description].filter(Boolean).join("; "),
    ),
    suitableFor: extractSuitableForValues(row.suitableFor ?? ""),
    regionAvailability: regionAvailabilityFromPrefixes(availablePrefixes),
    disclaimer: cleanLabeledValue(row.disclaimer, "Disclaimer"),
  };
}

function regionAvailabilityFromPrefixes(prefixes: RegionalPrefix[]) {
  return Array.from(
    new Set(prefixes.map((prefix) => regionAvailabilityByPrefix[prefix])),
  );
}

function cleanLabeledValue(value: string | null, label: string) {
  if (!value) return null;
  return value
    .replace(new RegExp(`^\\s*${escapeRegExp(label)}\\s*:\\s*`, "i"), "")
    .trim();
}

function categoryValue(value: string | null | undefined) {
  return cleanLabeledValue(value ?? null, "Category");
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function decodeXml(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

async function migrateProductCandidate(
  candidate: ProductMigrationCandidate,
  locationsByName: Map<string, { id: string; name: string }>,
  publicationIds: string[],
): Promise<ProductMigrationRunResult> {
  const inventorySet = candidate.regionalProducts.map((product) => ({
    locationName: product.locationName,
    quantity: product.quantity,
  }));
  const originalProductGids = candidate.regionalProducts.map(
    (product) => product.sourceProductId,
  );

  if (candidate.existingUnifiedProductId) {
    return {
      baseSku: candidate.baseSku,
      status: "skipped",
      newProductGid: null,
      inventorySet,
      missingFields: candidate.missingFields,
      imagesAttached: 0,
      metafieldsPopulated: metafieldInputs(candidate.metafields).length,
      originalProductGids,
      error: `Unified product already exists: ${candidate.existingUnifiedProductId}`,
    };
  }

  const missingLocations = candidate.regionalProducts
    .map((product) => product.locationName)
    .filter(
      (locationName) =>
        !locationsByName.has(normalizeLocationName(locationName)),
    );
  if (missingLocations.length) {
    return {
      baseSku: candidate.baseSku,
      status: "failed",
      newProductGid: null,
      inventorySet,
      missingFields: candidate.missingFields,
      imagesAttached: 0,
      metafieldsPopulated: metafieldInputs(candidate.metafields).length,
      originalProductGids,
      error: `Missing Shopify location(s): ${Array.from(new Set(missingLocations)).join(", ")}`,
    };
  }

  let createdProductId: string | null = null;

  try {
    const metafields = metafieldInputs(candidate.metafields);
    const created = await createDraftProduct(candidate, metafields);
    createdProductId = created.id;
    const variant = created.variants.nodes[0];
    if (!variant)
      throw new Error("Shopify created the product without a default variant.");

    const inventoryItemId = await updateDefaultVariant(
      created.id,
      variant.id,
      candidate,
    );
    await activateInventoryLocations(
      inventoryItemId,
      candidate,
      locationsByName,
    );
    await setUnifiedInventoryQuantities(created.id, inventoryItemId, candidate);
    await publishUnifiedProduct(created.id, publicationIds);

    const verified = await verifyMigratedProduct(
      created.id,
      candidate,
      locationsByName,
      metafields.length,
    );

    return {
      baseSku: candidate.baseSku,
      status: "success",
      newProductGid: created.id,
      inventorySet,
      missingFields: candidate.missingFields,
      imagesAttached: verified.mediaCount,
      metafieldsPopulated: verified.metafieldCount,
      originalProductGids,
    };
  } catch (error) {
    return {
      baseSku: candidate.baseSku,
      status: "failed",
      newProductGid: createdProductId,
      inventorySet,
      missingFields: candidate.missingFields,
      imagesAttached: 0,
      metafieldsPopulated: metafieldInputs(candidate.metafields).length,
      originalProductGids,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function fetchMigrationProducts(baseSkus?: string[]) {
  const indexProducts = await fetchMigrationProductIndex();
  const detailIds = detailProductIdsForMigration(indexProducts, baseSkus);
  const detailsById = new Map<string, MigrationProductNode>();

  for (const productId of detailIds) {
    const product = await fetchMigrationProductDetails(productId);
    if (product) detailsById.set(product.id, product);
  }

  return indexProducts.map(
    (product) =>
      detailsById.get(product.id) ?? productIndexToMinimalProduct(product),
  );
}

async function fetchMigrationProductIndex() {
  const products: MigrationProductIndexNode[] = [];
  let cursor: string | null = null;

  do {
    const data: MigrationProductIndexResponse =
      await shopifyGraphql<MigrationProductIndexResponse>(
        MIGRATION_PRODUCT_INDEX_QUERY,
        { cursor },
      );
    products.push(...data.products.nodes);
    cursor = data.products.pageInfo.hasNextPage
      ? data.products.pageInfo.endCursor
      : null;
  } while (cursor);

  return products;
}

async function fetchMigrationProductDetails(productId: string) {
  const data = await shopifyGraphql<MigrationProductSourceDetailsResponse>(
    MIGRATION_SOURCE_PRODUCT_QUERY,
    { id: productId },
  );
  return data.product;
}

function detailProductIdsForMigration(
  products: MigrationProductIndexNode[],
  baseSkus?: string[],
) {
  if (!baseSkus || baseSkus.length === 0) return [];

  const requestedBaseSkuSet = new Set(
    baseSkus.map((baseSku) => baseSku.trim().toUpperCase()),
  );
  const groups = new Map<
    string,
    Partial<Record<RegionalPrefix, MigrationProductIndexNode[]>>
  >();

  for (const product of products) {
    const source = migrationSourceIndexProduct(product);
    if (!source) continue;
    if (!requestedBaseSkuSet.has(source.identity.baseSku)) continue;

    const group = groups.get(source.identity.baseSku) ?? {};
    group[source.identity.prefix] = [
      ...(group[source.identity.prefix] ?? []),
      product,
    ];
    groups.set(source.identity.baseSku, group);
  }

  const ids = new Set<string>();
  for (const group of groups.values()) {
    const hasDuplicatePrefix = regionalPrefixes.some(
      (prefix) => (group[prefix]?.length ?? 0) > 1,
    );
    if (hasDuplicatePrefix) continue;

    for (const prefix of regionalPrefixes) {
      for (const product of group[prefix] ?? []) {
        ids.add(product.id);
      }
    }
  }

  return Array.from(ids);
}

function productIndexToMinimalProduct(
  product: MigrationProductIndexNode,
): MigrationProductNode {
  return {
    id: product.id,
    title: product.title,
    handle: product.handle,
    descriptionHtml: product.descriptionHtml,
    tags: product.tags,
    productType: product.productType,
    variants: {
      nodes: product.variants.nodes.map((variant) => ({
        id: variant.id,
        sku: variant.sku,
        price: variant.price,
        inventoryQuantity: variant.inventoryQuantity,
        inventoryItem: {
          id: variant.inventoryItem.id,
          sku: variant.inventoryItem.sku,
          tracked: variant.inventoryItem.tracked,
          requiresShipping: variant.inventoryItem.requiresShipping,
          inventoryLevels: { nodes: [] },
        },
      })),
    },
    media: { nodes: [] },
    images: { nodes: [] },
  };
}

async function fetchLocationsByName() {
  const locations = new Map<string, { id: string; name: string }>();
  let cursor: string | null = null;

  do {
    const data: MigrationLocationsResponse =
      await shopifyGraphql<MigrationLocationsResponse>(LOCATIONS_QUERY, {
        cursor,
      });
    for (const location of data.locations.nodes) {
      locations.set(normalizeLocationName(location.name), location);
    }
    cursor = data.locations.pageInfo.hasNextPage
      ? data.locations.pageInfo.endCursor
      : null;
  } while (cursor);

  return locations;
}

function migrationSourceProduct(
  product: MigrationProductNode,
): MigrationSourceProduct | null {
  for (const variant of product.variants.nodes) {
    const identity = regionalSkuIdentity(variant.sku);
    if (identity) return { ...product, identity, variant };
  }

  const titleIdentity =
    regionalSkuIdentity(product.title) ?? regionalSkuIdentity(product.handle);
  const variant = product.variants.nodes[0];
  if (titleIdentity && variant)
    return { ...product, identity: titleIdentity, variant };

  return null;
}

function migrationSourceIndexProduct(product: MigrationProductIndexNode): {
  product: MigrationProductIndexNode;
  identity: RegionalProductIdentity;
} | null {
  for (const variant of product.variants.nodes) {
    const identity = regionalSkuIdentity(variant.sku);
    if (identity) return { product, identity };
  }

  const titleIdentity =
    regionalSkuIdentity(product.title) ?? regionalSkuIdentity(product.handle);
  if (titleIdentity) return { product, identity: titleIdentity };

  return null;
}

function regionalSkuIdentity(
  value: string | null | undefined,
): RegionalProductIdentity | null {
  const normalized = value?.trim();
  if (!normalized) return null;

  const match = normalized.match(/^(LUZ|VIS|MIN)[\s\-_]+(.+)$/i);
  if (!match) return null;

  return {
    prefix: match[1].toUpperCase() as RegionalPrefix,
    baseSku: match[2].trim().toUpperCase(),
    sku: `${match[1].toUpperCase()}-${match[2].trim().toUpperCase()}`,
  };
}

function candidateFromSourceProducts(
  baseSku: string,
  products: MigrationSourceProduct[],
  existingUnifiedProductId: string | null,
  descriptionCatalog: ProductMigrationDescriptionCatalog | null,
): ProductMigrationCandidate {
  const canonicalProduct = products[0];
  const catalogMatch = descriptionCatalog
    ? descriptionRowForCandidate(baseSku, products, descriptionCatalog)
    : null;
  const descriptionRow = catalogMatch?.row ?? null;
  const descriptionHtml = descriptionRow
    ? descriptionHtmlFromDescriptionRow(descriptionRow)
    : (canonicalProduct.descriptionHtml ?? "");
  const tags = canonicalProduct.tags ?? [];
  const productType =
    categoryValue(descriptionRow?.category) ??
    canonicalProduct.productType ??
    "";
  const price = canonicalProduct.variant.price;
  const availablePrefixes = products.map((product) => product.identity.prefix);
  const metafields = descriptionRow
    ? metafieldsFromDescriptionRow(baseSku, descriptionRow, availablePrefixes)
    : extractMigrationMetafields(
        baseSku,
        descriptionHtml,
        tags,
        availablePrefixes,
      );
  const missingFields = missingMetafieldNames(metafields);
  const manualReviewFields = collectManualReviewFields(
    products,
    missingFields,
    existingUnifiedProductId,
  );
  const descriptionDataWarnings = catalogMatch?.warnings ?? [];
  if (descriptionCatalog && !descriptionRow)
    manualReviewFields.push("description_data_missing");
  manualReviewFields.push(
    ...descriptionDataWarnings.map((warning) => `description_data_${warning}`),
  );

  return {
    baseSku,
    title: baseSku,
    descriptionHtml,
    price,
    tags,
    productType,
    imageUrls: candidateImageUrls(products),
    regionalProducts: products.map((product) =>
      regionalProductSummary(product),
    ),
    metafields,
    missingFields,
    manualReviewFields: Array.from(new Set(manualReviewFields)),
    existingUnifiedProductId,
    descriptionDataStatus: !descriptionCatalog
      ? "not_provided"
      : descriptionRow
        ? descriptionDataWarnings.length
          ? "warning"
          : "matched"
        : "missing",
    descriptionDataWarnings,
    descriptionDataSource: descriptionRow
      ? {
          itemCode: descriptionRow.itemCode,
          size: descriptionRow.size,
          category: descriptionRow.category,
        }
      : null,
  };
}

function candidateImageUrls(products: MigrationSourceProduct[]) {
  const canonicalImageUrls = products[0] ? uniqueImageUrls([products[0]]) : [];
  if (canonicalImageUrls.length > 0) return canonicalImageUrls;
  return uniqueImageUrls(products);
}

function regionalProductSummary(
  product: MigrationSourceProduct,
): ProductMigrationRegionalProduct {
  const locationName = migrationLocationByPrefix[product.identity.prefix];
  return {
    prefix: product.identity.prefix,
    sourceProductId: product.id,
    sourceTitle: product.title,
    sku: product.identity.sku,
    locationName,
    quantity: availableQuantity(product.variant, locationName),
  };
}

function availableQuantity(
  variant: MigrationProductVariantNode,
  locationName: ProductMigrationLocationName,
) {
  const matchingLevel = variant.inventoryItem.inventoryLevels?.nodes.find(
    (level) =>
      normalizeLocationName(level.location.name) ===
      normalizeLocationName(locationName),
  );
  const matchingQuantity = matchingLevel?.quantities.find(
    (quantity) => quantity.name === "available",
  )?.quantity;
  return matchingQuantity ?? variant.inventoryQuantity ?? 0;
}

function uniqueImageUrls(products: MigrationSourceProduct[]) {
  const urls = products.flatMap((product) => {
    const fallbackImageUrls = product.images.nodes.map((image) => image.url);
    return product.media.nodes.map(
      (media, index) =>
        media.image?.url ??
        media.preview?.image?.url ??
        fallbackImageUrls[index] ??
        null,
    );
  });

  return Array.from(new Set(urls.filter((url): url is string => Boolean(url))));
}

function collectManualReviewFields(
  products: MigrationSourceProduct[],
  missingFields: string[],
  existingUnifiedProductId: string | null,
) {
  const fields = new Set(missingFields);
  if (existingUnifiedProductId) fields.add("existing_unified_product");
  if (new Set(products.map((product) => product.variant.price)).size > 1)
    fields.add("price_mismatch");
  if (new Set(products.map((product) => product.productType)).size > 1)
    fields.add("product_type_mismatch");
  if (
    new Set(products.map((product) => normalizeTagSet(product.tags))).size > 1
  )
    fields.add("tag_mismatch");
  if (
    new Set(
      products.map((product) => plainTextFromHtml(product.descriptionHtml)),
    ).size > 1
  )
    fields.add("description_mismatch");
  if (products.every((product) => uniqueImageUrls([product]).length === 0))
    fields.add("images");
  return Array.from(fields);
}

function normalizeTagSet(tags: string[]) {
  return [...tags]
    .map((tag) => tag.trim().toLowerCase())
    .sort()
    .join("|");
}

function missingMetafieldNames(metafields: ProductMigrationMetafields) {
  const missing: string[] = [];
  if (!metafields.tileSize) missing.push(METAFIELD_KEYS.tileSize);
  if (metafields.surfaceFinish.length === 0)
    missing.push(METAFIELD_KEYS.surfaceFinish);
  if (metafields.features.length === 0) missing.push(METAFIELD_KEYS.features);
  if (metafields.materialType.length === 0)
    missing.push(METAFIELD_KEYS.materialType);
  if (metafields.printTechnology.length === 0)
    missing.push(METAFIELD_KEYS.printTechnology);
  if (metafields.colorTone.length === 0) missing.push(METAFIELD_KEYS.colorTone);
  if (!metafields.waterAbsorption) missing.push(METAFIELD_KEYS.waterAbsorption);
  if (metafields.thicknessMm === null) missing.push(METAFIELD_KEYS.thicknessMm);
  if (metafields.trafficRating.length === 0)
    missing.push(METAFIELD_KEYS.trafficRating);
  if (metafields.applicationArea.length === 0)
    missing.push(METAFIELD_KEYS.applicationArea);
  if (metafields.suitableFor.length === 0)
    missing.push(METAFIELD_KEYS.suitableFor);
  if (!metafields.disclaimer) missing.push(METAFIELD_KEYS.disclaimer);
  return missing;
}

export function metafieldInputs(metafields: ProductMigrationMetafields) {
  const inputs = [
    metafieldInput("item_code", "single_line_text_field", metafields.itemCode),
    metafields.tileSize
      ? metafieldInput(
          "tile_size",
          "single_line_text_field",
          metafields.tileSize,
        )
      : null,
    metafields.surfaceFinish.length
      ? metafieldInput(
          "surface_finish",
          "list.single_line_text_field",
          listMetafieldValue(metafields.surfaceFinish),
        )
      : null,
    metafields.features.length
      ? metafieldInput(
          "features",
          "single_line_text_field",
          metafields.features.join("; "),
        )
      : null,
    metafields.materialType.length
      ? metafieldInput(
          "material_type",
          "list.single_line_text_field",
          listMetafieldValue(metafields.materialType),
        )
      : null,
    metafields.printTechnology.length
      ? metafieldInput(
          "print_technology",
          "list.single_line_text_field",
          listMetafieldValue(metafields.printTechnology),
        )
      : null,
    metafields.colorTone.length
      ? metafieldInput(
          "color_tone",
          "list.single_line_text_field",
          listMetafieldValue(metafields.colorTone),
        )
      : null,
    metafields.waterAbsorption
      ? metafieldInput(
          "water_absorption",
          "single_line_text_field",
          metafields.waterAbsorption,
        )
      : null,
    metafields.thicknessMm !== null
      ? metafieldInput(
          "thickness_mm",
          "number_decimal",
          String(metafields.thicknessMm),
        )
      : null,
    metafieldInput("rectified", "boolean", String(metafields.rectified)),
    metafields.trafficRating.length
      ? metafieldInput(
          "traffic_rating",
          "list.single_line_text_field",
          listMetafieldValue(metafields.trafficRating),
        )
      : null,
    metafields.applicationArea.length
      ? metafieldInput(
          "application_area",
          "list.single_line_text_field",
          listMetafieldValue(metafields.applicationArea),
        )
      : null,
    metafields.suitableFor.length
      ? metafieldInput(
          "suitable_for",
          "list.single_line_text_field",
          listMetafieldValue(metafields.suitableFor),
        )
      : null,
    metafieldInput(
      "region_availability",
      "list.single_line_text_field",
      listMetafieldValue(metafields.regionAvailability),
    ),
    metafields.disclaimer
      ? metafieldInput(
          "disclaimer",
          "single_line_text_field",
          metafields.disclaimer,
        )
      : null,
  ];

  return inputs.filter((input): input is NonNullable<typeof input> =>
    Boolean(input),
  );
}

function listMetafieldValue(values: string[]) {
  return JSON.stringify(
    Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))),
  );
}

function metafieldInput(key: string, type: string, value: string) {
  return {
    namespace: "custom",
    key,
    type,
    value,
  };
}

async function createDraftProduct(
  candidate: ProductMigrationCandidate,
  metafields: ReturnType<typeof metafieldInputs>,
) {
  const data = await shopifyGraphql<ProductCreateResponse>(
    PRODUCT_CREATE_MUTATION,
    {
      product: {
        title: candidate.title,
        status: "ACTIVE",
        descriptionHtml: candidate.descriptionHtml,
        productType: candidate.productType,
        tags: candidate.tags,
        metafields,
      },
      media: candidate.imageUrls.map((url) => ({
        mediaContentType: "IMAGE",
        originalSource: url,
        alt: candidate.title,
      })),
    },
  );

  throwIfUserErrors(data.productCreate.userErrors);
  const product = data.productCreate.product;
  if (!product) throw new Error("Shopify did not return the created product.");
  return product;
}

async function updateDefaultVariant(
  productId: string,
  variantId: string,
  candidate: ProductMigrationCandidate,
) {
  const data = await shopifyGraphql<{
    productVariantsBulkUpdate: {
      productVariants: {
        id: string;
        inventoryItem: {
          id: string;
          sku: string | null;
          tracked: boolean;
          requiresShipping: boolean;
        };
      }[];
      userErrors: ShopifyUserError[];
    };
  }>(VARIANT_UPDATE_MUTATION, {
    productId,
    variants: [
      {
        id: variantId,
        price: candidate.price,
        inventoryItem: {
          sku: candidate.baseSku,
          tracked: true,
          requiresShipping: true,
        },
        inventoryPolicy: "DENY",
      },
    ],
  });

  throwIfUserErrors(data.productVariantsBulkUpdate.userErrors);
  const updatedVariant = data.productVariantsBulkUpdate.productVariants[0];
  if (!updatedVariant?.inventoryItem.id)
    throw new Error(
      "Shopify did not return the unified variant inventory item.",
    );
  return updatedVariant.inventoryItem.id;
}

async function activateInventoryLocations(
  inventoryItemId: string,
  candidate: ProductMigrationCandidate,
  locationsByName: Map<string, { id: string; name: string }>,
) {
  const inventoryItemUpdates = candidate.regionalProducts
    .map((product) => ({
      locationId: locationsByName.get(
        normalizeLocationName(product.locationName),
      )?.id,
      activate: true,
    }))
    .filter((input): input is { locationId: string; activate: boolean } =>
      Boolean(input.locationId),
    );

  const data = await shopifyGraphql<{
    inventoryBulkToggleActivation: { userErrors: ShopifyUserError[] };
  }>(INVENTORY_BULK_TOGGLE_MUTATION, {
    inventoryItemId,
    inventoryItemUpdates,
  });

  throwIfUserErrors(
    data.inventoryBulkToggleActivation.userErrors.filter(
      (error) => !isIgnorableInventoryActivationError(error),
    ),
  );
}

async function setUnifiedInventoryQuantities(
  productId: string,
  inventoryItemId: string,
  candidate: ProductMigrationCandidate,
) {
  const currentQuantities = await fetchUnifiedInventoryQuantities(productId);
  const quantities = buildUnifiedInventoryQuantities(
    inventoryItemId,
    candidate,
    currentQuantities,
  );
  if (quantities.length === 0) return;

  const data = await shopifyGraphql<{
    inventorySetQuantities: { userErrors: ShopifyUserError[] };
  }>(INVENTORY_ADJUST_MUTATION, {
    input: {
      name: "available",
      reason: "correction",
      quantities,
    },
    idempotencyKey: crypto.randomUUID(),
  });

  throwIfUserErrors(data.inventorySetQuantities.userErrors);
}

async function fetchUnifiedInventoryQuantities(productId: string) {
  const data = await shopifyGraphql<MigrationProductDetailsResponse>(
    PRODUCT_DETAILS_QUERY,
    { id: productId },
  );
  const product = data.product;
  if (!product)
    throw new Error("Could not load inventory levels for the created product.");

  const variant = product.variants.nodes[0];
  if (!variant)
    throw new Error("Could not load inventory levels for the created variant.");

  const currentQuantities = new Map<RegionalPrefix, number>();
  for (const regionalPrefix of regionalPrefixes) {
    const locationId = migrationLocationIdByPrefix[regionalPrefix];
    const location = variant.inventoryItem.inventoryLevels.nodes.find(
      (level) => level.location.id === locationId,
    );
    const quantity =
      location?.quantities.find((entry) => entry.name === "available")
        ?.quantity ?? 0;
    currentQuantities.set(regionalPrefix, quantity);
  }

  return currentQuantities;
}

export function buildUnifiedInventoryQuantities(
  inventoryItemId: string,
  candidate: ProductMigrationCandidate,
  currentQuantities: Map<RegionalPrefix, number>,
) {
  return candidate.regionalProducts
    .map((product) => ({
      inventoryItemId,
      locationId: migrationLocationIdByPrefix[product.prefix],
      quantity: product.quantity,
      changeFromQuantity: currentQuantities.get(product.prefix) ?? 0,
    }))
    .filter(
      (input) =>
        typeof input.locationId === "string" && input.locationId.length > 0,
    );
}

export function buildPublicationInputs(publicationIds: string[]) {
  return publicationIds.map((publicationId) => ({ publicationId }));
}

async function fetchPublicationIds() {
  const publicationIds: string[] = [];
  let cursor: string | null = null;

  do {
    const data: PublicationsResponse = await shopifyGraphql<PublicationsResponse>(
      PUBLICATIONS_QUERY,
      {
        cursor,
      },
    );
    publicationIds.push(
      ...data.publications.nodes.map((publication) => publication.id),
    );
    cursor = data.publications.pageInfo.hasNextPage
      ? data.publications.pageInfo.endCursor
      : null;
  } while (cursor);

  return publicationIds;
}

async function publishUnifiedProduct(
  productId: string,
  publicationIds: string[],
) {
  if (publicationIds.length === 0) return;

  const data = await shopifyGraphql<PublishablePublishResponse>(
    PUBLISHABLE_PUBLISH_MUTATION,
    {
      id: productId,
      input: buildPublicationInputs(publicationIds),
    },
  );

  throwIfUserErrors(data.publishablePublish.userErrors);
}

async function verifyMigratedProduct(
  productId: string,
  candidate: ProductMigrationCandidate,
  locationsByName: Map<string, { id: string; name: string }>,
  expectedMetafieldCount: number,
) {
  const data = await shopifyGraphql<MigrationProductDetailsResponse>(
    PRODUCT_DETAILS_QUERY,
    { id: productId },
  );
  const product = data.product;
  if (!product) throw new Error("Could not verify the created product.");
  if (product.title !== candidate.title)
    throw new Error(
      `Verification failed: title is ${product.title}, expected ${candidate.title}.`,
    );
  if (product.status !== "ACTIVE")
    throw new Error(
      `Verification failed: status is ${product.status}, expected ACTIVE.`,
    );

  const variant = product.variants.nodes[0];
  if (!variant)
    throw new Error("Verification failed: created product has no variant.");
  if ((variant.sku ?? variant.inventoryItem.sku) !== candidate.baseSku)
    throw new Error("Verification failed: unified SKU was not set.");
  if (!variant.inventoryItem.tracked)
    throw new Error("Verification failed: inventory tracking is disabled.");
  if (!variant.inventoryItem.requiresShipping)
    throw new Error("Verification failed: requires shipping is disabled.");

  for (const regionalProduct of candidate.regionalProducts) {
    const expectedLocation = locationsByName.get(
      normalizeLocationName(regionalProduct.locationName),
    );
    const level = variant.inventoryItem.inventoryLevels.nodes.find(
      (node) => node.location.id === expectedLocation?.id,
    );
    const available = level?.quantities.find(
      (quantity) => quantity.name === "available",
    )?.quantity;
    if (available !== regionalProduct.quantity) {
      throw new Error(
        `Verification failed: ${regionalProduct.locationName} inventory is ${available ?? "missing"}, expected ${regionalProduct.quantity}.`,
      );
    }
  }

  const metafieldCount = product.metafields.nodes.filter(
    (metafield) => metafield.namespace === "custom",
  ).length;
  if (metafieldCount < expectedMetafieldCount)
    throw new Error(
      `Verification failed: ${metafieldCount} metafield(s) found, expected ${expectedMetafieldCount}.`,
    );
  if (product.mediaCount.count < candidate.imageUrls.length)
    throw new Error(
      `Verification failed: ${product.mediaCount.count} image(s) attached, expected ${candidate.imageUrls.length}.`,
    );

  return {
    mediaCount: product.mediaCount.count,
    metafieldCount,
  };
}

function throwIfUserErrors(errors: ShopifyUserError[]) {
  if (!errors.length) return;
  throw new Error(
    errors
      .map((error) => {
        const field = error.field?.length ? `${error.field.join(".")}: ` : "";
        const code = error.code ? ` (${error.code})` : "";
        return `${field}${error.message}${code}`;
      })
      .join("; "),
  );
}

export function isIgnorableInventoryActivationError(error: ShopifyUserError) {
  const code = error.code?.trim().toUpperCase();
  if (code && /ALREADY|ACTIVE|STOCK/.test(code)) return true;

  return (
    /\balready\b.*\b(active|activated|stocked)\b/i.test(error.message) ||
    /\b(active|activated|stocked)\b.*\balready\b/i.test(error.message)
  );
}

function extractTileSize(tags: string[], text: string) {
  const source = [...tags, text].join(" ");
  const match = source.match(/\b(\d{2,3})\s*x\s*(\d{2,3})\s*(cm|mm)?\b/i);
  if (!match) return null;
  const unit = match[3] ? ` ${match[3].toLowerCase()}` : "";
  return `${match[1]}x${match[2]}${unit}`;
}

function extractSurfaceFinishes(tags: string[], text: string) {
  return removeContainedValues(
    extractKnownValues([...tags, text], migrationTaxonomy.surface_finish).map(
      (finish) =>
        finish === "Matt" ? "Matte" : finish.replace(/\bGrey\b/g, "Gray"),
    ),
  );
}

function extractColorTones(text: string) {
  return removeContainedValues(
    extractKnownValues([text], migrationTaxonomy.color_tone).map((color) =>
      color.replace(/\bGrey\b/g, "Gray"),
    ),
  );
}

function extractFeatures(text: string) {
  return extractMappedValues([text], migrationTaxonomy.features);
}

function extractMaterialTypes(text: string, contextText = text) {
  const explicit = text.match(
    /\bmaterial\s*(?:type)?\s*:\s*([A-Za-z][A-Za-z\s-]*)/i,
  );
  if (explicit) {
    return extractKnownValues([explicit[1]], migrationTaxonomy.material_type);
  }

  if (!isTileMaterialContext(contextText)) return [];
  return extractKnownValues([text], migrationTaxonomy.material_type);
}

function isTileMaterialContext(text: string) {
  const normalized = text.toLowerCase();
  if (/\b(?:grout|adhesive|sealant|caulk|filler)\b/.test(normalized))
    return false;
  return /\b(?:tile|tiles|slab|slabs|porcelain|ceramic)\b/.test(normalized);
}

function extractPrintTechnologies(text: string) {
  const mapped = extractMappedValues([text], migrationTaxonomy.print_technology);
  if (mapped.length) return mapped;

  const matches = text.match(/\b(?:HD\s*)?(?:Inkjet|Digital)\s+Print(?:ing)?\b/gi);
  return uniqueValues(
    (matches ?? []).map((match) => titleCase(match.replace(/\s+/g, " "))),
  );
}

function extractWaterAbsorption(text: string) {
  const explicit = text.match(
    /water\s*absorption[^A-Za-z0-9<>≤=]*(E?\s*[<≤=]\s*\d+(?:\.\d+)?\s*%)/i,
  );
  if (explicit) return normalizeWaterAbsorption(explicit[1]);

  const reverse = text.match(
    /\b(E?\s*(?:[<≤=]\s*)?\d+(?:\.\d+)?\s*%)\s*water\s*absorption\b/i,
  );
  if (reverse) return normalizeWaterAbsorption(reverse[1]);

  const compact = text.match(/\bE\s*[<≤=]\s*\d+(?:\.\d+)?\s*%/i);
  return compact ? normalizeWaterAbsorption(compact[0]) : null;
}

function normalizeWaterAbsorption(value: string) {
  return value.replace(/\s+/g, "").replace("≤", "<=");
}

function extractThicknessMm(text: string) {
  const explicit = text.match(/thickness[^0-9]*(\d+(?:\.\d+)?)\s*mm/i);
  const fallback = text.match(/\b(\d+(?:\.\d+)?)\s*mm\b/i);
  const value = explicit?.[1] ?? fallback?.[1];
  return value ? Number(value) : null;
}

function extractTrafficRatings(text: string) {
  const mapped = extractMappedValues([text], migrationTaxonomy.traffic_rating);
  if (mapped.length) return mapped;

  const explicit = text.match(
    /traffic\s*(?:rating|grade)?[^A-Za-z]*(light|moderate|medium|heavy|commercial|residential)/i,
  );
  return uniqueValues([
    ...(explicit ? [titleCase(explicit[1])] : []),
    ...extractKnownValues(
    [text],
    ["Light", "Moderate", "Medium", "Heavy", "Commercial", "Residential"],
    ),
  ]);
}

function extractApplicationAreas(text: string) {
  const areas = [
    "Floor",
    "Wall",
    "Indoor",
    "Outdoor",
    "Bathroom",
    "Kitchen",
    "Commercial",
    "Residential",
  ];

  const normalizedText = text
    .replace(/\b(?:or|and)\b/gi, ";")
    .replace(/[\/,|]+/g, ";");

  return areas.filter((area) =>
    new RegExp(`\\b${escapeRegExp(area)}\\b`, "i").test(normalizedText),
  );
}

function extractSuitableForValues(text: string) {
  const cleaned = cleanLabeledValue(text, "Suitable For") ?? "";
  const normalized = cleaned
    .replace(/\band\b/gi, ",")
    .replace(/[;/|]+/g, ",")
    .replace(/\s+/g, " ");
  const aliases: [RegExp, string][] = [
    [/\bliving\s*rooms?\b/i, "Living Room"],
    [/\bbedrooms?\b/i, "Bedroom"],
    [/\bbathrooms?\b/i, "Bathroom"],
    [/\bkitchens?\b/i, "Kitchen"],
    [/\bdining\s*rooms?\b/i, "Dining Room"],
    [/\bhallways?\b/i, "Hallway"],
    [/\bchurches?\b/i, "Church"],
    [/\bhospitals?\b/i, "Hospital"],
    [/\boffices?\b/i, "Office"],
    [/\bshopping\s*malls?\b/i, "Shopping Mall"],
    [/\bhotels?\b/i, "Hotel"],
    [/\bcondominiums?\b/i, "Condominium"],
    [/\brestaurants?\b/i, "Restaurant"],
    [/\bairports?\b/i, "Airport"],
    [/\bcafeterias?\b/i, "Cafeteria"],
    [/\bpatios?\b/i, "Patio"],
    [/\bbalconies?\b/i, "Balcony"],
    [/\bterraces?\b/i, "Terrace"],
    [/\bporches?\b/i, "Porch"],
  ];

  return uniqueValues(
    aliases
      .filter(([pattern]) => pattern.test(normalized))
      .map(([, value]) => value),
  );
}

function extractKnownValue(sources: string[], values: string[]) {
  for (const source of sources) {
    for (const value of values) {
      if (new RegExp(`\\b${escapeRegExp(value)}\\b`, "i").test(source))
        return value === "Matt" ? "Matte" : value;
    }
  }

  return null;
}

function extractKnownValues(sources: string[], values: string[]) {
  const found: string[] = [];
  for (const source of sources) {
    for (const value of values) {
      if (new RegExp(`\\b${escapeRegExp(value)}\\b`, "i").test(source))
        found.push(value === "Matt" ? "Matte" : value);
    }
  }

  return uniqueValues(found);
}

function extractMappedValues(
  sources: string[],
  values: { phrase: string; value: string }[],
) {
  const found: string[] = [];
  for (const source of sources) {
    for (const entry of values) {
      if (new RegExp(`\\b${escapeRegExp(entry.phrase)}\\b`, "i").test(source))
        found.push(entry.value);
    }
  }

  return removeContainedValues(found);
}

function removeContainedValues(values: string[]) {
  const unique = uniqueValues(values);
  return unique.filter(
    (value) =>
      !unique.some((other) => other !== value && other.includes(value)),
  );
}

function uniqueValues(values: string[]) {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter(Boolean)),
  );
}

function titleCase(value: string) {
  return value
    .toLowerCase()
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function normalizeLocationName(value: string) {
  return value.trim().toLowerCase();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
