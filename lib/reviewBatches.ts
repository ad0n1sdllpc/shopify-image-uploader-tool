import type { UploadJob, UploadSelection } from "@/types";

export const DEFAULT_REVIEW_BATCH_GROUP_SIZE = 100;
export const DEFAULT_MIGRATION_BATCH_SIZE = 10;
export const FALLBACK_SECONDS_PER_PRODUCT = 30;

export type ReviewBatchStatus = "uploaded" | "current" | "waiting";

export type ReviewBatchPlan = {
  batchSize: number;
  currentBatchNumber: number;
  totalBatchCount: number;
  currentBatchSelections: UploadSelection[];
  uploadedSelections: UploadSelection[];
  waitingSelections: UploadSelection[];
  remainingSelections: UploadSelection[];
  currentGroupCount: number;
  currentProductCount: number;
  remainingGroupCount: number;
  remainingProductCount: number;
  uploadedGroupCount: number;
  uploadedProductCount: number;
  totalGroupCount: number;
  totalProductCount: number;
};

export type MigrationBatchPlan = {
  batchSize: number;
  currentBatchNumber: number;
  totalBatchCount: number;
  currentBatchSkus: string[];
  uploadedSkus: string[];
  waitingSkus: string[];
  remainingSkus: string[];
  currentSkuCount: number;
  remainingSkuCount: number;
  uploadedSkuCount: number;
  totalSkuCount: number;
};

export function productCount(selections: UploadSelection[]) {
  return selections.reduce((total, selection) => total + selection.products.length, 0);
}

export function createReviewBatchPlan(
  selections: UploadSelection[],
  completedFolderIds: string[],
  batchSize = DEFAULT_REVIEW_BATCH_GROUP_SIZE
): ReviewBatchPlan {
  const completedFolderIdSet = new Set(completedFolderIds);
  const uploadedSelections = selections.filter((selection) => completedFolderIdSet.has(selection.folder.id));
  const remainingSelections = selections.filter((selection) => !completedFolderIdSet.has(selection.folder.id));
  const currentBatchSelections = remainingSelections.slice(0, batchSize);
  const waitingSelections = remainingSelections.slice(batchSize);
  const completedBatchCount = Math.floor(uploadedSelections.length / batchSize);
  const totalBatchCount = Math.ceil(selections.length / batchSize);

  return {
    batchSize,
    currentBatchNumber: currentBatchSelections.length ? completedBatchCount + 1 : completedBatchCount,
    totalBatchCount,
    currentBatchSelections,
    uploadedSelections,
    waitingSelections,
    remainingSelections,
    currentGroupCount: currentBatchSelections.length,
    currentProductCount: productCount(currentBatchSelections),
    remainingGroupCount: remainingSelections.length,
    remainingProductCount: productCount(remainingSelections),
    uploadedGroupCount: uploadedSelections.length,
    uploadedProductCount: productCount(uploadedSelections),
    totalGroupCount: selections.length,
    totalProductCount: productCount(selections)
  };
}

export function createMigrationBatchPlan(
  selectedSkus: string[],
  completedSkus: string[],
  batchSize = DEFAULT_MIGRATION_BATCH_SIZE
): MigrationBatchPlan {
  const normalizedSelectedSkus = uniqueStrings(selectedSkus.map((sku) => sku.trim()).filter(Boolean));
  const completedSkuSet = new Set(completedSkus.map((sku) => sku.trim().toUpperCase()));
  const uploadedSkus = normalizedSelectedSkus.filter((sku) => completedSkuSet.has(sku.toUpperCase()));
  const remainingSkus = normalizedSelectedSkus.filter((sku) => !completedSkuSet.has(sku.toUpperCase()));
  const currentBatchSkus = remainingSkus.slice(0, batchSize);
  const waitingSkus = remainingSkus.slice(batchSize);
  const completedBatchCount = Math.floor(uploadedSkus.length / batchSize);
  const totalBatchCount = Math.ceil(normalizedSelectedSkus.length / batchSize);

  return {
    batchSize,
    currentBatchNumber: currentBatchSkus.length ? completedBatchCount + 1 : completedBatchCount,
    totalBatchCount,
    currentBatchSkus,
    uploadedSkus,
    waitingSkus,
    remainingSkus,
    currentSkuCount: currentBatchSkus.length,
    remainingSkuCount: remainingSkus.length,
    uploadedSkuCount: uploadedSkus.length,
    totalSkuCount: normalizedSelectedSkus.length
  };
}

export function batchStatusForSelection(selection: UploadSelection, plan: ReviewBatchPlan): ReviewBatchStatus {
  if (plan.uploadedSelections.some((item) => item.folder.id === selection.folder.id)) return "uploaded";
  if (plan.currentBatchSelections.some((item) => item.folder.id === selection.folder.id)) return "current";
  return "waiting";
}

export function successfulFolderIdsForJob(job: UploadJob, selections: UploadSelection[]) {
  const statusByProductId = new Map(job.products.map((product) => [product.productId, product.status]));

  return selections.flatMap((selection) => {
    const allSelectedProductsSucceeded = selection.products.every((product) => statusByProductId.get(product.id) === "success");
    return allSelectedProductsSucceeded ? [selection.folder.id] : [];
  });
}

export function pruneCompletedFolderIds(completedFolderIds: string[], selections: UploadSelection[]) {
  const folderIds = new Set(selections.map((selection) => selection.folder.id));
  return completedFolderIds.filter((folderId) => folderIds.has(folderId));
}

export function pruneCompletedMigrationSkus(completedSkus: string[], selectedSkus: string[]) {
  const selectedSkuSet = new Set(selectedSkus.map((sku) => sku.trim().toUpperCase()));
  return completedSkus.filter((sku) => selectedSkuSet.has(sku.trim().toUpperCase()));
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values));
}
