import "server-only";
import crypto from "node:crypto";
import { shopifyGraphql } from "@/lib/shopify";
import type {
  ProductMigrationCandidate,
  ProductMigrationIssue,
  ProductMigrationLocationName,
  ProductMigrationMetafields,
  ProductMigrationRegionalProduct,
  ProductMigrationRunResult,
  ProductMigrationScanResult,
  RegionalPrefix
} from "@/types";

export const regionalPrefixes: RegionalPrefix[] = ["LUZ", "VIS", "MIN"];

export const migrationLocationByPrefix: Record<RegionalPrefix, ProductMigrationLocationName> = {
  LUZ: "Lusterplus Inc.",
  VIS: "ARTEMISIA CEBU",
  MIN: "ARTEMISIA DAVAO"
};

const regionAvailabilityByPrefix: Record<RegionalPrefix, string> = {
  LUZ: "Luzon",
  VIS: "Visayas",
  MIN: "Mindanao"
};

const METAFIELD_KEYS = {
  itemCode: "custom.item_code",
  tileSize: "custom.tile_size",
  surfaceFinish: "custom.surface_finish",
  materialType: "custom.material_type",
  printTechnology: "custom.print_technology",
  waterAbsorption: "custom.water_absorption",
  thicknessMm: "custom.thickness_mm",
  rectified: "custom.rectified",
  trafficRating: "custom.traffic_rating",
  applicationArea: "custom.application_area",
  regionAvailability: "custom.region_availability",
  productDescription: "custom.product_description"
} as const;

type ShopifyUserError = { field?: string[] | null; message: string; code?: string | null };

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
    nodes: { id: string; image?: { url: string | null } | null; preview?: { image?: { url: string | null } | null } | null }[];
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
          inventoryItem: { id: string; sku: string | null; tracked: boolean; requiresShipping: boolean };
        }[];
      };
      metafields: { nodes: { namespace: string; key: string; value: string; type: string }[] };
    } | null;
    userErrors: ShopifyUserError[];
  };
};

type MigrationProductsResponse = {
  products: { nodes: MigrationProductNode[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
};

type MigrationLocationsResponse = {
  locations: { nodes: { id: string; name: string }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
};

type MigrationProductIndexResponse = {
  products: { nodes: MigrationProductIndexNode[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
};

type MigrationProductSourceDetailsResponse = {
  product: MigrationProductNode | null;
};

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
    metafields: { nodes: { namespace: string; key: string; value: string; type: string }[] };
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
  mutation AdjustUnifiedMigrationInventory($input: InventoryAdjustQuantitiesInput!, $idempotencyKey: String!) {
    inventoryAdjustQuantities(input: $input) @idempotent(key: $idempotencyKey) {
      inventoryAdjustmentGroup {
        createdAt
        reason
        referenceDocumentUri
        changes { name delta }
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

export async function scanProductMigrations(): Promise<ProductMigrationScanResult> {
  const products = await fetchMigrationProducts([]);
  return {
    scannedAt: new Date().toISOString(),
    ...buildProductMigrationScan(products)
  };
}

export async function migrateRegionalProducts(baseSkus: string[]): Promise<ProductMigrationRunResult[]> {
  const normalizedBaseSkus = baseSkus.map((baseSku) => baseSku.trim().toUpperCase()).filter(Boolean);
  if (normalizedBaseSkus.length === 0) return [];

  const products = await fetchMigrationProducts(normalizedBaseSkus);
  const locationsByName = await fetchLocationsByName();
  const scan = buildProductMigrationScan(products);
  const candidatesBySku = new Map(scan.candidates.map((candidate) => [candidate.baseSku.toUpperCase(), candidate]));
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
        error: "No complete LUZ/VIS/MIN product set was found for this SKU."
      });
      continue;
    }

    results.push(await migrateProductCandidate(candidate, locationsByName));
  }

  return results;
}

export function buildProductMigrationScan(products: MigrationProductNode[]): Omit<ProductMigrationScanResult, "scannedAt"> {
  const sourceProducts: MigrationSourceProduct[] = [];
  const existingUnifiedProductsBySku = new Map<string, string>();

  for (const product of products) {
    const regional = migrationSourceProduct(product);
    if (regional) sourceProducts.push(regional);

    const unifiedSku = product.variants.nodes.find((variant) => {
      const sku = variant.sku?.trim();
      return sku && !regionalSkuIdentity(sku) && sku.length > 0;
    })?.sku?.trim().toUpperCase();
    if (unifiedSku) existingUnifiedProductsBySku.set(unifiedSku, product.id);
  }

  const grouped = new Map<string, Partial<Record<RegionalPrefix, MigrationSourceProduct[]>>>();
  for (const product of sourceProducts) {
    const group = grouped.get(product.identity.baseSku) ?? {};
    group[product.identity.prefix] = [...(group[product.identity.prefix] ?? []), product];
    grouped.set(product.identity.baseSku, group);
  }

  const candidates: ProductMigrationCandidate[] = [];
  const issues: ProductMigrationIssue[] = [];

  for (const [baseSku, group] of grouped.entries()) {
    const missingPrefixes = regionalPrefixes.filter((prefix) => !group[prefix]?.length);
    const duplicatePrefixes = regionalPrefixes.filter((prefix) => (group[prefix]?.length ?? 0) > 1);
    const regionalProducts = regionalPrefixes.flatMap((prefix) => (group[prefix] ?? []).map((product) => regionalProductSummary(product)));

    if (missingPrefixes.length || duplicatePrefixes.length) {
      issues.push({
        baseSku,
        reason: [
          missingPrefixes.length ? `Missing ${missingPrefixes.join(", ")} product(s)` : "",
          duplicatePrefixes.length ? `Duplicate ${duplicatePrefixes.join(", ")} product(s)` : ""
        ].filter(Boolean).join("; "),
        products: regionalProducts
      });
      continue;
    }

    const productsInOrder = regionalPrefixes.map((prefix) => group[prefix]?.[0]).filter((product): product is MigrationSourceProduct => Boolean(product));
    const candidate = candidateFromSourceProducts(baseSku, productsInOrder, existingUnifiedProductsBySku.get(baseSku) ?? null);
    candidates.push(candidate);
  }

  return {
    candidates: candidates.sort((first, second) => first.baseSku.localeCompare(second.baseSku)),
    issues: issues.sort((first, second) => first.baseSku.localeCompare(second.baseSku))
  };
}

export function extractMigrationMetafields(baseSku: string, descriptionHtml: string, tags: string[]): ProductMigrationMetafields {
  const productDescription = plainTextFromHtml(descriptionHtml);
  const searchableText = [productDescription, tags.join(" ")].join(" ");

  return {
    itemCode: baseSku,
    tileSize: extractTileSize(tags, searchableText),
    surfaceFinish: extractSurfaceFinish(tags, searchableText),
    materialType: extractMaterialType(productDescription),
    printTechnology: extractPrintTechnology(productDescription),
    waterAbsorption: extractWaterAbsorption(productDescription),
    thicknessMm: extractThicknessMm(productDescription),
    rectified: /\brectified\b/i.test(productDescription),
    trafficRating: extractTrafficRating(productDescription),
    applicationArea: extractApplicationArea(tags),
    regionAvailability: regionalPrefixes.map((prefix) => regionAvailabilityByPrefix[prefix]),
    productDescription
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
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function migrateProductCandidate(candidate: ProductMigrationCandidate, locationsByName: Map<string, { id: string; name: string }>): Promise<ProductMigrationRunResult> {
  const inventorySet = candidate.regionalProducts.map((product) => ({ locationName: product.locationName, quantity: product.quantity }));
  const originalProductGids = candidate.regionalProducts.map((product) => product.sourceProductId);

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
      error: `Unified product already exists: ${candidate.existingUnifiedProductId}`
    };
  }

  const missingLocations = candidate.regionalProducts
    .map((product) => product.locationName)
    .filter((locationName) => !locationsByName.has(normalizeLocationName(locationName)));
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
      error: `Missing Shopify location(s): ${Array.from(new Set(missingLocations)).join(", ")}`
    };
  }

  let createdProductId: string | null = null;

  try {
    const metafields = metafieldInputs(candidate.metafields);
    const created = await createDraftProduct(candidate, metafields);
    createdProductId = created.id;
    const variant = created.variants.nodes[0];
    if (!variant) throw new Error("Shopify created the product without a default variant.");

    const inventoryItemId = await updateDefaultVariant(created.id, variant.id, candidate);
    await activateInventoryLocations(inventoryItemId, candidate, locationsByName);
    await adjustInventoryFromZero(inventoryItemId, candidate, locationsByName);

    const verified = await verifyMigratedProduct(created.id, candidate, locationsByName, metafields.length);

    return {
      baseSku: candidate.baseSku,
      status: "success",
      newProductGid: created.id,
      inventorySet,
      missingFields: candidate.missingFields,
      imagesAttached: verified.mediaCount,
      metafieldsPopulated: verified.metafieldCount,
      originalProductGids
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
      error: error instanceof Error ? error.message : String(error)
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

  return indexProducts.map((product) => detailsById.get(product.id) ?? productIndexToMinimalProduct(product));
}

async function fetchMigrationProductIndex() {
  const products: MigrationProductIndexNode[] = [];
  let cursor: string | null = null;

  do {
    const data: MigrationProductIndexResponse = await shopifyGraphql<MigrationProductIndexResponse>(MIGRATION_PRODUCT_INDEX_QUERY, { cursor });
    products.push(...data.products.nodes);
    cursor = data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : null;
  } while (cursor);

  return products;
}

async function fetchMigrationProductDetails(productId: string) {
  const data = await shopifyGraphql<MigrationProductSourceDetailsResponse>(MIGRATION_SOURCE_PRODUCT_QUERY, { id: productId });
  return data.product;
}

function detailProductIdsForMigration(products: MigrationProductIndexNode[], baseSkus?: string[]) {
  if (!baseSkus || baseSkus.length === 0) return [];

  const requestedBaseSkuSet = new Set(baseSkus.map((baseSku) => baseSku.trim().toUpperCase()));
  const groups = new Map<string, Partial<Record<RegionalPrefix, MigrationProductIndexNode[]>>>();

  for (const product of products) {
    const source = migrationSourceIndexProduct(product);
    if (!source) continue;
    if (!requestedBaseSkuSet.has(source.identity.baseSku)) continue;

    const group = groups.get(source.identity.baseSku) ?? {};
    group[source.identity.prefix] = [...(group[source.identity.prefix] ?? []), product];
    groups.set(source.identity.baseSku, group);
  }

  const ids = new Set<string>();
  for (const group of groups.values()) {
    const complete = regionalPrefixes.every((prefix) => (group[prefix]?.length ?? 0) === 1);
    if (!complete) continue;

    for (const prefix of regionalPrefixes) {
      const product = group[prefix]?.[0];
      if (product) ids.add(product.id);
    }
  }

  return Array.from(ids);
}

function productIndexToMinimalProduct(product: MigrationProductIndexNode): MigrationProductNode {
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
          inventoryLevels: { nodes: [] }
        }
      }))
    },
    media: { nodes: [] },
    images: { nodes: [] }
  };
}

async function fetchLocationsByName() {
  const locations = new Map<string, { id: string; name: string }>();
  let cursor: string | null = null;

  do {
    const data: MigrationLocationsResponse = await shopifyGraphql<MigrationLocationsResponse>(LOCATIONS_QUERY, { cursor });
    for (const location of data.locations.nodes) {
      locations.set(normalizeLocationName(location.name), location);
    }
    cursor = data.locations.pageInfo.hasNextPage ? data.locations.pageInfo.endCursor : null;
  } while (cursor);

  return locations;
}

function migrationSourceProduct(product: MigrationProductNode): MigrationSourceProduct | null {
  for (const variant of product.variants.nodes) {
    const identity = regionalSkuIdentity(variant.sku);
    if (identity) return { ...product, identity, variant };
  }

  const titleIdentity = regionalSkuIdentity(product.title) ?? regionalSkuIdentity(product.handle);
  const variant = product.variants.nodes[0];
  if (titleIdentity && variant) return { ...product, identity: titleIdentity, variant };

  return null;
}

function migrationSourceIndexProduct(product: MigrationProductIndexNode): { product: MigrationProductIndexNode; identity: RegionalProductIdentity } | null {
  for (const variant of product.variants.nodes) {
    const identity = regionalSkuIdentity(variant.sku);
    if (identity) return { product, identity };
  }

  const titleIdentity = regionalSkuIdentity(product.title) ?? regionalSkuIdentity(product.handle);
  if (titleIdentity) return { product, identity: titleIdentity };

  return null;
}

function regionalSkuIdentity(value: string | null | undefined): RegionalProductIdentity | null {
  const normalized = value?.trim();
  if (!normalized) return null;

  const match = normalized.match(/^(LUZ|VIS|MIN)[\s\-_]+(.+)$/i);
  if (!match) return null;

  return {
    prefix: match[1].toUpperCase() as RegionalPrefix,
    baseSku: match[2].trim().toUpperCase(),
    sku: `${match[1].toUpperCase()}-${match[2].trim().toUpperCase()}`
  };
}

function candidateFromSourceProducts(baseSku: string, products: MigrationSourceProduct[], existingUnifiedProductId: string | null): ProductMigrationCandidate {
  const canonicalProduct = products[0];
  const descriptionHtml = canonicalProduct.descriptionHtml ?? "";
  const tags = canonicalProduct.tags ?? [];
  const productType = canonicalProduct.productType ?? "";
  const price = canonicalProduct.variant.price;
  const metafields = extractMigrationMetafields(baseSku, descriptionHtml, tags);
  const missingFields = missingMetafieldNames(metafields);
  const manualReviewFields = collectManualReviewFields(products, missingFields, existingUnifiedProductId);

  return {
    baseSku,
    title: baseSku,
    descriptionHtml,
    price,
    tags,
    productType,
    imageUrls: candidateImageUrls(products),
    regionalProducts: products.map((product) => regionalProductSummary(product)),
    metafields,
    missingFields,
    manualReviewFields,
    existingUnifiedProductId
  };
}

function candidateImageUrls(products: MigrationSourceProduct[]) {
  const canonicalImageUrls = products[0] ? uniqueImageUrls([products[0]]) : [];
  if (canonicalImageUrls.length > 0) return canonicalImageUrls;
  return uniqueImageUrls(products);
}

function regionalProductSummary(product: MigrationSourceProduct): ProductMigrationRegionalProduct {
  const locationName = migrationLocationByPrefix[product.identity.prefix];
  return {
    prefix: product.identity.prefix,
    sourceProductId: product.id,
    sourceTitle: product.title,
    sku: product.identity.sku,
    locationName,
    quantity: availableQuantity(product.variant, locationName)
  };
}

function availableQuantity(variant: MigrationProductVariantNode, locationName: ProductMigrationLocationName) {
  const matchingLevel = variant.inventoryItem.inventoryLevels?.nodes.find((level) => normalizeLocationName(level.location.name) === normalizeLocationName(locationName));
  const matchingQuantity = matchingLevel?.quantities.find((quantity) => quantity.name === "available")?.quantity;
  return matchingQuantity ?? variant.inventoryQuantity ?? 0;
}

function uniqueImageUrls(products: MigrationSourceProduct[]) {
  const urls = products.flatMap((product) => {
    const fallbackImageUrls = product.images.nodes.map((image) => image.url);
    return product.media.nodes.map((media, index) => media.image?.url ?? media.preview?.image?.url ?? fallbackImageUrls[index] ?? null);
  });

  return Array.from(new Set(urls.filter((url): url is string => Boolean(url))));
}

function collectManualReviewFields(products: MigrationSourceProduct[], missingFields: string[], existingUnifiedProductId: string | null) {
  const fields = new Set(missingFields);
  if (existingUnifiedProductId) fields.add("existing_unified_product");
  if (new Set(products.map((product) => product.variant.price)).size > 1) fields.add("price_mismatch");
  if (new Set(products.map((product) => product.productType)).size > 1) fields.add("product_type_mismatch");
  if (new Set(products.map((product) => normalizeTagSet(product.tags))).size > 1) fields.add("tag_mismatch");
  if (new Set(products.map((product) => plainTextFromHtml(product.descriptionHtml))).size > 1) fields.add("description_mismatch");
  if (products.every((product) => uniqueImageUrls([product]).length === 0)) fields.add("images");
  return Array.from(fields);
}

function normalizeTagSet(tags: string[]) {
  return [...tags].map((tag) => tag.trim().toLowerCase()).sort().join("|");
}

function missingMetafieldNames(metafields: ProductMigrationMetafields) {
  const missing: string[] = [];
  if (!metafields.tileSize) missing.push(METAFIELD_KEYS.tileSize);
  if (!metafields.surfaceFinish) missing.push(METAFIELD_KEYS.surfaceFinish);
  if (!metafields.materialType) missing.push(METAFIELD_KEYS.materialType);
  if (!metafields.printTechnology) missing.push(METAFIELD_KEYS.printTechnology);
  if (!metafields.waterAbsorption) missing.push(METAFIELD_KEYS.waterAbsorption);
  if (metafields.thicknessMm === null) missing.push(METAFIELD_KEYS.thicknessMm);
  if (!metafields.trafficRating) missing.push(METAFIELD_KEYS.trafficRating);
  if (!metafields.applicationArea) missing.push(METAFIELD_KEYS.applicationArea);
  if (!metafields.productDescription) missing.push(METAFIELD_KEYS.productDescription);
  return missing;
}

export function metafieldInputs(metafields: ProductMigrationMetafields) {
  const inputs = [
    metafieldInput("item_code", "single_line_text_field", metafields.itemCode),
    metafields.tileSize ? metafieldInput("tile_size", "single_line_text_field", metafields.tileSize) : null,
    metafields.surfaceFinish ? metafieldInput("surface_finish", "list.single_line_text_field", listMetafieldValue([metafields.surfaceFinish])) : null,
    metafields.materialType ? metafieldInput("material_type", "list.single_line_text_field", listMetafieldValue([metafields.materialType])) : null,
    metafields.printTechnology ? metafieldInput("print_technology", "list.single_line_text_field", listMetafieldValue([metafields.printTechnology])) : null,
    metafields.waterAbsorption ? metafieldInput("water_absorption", "single_line_text_field", metafields.waterAbsorption) : null,
    metafields.thicknessMm !== null ? metafieldInput("thickness_mm", "number_decimal", String(metafields.thicknessMm)) : null,
    metafieldInput("rectified", "boolean", String(metafields.rectified)),
    metafields.trafficRating ? metafieldInput("traffic_rating", "list.single_line_text_field", listMetafieldValue([metafields.trafficRating])) : null,
    metafields.applicationArea ? metafieldInput("application_area", "list.single_line_text_field", listMetafieldValue(metafields.applicationArea.split(";").map((area) => area.trim()).filter(Boolean))) : null,
    metafieldInput("region_availability", "list.single_line_text_field", listMetafieldValue(metafields.regionAvailability)),
    metafields.productDescription ? metafieldInput("product_description", "multi_line_text_field", metafields.productDescription) : null
  ];

  return inputs.filter((input): input is NonNullable<typeof input> => Boolean(input));
}

function listMetafieldValue(values: string[]) {
  return JSON.stringify(Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))));
}

function metafieldInput(key: string, type: string, value: string) {
  return {
    namespace: "custom",
    key,
    type,
    value
  };
}

async function createDraftProduct(candidate: ProductMigrationCandidate, metafields: ReturnType<typeof metafieldInputs>) {
  const data = await shopifyGraphql<ProductCreateResponse>(PRODUCT_CREATE_MUTATION, {
    product: {
      title: candidate.title,
      status: "DRAFT",
      descriptionHtml: candidate.descriptionHtml,
      productType: candidate.productType,
      tags: candidate.tags,
      metafields
    },
    media: candidate.imageUrls.map((url) => ({
      mediaContentType: "IMAGE",
      originalSource: url,
      alt: candidate.title
    }))
  });

  throwIfUserErrors(data.productCreate.userErrors);
  const product = data.productCreate.product;
  if (!product) throw new Error("Shopify did not return the created product.");
  return product;
}

async function updateDefaultVariant(productId: string, variantId: string, candidate: ProductMigrationCandidate) {
  const data = await shopifyGraphql<{
    productVariantsBulkUpdate: {
      productVariants: { id: string; inventoryItem: { id: string; sku: string | null; tracked: boolean; requiresShipping: boolean } }[];
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
          requiresShipping: true
        },
        inventoryPolicy: "DENY"
      }
    ]
  });

  throwIfUserErrors(data.productVariantsBulkUpdate.userErrors);
  const updatedVariant = data.productVariantsBulkUpdate.productVariants[0];
  if (!updatedVariant?.inventoryItem.id) throw new Error("Shopify did not return the unified variant inventory item.");
  return updatedVariant.inventoryItem.id;
}

async function activateInventoryLocations(inventoryItemId: string, candidate: ProductMigrationCandidate, locationsByName: Map<string, { id: string; name: string }>) {
  const inventoryItemUpdates = candidate.regionalProducts.map((product) => ({
    locationId: locationsByName.get(normalizeLocationName(product.locationName))?.id,
    activate: true
  })).filter((input): input is { locationId: string; activate: boolean } => Boolean(input.locationId));

  const data = await shopifyGraphql<{
    inventoryBulkToggleActivation: { userErrors: ShopifyUserError[] };
  }>(INVENTORY_BULK_TOGGLE_MUTATION, {
    inventoryItemId,
    inventoryItemUpdates
  });

  throwIfUserErrors(data.inventoryBulkToggleActivation.userErrors.filter((error) => !isIgnorableInventoryActivationError(error)));
}

async function adjustInventoryFromZero(inventoryItemId: string, candidate: ProductMigrationCandidate, locationsByName: Map<string, { id: string; name: string }>) {
  const changes = candidate.regionalProducts
    .filter((product) => product.quantity !== 0)
    .map((product) => ({
      inventoryItemId,
      locationId: locationsByName.get(normalizeLocationName(product.locationName))?.id,
      delta: product.quantity
    }))
    .filter((input): input is { inventoryItemId: string; locationId: string; delta: number } => Boolean(input.locationId));

  if (changes.length === 0) return;

  const data = await shopifyGraphql<{
    inventoryAdjustQuantities: { userErrors: ShopifyUserError[] };
  }>(INVENTORY_ADJUST_MUTATION, {
    input: {
      name: "available",
      reason: "correction",
      referenceDocumentUri: `product-migration://${candidate.baseSku}`,
      changes
    },
    idempotencyKey: crypto.randomUUID()
  });

  throwIfUserErrors(data.inventoryAdjustQuantities.userErrors);
}

async function verifyMigratedProduct(productId: string, candidate: ProductMigrationCandidate, locationsByName: Map<string, { id: string; name: string }>, expectedMetafieldCount: number) {
  const data = await shopifyGraphql<MigrationProductDetailsResponse>(PRODUCT_DETAILS_QUERY, { id: productId });
  const product = data.product;
  if (!product) throw new Error("Could not verify the created product.");
  if (product.title !== candidate.title) throw new Error(`Verification failed: title is ${product.title}, expected ${candidate.title}.`);
  if (product.status !== "DRAFT") throw new Error(`Verification failed: status is ${product.status}, expected DRAFT.`);

  const variant = product.variants.nodes[0];
  if (!variant) throw new Error("Verification failed: created product has no variant.");
  if ((variant.sku ?? variant.inventoryItem.sku) !== candidate.baseSku) throw new Error("Verification failed: unified SKU was not set.");
  if (!variant.inventoryItem.tracked) throw new Error("Verification failed: inventory tracking is disabled.");
  if (!variant.inventoryItem.requiresShipping) throw new Error("Verification failed: requires shipping is disabled.");

  for (const regionalProduct of candidate.regionalProducts) {
    const expectedLocation = locationsByName.get(normalizeLocationName(regionalProduct.locationName));
    const level = variant.inventoryItem.inventoryLevels.nodes.find((node) => node.location.id === expectedLocation?.id);
    const available = level?.quantities.find((quantity) => quantity.name === "available")?.quantity;
    if (available !== regionalProduct.quantity) {
      throw new Error(`Verification failed: ${regionalProduct.locationName} inventory is ${available ?? "missing"}, expected ${regionalProduct.quantity}.`);
    }
  }

  const metafieldCount = product.metafields.nodes.filter((metafield) => metafield.namespace === "custom").length;
  if (metafieldCount < expectedMetafieldCount) throw new Error(`Verification failed: ${metafieldCount} metafield(s) found, expected ${expectedMetafieldCount}.`);
  if (product.mediaCount.count < candidate.imageUrls.length) throw new Error(`Verification failed: ${product.mediaCount.count} image(s) attached, expected ${candidate.imageUrls.length}.`);

  return {
    mediaCount: product.mediaCount.count,
    metafieldCount
  };
}

function throwIfUserErrors(errors: ShopifyUserError[]) {
  if (!errors.length) return;
  throw new Error(errors.map((error) => {
    const field = error.field?.length ? `${error.field.join(".")}: ` : "";
    const code = error.code ? ` (${error.code})` : "";
    return `${field}${error.message}${code}`;
  }).join("; "));
}

export function isIgnorableInventoryActivationError(error: ShopifyUserError) {
  const code = error.code?.trim().toUpperCase();
  if (code && /ALREADY|ACTIVE|STOCK/.test(code)) return true;

  return /\balready\b.*\b(active|activated|stocked)\b/i.test(error.message)
    || /\b(active|activated|stocked)\b.*\balready\b/i.test(error.message);
}

function extractTileSize(tags: string[], text: string) {
  const source = [...tags, text].join(" ");
  const match = source.match(/\b(\d{2,3})\s*x\s*(\d{2,3})\s*(cm|mm)?\b/i);
  if (!match) return null;
  const unit = match[3] ? ` ${match[3].toLowerCase()}` : "";
  return `${match[1]}x${match[2]}${unit}`;
}

function extractSurfaceFinish(tags: string[], text: string) {
  const finishes = [
    "Polished",
    "Matte",
    "Matt",
    "Glossy",
    "High Gloss",
    "Glazed",
    "Unglazed",
    "Textured",
    "Structured",
    "Rustic",
    "Satin",
    "Lappato",
    "Honed"
  ];
  return extractKnownValue(tags, finishes) ?? extractKnownValue([text], finishes);
}

function extractMaterialType(text: string) {
  return extractKnownValue([text], ["Porcelain", "Ceramic", "Homogeneous", "Vinyl", "Granite", "Marble", "Stoneware", "Terracotta"]);
}

function extractPrintTechnology(text: string) {
  const match = text.match(/\b(?:HD\s*)?(?:Inkjet|Digital)\s+Print(?:ing)?\b/i);
  return match ? titleCase(match[0].replace(/\s+/g, " ")) : null;
}

function extractWaterAbsorption(text: string) {
  const explicit = text.match(/water\s*absorption[^A-Za-z0-9<>≤=]*(E?\s*[<≤=]\s*\d+(?:\.\d+)?\s*%)/i);
  if (explicit) return normalizeWaterAbsorption(explicit[1]);

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

function extractTrafficRating(text: string) {
  const explicit = text.match(/traffic\s*(?:rating|grade)?[^A-Za-z]*(light|moderate|medium|heavy|commercial|residential)/i);
  if (explicit) return titleCase(explicit[1]);
  return extractKnownValue([text], ["Light", "Moderate", "Medium", "Heavy", "Commercial", "Residential"]);
}

function extractApplicationArea(tags: string[]) {
  const areas = ["Floor", "Wall", "Indoor", "Outdoor", "Bathroom", "Kitchen", "Commercial", "Residential"];
  const found = areas.filter((area) => tags.some((tag) => new RegExp(`\\b${escapeRegExp(area)}\\b`, "i").test(tag)));
  return found.length ? found.join("; ") : null;
}

function extractKnownValue(sources: string[], values: string[]) {
  for (const source of sources) {
    for (const value of values) {
      if (new RegExp(`\\b${escapeRegExp(value)}\\b`, "i").test(source)) return value === "Matt" ? "Matte" : value;
    }
  }

  return null;
}

function titleCase(value: string) {
  return value.toLowerCase().replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function normalizeLocationName(value: string) {
  return value.trim().toLowerCase();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
