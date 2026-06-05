import { describe, expect, it } from "vitest";
import { matchImageFolder, normalizeName } from "@/lib/matcher";
import type { ImageFolder, ShopifyProduct } from "@/types";

const folder: ImageFolder = {
  id: "folder-1",
  name: "LUZ-14MEA",
  productCode: "LUZ-14MEA",
  absolutePath: "/IMAGES/60x60/LUZ-14MEA",
  relativePath: "60x60/LUZ-14MEA",
  images: []
};

function product(overrides: Partial<ShopifyProduct>): ShopifyProduct {
  return {
    id: overrides.id ?? "gid://shopify/Product/1",
    title: overrides.title ?? "Luz 14MEA",
    handle: overrides.handle ?? "luz-14mea",
    variantsSkus: overrides.variantsSkus ?? [],
    media: [],
    mediaIds: [],
    firstImageUrl: null,
    mediaImageUrls: [],
    totalMediaCount: 0
  };
}

describe("matcher", () => {
  it("normalizes spaces, separators, case, and extensions", () => {
    expect(normalizeName("LUZ_14 MEA.jpg")).toBe("luz14mea");
  });

  it("prioritizes exact sku matches", () => {
    const match = matchImageFolder(folder, [
      product({ id: "title", title: "LUZ-14MEA" }),
      product({ id: "sku", title: "Other", variantsSkus: ["LUZ-14MEA"] })
    ]);

    expect(match.product?.id).toBe("sku");
    expect(match.confidence).toBe("Exact");
    expect(match.selectedProducts.map((item) => item.id)).toEqual(["sku"]);
  });

  it("groups sibling products that end with the same folder product code", () => {
    const match = matchImageFolder({ ...folder, name: "11AW1", productCode: "11AW1" }, [
      product({ id: "luz", title: "LUZ-11AW1", handle: "luz-11aw1" }),
      product({ id: "min", title: "MIN-11AW1", handle: "min-11aw1" }),
      product({ id: "vis", title: "VIS-11AW1", handle: "vis-11aw1" }),
      product({ id: "other", title: "LUZ-11AW2", handle: "luz-11aw2" })
    ]);

    expect(match.confidence).toBe("Variant Group");
    expect(match.selectedProducts.map((item) => item.id)).toEqual(["luz", "vis", "min"]);
    expect(match.candidates.map((item) => item.id)).toEqual(["luz", "vis", "min"]);
  });

  it("does not group product codes embedded inside a longer suffix segment", () => {
    const match = matchImageFolder({ ...folder, name: "L31", productCode: "L31" }, [
      product({ id: "luz", title: "LUZ-L31", handle: "luz-l31" }),
      product({ id: "min", title: "MIN-L31", handle: "min-l31" }),
      product({ id: "vis", title: "VIS-L31", handle: "vis-l31" }),
      product({ id: "luz-cl", title: "LUZ-CL31", handle: "luz-cl31" }),
      product({ id: "min-36cl", title: "MIN-36CL31", handle: "min-36cl31" })
    ]);

    expect(match.confidence).toBe("Variant Group");
    expect(match.selectedProducts.map((item) => item.id)).toEqual(["luz", "vis", "min"]);
  });

  it("falls back to partial title matches", () => {
    const match = matchImageFolder(folder, [product({ id: "partial", title: "Premium Luz 14MEA Product", handle: "premium-luz-product" })]);

    expect(match.confidence).toBe("Partial");
    expect(match.product?.id).toBe("partial");
  });

  it("matches general product folders by product code and category", () => {
    const match = matchImageFolder({ ...folder, category: "- FAUCET", productCode: "FC-2877", name: "FC-2877" }, [
      product({ id: "faucet", title: "FC-2877 Faucet", handle: "fc-2877-faucet" }),
      product({ id: "drain", title: "FC-2877 Drain", handle: "fc-2877-drain" })
    ]);

    expect(match.confidence).toBe("Partial");
    expect(match.product?.id).toBe("faucet");
  });

  it("matches folder codes without parenthetical descriptors", () => {
    const match = matchImageFolder({ ...folder, productCode: "619X1 (SMART)", name: "619X1 (SMART)" }, [
      product({ id: "smart-toilet", title: "619X1 Luxury Smart Toilet", handle: "619x1-luxury-smart-toilet" })
    ]);

    expect(match.product?.id).toBe("smart-toilet");
  });

  it("keeps no-match behavior when no product includes the folder code", () => {
    const match = matchImageFolder({ ...folder, name: "NOPE", productCode: "NOPE" }, [product({ id: "other", title: "LUZ-11AW2", handle: "luz-11aw2" })]);

    expect(match.confidence).toBe("No Match");
    expect(match.selectedProducts).toEqual([]);
  });
});
