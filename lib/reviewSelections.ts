import type { ProductMatch, UploadMode, UploadSelection } from "@/types";
import { sortProductsByVariantPrefix } from "@/lib/productOrdering";

export function defaultSelection(match: ProductMatch): UploadSelection {
  return {
    folder: match.folder,
    products: sortProductsByVariantPrefix(match.selectedProducts),
    selectedFirstImagePath: match.folder.images[0]?.absolutePath ?? "",
    orderedImagePaths: match.folder.images.map((image) => image.absolutePath),
    mode: "append-folder" as UploadMode,
    deleteOldMedia: true
  };
}

export function activeSelections(matches: ProductMatch[], selections: UploadSelection[]) {
  const selectionsByFolderId = new Map(selections.map((selection) => [selection.folder.id, selection]));

  return matches.flatMap((match) => {
    if (match.selectedProducts.length === 0) return [];

    const savedSelection = selectionsByFolderId.get(match.folder.id);
    return [savedSelection ? {
      ...savedSelection,
      folder: match.folder,
      products: sortProductsByVariantPrefix(match.selectedProducts)
    } : defaultSelection(match)];
  });
}

export function includedSelections(selections: UploadSelection[], excludedProductIds: string[]) {
  const excludedProductIdSet = new Set(excludedProductIds);

  return selections.flatMap((selection) => {
    const products = selection.products.filter((product) => !excludedProductIdSet.has(product.id));
    return products.length ? [{ ...selection, products }] : [];
  });
}

export function matchedProductIds(matches: ProductMatch[]) {
  return matches.flatMap((match) => match.selectedProducts.map((product) => product.id));
}

export function keepCurrentExcludedProductIds(excludedProductIds: string[], productIds: string[]) {
  const currentProductIds = new Set(productIds);
  return excludedProductIds.filter((productId) => currentProductIds.has(productId));
}
