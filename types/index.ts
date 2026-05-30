export type UploadMode = "replace-first" | "append-folder" | "replace-gallery";

export type LocalImage = {
  id: string;
  name: string;
  absolutePath: string;
  relativePath: string;
  previewUrl: string;
  sizeBytes: number;
  modifiedAt: string;
  mimeType: string;
};

export type TileFolder = {
  id: string;
  size: string;
  tileName: string;
  absolutePath: string;
  relativePath: string;
  images: LocalImage[];
};

export type ScanResult = {
  rootPath: string;
  scannedAt: string;
  folders: TileFolder[];
};

export type ShopifyProduct = {
  id: string;
  title: string;
  handle: string;
  variantsSkus: string[];
  mediaIds: string[];
  firstImageUrl: string | null;
  totalMediaCount: number;
};

export type MatchConfidence = "Exact" | "Partial" | "Multiple Matches" | "No Match";

export type ProductMatch = {
  folder: TileFolder;
  confidence: MatchConfidence;
  product: ShopifyProduct | null;
  candidates: ShopifyProduct[];
  reason: string;
};

export type UploadSelection = {
  folder: TileFolder;
  product: ShopifyProduct;
  selectedFirstImagePath: string;
  orderedImagePaths: string[];
  mode: UploadMode;
  deleteOldMedia: boolean;
};

export type UploadProductStatus = {
  productId: string;
  title: string;
  status: "pending" | "running" | "success" | "failed" | "dry-run";
  progress: number;
  message: string;
  uploadedMediaIds: string[];
  error?: string;
};

export type UploadJob = {
  id: string;
  createdAt: string;
  mode: UploadMode;
  dryRun: boolean;
  status: "pending" | "running" | "success" | "failed" | "partial";
  products: UploadProductStatus[];
};
