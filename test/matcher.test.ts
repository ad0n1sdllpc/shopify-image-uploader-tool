import { describe, expect, it } from "vitest";
import { matchTileFolder, normalizeName } from "@/lib/matcher";
import type { ShopifyProduct, TileFolder } from "@/types";

const folder: TileFolder = {
  id: "folder-1",
  size: "60x60",
  tileName: "LUZ-14MEA",
  absolutePath: "/TILES/60x60/LUZ-14MEA",
  relativePath: "60x60/LUZ-14MEA",
  images: []
};

function product(overrides: Partial<ShopifyProduct>): ShopifyProduct {
  return {
    id: overrides.id ?? "gid://shopify/Product/1",
    title: overrides.title ?? "Luz 14MEA",
    handle: overrides.handle ?? "luz-14mea",
    variantsSkus: overrides.variantsSkus ?? [],
    mediaIds: [],
    firstImageUrl: null,
    totalMediaCount: 0
  };
}

describe("matcher", () => {
  it("normalizes spaces, separators, case, and extensions", () => {
    expect(normalizeName("LUZ_14 MEA.jpg")).toBe("luz14mea");
  });

  it("prioritizes exact sku matches", () => {
    const match = matchTileFolder(folder, [
      product({ id: "title", title: "LUZ-14MEA" }),
      product({ id: "sku", title: "Other", variantsSkus: ["LUZ-14MEA"] })
    ]);

    expect(match.product?.id).toBe("sku");
    expect(match.confidence).toBe("Exact");
    expect(match.selectedProducts.map((item) => item.id)).toEqual(["sku"]);
  });

  it("groups sibling products that end with the same folder tile code", () => {
    const match = matchTileFolder({ ...folder, tileName: "11AW1" }, [
      product({ id: "luz", title: "LUZ-11AW1", handle: "luz-11aw1" }),
      product({ id: "min", title: "MIN-11AW1", handle: "min-11aw1" }),
      product({ id: "vis", title: "VIS-11AW1", handle: "vis-11aw1" }),
      product({ id: "other", title: "LUZ-11AW2", handle: "luz-11aw2" })
    ]);

    expect(match.confidence).toBe("Variant Group");
    expect(match.selectedProducts.map((item) => item.id)).toEqual(["luz", "min", "vis"]);
    expect(match.candidates.map((item) => item.id)).toEqual(["luz", "min", "vis"]);
  });

  it("falls back to partial title matches", () => {
    const match = matchTileFolder(folder, [product({ id: "partial", title: "Premium Luz 14MEA Tile", handle: "premium-luz-tile" })]);

    expect(match.confidence).toBe("Partial");
    expect(match.product?.id).toBe("partial");
  });

  it("keeps no-match behavior when no product includes the tile code", () => {
    const match = matchTileFolder({ ...folder, tileName: "NOPE" }, [product({ id: "other", title: "LUZ-11AW2", handle: "luz-11aw2" })]);

    expect(match.confidence).toBe("No Match");
    expect(match.selectedProducts).toEqual([]);
  });
});
