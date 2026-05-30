import "server-only";
import type { ShopifyProduct } from "@/types";

const DEFAULT_API_VERSION = "2026-01";

export function getShopifyConfig() {
  return {
    storeDomain: process.env.SHOPIFY_STORE_DOMAIN,
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

type GraphQLError = { message: string };

export async function shopifyGraphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const config = getShopifyConfig();
  if (!config.storeDomain || !config.accessToken) {
    throw new Error("Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_ADMIN_ACCESS_TOKEN.");
  }

  const response = await fetch(`https://${config.storeDomain}/admin/api/${config.apiVersion}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": config.accessToken
    },
    body: JSON.stringify({ query, variables }),
    cache: "no-store"
  });

  const payload = (await response.json()) as { data?: T; errors?: GraphQLError[] };
  if (!response.ok || payload.errors?.length) {
    throw new Error(payload.errors?.map((error) => error.message).join("; ") || `Shopify request failed: ${response.status}`);
  }

  if (!payload.data) throw new Error("Shopify returned no data.");
  return payload.data;
}

type ProductNode = {
  id: string;
  title: string;
  handle: string;
  variants: { nodes: { sku: string | null }[] };
  media: {
    nodes: { id: string; image?: { url: string | null } | null }[];
    pageInfo: { hasNextPage: boolean };
  };
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
        media(first: 100, sortKey: POSITION) {
          nodes {
            id
            ... on MediaImage { image { url } }
          }
          pageInfo { hasNextPage }
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
      products.push({
        id: product.id,
        title: product.title,
        handle: product.handle,
        variantsSkus: product.variants.nodes.map((variant) => variant.sku).filter(Boolean) as string[],
        mediaIds: product.media.nodes.map((media) => media.id),
        firstImageUrl: product.media.nodes[0]?.image?.url ?? null,
        totalMediaCount: product.mediaCount.count
      });
    }

    cursor = data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : null;
  } while (cursor);

  return products;
}

export async function fetchProductMediaIds(productId: string) {
  const data = await shopifyGraphql<{
    product: { media: { nodes: { id: string }[] } } | null;
  }>(
    `query ProductMedia($id: ID!) {
      product(id: $id) { media(first: 250, sortKey: POSITION) { nodes { id } } }
    }`,
    { id: productId }
  );

  return data.product?.media.nodes.map((media) => media.id) ?? [];
}
