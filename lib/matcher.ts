import type { ProductMatch, ShopifyProduct, TileFolder } from "@/types";
import { sortProductsByVariantPrefix } from "@/lib/productOrdering";

export function normalizeName(value: string) {
  return value
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]/g, "");
}

function exactMatches(folderNames: string[], products: ShopifyProduct[], selector: (product: ShopifyProduct) => string[]) {
  const names = new Set(folderNames);
  return products.filter((product) => selector(product).some((value) => names.has(normalizeName(value))));
}

function normalizedSegments(value: string) {
  return value
    .replace(/\.[^.]+$/, "")
    .split(/[^a-zA-Z0-9]+/)
    .map((segment) => normalizeName(segment))
    .filter(Boolean);
}

function productValues(product: ShopifyProduct) {
  return [product.title, product.handle, ...product.variantsSkus].filter(Boolean);
}

function hasProductCodeSegment(value: string, folderNames: string[]) {
  const names = new Set(folderNames);
  return normalizedSegments(value).some((segment) => names.has(segment));
}

function productCodeAliases(value: string) {
  const normalized = normalizeName(value);
  const withoutParentheses = normalizeName(value.replace(/\([^)]*\)/g, ""));
  const aliases = new Set([normalized, withoutParentheses]);
  return [...aliases].filter(Boolean);
}

function categoryTokens(folder: TileFolder) {
  return [folder.category, folder.size, ...folder.relativePath.split(/[\\/]+/).slice(0, -1)]
    .filter((value): value is string => Boolean(value))
    .flatMap((value) => normalizedSegments(value))
    .filter((token) => token.length > 2);
}

function productMentionsCategory(product: ShopifyProduct, tokens: string[]) {
  if (tokens.length === 0) return false;
  return productValues(product).some((value) => {
    const valueTokens = normalizedSegments(value);
    return tokens.some((token) => valueTokens.includes(token));
  });
}

function preferCategoryMatches(folder: TileFolder, products: ShopifyProduct[]) {
  const tokens = categoryTokens(folder);
  const categoryMatches = products.filter((product) => productMentionsCategory(product, tokens));
  return categoryMatches.length > 0 ? categoryMatches : products;
}

function codeSegmentMatches(folder: TileFolder, folderNames: string[], products: ShopifyProduct[]) {
  const matches = products.filter((product) => {
    return productValues(product).some((value) => hasProductCodeSegment(value, folderNames));
  });
  return sortProductsByVariantPrefix(preferCategoryMatches(folder, matches));
}

function normalizedValueMatches(value: string, folderNames: string[]) {
  const normalized = normalizeName(value);
  return folderNames.some((folderName) => normalized.includes(folderName) || folderName.includes(normalized));
}

function toMatch(folder: TileFolder, candidates: ShopifyProduct[], reason: string, partial = false): ProductMatch {
  if (candidates.length === 0) {
    return { folder, confidence: "No Match", product: null, candidates: [], selectedProducts: [], reason: "No Shopify product matched this folder." };
  }

  if (candidates.length > 1) {
    return { folder, confidence: "Multiple Matches", product: null, candidates, selectedProducts: [], reason };
  }

  return {
    folder,
    confidence: partial ? "Partial" : "Exact",
    product: candidates[0],
    candidates,
    selectedProducts: candidates,
    reason
  };
}

export function matchTileFolder(folder: TileFolder, products: ShopifyProduct[]): ProductMatch {
  const folderNames = productCodeAliases(folder.productCode ?? folder.tileName);

  const skuMatches = exactMatches(folderNames, products, (product) => product.variantsSkus);
  if (skuMatches.length === 1) return toMatch(folder, skuMatches, "Matched exact variant SKU.");

  const handleMatches = exactMatches(folderNames, products, (product) => [product.handle]);
  if (handleMatches.length === 1) return toMatch(folder, handleMatches, "Matched exact product handle.");

  const titleMatches = exactMatches(folderNames, products, (product) => [product.title]);
  if (titleMatches.length === 1) return toMatch(folder, titleMatches, "Matched exact product title.");

  const variantMatches = codeSegmentMatches(folder, folderNames, products);
  if (variantMatches.length > 1) {
    return {
      folder,
      confidence: "Variant Group",
      product: variantMatches[0],
      candidates: variantMatches,
      selectedProducts: variantMatches,
      reason: "Grouped products containing this folder product code."
    };
  }

  if (variantMatches.length === 1) return toMatch(folder, variantMatches, "Matched product code in Shopify product data.", true);

  if (skuMatches.length > 0) return toMatch(folder, skuMatches, "Matched exact variant SKU.");

  if (handleMatches.length > 0) return toMatch(folder, handleMatches, "Matched exact product handle.");

  if (titleMatches.length > 0) return toMatch(folder, titleMatches, "Matched exact product title.");

  const partialMatches = products.filter((product) => {
    return productValues(product).some((value) => normalizedValueMatches(value, folderNames));
  });

  return toMatch(folder, sortProductsByVariantPrefix(preferCategoryMatches(folder, partialMatches)), "Matched partial product code in Shopify product data.", true);
}

export function matchTileFolders(folders: TileFolder[], products: ShopifyProduct[]) {
  return folders.map((folder) => matchTileFolder(folder, products));
}
