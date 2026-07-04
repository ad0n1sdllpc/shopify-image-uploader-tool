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

export type ImageFolder = {
  id: string;
  name: string;
  category?: string;
  productCode: string;
  absolutePath: string;
  relativePath: string;
  images: LocalImage[];
};

export type ScanResult = {
  rootPath: string;
  scannedAt: string;
  folders: ImageFolder[];
};

export type ShopifyProductMedia = {
  id: string;
  url: string | null;
  position: number;
};

export type ShopifyProduct = {
  id: string;
  title: string;
  handle: string;
  variantsSkus: string[];
  media: ShopifyProductMedia[];
  mediaIds: string[];
  firstImageUrl: string | null;
  mediaImageUrls: string[];
  totalMediaCount: number;
};

export type RegionalPrefix = "LUZ" | "VIS" | "MIN";

export type ProductMigrationLocationName = "Lusterplus Inc." | "ARTEMISIA CEBU" | "ARTEMISIA DAVAO";

export type ProductMigrationMetafields = {
  itemCode: string;
  tileSize: string | null;
  surfaceFinish: string[];
  features: string[];
  materialType: string[];
  printTechnology: string[];
  colorTone: string[];
  waterAbsorption: string | null;
  thicknessMm: string | null;
  rectified: boolean;
  trafficRating: string[];
  applicationArea: string[];
  suitableFor: string[];
  regionAvailability: string[];
  disclaimer: string | null;
};

export type ProductMigrationShippingWeight = {
  value: number;
  unit: "GRAMS" | "KILOGRAMS" | "OUNCES" | "POUNDS";
  source: string;
};

export type ProductMigrationRegionalProduct = {
  prefix: RegionalPrefix;
  sourceProductId: string;
  sourceTitle: string;
  sku: string;
  locationName: ProductMigrationLocationName;
  quantity: number;
};

export type ProductMigrationCandidate = {
  baseSku: string;
  title: string;
  descriptionHtml: string;
  price: string;
  tags: string[];
  productType: string;
  shippingWeight: ProductMigrationShippingWeight | null;
  imageUrls: string[];
  regionalProducts: ProductMigrationRegionalProduct[];
  metafields: ProductMigrationMetafields;
  missingFields: string[];
  manualReviewFields: string[];
  existingUnifiedProductId: string | null;
  descriptionDataStatus: "not_provided" | "matched" | "missing" | "warning";
  descriptionDataWarnings: string[];
  descriptionDataSource: {
    itemCode: string;
    size: string | null;
    category: string | null;
  } | null;
};

export type ProductMigrationIssue = {
  baseSku: string;
  reason: string;
  products: ProductMigrationRegionalProduct[];
};

export type ProductMigrationScanResult = {
  scannedAt: string;
  candidates: ProductMigrationCandidate[];
  issues: ProductMigrationIssue[];
};

export type ProductMigrationRunResult = {
  baseSku: string;
  status: "success" | "failed" | "skipped";
  newProductGid: string | null;
  inventorySet: { locationName: ProductMigrationLocationName; quantity: number }[];
  missingFields: string[];
  imagesAttached: number;
  metafieldsPopulated: number;
  originalProductGids: string[];
  error?: string;
};

export type MediaDeleteRequestItem = {
  productId: string;
  mediaIds: string[];
};

export type MediaDeleteResult = {
  productId: string;
  requestedMediaIds: string[];
  deletedMediaIds: string[];
  skippedMediaIds: string[];
  status: "success" | "failed";
  error?: string;
};

export type MatchConfidence = "Exact" | "Partial" | "Variant Group" | "Multiple Matches" | "No Match";

export type ProductMatch = {
  folder: ImageFolder;
  confidence: MatchConfidence;
  product: ShopifyProduct | null;
  candidates: ShopifyProduct[];
  selectedProducts: ShopifyProduct[];
  reason: string;
};

export type UploadSelection = {
  folder: ImageFolder;
  products: ShopifyProduct[];
  selectedFirstImagePath: string;
  orderedImagePaths: string[];
  mode: UploadMode;
  deleteOldMedia: boolean;
};

export type UploadOptions = {
  removeWhiteBackground: boolean;
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
  removeWhiteBackground: boolean;
  status: "pending" | "running" | "success" | "failed" | "partial";
  products: UploadProductStatus[];
};
