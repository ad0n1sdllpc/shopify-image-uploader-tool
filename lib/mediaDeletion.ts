import "server-only";
import { deleteProductMedia, fetchProductMedia } from "@/lib/shopify";
import type { MediaDeleteRequestItem, MediaDeleteResult } from "@/types";

export async function deleteSelectedProductMedia(items: MediaDeleteRequestItem[]): Promise<MediaDeleteResult[]> {
  const normalizedItems = items
    .map((item) => ({
      productId: item.productId,
      mediaIds: Array.from(new Set(item.mediaIds.filter(Boolean)))
    }))
    .filter((item) => item.productId && item.mediaIds.length > 0);

  const results: MediaDeleteResult[] = [];
  for (const item of normalizedItems) {
    try {
      const currentMedia = await fetchProductMedia(item.productId);
      const currentMediaIds = new Set(currentMedia.map((media) => media.id));
      const protectedFirstId = currentMedia[0]?.id ?? null;
      const skippedMediaIds = item.mediaIds.filter((mediaId) => mediaId === protectedFirstId || !currentMediaIds.has(mediaId));
      const deleteIds = item.mediaIds.filter((mediaId) => mediaId !== protectedFirstId && currentMediaIds.has(mediaId));
      const deletedMediaIds = await deleteProductMedia(item.productId, deleteIds);

      results.push({
        productId: item.productId,
        requestedMediaIds: item.mediaIds,
        deletedMediaIds,
        skippedMediaIds,
        status: "success"
      });
    } catch (error) {
      results.push({
        productId: item.productId,
        requestedMediaIds: item.mediaIds,
        deletedMediaIds: [],
        skippedMediaIds: [],
        status: "failed",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return results;
}
