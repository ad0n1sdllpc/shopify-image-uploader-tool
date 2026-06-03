import { describe, expect, it } from "vitest";
import { productNodeToShopifyProduct, type ProductNode } from "@/lib/shopify";

describe("Shopify product mapping", () => {
  it("maps structured media while preserving legacy media fields", () => {
    const product = productNodeToShopifyProduct({
      id: "product-1",
      title: "LUZ-11AW1",
      handle: "luz-11aw1",
      variants: { nodes: [{ sku: "LUZ-11AW1" }] },
      media: {
        nodes: [
          { id: "media-1", image: { url: "https://cdn/1.jpg" }, preview: null },
          { id: "media-2", image: null, preview: { image: { url: "https://cdn/2.jpg" } } }
        ],
        pageInfo: { hasNextPage: false }
      },
      images: { nodes: [] },
      mediaCount: { count: 2 }
    } satisfies ProductNode);

    expect(product.media).toEqual([
      { id: "media-1", url: "https://cdn/1.jpg", position: 0 },
      { id: "media-2", url: "https://cdn/2.jpg", position: 1 }
    ]);
    expect(product.mediaIds).toEqual(["media-1", "media-2"]);
    expect(product.mediaImageUrls).toEqual(["https://cdn/1.jpg", "https://cdn/2.jpg"]);
    expect(product.firstImageUrl).toBe("https://cdn/1.jpg");
  });

  it("uses product image URLs when media preview URLs are missing", () => {
    const product = productNodeToShopifyProduct({
      id: "product-1",
      title: "LUZ-11AW1",
      handle: "luz-11aw1",
      variants: { nodes: [{ sku: "LUZ-11AW1" }] },
      media: {
        nodes: [
          { id: "media-1", image: { url: "https://cdn/1.jpg" }, preview: null },
          { id: "media-2", image: null, preview: null },
          { id: "media-3", image: null, preview: null }
        ],
        pageInfo: { hasNextPage: false }
      },
      images: {
        nodes: [
          { url: "https://cdn/1.jpg" },
          { url: "https://cdn/2.jpg" },
          { url: "https://cdn/3.jpg" }
        ]
      },
      mediaCount: { count: 3 }
    } satisfies ProductNode);

    expect(product.media.map((media) => media.url)).toEqual([
      "https://cdn/1.jpg",
      "https://cdn/2.jpg",
      "https://cdn/3.jpg"
    ]);
    expect(product.mediaImageUrls).toEqual(["https://cdn/1.jpg", "https://cdn/2.jpg", "https://cdn/3.jpg"]);
  });
});
