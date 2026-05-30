import type { ProductMatch, ShopifyProduct, TileFolder } from "@/types";

export function normalizeName(value: string) {
  return value
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[\s\-_]/g, "");
}

function exactMatches(folderName: string, products: ShopifyProduct[], selector: (product: ShopifyProduct) => string[]) {
  return products.filter((product) => selector(product).some((value) => normalizeName(value) === folderName));
}

function toMatch(folder: TileFolder, candidates: ShopifyProduct[], reason: string, partial = false): ProductMatch {
  if (candidates.length === 0) {
    return { folder, confidence: "No Match", product: null, candidates: [], reason: "No Shopify product matched this folder." };
  }

  if (candidates.length > 1) {
    return { folder, confidence: "Multiple Matches", product: null, candidates, reason };
  }

  return {
    folder,
    confidence: partial ? "Partial" : "Exact",
    product: candidates[0],
    candidates,
    reason
  };
}

export function matchTileFolder(folder: TileFolder, products: ShopifyProduct[]): ProductMatch {
  const folderName = normalizeName(folder.tileName);
  const skuMatches = exactMatches(folderName, products, (product) => product.variantsSkus);
  if (skuMatches.length > 0) return toMatch(folder, skuMatches, "Matched exact variant SKU.");

  const handleMatches = exactMatches(folderName, products, (product) => [product.handle]);
  if (handleMatches.length > 0) return toMatch(folder, handleMatches, "Matched exact product handle.");

  const titleMatches = exactMatches(folderName, products, (product) => [product.title]);
  if (titleMatches.length > 0) return toMatch(folder, titleMatches, "Matched exact product title.");

  const partialMatches = products.filter((product) => {
    const title = normalizeName(product.title);
    return title.includes(folderName) || folderName.includes(title);
  });

  return toMatch(folder, partialMatches, "Matched partial product title.", true);
}

export function matchTileFolders(folders: TileFolder[], products: ShopifyProduct[]) {
  return folders.map((folder) => matchTileFolder(folder, products));
}
