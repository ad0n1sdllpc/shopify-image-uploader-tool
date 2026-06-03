import type { ShopifyProduct } from "@/types";

const productPrefixOrder = ["LUZ", "VIS", "MIN"];

function productPrefix(product: ShopifyProduct) {
  const values = [product.title, product.handle, ...product.variantsSkus].filter(Boolean);
  for (const value of values) {
    const prefix = value.split(/[\s\-_]+/)[0]?.toUpperCase();
    if (productPrefixOrder.includes(prefix)) return prefix;
  }

  return "";
}

export function sortProductsByVariantPrefix(products: ShopifyProduct[]) {
  return [...products].sort((first, second) => {
    const firstIndex = productPrefixOrder.indexOf(productPrefix(first));
    const secondIndex = productPrefixOrder.indexOf(productPrefix(second));
    const normalizedFirstIndex = firstIndex === -1 ? productPrefixOrder.length : firstIndex;
    const normalizedSecondIndex = secondIndex === -1 ? productPrefixOrder.length : secondIndex;
    return normalizedFirstIndex - normalizedSecondIndex || first.title.localeCompare(second.title);
  });
}
