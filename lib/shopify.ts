import "server-only";
import type { ShopifyProduct, ShopifyProductMedia } from "@/types";

const DEFAULT_API_VERSION = "2026-01";

function normalizeStoreDomain(value?: string) {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;

  try {
    return new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`).hostname;
  } catch {
    return trimmed.replace(/^https?:\/\//, "").split("/")[0];
  }
}

export function getShopifyConfig() {
  return {
    storeDomain: normalizeStoreDomain(process.env.SHOPIFY_STORE_DOMAIN),
    accessToken: process.env.SHOPIFY_ADMIN_ACCESS_TOKEN,
    apiVersion: process.env.SHOPIFY_API_VERSION || DEFAULT_API_VERSION
  };
}

export function getEnvironmentStatus() {
  const config = getShopifyConfig();
  return {
    hasStoreDomain: Boolean(config.storeDomain),
    hasAdminToken: Boolean(config.accessToken),
    apiVersion: config.apiVersion
  };
}

type GraphQLError = { message?: string };

function formatShopifyErrors(errors: unknown) {
  if (!errors) return null;

  if (Array.isArray(errors)) {
    return errors
      .map((error) => {
        if (typeof error === "string") return error;
        if (error && typeof error === "object" && "message" in error) return String((error as GraphQLError).message);
        return JSON.stringify(error);
      })
      .filter(Boolean)
      .join("; ");
  }

  if (typeof errors === "string") return errors;

  if (typeof errors === "object") {
    return Object.entries(errors)
      .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : String(value)}`)
      .join("; ");
  }

  return String(errors);
}

export async function shopifyGraphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const config = getShopifyConfig();
  if (!config.storeDomain || !config.accessToken) {
    throw new Error("Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_ADMIN_ACCESS_TOKEN.");
  }

  const url = `https://${config.storeDomain}/admin/api/${config.apiVersion}/graphql.json`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": config.accessToken
    },
    body: JSON.stringify({ query, variables }),
    cache: "no-store"
  }).catch((error) => {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not connect to Shopify at ${config.storeDomain}: ${reason}`);
  });

  const payload = (await response.json()) as { data?: T; errors?: unknown };
  const errorMessage = formatShopifyErrors(payload.errors);
  if (!response.ok || errorMessage) {
    throw new Error(errorMessage || `Shopify request failed: ${response.status}`);
  }

  if (!payload.data) throw new Error("Shopify returned no data.");
  return payload.data;
}

export type ProductNode = {
  id: string;
  title: string;
  handle: string;
  variants: { nodes: { sku: string | null }[] };
  media: {
    nodes: { id: string; image?: { url: string | null } | null; preview?: { image?: { url: string | null } | null } | null }[];
    pageInfo: { hasNextPage: boolean };
  };
  images: { nodes: { url: string | null }[] };
  mediaCount: { count: number };
};

type ProductsResponse = {
  products: { nodes: ProductNode[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
};

const PRODUCTS_QUERY = `
  query Products($cursor: String) {
    products(first: 100, after: $cursor, sortKey: TITLE) {
      nodes {
        id
        title
        handle
        variants(first: 100) { nodes { sku } }
        media(first: 250, sortKey: POSITION) {
          nodes {
            id
            preview { image { url } }
            ... on MediaImage { image { url } }
          }
          pageInfo { hasNextPage }
        }
        images(first: 250) {
          nodes { url }
        }
        mediaCount { count }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export async function fetchProducts(): Promise<ShopifyProduct[]> {
  const products: ShopifyProduct[] = [];
  let cursor: string | null = null;

  do {
    const data: ProductsResponse = await shopifyGraphql<ProductsResponse>(PRODUCTS_QUERY, { cursor });

    for (const product of data.products.nodes) {
      products.push(productNodeToShopifyProduct(product));
    }

    cursor = data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : null;
  } while (cursor);

  return products;
}

export function productNodeToShopifyProduct(product: ProductNode): ShopifyProduct {
  const media = product.media.nodes.map<ShopifyProductMedia>((node, index) => ({
    id: node.id,
    url: mediaImageUrl(node),
    position: index
  }));
  const imageUrls = media.map((item) => item.url).filter((url): url is string => Boolean(url));
  const fallbackImageUrls = product.images.nodes.map((image) => image.url).filter((url): url is string => Boolean(url));
  const mediaImageUrls = imageUrls.length ? imageUrls : uniqueUrls(fallbackImageUrls);

  return {
    id: product.id,
    title: product.title,
    handle: product.handle,
    variantsSkus: product.variants.nodes.map((variant) => variant.sku).filter(Boolean) as string[],
    media,
    mediaIds: media.map((item) => item.id),
    firstImageUrl: mediaImageUrls[0] ?? null,
    mediaImageUrls,
    totalMediaCount: product.mediaCount.count
  };
}

function mediaImageUrl(media: ProductNode["media"]["nodes"][number]) {
  return media.image?.url ?? media.preview?.image?.url ?? null;
}

function uniqueUrls(urls: (string | null | undefined)[]) {
  return Array.from(new Set(urls.filter((url): url is string => Boolean(url))));
}

export async function fetchProductMedia(productId: string) {
  const data = await shopifyGraphql<{
    product: { media: { nodes: { id: string; image?: { url: string | null } | null; preview?: { image?: { url: string | null } | null } | null }[] } } | null;
  }>(
    `query ProductMedia($id: ID!) {
      product(id: $id) {
        media(first: 250, sortKey: POSITION) {
          nodes {
            id
            preview { image { url } }
            ... on MediaImage { image { url } }
          }
        }
      }
    }`,
    { id: productId }
  );

  return data.product?.media.nodes.map<ShopifyProductMedia>((media, index) => ({
    id: media.id,
    url: mediaImageUrl(media),
    position: index
  })) ?? [];
}

export async function fetchProductMediaIds(productId: string) {
  return (await fetchProductMedia(productId)).map((media) => media.id);
}

export async function deleteProductMedia(productId: string, mediaIds: string[]) {
  if (mediaIds.length === 0) return [];

  const data = await shopifyGraphql<{
    productDeleteMedia: { deletedMediaIds: string[]; mediaUserErrors: { message: string }[] };
  }>(
    `mutation ProductDeleteMedia($productId: ID!, $mediaIds: [ID!]!) {
      productDeleteMedia(productId: $productId, mediaIds: $mediaIds) {
        deletedMediaIds
        mediaUserErrors { message }
      }
    }`,
    { productId, mediaIds }
  );

  const errors = data.productDeleteMedia.mediaUserErrors;
  if (errors.length) throw new Error(errors.map((error) => error.message).join("; "));
  return data.productDeleteMedia.deletedMediaIds;
}
