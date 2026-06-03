import { describe, expect, it } from "vitest";
import { filterMediaProducts, filterMediaGroups, groupedMediaSelected, groupMediaProducts, matchedMediaProducts, mediaDeleteItems, nonFirstGroupedMediaIds, nonFirstMediaIds, selectedMediaSummary, toggleGroupedMediaSelection } from "@/lib/mediaManager";
import type { ProductMatch, ShopifyProduct } from "@/types";

function product(overrides: Partial<ShopifyProduct> = {}): ShopifyProduct {
  return {
    id: overrides.id ?? "product-1",
    title: overrides.title ?? "LUZ-11AW1",
    handle: overrides.handle ?? "luz-11aw1",
    variantsSkus: overrides.variantsSkus ?? ["LUZ-11AW1"],
    media: overrides.media ?? [
      { id: "first", url: "https://cdn/first.jpg", position: 0 },
      { id: "second", url: "https://cdn/second.jpg", position: 1 },
      { id: "third", url: "https://cdn/third.jpg", position: 2 }
    ],
    mediaIds: overrides.mediaIds ?? ["first", "second", "third"],
    firstImageUrl: overrides.firstImageUrl ?? "https://cdn/first.jpg",
    mediaImageUrls: overrides.mediaImageUrls ?? ["https://cdn/first.jpg", "https://cdn/second.jpg", "https://cdn/third.jpg"],
    totalMediaCount: overrides.totalMediaCount ?? 3
  };
}

describe("media manager selection", () => {
  it("selects only non-first media IDs", () => {
    expect(nonFirstMediaIds([product()])).toEqual(["second", "third"]);
  });

  it("builds delete payloads without first media IDs", () => {
    expect(mediaDeleteItems([product()], ["first", "second"])).toEqual([
      { productId: "product-1", mediaIds: ["second"] }
    ]);
  });

  it("counts only selected non-first media", () => {
    expect(selectedMediaSummary([product()], ["first", "second"])).toEqual({
      selectedProductCount: 1,
      selectedMediaCount: 1
    });
  });

  it("filters products by query and multi-media count", () => {
    const products = [
      product({ id: "one", title: "LUZ-11AW1" }),
      product({ id: "two", title: "MIN-11BC3", media: [{ id: "only", url: null, position: 0 }], mediaIds: ["only"], mediaImageUrls: [], totalMediaCount: 1 })
    ];

    expect(filterMediaProducts(products, { query: "11aw1", multiMediaOnly: true, selectedOnly: false }, []).map((item) => item.id)).toEqual(["one"]);
  });

  it("scopes media products to unique selected products from local matches", () => {
    const selected = product({ id: "selected" });
    const duplicateSelected = product({ id: "selected", title: "Duplicate reference" });
    const unselectedCandidate = product({ id: "candidate" });
    const matches: ProductMatch[] = [{
      folder: {
        id: "folder-1",
        size: "10x10",
        tileName: "11AW1",
        absolutePath: "/tiles/11AW1",
        relativePath: "10x10/11AW1",
        images: []
      },
      confidence: "Variant Group",
      product: selected,
      candidates: [selected, unselectedCandidate],
      selectedProducts: [selected, duplicateSelected],
      reason: "Grouped by tile code."
    }];

    expect(matchedMediaProducts(matches).map((item) => item.id)).toEqual(["selected"]);
  });

  it("groups LUZ, VIS, and MIN product variants under the shared product code", () => {
    const products = [
      product({ id: "luz", title: "LUZ-61271", handle: "luz-61271" }),
      product({ id: "min", title: "MIN-61271", handle: "min-61271" }),
      product({ id: "vis", title: "VIS-61271", handle: "vis-61271" })
    ];

    const [group] = groupMediaProducts(products);

    expect(group.code).toBe("61271");
    expect(group.variantLabels).toEqual(["LUZ", "VIS", "MIN"]);
    expect(group.products.map((item) => item.id)).toEqual(["luz", "vis", "min"]);
  });

  it("selects the same media position across every product in a group", () => {
    const products = [
      product({ id: "luz", media: [{ id: "luz-first", url: null, position: 0 }, { id: "luz-second", url: null, position: 1 }] }),
      product({ id: "vis", title: "VIS-11AW1", media: [{ id: "vis-first", url: null, position: 0 }, { id: "vis-second", url: null, position: 1 }] })
    ];
    const [group] = groupMediaProducts(products);
    const selectedIds = toggleGroupedMediaSelection(group, 1, true, []);

    expect(selectedIds).toEqual(["luz-second", "vis-second"]);
    expect(groupedMediaSelected(group, 1, selectedIds)).toBe(true);
    expect(mediaDeleteItems(products, selectedIds)).toEqual([
      { productId: "luz", mediaIds: ["luz-second"] },
      { productId: "vis", mediaIds: ["vis-second"] }
    ]);
  });

  it("selects non-first media across visible groups", () => {
    const groups = groupMediaProducts([
      product({ id: "luz", media: [{ id: "luz-first", url: null, position: 0 }, { id: "luz-second", url: null, position: 1 }] }),
      product({ id: "vis", title: "VIS-11AW1", media: [{ id: "vis-first", url: null, position: 0 }, { id: "vis-second", url: null, position: 1 }] })
    ]);

    expect(nonFirstGroupedMediaIds(filterMediaGroups(groups, { query: "11AW1", multiMediaOnly: true, selectedOnly: false }, []))).toEqual(["luz-second", "vis-second"]);
  });
});
