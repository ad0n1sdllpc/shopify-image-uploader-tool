import "server-only";
import { fetchProductMediaIds, shopifyGraphql } from "@/lib/shopify";

type JobStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELED";

export async function reorderProductMedia(productId: string, orderedMediaIds: string[]) {
  const moves = orderedMediaIds.map((id, index) => ({ id, newPosition: index.toString() }));
  const data = await shopifyGraphql<{
    productReorderMedia: { job: { id: string } | null; mediaUserErrors: { message: string }[] };
  }>(
    `mutation ReorderProductMedia($id: ID!, $moves: [MoveInput!]!) {
      productReorderMedia(id: $id, moves: $moves) {
        job { id }
        mediaUserErrors { message }
      }
    }`,
    { id: productId, moves }
  );

  const errors = data.productReorderMedia.mediaUserErrors;
  if (errors.length) throw new Error(errors.map((error) => error.message).join("; "));
  const jobId = data.productReorderMedia.job?.id;
  if (!jobId) throw new Error("Shopify did not return a reorder job.");
  await pollShopifyJob(jobId);
}

export async function pollShopifyJob(jobId: string, timeoutMs = 120000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const data = await shopifyGraphql<{ job: { id: string; done: boolean; status: JobStatus } | null }>(
      `query Job($id: ID!) { job(id: $id) { id done status } }`,
      { id: jobId }
    );

    if (data.job?.done) {
      if (data.job.status !== "COMPLETED") throw new Error(`Shopify reorder job ended with ${data.job.status}.`);
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  throw new Error("Timed out waiting for Shopify media reorder job.");
}

export async function verifyMediaOrder(productId: string, expectedPrefix: string[]) {
  const mediaIds = await fetchProductMediaIds(productId);
  const matches = expectedPrefix.every((id, index) => mediaIds[index] === id);
  if (!matches) {
    throw new Error("Shopify media order verification failed.");
  }
  return mediaIds;
}
