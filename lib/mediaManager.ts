import type { ProductMatch, ShopifyProduct, ShopifyProductMedia } from "@/types";

export type MediaManagerFilters = {
  query: string;
  multiMediaOnly: boolean;
  selectedOnly: boolean;
};

export function productMediaItems(product: ShopifyProduct): ShopifyProductMedia[] {
  if (product.media?.length) return product.media;

  return product.mediaIds.map((id, index) => ({
    id,
    url: product.mediaImageUrls[index] ?? (index === 0 ? product.firstImageUrl : null),
    position: index
  }));
}

export function nonFirstMediaIds(products: ShopifyProduct[]) {
  return products.flatMap((product) => productMediaItems(product).slice(1).map((media) => media.id));
}

const variantPrefixes = ["LUZ", "VIS", "MIN"];

function variantPrefix(product: ShopifyProduct) {
  const values = [product.title, product.handle, ...product.variantsSkus].filter(Boolean);
  for (const value of values) {
    const prefix = value.split(/[\s\-_]+/)[0]?.toUpperCase();
    if (variantPrefixes.includes(prefix)) return prefix;
  }

  return "";
}

function productCode(product: ShopifyProduct) {
  const values = [product.title, product.handle, ...product.variantsSkus].filter(Boolean);
  for (const value of values) {
    const parts = value.split(/[\s\-_]+/).filter(Boolean);
    const prefix = parts[0]?.toUpperCase();
    if (variantPrefixes.includes(prefix) && parts.length > 1) return parts.slice(1).join("-").toUpperCase();
  }

  return product.title.toUpperCase();
}

export type MediaProductGroup = {
  id: string;
  code: string;
  products: ShopifyProduct[];
  variantLabels: string[];
  media: ShopifyProductMedia[];
};

export function groupMediaProducts(products: ShopifyProduct[]): MediaProductGroup[] {
  const groupsByCode = new Map<string, ShopifyProduct[]>();
  for (const product of products) {
    const code = productCode(product);
    groupsByCode.set(code, [...(groupsByCode.get(code) ?? []), product]);
  }

  return Array.from(groupsByCode.entries()).map(([code, groupProducts]) => {
    const productsByPrefix = [...groupProducts].sort((first, second) => {
      const firstIndex = variantPrefixes.indexOf(variantPrefix(first));
      const secondIndex = variantPrefixes.indexOf(variantPrefix(second));
      const normalizedFirstIndex = firstIndex === -1 ? variantPrefixes.length : firstIndex;
      const normalizedSecondIndex = secondIndex === -1 ? variantPrefixes.length : secondIndex;
      return normalizedFirstIndex - normalizedSecondIndex || first.title.localeCompare(second.title);
    });
    const representativeProduct = productsByPrefix[0];

    return {
      id: code,
      code,
      products: productsByPrefix,
      variantLabels: productsByPrefix.map((product) => variantPrefix(product) || product.title),
      media: productMediaItems(representativeProduct)
    };
  }).sort((first, second) => first.code.localeCompare(second.code));
}

export function nonFirstGroupedMediaIds(groups: MediaProductGroup[]) {
  return groups.flatMap((group) =>
    group.products.flatMap((product) => productMediaItems(product).slice(1).map((media) => media.id))
  );
}

export function matchedMediaProducts(matches: ProductMatch[]) {
  const seenProductIds = new Set<string>();
  const products: ShopifyProduct[] = [];

  for (const match of matches) {
    for (const product of match.selectedProducts) {
      if (seenProductIds.has(product.id)) continue;
      seenProductIds.add(product.id);
      products.push(product);
    }
  }

  return products;
}

export function selectedMediaSummary(products: ShopifyProduct[], selectedMediaIds: string[]) {
  const selectedSet = new Set(selectedMediaIds);
  const selectedProducts = products.filter((product) => productMediaItems(product).some((media) => selectedSet.has(media.id)));
  const selectedMediaCount = products.reduce(
    (total, product) => total + productMediaItems(product).filter((media, index) => index > 0 && selectedSet.has(media.id)).length,
    0
  );

  return {
    selectedProductCount: selectedProducts.length,
    selectedMediaCount
  };
}

export function filterMediaProducts(products: ShopifyProduct[], filters: MediaManagerFilters, selectedMediaIds: string[]) {
  const query = filters.query.trim().toLowerCase();
  const selectedSet = new Set(selectedMediaIds);

  return products.filter((product) => {
    const media = productMediaItems(product);
    if (filters.multiMediaOnly && media.length < 2) return false;
    if (filters.selectedOnly && !media.some((item) => selectedSet.has(item.id))) return false;
    if (!query) return true;

    const searchable = [
      product.title,
      product.handle,
      ...product.variantsSkus
    ].join(" ").toLowerCase();
    return searchable.includes(query);
  });
}

export function filterMediaGroups(groups: MediaProductGroup[], filters: MediaManagerFilters, selectedMediaIds: string[]) {
  const query = filters.query.trim().toLowerCase();
  const selectedSet = new Set(selectedMediaIds);

  return groups.filter((group) => {
    if (filters.multiMediaOnly && group.media.length < 2) return false;
    if (filters.selectedOnly && !group.products.some((product) => productMediaItems(product).some((media) => selectedSet.has(media.id)))) return false;
    if (!query) return true;

    const searchable = [
      group.code,
      ...group.variantLabels,
      ...group.products.flatMap((product) => [product.title, product.handle, ...product.variantsSkus])
    ].join(" ").toLowerCase();
    return searchable.includes(query);
  });
}

export function toggleGroupedMediaSelection(group: MediaProductGroup, mediaIndex: number, selected: boolean, selectedMediaIds: string[]) {
  const idsAtIndex = group.products
    .map((product) => productMediaItems(product)[mediaIndex]?.id)
    .filter((mediaId): mediaId is string => Boolean(mediaId));
  const idsAtIndexSet = new Set(idsAtIndex);

  if (selected) return Array.from(new Set([...selectedMediaIds, ...idsAtIndex]));
  return selectedMediaIds.filter((mediaId) => !idsAtIndexSet.has(mediaId));
}

export function groupedMediaSelected(group: MediaProductGroup, mediaIndex: number, selectedMediaIds: string[]) {
  const selectedSet = new Set(selectedMediaIds);
  const idsAtIndex = group.products
    .map((product) => productMediaItems(product)[mediaIndex]?.id)
    .filter((mediaId): mediaId is string => Boolean(mediaId));

  return idsAtIndex.length > 0 && idsAtIndex.every((mediaId) => selectedSet.has(mediaId));
}

export function mediaDeleteItems(products: ShopifyProduct[], selectedMediaIds: string[]) {
  const selectedSet = new Set(selectedMediaIds);

  return products.flatMap((product) => {
    const mediaIds = productMediaItems(product)
      .slice(1)
      .map((media) => media.id)
      .filter((mediaId) => selectedSet.has(mediaId));

    return mediaIds.length ? [{ productId: product.id, mediaIds }] : [];
  });
}
