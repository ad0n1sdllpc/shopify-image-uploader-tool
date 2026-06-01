import "server-only";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { removeWhiteBackground } from "@/lib/backgroundTransparency";
import { reorderProductMedia, verifyMediaOrder } from "@/lib/mediaOrder";
import { shopifyGraphql } from "@/lib/shopify";
import type { UploadJob, UploadOptions, UploadProductStatus, UploadSelection } from "@/types";

const MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp"
};

function jobId() {
  return crypto.randomUUID();
}

function fileName(filePath: string) {
  return path.basename(filePath);
}

function mimeType(filePath: string) {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

const defaultUploadOptions: UploadOptions = { removeWhiteBackground: false };

export function createDryRunJob(selections: UploadSelection[], options: UploadOptions = defaultUploadOptions): UploadJob {
  return {
    id: jobId(),
    createdAt: new Date().toISOString(),
    mode: selections[0]?.mode ?? "append-folder",
    dryRun: true,
    removeWhiteBackground: options.removeWhiteBackground,
    status: "success",
    products: selections.map((selection) => ({
      productId: selection.product.id,
      title: selection.product.title,
      status: "dry-run",
      progress: 100,
      message: `${selection.orderedImagePaths.length} image(s) would upload${options.removeWhiteBackground ? " with white backgrounds removed" : ""}. Existing media will be ${selection.deleteOldMedia ? "deleted after verification" : "kept"}.`,
      uploadedMediaIds: []
    }))
  };
}

async function prepareUpload(filePath: string, options: UploadOptions) {
  if (options.removeWhiteBackground) return removeWhiteBackground(filePath);

  return {
    bytes: await fs.readFile(filePath),
    fileName: fileName(filePath),
    mimeType: mimeType(filePath)
  };
}

async function stagedUpload(filePath: string, options: UploadOptions) {
  const upload = await prepareUpload(filePath, options);
  const staged = await shopifyGraphql<{
    stagedUploadsCreate: {
      stagedTargets: { url: string; resourceUrl: string; parameters: { name: string; value: string }[] }[];
      userErrors: { message: string }[];
    };
  }>(
    `mutation StagedUploadsCreate($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets { url resourceUrl parameters { name value } }
        userErrors { message }
      }
    }`,
    {
      input: [
        {
          filename: upload.fileName,
          mimeType: upload.mimeType,
          resource: "PRODUCT_IMAGE",
          fileSize: upload.bytes.length.toString(),
          httpMethod: "POST"
        }
      ]
    }
  );

  const error = staged.stagedUploadsCreate.userErrors[0];
  if (error) throw new Error(error.message);

  const target = staged.stagedUploadsCreate.stagedTargets[0];
  const form = new FormData();
  for (const parameter of target.parameters) {
    form.append(parameter.name, parameter.value);
  }

  const blobBytes = new Uint8Array(upload.bytes.length);
  blobBytes.set(upload.bytes);
  form.append("file", new Blob([blobBytes.buffer], { type: upload.mimeType }), upload.fileName);

  const uploadResponse = await fetch(target.url, { method: "POST", body: form });
  if (!uploadResponse.ok) throw new Error(`Staged upload failed for ${upload.fileName}.`);

  return target.resourceUrl;
}

async function attachProductMedia(productId: string, imagePaths: string[], options: UploadOptions) {
  const originalSources = [];
  for (const imagePath of imagePaths) {
    originalSources.push(await stagedUpload(imagePath, options));
  }

  const data = await shopifyGraphql<{
    productCreateMedia: {
      media: { id: string }[];
      mediaUserErrors: { message: string }[];
    };
  }>(
    `mutation ProductCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
      productCreateMedia(productId: $productId, media: $media) {
        media { id }
        mediaUserErrors { message }
      }
    }`,
    {
      productId,
      media: originalSources.map((originalSource) => ({
        mediaContentType: "IMAGE",
        originalSource
      }))
    }
  );

  const errors = data.productCreateMedia.mediaUserErrors;
  if (errors.length) throw new Error(errors.map((error) => error.message).join("; "));
  return data.productCreateMedia.media.map((media) => media.id);
}

async function deleteMedia(productId: string, mediaIds: string[]) {
  if (mediaIds.length === 0) return;

  const data = await shopifyGraphql<{
    productDeleteMedia: { deletedMediaIds: string[]; mediaUserErrors: { message: string }[] };
  }>(
    `mutation ProductDeleteMedia($productId: ID!, $mediaIds: [ID!]!) {
      productDeleteMedia(productId: $productId, mediaIds: $mediaIds) {
        deletedMediaIds
        mediaUserErrors { message }
      }
    }`,
    { productId, mediaIds }
  );

  const errors = data.productDeleteMedia.mediaUserErrors;
  if (errors.length) throw new Error(errors.map((error) => error.message).join("; "));
}

export async function runUploadJob(selections: UploadSelection[], options: UploadOptions = defaultUploadOptions, onUpdate?: (job: UploadJob) => void | Promise<void>) {
  const job: UploadJob = {
    id: jobId(),
    createdAt: new Date().toISOString(),
    mode: selections[0]?.mode ?? "append-folder",
    dryRun: false,
    removeWhiteBackground: options.removeWhiteBackground,
    status: "running",
    products: selections.map<UploadProductStatus>((selection) => ({
      productId: selection.product.id,
      title: selection.product.title,
      status: "pending",
      progress: 0,
      message: "Waiting",
      uploadedMediaIds: []
    }))
  };

  const persist = async () => onUpdate?.(job);
  await persist();

  for (const [index, selection] of selections.entries()) {
    const productStatus = job.products[index];
    productStatus.status = "running";
    productStatus.message = "Uploading local images";
    productStatus.progress = 15;
    await persist();

    try {
      const oldMediaIds = [...selection.product.mediaIds];
      const pathsToUpload =
        selection.mode === "replace-first" ? [selection.selectedFirstImagePath] : selection.orderedImagePaths;
      const uploadedMediaIds = await attachProductMedia(selection.product.id, pathsToUpload, options);
      productStatus.uploadedMediaIds = uploadedMediaIds;
      productStatus.message = "Reordering Shopify media";
      productStatus.progress = 65;
      await persist();

      const preserveIds = oldMediaIds.filter((id) => !uploadedMediaIds.includes(id));
      const orderedPrefix = selection.mode === "replace-first" ? [uploadedMediaIds[0]] : uploadedMediaIds;
      await reorderProductMedia(selection.product.id, [...orderedPrefix, ...preserveIds]);
      await verifyMediaOrder(selection.product.id, orderedPrefix);

      if (selection.deleteOldMedia) {
        productStatus.message = "Deleting old media after verification";
        productStatus.progress = 88;
        await persist();
        const deleteIds = selection.mode === "replace-gallery" ? oldMediaIds : oldMediaIds.slice(0, 1);
        await deleteMedia(selection.product.id, deleteIds);
      }

      productStatus.status = "success";
      productStatus.progress = 100;
      productStatus.message = "Upload verified";
    } catch (error) {
      productStatus.status = "failed";
      productStatus.progress = 100;
      productStatus.message = "Upload failed";
      productStatus.error = error instanceof Error ? error.message : String(error);
    }

    await persist();
  }

  const failed = job.products.filter((product) => product.status === "failed").length;
  job.status = failed === 0 ? "success" : failed === job.products.length ? "failed" : "partial";
  await persist();
  return job;
}
