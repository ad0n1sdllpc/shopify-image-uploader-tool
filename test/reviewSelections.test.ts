import { describe, expect, it } from "vitest";
import { activeSelections, includedSelections, keepCurrentExcludedProductIds, matchedProductIds } from "@/lib/reviewSelections";
import type { LocalImage, ProductMatch, ShopifyProduct, TileFolder, UploadSelection } from "@/types";

function image(name: string): LocalImage {
  return {
    id: name,
    name,
    absolutePath: `/tiles/11AW1/${name}`,
    relativePath: `11AW1/${name}`,
    previewUrl: `/api/images?path=${name}`,
    sizeBytes: 100,
    modifiedAt: "2026-01-01T00:00:00.000Z",
    mimeType: "image/jpeg"
  };
}

function folder(overrides: Partial<TileFolder> = {}): TileFolder {
  return {
    id: overrides.id ?? "folder-1",
    size: overrides.size ?? "10x10",
    tileName: overrides.tileName ?? "11AW1",
    absolutePath: overrides.absolutePath ?? "/tiles/11AW1",
    relativePath: overrides.relativePath ?? "10x10/11AW1",
    images: overrides.images ?? [image("1.jpg"), image("2.jpg")]
  };
}

function product(id: string, title: string): ShopifyProduct {
  return {
    id,
    title,
    handle: title.toLowerCase(),
    variantsSkus: [title],
    mediaIds: [],
    firstImageUrl: null,
    mediaImageUrls: [],
    totalMediaCount: 0
  };
}

function match(overrides: Partial<ProductMatch> = {}): ProductMatch {
  const nextFolder = overrides.folder ?? folder();
  const selectedProducts = overrides.selectedProducts ?? [
    product("luz", "LUZ-11AW1"),
    product("min", "MIN-11AW1"),
    product("vis", "VIS-11AW1")
  ];

  return {
    folder: nextFolder,
    confidence: overrides.confidence ?? "Variant Group",
    product: overrides.product ?? selectedProducts[0] ?? null,
    candidates: overrides.candidates ?? selectedProducts,
    selectedProducts,
    reason: overrides.reason ?? "Grouped by tile code."
  };
}

describe("review selection planning", () => {
  it("creates default selections for untouched matched folders", () => {
    const [selection] = activeSelections([match()], []);

    expect(selection.products.map((item) => item.id)).toEqual(["luz", "vis", "min"]);
    expect(selection.selectedFirstImagePath).toBe("/tiles/11AW1/1.jpg");
    expect(selection.orderedImagePaths).toEqual(["/tiles/11AW1/1.jpg", "/tiles/11AW1/2.jpg"]);
    expect(selection.mode).toBe("append-folder");
    expect(selection.deleteOldMedia).toBe(true);
  });

  it("uses saved image selector overrides when present", () => {
    const nextMatch = match();
    const savedSelection: UploadSelection = {
      folder: nextMatch.folder,
      products: [product("old", "OLD")],
      selectedFirstImagePath: "/tiles/11AW1/2.jpg",
      orderedImagePaths: ["/tiles/11AW1/2.jpg", "/tiles/11AW1/1.jpg"],
      mode: "replace-gallery",
      deleteOldMedia: true
    };

    const [selection] = activeSelections([nextMatch], [savedSelection]);

    expect(selection.products.map((item) => item.id)).toEqual(["luz", "vis", "min"]);
    expect(selection.selectedFirstImagePath).toBe("/tiles/11AW1/2.jpg");
    expect(selection.orderedImagePaths).toEqual(["/tiles/11AW1/2.jpg", "/tiles/11AW1/1.jpg"]);
    expect(selection.mode).toBe("replace-gallery");
    expect(selection.deleteOldMedia).toBe(true);
  });

  it("excludes unchecked review products and drops empty folders", () => {
    const selections = activeSelections([match()], []);

    expect(includedSelections(selections, ["min"]).flatMap((selection) => selection.products.map((item) => item.id))).toEqual(["luz", "vis"]);
    expect(includedSelections(selections, ["luz", "min", "vis"])).toEqual([]);
  });

  it("supports clear all and select all exclusion state", () => {
    const productIds = matchedProductIds([match()]);
    const cleared = Array.from(new Set(productIds));
    const selectedAgain = keepCurrentExcludedProductIds(cleared, []);

    expect(cleared).toEqual(["luz", "min", "vis"]);
    expect(selectedAgain).toEqual([]);
  });

  it("removes excluded product ids that are no longer in current matches", () => {
    expect(keepCurrentExcludedProductIds(["luz", "old"], ["luz", "min"])).toEqual(["luz"]);
  });
});
