import { describe, expect, it } from "vitest";
import {
  createMigrationBatchPlan,
  createReviewBatchPlan,
  pruneCompletedFolderIds,
  pruneCompletedMigrationSkus,
  successfulFolderIdsForJob,
} from "@/lib/reviewBatches";
import type { ImageFolder, LocalImage, ShopifyProduct, UploadJob, UploadSelection } from "@/types";

function image(name: string): LocalImage {
  return {
    id: name,
    name,
    absolutePath: `/images/${name}`,
    relativePath: name,
    previewUrl: `/api/images?path=${name}`,
    sizeBytes: 100,
    modifiedAt: "2026-01-01T00:00:00.000Z",
    mimeType: "image/jpeg"
  };
}

function folder(index: number): ImageFolder {
  return {
    id: `folder-${index}`,
    name: `PRODUCT-${index}`,
    productCode: `PRODUCT-${index}`,
    category: "10x10",
    absolutePath: `/images/PRODUCT-${index}`,
    relativePath: `10x10/PRODUCT-${index}`,
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
  it("splits included selections by image group and keeps variants together", () => {
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

  it("marks only fully successful image groups as completed", () => {
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

describe("product migration batches", () => {
  it("splits selected migration SKUs into batches of 100", () => {
    const skus = Array.from({ length: 165 }, (_, index) => `SKU-${index + 1}`);
    const plan = createMigrationBatchPlan(skus, []);

    expect(plan.batchSize).toBe(100);
    expect(plan.currentBatchNumber).toBe(1);
    expect(plan.totalBatchCount).toBe(2);
    expect(plan.currentBatchSkus).toEqual(skus.slice(0, 100));
    expect(plan.waitingSkus).toEqual(skus.slice(100));
    expect(plan.remainingSkuCount).toBe(165);
  });

  it("excludes completed migration SKUs and keeps remaining SKUs retryable", () => {
    const plan = createMigrationBatchPlan(
      ["A", "B", "C", "D", "E"],
      ["B", "D"],
      2,
    );

    expect(plan.uploadedSkus).toEqual(["B", "D"]);
    expect(plan.currentBatchSkus).toEqual(["A", "C"]);
    expect(plan.waitingSkus).toEqual(["E"]);
    expect(plan.uploadedSkuCount).toBe(2);
    expect(plan.remainingSkuCount).toBe(3);
  });

  it("prunes completed migration SKUs that are no longer selected", () => {
    expect(pruneCompletedMigrationSkus(["A", "OLD"], ["A", "B"])).toEqual([
      "A",
    ]);
  });
});
