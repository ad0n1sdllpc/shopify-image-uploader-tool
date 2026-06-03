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
