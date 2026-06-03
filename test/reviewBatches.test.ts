import { describe, expect, it } from "vitest";
import { createReviewBatchPlan, pruneCompletedFolderIds, successfulFolderIdsForJob } from "@/lib/reviewBatches";
import type { LocalImage, ShopifyProduct, TileFolder, UploadJob, UploadSelection } from "@/types";

function image(name: string): LocalImage {
  return {
    id: name,
    name,
    absolutePath: `/tiles/${name}`,
    relativePath: name,
    previewUrl: `/api/images?path=${name}`,
    sizeBytes: 100,
    modifiedAt: "2026-01-01T00:00:00.000Z",
    mimeType: "image/jpeg"
  };
}

function folder(index: number): TileFolder {
  return {
    id: `folder-${index}`,
    size: "10x10",
    tileName: `TILE-${index}`,
    absolutePath: `/tiles/TILE-${index}`,
    relativePath: `10x10/TILE-${index}`,
    images: [image(`${index}-1.jpg`), image(`${index}-2.jpg`)]
  };
}

function product(id: string): ShopifyProduct {
  return {
    id,
    title: id.toUpperCase(),
    handle: id,
    variantsSkus: [id],
    media: [],
    mediaIds: [],
    firstImageUrl: null,
    mediaImageUrls: [],
    totalMediaCount: 0
  };
}

function selection(index: number, productIds = [`luz-${index}`, `min-${index}`, `vis-${index}`]): UploadSelection {
  const nextFolder = folder(index);
  return {
    folder: nextFolder,
    products: productIds.map(product),
    selectedFirstImagePath: nextFolder.images[0].absolutePath,
    orderedImagePaths: nextFolder.images.map((item) => item.absolutePath),
    mode: "append-folder",
    deleteOldMedia: false
  };
}

function job(statuses: Record<string, "success" | "failed">): UploadJob {
  return {
    id: "job-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    mode: "append-folder",
    dryRun: false,
    removeWhiteBackground: false,
    status: "partial",
    products: Object.entries(statuses).map(([productId, status]) => ({
      productId,
      title: productId,
      status,
      progress: 100,
      message: status,
      uploadedMediaIds: []
    }))
  };
}

describe("review upload batches", () => {
  it("splits included selections by tile group and keeps variants together", () => {
    const selections = Array.from({ length: 105 }, (_, index) => selection(index + 1));
    const plan = createReviewBatchPlan(selections, [], 100);

    expect(plan.currentGroupCount).toBe(100);
    expect(plan.currentProductCount).toBe(300);
    expect(plan.waitingSelections).toHaveLength(5);
    expect(plan.currentBatchSelections[0].products.map((item) => item.id)).toEqual(["luz-1", "min-1", "vis-1"]);
  });

  it("skips completed folders and keeps remaining groups retryable", () => {
    const selections = Array.from({ length: 6 }, (_, index) => selection(index + 1));
    const plan = createReviewBatchPlan(selections, ["folder-1", "folder-3"], 2);

    expect(plan.uploadedSelections.map((item) => item.folder.id)).toEqual(["folder-1", "folder-3"]);
    expect(plan.currentBatchSelections.map((item) => item.folder.id)).toEqual(["folder-2", "folder-4"]);
    expect(plan.waitingSelections.map((item) => item.folder.id)).toEqual(["folder-5", "folder-6"]);
  });

  it("marks only fully successful tile groups as completed", () => {
    const selections = [
      selection(1, ["luz-1", "min-1"]),
      selection(2, ["luz-2", "min-2"])
    ];

    expect(successfulFolderIdsForJob(job({
      "luz-1": "success",
      "min-1": "success",
      "luz-2": "success",
      "min-2": "failed"
    }), selections)).toEqual(["folder-1"]);
  });

  it("prunes completed folder ids that no longer exist in current review selections", () => {
    expect(pruneCompletedFolderIds(["folder-1", "folder-old"], [selection(1), selection(2)])).toEqual(["folder-1"]);
  });
});
