"use client";

import Link from "next/link";
import type { ChangeEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  Download,
  FolderSearch,
  History,
  Images,
  LayoutDashboard,
  PackagePlus,
  RefreshCw,
  Shuffle,
  Trash2,
  UploadCloud,
  Upload,
} from "lucide-react";
import ImageSelector from "@/components/ImageSelector";
import MediaManager from "@/components/MediaManager";
import ProductMatchTable from "@/components/ProductMatchTable";
import ReviewUploadModal from "@/components/ReviewUploadModal";
import ThemeToggle from "@/components/ThemeToggle";
import UploadProgress from "@/components/UploadProgress";
import { matchedMediaProducts } from "@/lib/mediaManager";
import { sortProductsByVariantPrefix } from "@/lib/productOrdering";
import {
  DEFAULT_MIGRATION_BATCH_SIZE,
  DEFAULT_REVIEW_BATCH_GROUP_SIZE,
  FALLBACK_SECONDS_PER_PRODUCT,
  batchStatusForSelection,
  createMigrationBatchPlan,
  createReviewBatchPlan,
  pruneCompletedFolderIds,
  pruneCompletedMigrationSkus,
  successfulFolderIdsForJob,
  type MigrationBatchPlan,
  type ReviewBatchPlan,
} from "@/lib/reviewBatches";
import {
  activeSelections,
  includedSelections,
  keepCurrentExcludedProductIds,
  matchedProductIds,
} from "@/lib/reviewSelections";
import type {
  ImageFolder,
  MediaDeleteRequestItem,
  MediaDeleteResult,
  ProductMatch,
  ProductMigrationCandidate,
  ProductMigrationRunResult,
  ProductMigrationScanResult,
  ScanResult,
  ShopifyProduct,
  UploadJob,
  UploadMode,
  UploadSelection,
} from "@/types";

type PageKey =
  | "dashboard"
  | "scan"
  | "matching"
  | "media"
  | "selector"
  | "review"
  | "migration"
  | "history";

const navItems: {
  key: PageKey;
  href: string;
  label: string;
  icon: React.ElementType;
}[] = [
  { key: "dashboard", href: "/", label: "Dashboard", icon: LayoutDashboard },
  { key: "scan", href: "/scan", label: "Folder Scan", icon: FolderSearch },
  {
    key: "matching",
    href: "/matching",
    label: "Product Matching",
    icon: Shuffle,
  },
  { key: "media", href: "/media", label: "Media Manager", icon: Trash2 },
  { key: "selector", href: "/selector", label: "Image Selector", icon: Images },
  { key: "review", href: "/review", label: "Review Upload", icon: UploadCloud },
  {
    key: "migration",
    href: "/migration",
    label: "Product Migration",
    icon: PackagePlus,
  },
  { key: "history", href: "/history", label: "History", icon: History },
];

type Store = {
  scan: ScanResult | null;
  products: ShopifyProduct[];
  matches: ProductMatch[];
  selections: UploadSelection[];
  excludedReviewProductIds: string[];
  completedReviewFolderIds: string[];
  completedMigrationBaseSkus: string[];
  uploadSecondsPerProduct: number | null;
  migrationSecondsPerProduct: number | null;
  lastJob: UploadJob | null;
};

type MigrationProgress = {
  startedAt: number;
  total: number;
  now: number;
};

type PersistedStore = {
  scan: ScanResult | null;
  products: ShopifyProduct[];
  matches: {
    folderId: string;
    confidence: ProductMatch["confidence"];
    productId: string | null;
    candidateIds: string[];
    selectedProductIds: string[];
    reason: string;
  }[];
  selections: {
    folderId: string;
    productIds: string[];
    selectedFirstImagePath: string;
    orderedImagePaths: string[];
    mode: UploadMode;
    deleteOldMedia: boolean;
  }[];
  excludedReviewProductIds: string[];
  completedReviewFolderIds: string[];
  completedMigrationBaseSkus: string[];
  uploadSecondsPerProduct: number | null;
  migrationSecondsPerProduct: number | null;
  lastJob: UploadJob | null;
};

type CheckpointFile = {
  kind: "image-uploader-checkpoint";
  version: 1;
  exportedAt: string;
  state: PersistedStore;
};

const emptyStore: Store = {
  scan: null,
  products: [],
  matches: [],
  selections: [],
  excludedReviewProductIds: [],
  completedReviewFolderIds: [],
  completedMigrationBaseSkus: [],
  uploadSecondsPerProduct: null,
  migrationSecondsPerProduct: null,
  lastJob: null,
};

function normalizeProduct(product: ShopifyProduct): ShopifyProduct {
  const media = product.media?.length
    ? product.media.map((item, index) => ({
        ...item,
        url:
          item.url ??
          product.mediaImageUrls?.[index] ??
          (index === 0 ? product.firstImageUrl : null),
      }))
    : (product.mediaIds?.map((id, index) => ({
        id,
        url:
          product.mediaImageUrls?.[index] ??
          (index === 0 ? product.firstImageUrl : null),
        position: index,
      })) ?? []);
  const mediaImageUrls = media
    .map((item) => item.url)
    .filter((url): url is string => Boolean(url));

  return {
    ...product,
    media,
    mediaIds: media.length
      ? media.map((item) => item.id)
      : (product.mediaIds ?? []),
    firstImageUrl: mediaImageUrls[0] ?? product.firstImageUrl ?? null,
    mediaImageUrls: mediaImageUrls.length
      ? mediaImageUrls
      : product.mediaImageUrls?.length
        ? product.mediaImageUrls
        : product.firstImageUrl
          ? [product.firstImageUrl]
          : [],
  };
}

function compactProductForStorage(product: ShopifyProduct): ShopifyProduct {
  const firstImageUrl =
    product.firstImageUrl ??
    product.mediaImageUrls?.[0] ??
    product.media?.find((item) => item.url)?.url ??
    null;

  return {
    id: product.id,
    title: product.title,
    handle: product.handle,
    variantsSkus: product.variantsSkus,
    media: [],
    mediaIds: [],
    firstImageUrl,
    mediaImageUrls: firstImageUrl ? [firstImageUrl] : [],
    totalMediaCount: product.totalMediaCount,
  };
}

function compactStore(store: Store): PersistedStore {
  return {
    scan: store.scan,
    products: store.products.map((product) =>
      compactProductForStorage(product),
    ),
    matches: store.matches.map((match) => ({
      folderId: match.folder.id,
      confidence: match.confidence,
      productId: match.product?.id ?? null,
      candidateIds: match.candidates.map((product) => product.id),
      selectedProductIds: match.selectedProducts.map((product) => product.id),
      reason: match.reason,
    })),
    selections: store.selections.map((selection) => ({
      folderId: selection.folder.id,
      productIds: selection.products.map((product) => product.id),
      selectedFirstImagePath: selection.selectedFirstImagePath,
      orderedImagePaths: selection.orderedImagePaths,
      mode: selection.mode,
      deleteOldMedia: selection.deleteOldMedia,
    })),
    excludedReviewProductIds: store.excludedReviewProductIds,
    completedReviewFolderIds: store.completedReviewFolderIds,
    completedMigrationBaseSkus: store.completedMigrationBaseSkus,
    uploadSecondsPerProduct: store.uploadSecondsPerProduct,
    migrationSecondsPerProduct: store.migrationSecondsPerProduct,
    lastJob: null,
  };
}

function normalizeStoredStore(
  saved: Partial<Store> | Partial<PersistedStore>,
): Store {
  const scan = saved.scan ?? null;
  const products = (saved.products ?? []).map((product) =>
    normalizeProduct(product),
  );
  const foldersById = new Map(
    scan?.folders.map((folder) => [folder.id, folder]) ?? [],
  );
  const productsById = new Map(
    products.map((product) => [product.id, product]),
  );

  const matches = (saved.matches ?? []).flatMap((match) => {
    const legacyMatch = match as Partial<ProductMatch> &
      Partial<PersistedStore["matches"][number]>;
    const folder =
      legacyMatch.folder ??
      (legacyMatch.folderId ? foldersById.get(legacyMatch.folderId) : null);
    if (!folder) return [];

    const candidateIds =
      legacyMatch.candidateIds ??
      legacyMatch.candidates?.map((product) => product.id) ??
      [];
    const selectedProductIds =
      legacyMatch.selectedProductIds ??
      legacyMatch.selectedProducts?.map((product) => product.id) ??
      (legacyMatch.product?.id ? [legacyMatch.product.id] : []);
    const candidates = candidateIds
      .map((productId) => productsById.get(productId))
      .filter((product): product is ShopifyProduct => Boolean(product));
    const selectedProducts = selectedProductIds
      .map((productId) => productsById.get(productId))
      .filter((product): product is ShopifyProduct => Boolean(product));

    return [
      {
        folder,
        confidence: legacyMatch.confidence ?? "No Match",
        product: selectedProducts[0] ?? legacyMatch.product ?? null,
        candidates,
        selectedProducts,
        reason: legacyMatch.reason ?? "",
      },
    ];
  });

  const selections = (saved.selections ?? []).flatMap((selection) => {
    const legacySelection = selection as Partial<UploadSelection> &
      Partial<PersistedStore["selections"][number]> & {
        product?: ShopifyProduct;
      };
    const folder =
      legacySelection.folder ??
      (legacySelection.folderId
        ? foldersById.get(legacySelection.folderId)
        : null);
    if (!folder) return [];

    const productIds =
      legacySelection.productIds ??
      legacySelection.products?.map((product) => product.id) ??
      (legacySelection.product?.id ? [legacySelection.product.id] : []);
    const nextProducts = productIds
      .map((productId) => productsById.get(productId))
      .filter((product): product is ShopifyProduct => Boolean(product));
    if (nextProducts.length === 0) return [];

    return [
      {
        folder,
        products: nextProducts,
        selectedFirstImagePath:
          legacySelection.selectedFirstImagePath ??
          folder.images[0]?.absolutePath ??
          "",
        orderedImagePaths:
          legacySelection.orderedImagePaths ??
          folder.images.map((image) => image.absolutePath),
        mode: legacySelection.mode ?? "append-folder",
        deleteOldMedia: Boolean(legacySelection.deleteOldMedia),
      },
    ];
  });

  return {
    scan,
    products,
    matches,
    selections,
    excludedReviewProductIds: saved.excludedReviewProductIds ?? [],
    completedReviewFolderIds: saved.completedReviewFolderIds ?? [],
    completedMigrationBaseSkus: saved.completedMigrationBaseSkus ?? [],
    uploadSecondsPerProduct: saved.uploadSecondsPerProduct ?? null,
    migrationSecondsPerProduct: saved.migrationSecondsPerProduct ?? null,
    lastJob: saved.lastJob ?? null,
  };
}

function checkpointFileName(date = new Date()) {
  const stamp = date.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `image-uploader-checkpoint-${stamp}.json`;
}

function checkpointStateFromPayload(
  payload: unknown,
): Partial<Store> | Partial<PersistedStore> {
  if (!payload || typeof payload !== "object")
    throw new Error("Checkpoint file is not valid JSON data.");
  const maybeCheckpoint = payload as Partial<CheckpointFile>;
  if (
    maybeCheckpoint.kind === "image-uploader-checkpoint" &&
    maybeCheckpoint.state
  )
    return maybeCheckpoint.state;
  return payload as Partial<Store> | Partial<PersistedStore>;
}

function storeWithRefreshedProducts(
  current: Store,
  products: ShopifyProduct[],
): Store {
  const normalizedProducts = products.map((product) =>
    normalizeProduct(product),
  );
  const productsById = new Map(
    normalizedProducts.map((product) => [product.id, product]),
  );
  const refreshProduct = (product: ShopifyProduct) =>
    productsById.get(product.id) ?? normalizeProduct(product);
  const matches = current.matches.map((match) => {
    const selectedProducts = sortProductsByVariantPrefix(
      match.selectedProducts.map(refreshProduct),
    );
    return {
      ...match,
      product: match.product
        ? refreshProduct(match.product)
        : (selectedProducts[0] ?? null),
      candidates: match.candidates.map(refreshProduct),
      selectedProducts,
    };
  });
  const selections = current.selections.map((selection) => ({
    ...selection,
    products: selection.products.map(refreshProduct),
  }));

  return {
    ...current,
    products: normalizedProducts,
    matches,
    selections,
  };
}

function migrationRunFormData(baseSkus: string[], descriptionWorkbook: File | null) {
  const formData = new FormData();
  formData.set("intent", "run");
  formData.set("baseSkus", JSON.stringify(baseSkus));
  if (descriptionWorkbook)
    formData.set("descriptionWorkbook", descriptionWorkbook);
  return formData;
}

export default function AppShell({ page }: { page: PageKey }) {
  const [store, setStore] = useState<Store>(emptyStore);
  const [folderPath, setFolderPath] = useState(".");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [history, setHistory] = useState<UploadJob[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [migrationScan, setMigrationScan] =
    useState<ProductMigrationScanResult | null>(null);
  const [migrationSelectedSkus, setMigrationSelectedSkus] = useState<string[]>(
    [],
  );
  const [migrationResults, setMigrationResults] = useState<
    ProductMigrationRunResult[]
  >([]);
  const [migrationProgress, setMigrationProgress] =
    useState<MigrationProgress | null>(null);
  const [migrationDescriptionWorkbook, setMigrationDescriptionWorkbook] =
    useState<File | null>(null);
  const checkpointInputRef = useRef<HTMLInputElement>(null);
  const migrationProgressActive = Boolean(migrationProgress);

  useEffect(() => {
    const saved = window.localStorage.getItem("image-uploader-state");
    if (saved) {
      try {
        setStore(normalizeStoredStore(JSON.parse(saved) as Store));
      } catch {
        window.localStorage.removeItem("image-uploader-state");
      }
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(
        "image-uploader-state",
        JSON.stringify(compactStore(store)),
      );
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? `Could not save browser state: ${nextError.message}`
          : String(nextError),
      );
    }
  }, [hydrated, store]);

  useEffect(() => {
    if (!migrationProgressActive) return;
    const timer = window.setInterval(() => {
      setMigrationProgress((current) =>
        current ? { ...current, now: Date.now() } : current,
      );
    }, 1000);
    return () => window.clearInterval(timer);
  }, [migrationProgressActive]);

  const matchedSelections = useMemo(
    () =>
      store.matches.reduce(
        (total, match) => total + match.selectedProducts.length,
        0,
      ),
    [store.matches],
  );
  const readySelections = useMemo(
    () => activeSelections(store.matches, store.selections),
    [store.matches, store.selections],
  );
  const includedReadySelections = useMemo(
    () => includedSelections(readySelections, store.excludedReviewProductIds),
    [readySelections, store.excludedReviewProductIds],
  );
  const reviewBatchPlan = useMemo(
    () =>
      createReviewBatchPlan(
        includedReadySelections,
        store.completedReviewFolderIds,
        DEFAULT_REVIEW_BATCH_GROUP_SIZE,
      ),
    [includedReadySelections, store.completedReviewFolderIds],
  );
  const migrationBatchPlan = useMemo(
    () =>
      createMigrationBatchPlan(
        migrationSelectedSkus,
        store.completedMigrationBaseSkus,
        DEFAULT_MIGRATION_BATCH_SIZE,
      ),
    [migrationSelectedSkus, store.completedMigrationBaseSkus],
  );
  const mediaManagerProducts = useMemo(
    () => matchedMediaProducts(store.matches),
    [store.matches],
  );
  const pageTitle =
    navItems.find((item) => item.key === page)?.label ?? "Dashboard";
  const includedProductCount = includedReadySelections.reduce(
    (total, selection) => total + selection.products.length,
    0,
  );
  const hasCheckpointState = Boolean(
    store.scan ||
    store.products.length ||
    store.matches.length ||
    store.selections.length ||
    store.completedReviewFolderIds.length ||
    store.completedMigrationBaseSkus.length ||
    store.lastJob,
  );
  const workflowStats = [
    ["Folders", store.scan?.folders.length ?? 0],
    ["Products", store.products.length],
    ["Matched", matchedSelections],
    ["Included", includedProductCount],
  ];
  const primaryAction = {
    dashboard: { href: "/scan", label: "Start scan" },
    scan: { href: "/matching", label: "Match products" },
    matching: { href: "/selector", label: "Select images" },
    media: { href: "/selector", label: "Select images" },
    selector: { href: "/review", label: "Review upload" },
    review: { href: "/history", label: "View history" },
    migration: { href: "/migration", label: "Migration tab" },
    history: { href: "/review", label: "Back to review" },
  }[page];

  async function request<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, init);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Request failed.");
    return payload as T;
  }

  function saveCheckpoint() {
    setError(null);
    setNotice(null);
    try {
      const checkpoint: CheckpointFile = {
        kind: "image-uploader-checkpoint",
        version: 1,
        exportedAt: new Date().toISOString(),
        state: compactStore(store),
      };
      window.localStorage.setItem(
        "image-uploader-state",
        JSON.stringify(checkpoint.state),
      );
      const blob = new Blob([JSON.stringify(checkpoint, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = checkpointFileName();
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setNotice(
        "Checkpoint saved. Keep that JSON file somewhere safe so you can continue later.",
      );
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : String(nextError),
      );
    }
  }

  async function loadCheckpoint(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const payload = JSON.parse(await file.text()) as unknown;
      const restoredStore = normalizeStoredStore(
        checkpointStateFromPayload(payload),
      );
      setStore(restoredStore);
      setFolderPath(restoredStore.scan?.rootPath ?? folderPath);
      setNotice(
        `Checkpoint loaded from ${file.name}. Review your included products before uploading.`,
      );
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? `Could not load checkpoint: ${nextError.message}`
          : String(nextError),
      );
    } finally {
      setBusy(false);
    }
  }

  async function scanFolders() {
    setBusy(true);
    setError(null);
    try {
      const scan = await request<ScanResult>(
        `/api/scan?path=${encodeURIComponent(folderPath)}`,
      );
      setStore((current) => ({
        ...current,
        scan,
        matches: [],
        selections: [],
        excludedReviewProductIds: [],
        completedReviewFolderIds: [],
      }));
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : String(nextError),
      );
    } finally {
      setBusy(false);
    }
  }

  async function fetchProductsAndMatch() {
    setBusy(true);
    setError(null);
    try {
      const scan =
        store.scan ??
        (await request<ScanResult>(
          `/api/scan?path=${encodeURIComponent(folderPath)}`,
        ));
      const productsResponse = await request<{ products: ShopifyProduct[] }>(
        "/api/products",
      );
      const matchResponse = await request<{ matches: ProductMatch[] }>(
        "/api/match",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            folders: scan.folders,
            products: productsResponse.products,
          }),
        },
      );
      setStore((current) => ({
        ...current,
        scan,
        products: productsResponse.products.map((product) =>
          normalizeProduct(product),
        ),
        matches: matchResponse.matches,
        selections: current.scan
          ? current.selections.filter((selection) =>
              matchResponse.matches.some(
                (match) => match.folder.id === selection.folder.id,
              ),
            )
          : [],
        excludedReviewProductIds: keepCurrentExcludedProductIds(
          current.excludedReviewProductIds,
          matchedProductIds(matchResponse.matches),
        ),
        completedReviewFolderIds: pruneCompletedFolderIds(
          current.completedReviewFolderIds,
          activeSelections(matchResponse.matches, current.selections),
        ),
      }));
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : String(nextError),
      );
    } finally {
      setBusy(false);
    }
  }

  async function fetchProductsOnly() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const productsResponse = await request<{ products: ShopifyProduct[] }>(
        "/api/products",
      );
      setStore((current) =>
        storeWithRefreshedProducts(current, productsResponse.products),
      );
      setNotice(
        `${productsResponse.products.length} Shopify product(s) refreshed.`,
      );
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : String(nextError),
      );
    } finally {
      setBusy(false);
    }
  }

  async function scanProductMigrationCandidates() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const formData = new FormData();
      formData.set("intent", "scan");
      if (migrationDescriptionWorkbook)
        formData.set("descriptionWorkbook", migrationDescriptionWorkbook);
      const response = await request<{ scan: ProductMigrationScanResult }>(
        "/api/migrations/products",
        {
          method: "POST",
          body: formData,
        },
      );
      const selectableSkus = response.scan.candidates
        .filter((candidate) => !candidate.existingUnifiedProductId)
        .map((candidate) => candidate.baseSku);
      setMigrationScan(response.scan);
      setMigrationSelectedSkus([]);
      setMigrationResults([]);
      setStore((current) => ({
        ...current,
        completedMigrationBaseSkus: pruneCompletedMigrationSkus(
          current.completedMigrationBaseSkus,
          selectableSkus,
        ),
      }));
      setNotice(
        `${response.scan.candidates.length} eligible regional group(s) found. ${selectableSkus.length} can be selected for migration. ${response.scan.issues.length} duplicate group(s) need manual review.`,
      );
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : String(nextError),
      );
    } finally {
      setBusy(false);
    }
  }

  function setMigrationSkuSelected(baseSku: string, selected: boolean) {
    setMigrationSelectedSkus((current) => {
      const nextSkus = selected
        ? Array.from(new Set([...current, baseSku]))
        : current.filter((item) => item !== baseSku);
      setStore((currentStore) => ({
        ...currentStore,
        completedMigrationBaseSkus: pruneCompletedMigrationSkus(
          currentStore.completedMigrationBaseSkus,
          nextSkus,
        ),
      }));
      return nextSkus;
    });
  }

  function setAllMigrationSkus(selected: boolean) {
    const selectableSkus =
      migrationScan?.candidates
        .filter((candidate) => !candidate.existingUnifiedProductId)
        .map((candidate) => candidate.baseSku) ?? [];
    const nextSkus = selected ? selectableSkus : [];
    setMigrationSelectedSkus(nextSkus);
    setStore((current) => ({
      ...current,
      completedMigrationBaseSkus: pruneCompletedMigrationSkus(
        current.completedMigrationBaseSkus,
        nextSkus,
      ),
    }));
  }

  async function runProductMigrationCandidates() {
    const batchSkus = migrationBatchPlan.currentBatchSkus;
    if (batchSkus.length === 0) {
      setNotice(
        migrationSelectedSkus.length === 0
          ? "No migration SKU is selected."
          : "No migration SKU remains in the current batch.",
      );
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);
    const startedAt = Date.now();
    setMigrationProgress({
      startedAt: Date.now(),
      total: batchSkus.length,
      now: Date.now(),
    });
    try {
      const response = await request<{ results: ProductMigrationRunResult[] }>(
        "/api/migrations/products",
        {
          method: "POST",
          body: migrationRunFormData(
            batchSkus,
            migrationDescriptionWorkbook,
          ),
        },
      );
      setMigrationResults((current) =>
        mergeMigrationResults(current, response.results),
      );
      const completedSkus = response.results
        .filter((result) => result.status !== "failed")
        .map((result) => result.baseSku);
      setStore((current) => ({
        ...current,
        completedMigrationBaseSkus: Array.from(
          new Set([...current.completedMigrationBaseSkus, ...completedSkus]),
        ),
        migrationSecondsPerProduct: response.results.length
          ? Math.max(
              1,
              Math.round(
                (Date.now() - startedAt) / 1000 / response.results.length,
              ),
            )
          : current.migrationSecondsPerProduct,
      }));
      const createdCount = response.results.filter(
        (result) => result.newProductGid,
      ).length;
      const failedCount = response.results.filter(
        (result) => result.status === "failed",
      ).length;
      const skippedCount = response.results.filter(
        (result) => result.status === "skipped",
      ).length;
      const failedErrors = response.results
        .filter((result) => result.status === "failed" && result.error)
        .map((result) => `${result.baseSku}: ${result.error}`);
      setNotice(
        [
          `Batch ${migrationBatchPlan.currentBatchNumber} finished: ${createdCount} active product(s) created. ${failedCount} failed. ${skippedCount} skipped.`,
          ...failedErrors.slice(0, 3),
        ].join(" "),
      );
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : String(nextError),
      );
    } finally {
      setMigrationProgress(null);
      setBusy(false);
    }
  }

  function markMigrationBatchDone(baseSkus: string[]) {
    setStore((current) => ({
      ...current,
      completedMigrationBaseSkus: Array.from(
        new Set([...current.completedMigrationBaseSkus, ...baseSkus]),
      ),
    }));
    setNotice(`${baseSkus.length} migration SKU(s) marked complete.`);
  }

  function resetMigrationBatchProgress() {
    setStore((current) => ({ ...current, completedMigrationBaseSkus: [] }));
    setNotice("Migration batch progress reset. Selected SKUs were not changed.");
  }

  async function deleteSelectedMedia(items: MediaDeleteRequestItem[]) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await request<{ results: MediaDeleteResult[] }>(
        "/api/media/delete",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items }),
        },
      );
      const deletedCount = response.results.reduce(
        (total, result) => total + result.deletedMediaIds.length,
        0,
      );
      const productsResponse = await request<{ products: ShopifyProduct[] }>(
        "/api/products",
      );
      setStore((current) =>
        storeWithRefreshedProducts(current, productsResponse.products),
      );
      setNotice(
        `${deletedCount} media item(s) deleted. Shopify product media was refreshed.`,
      );
      return response.results;
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : String(nextError),
      );
      throw nextError;
    } finally {
      setBusy(false);
    }
  }

  function updateManualMatch(folderId: string, productIds: string[]) {
    setStore((current) => {
      let nextSelectedProducts: ShopifyProduct[] = [];
      const matches = current.matches.map((match) => {
        if (match.folder.id !== folderId) return match;
        const selectedProducts = sortProductsByVariantPrefix(
          productIds
            .map((productId) =>
              current.products.find((item) => item.id === productId),
            )
            .filter((product): product is ShopifyProduct => Boolean(product)),
        );
        nextSelectedProducts = selectedProducts;
        return {
          ...match,
          product: selectedProducts[0] ?? null,
          selectedProducts,
          reason: selectedProducts.length ? "Manually selected." : match.reason,
        };
      });
      const selections = nextSelectedProducts.length
        ? current.selections.map((selection) =>
            selection.folder.id === folderId
              ? { ...selection, products: nextSelectedProducts }
              : selection,
          )
        : current.selections.filter(
            (selection) => selection.folder.id !== folderId,
          );
      return {
        ...current,
        matches,
        selections,
        excludedReviewProductIds: keepCurrentExcludedProductIds(
          current.excludedReviewProductIds,
          matchedProductIds(matches),
        ),
        completedReviewFolderIds: pruneCompletedFolderIds(
          current.completedReviewFolderIds,
          activeSelections(matches, selections),
        ),
      };
    });
  }

  function updateSelection(
    folder: ImageFolder,
    products: ShopifyProduct[],
    imagePaths: string[],
    firstPath: string,
    mode: UploadMode,
    deleteOldMedia: boolean,
  ) {
    const nextSelection: UploadSelection = {
      folder,
      products,
      selectedFirstImagePath: firstPath,
      orderedImagePaths: imagePaths,
      mode,
      deleteOldMedia,
    };
    setStore((current) => ({
      ...current,
      selections: [
        ...current.selections.filter(
          (selection) => selection.folder.id !== folder.id,
        ),
        nextSelection,
      ],
    }));
  }

  function setDeleteOldMediaForAll(deleteOldMedia: boolean) {
    setStore((current) => ({
      ...current,
      selections: activeSelections(current.matches, current.selections).map(
        (selection) => ({
          ...selection,
          deleteOldMedia,
        }),
      ),
    }));
    setNotice(
      deleteOldMedia
        ? "Delete old media after verification is now enabled for all matched image groups."
        : "Delete old media after verification is now off for all matched image groups.",
    );
  }

  async function runUpload(
    dryRun: boolean,
    removeWhiteBackground: boolean,
    selectionsToUpload: UploadSelection[] = includedSelections(
      activeSelections(store.matches, store.selections),
      store.excludedReviewProductIds,
    ),
  ) {
    setBusy(true);
    setError(null);
    const startedAt = Date.now();
    try {
      const response = await request<{ job: UploadJob }>(
        dryRun ? "/api/uploads/dry-run" : "/api/uploads",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            selections: selectionsToUpload,
            options: { removeWhiteBackground },
          }),
        },
      );
      setStore((current) => {
        const nextStore: Store = { ...current, lastJob: response.job };
        if (!dryRun) {
          const successfulFolderIds = successfulFolderIdsForJob(
            response.job,
            selectionsToUpload,
          );
          nextStore.completedReviewFolderIds = Array.from(
            new Set([
              ...current.completedReviewFolderIds,
              ...successfulFolderIds,
            ]),
          );
          if (response.job.products.length > 0) {
            nextStore.uploadSecondsPerProduct = Math.max(
              1,
              Math.round(
                (Date.now() - startedAt) / 1000 / response.job.products.length,
              ),
            );
          }
        }
        return nextStore;
      });
      if (!dryRun) {
        const successfulFolderIds = successfulFolderIdsForJob(
          response.job,
          selectionsToUpload,
        );
        setNotice(
          `${successfulFolderIds.length} image group(s) completed in this batch. Failed groups stay in the queue for retry.`,
        );
      }
      await loadHistory();
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : String(nextError),
      );
    } finally {
      setBusy(false);
    }
  }

  async function loadHistory() {
    const response = await request<{ jobs: UploadJob[] }>("/api/history");
    setHistory(response.jobs);
  }

  function setReviewProductIncluded(productId: string, included: boolean) {
    setStore((current) => {
      const excludedReviewProductIds = included
        ? current.excludedReviewProductIds.filter((id) => id !== productId)
        : Array.from(new Set([...current.excludedReviewProductIds, productId]));
      return { ...current, excludedReviewProductIds };
    });
  }

  function clearReviewProducts(productIds: string[]) {
    setStore((current) => ({
      ...current,
      excludedReviewProductIds: Array.from(
        new Set([...current.excludedReviewProductIds, ...productIds]),
      ),
    }));
  }

  function selectReviewProducts(productIds: string[]) {
    const productIdSet = new Set(productIds);
    setStore((current) => ({
      ...current,
      excludedReviewProductIds: current.excludedReviewProductIds.filter(
        (id) => !productIdSet.has(id),
      ),
    }));
  }

  function markReviewBatchUploaded(folderIds: string[]) {
    setStore((current) => ({
      ...current,
      completedReviewFolderIds: Array.from(
        new Set([...current.completedReviewFolderIds, ...folderIds]),
      ),
    }));
    setNotice(
      `${folderIds.length} image group(s) marked uploaded. The next batch is ready.`,
    );
  }

  function resetReviewBatchProgress() {
    setStore((current) => ({ ...current, completedReviewFolderIds: [] }));
    setNotice("Batch progress reset. Product selections were not changed.");
  }

  useEffect(() => {
    if (page === "history") loadHistory().catch(() => undefined);
  }, [page]);

  return (
    <div className="min-h-screen bg-canvas text-ink transition-colors dark:bg-[#0f1115] dark:text-[#f1f2f3]">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-line bg-surface px-3 py-4 dark:border-white/10 dark:bg-[#171a1f] lg:block">
        <div className="mb-5 flex items-center gap-3 rounded-md border border-line bg-mist px-3 py-3 dark:border-white/10 dark:bg-white/5">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-moss text-white">
            <UploadCloud size={19} />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">Image Uploader</p>
            <p className="truncate text-xs admin-muted">Shopify media ops</p>
          </div>
        </div>
        <nav className="space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = item.key === page;
            return (
              <Link
                key={item.key}
                href={item.href}
                className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition ${
                  active
                    ? "bg-[#e5f3ee] text-moss dark:bg-[#113d31] dark:text-[#8fd6bc]"
                    : "text-subdued hover:bg-mist hover:text-ink dark:text-white/60 dark:hover:bg-white/10 dark:hover:text-white"
                }`}
              >
                <Icon size={18} />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-5 border-t border-line pt-4 dark:border-white/10">
          <ThemeToggle />
        </div>
      </aside>

      <main className="lg:pl-64">
        <header className="sticky top-0 z-30 border-b border-line bg-surface/95 px-4 py-3 backdrop-blur dark:border-white/10 dark:bg-[#171a1f]/95">
          <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold tracking-normal">
                {pageTitle}
              </h1>
              <p className="mt-0.5 text-sm admin-muted">
                Scan, match, select, review, and upload verified Shopify media.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="hidden flex-wrap items-center gap-1 rounded-md border border-line bg-mist p-1 dark:border-white/10 dark:bg-white/5 md:flex">
                {workflowStats.map(([label, value]) => (
                  <div
                    key={label}
                    className="min-w-20 rounded bg-surface px-2.5 py-1.5 text-center text-xs shadow-sm dark:bg-white/10"
                  >
                    <p className="font-semibold">{value}</p>
                    <p className="admin-muted">{label}</p>
                  </div>
                ))}
              </div>
              <ThemeToggle />
              <button
                type="button"
                disabled={!hasCheckpointState}
                onClick={saveCheckpoint}
                className="admin-button hidden sm:inline-flex"
              >
                <Download size={16} />
                Save checkpoint
              </button>
              <button
                type="button"
                onClick={() => checkpointInputRef.current?.click()}
                className="admin-button hidden sm:inline-flex"
              >
                <Upload size={16} />
                Load checkpoint
              </button>
              <input
                ref={checkpointInputRef}
                type="file"
                accept="application/json,.json"
                onChange={loadCheckpoint}
                className="hidden"
              />
              <Link
                href={primaryAction.href}
                className="admin-button-primary hidden sm:inline-flex"
              >
                {primaryAction.label}
              </Link>
            </div>
          </div>
          <div className="mx-auto mt-3 flex max-w-[1500px] gap-2 overflow-x-auto lg:hidden">
            {navItems.map((item) => (
              <Link
                key={item.key}
                href={item.href}
                className={`shrink-0 rounded-md border px-3 py-2 text-xs font-medium ${item.key === page ? "border-moss bg-[#e5f3ee] text-moss dark:border-[#2f8f72] dark:bg-[#113d31] dark:text-[#8fd6bc]" : "border-line bg-white text-subdued dark:border-white/10 dark:bg-white/5 dark:text-white/70"}`}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </header>

        <div className="mx-auto max-w-[1500px] px-4 py-5 sm:px-6">
          {error ? (
            <div className="mb-4 rounded-md border border-clay/40 bg-clay/10 px-4 py-3 text-sm text-clay dark:bg-clay/20 dark:text-[#ffb39d]">
              {error}
            </div>
          ) : null}
          {notice ? (
            <div className="mb-4 rounded-md border border-moss/30 bg-moss/10 px-4 py-3 text-sm text-moss dark:border-[#2f8f72] dark:bg-[#0f3a2f] dark:text-[#8fd6bc]">
              {notice}
            </div>
          ) : null}

          {page === "dashboard" ? (
            <Dashboard
              store={store}
              matchedSelections={matchedSelections}
              readySelectionCount={includedReadySelections.length}
              saveCheckpoint={saveCheckpoint}
              loadCheckpoint={() => checkpointInputRef.current?.click()}
              hasCheckpointState={hasCheckpointState}
            />
          ) : page === "scan" ? (
            <ScanPage
              busy={busy}
              folderPath={folderPath}
              setFolderPath={setFolderPath}
              scanFolders={scanFolders}
              scan={store.scan}
            />
          ) : page === "matching" ? (
            <MatchingPage
              busy={busy}
              store={store}
              fetchProductsAndMatch={fetchProductsAndMatch}
              updateManualMatch={updateManualMatch}
            />
          ) : page === "media" ? (
            <MediaManager
              products={mediaManagerProducts}
              busy={busy}
              fetchProducts={fetchProductsOnly}
              deleteMedia={deleteSelectedMedia}
              emptyTitle="Matched product media"
              emptyDescription={
                store.matches.length > 0
                  ? "No Shopify products are selected in the current local matches."
                  : "Run Product Matching first so Media Manager only shows products tied to your local image folders."
              }
              emptyActionHref="/matching"
              emptyActionLabel="Open Product Matching"
            />
          ) : page === "selector" ? (
            <SelectorPage
              store={store}
              updateSelection={updateSelection}
              onSetDeleteOldMediaForAll={setDeleteOldMediaForAll}
            />
          ) : page === "review" ? (
            <ReviewPage
              busy={busy}
              selections={readySelections}
              includedSelections={includedReadySelections}
              batchPlan={reviewBatchPlan}
              excludedProductIds={store.excludedReviewProductIds}
              lastJob={store.lastJob}
              secondsPerProduct={
                store.uploadSecondsPerProduct ?? FALLBACK_SECONDS_PER_PRODUCT
              }
              runUpload={runUpload}
              onClearAll={clearReviewProducts}
              onSelectAll={selectReviewProducts}
              onToggleProduct={setReviewProductIncluded}
              onSetDeleteOldMediaForAll={setDeleteOldMediaForAll}
              onMarkBatchUploaded={markReviewBatchUploaded}
              onResetBatchProgress={resetReviewBatchProgress}
            />
          ) : page === "migration" ? (
            <MigrationPage
              busy={busy}
              scan={migrationScan}
              selectedSkus={migrationSelectedSkus}
              batchPlan={migrationBatchPlan}
              results={migrationResults}
              progress={migrationProgress}
              secondsPerProduct={
                store.migrationSecondsPerProduct ?? FALLBACK_SECONDS_PER_PRODUCT
              }
              descriptionWorkbook={migrationDescriptionWorkbook}
              onDescriptionWorkbookChange={setMigrationDescriptionWorkbook}
              onScan={scanProductMigrationCandidates}
              onRun={runProductMigrationCandidates}
              onToggleSku={setMigrationSkuSelected}
              onSetAll={setAllMigrationSkus}
              onMarkBatchDone={markMigrationBatchDone}
              onResetBatchProgress={resetMigrationBatchProgress}
            />
          ) : (
            <HistoryPage history={history} refresh={loadHistory} />
          )}
        </div>
      </main>
    </div>
  );
}

function Dashboard({
  store,
  matchedSelections,
  readySelectionCount,
  saveCheckpoint,
  loadCheckpoint,
  hasCheckpointState,
}: {
  store: Store;
  matchedSelections: number;
  readySelectionCount: number;
  saveCheckpoint: () => void;
  loadCheckpoint: () => void;
  hasCheckpointState: boolean;
}) {
  const folderCount = store.scan?.folders.length ?? 0;
  const latestJob = store.lastJob;
  const metrics: [string, number][] = [
    ["Scanned folders", folderCount],
    ["Fetched products", store.products.length],
    ["Selected products", matchedSelections],
    ["Included folders", readySelectionCount],
  ];
  const steps: [string, boolean][] = [
    ["Folder Scan", folderCount > 0],
    ["Product Matching", store.matches.length > 0],
    ["Image Selector", readySelectionCount > 0],
    ["Review Upload", Boolean(latestJob)],
  ];

  return (
    <div className="space-y-4">
      <section className="admin-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Workflow overview</h2>
            <p className="text-sm admin-muted">
              Bulk image media work stays ready for review by default.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/scan" className="admin-button">
              Scan
            </Link>
            <Link href="/matching" className="admin-button">
              Match
            </Link>
            <Link href="/review" className="admin-button-primary">
              Review
            </Link>
          </div>
        </div>
        <div className="mt-4 grid gap-2 md:grid-cols-4">
          {steps.map(([label, done], index) => (
            <div key={String(label)} className="admin-panel px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase admin-muted">
                  Step {index + 1}
                </span>
                <span
                  className={`admin-badge ${done ? "bg-moss/10 text-moss dark:bg-[#0f3a2f] dark:text-[#8fd6bc]" : "bg-mist text-subdued dark:bg-white/10 dark:text-white/55"}`}
                >
                  {done ? "Ready" : "Open"}
                </span>
              </div>
              <p className="mt-2 text-sm font-semibold">{label}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map(([label, value]) => (
          <div key={String(label)} className="admin-card px-4 py-3">
            <p className="text-xs font-semibold uppercase admin-muted">
              {label}
            </p>
            <p className="mt-1 text-2xl font-semibold">{value}</p>
          </div>
        ))}
      </section>

      <section className="admin-card p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-moss dark:text-[#8fd6bc]">
          <CheckCircle2 size={18} />
          Latest upload job
        </div>
        {latestJob ? (
          <div className="mt-3 grid gap-3 text-sm md:grid-cols-4">
            <div>
              <p className="text-xs uppercase admin-muted">Job</p>
              <p className="font-medium">{latestJob.id.slice(0, 8)}</p>
            </div>
            <div>
              <p className="text-xs uppercase admin-muted">Status</p>
              <p className="font-medium capitalize">{latestJob.status}</p>
            </div>
            <div>
              <p className="text-xs uppercase admin-muted">Products</p>
              <p className="font-medium">{latestJob.products.length}</p>
            </div>
            <div>
              <p className="text-xs uppercase admin-muted">Mode</p>
              <p className="font-medium">
                {latestJob.dryRun ? "Dry run" : "Live upload"}
              </p>
            </div>
          </div>
        ) : (
          <p className="mt-2 text-sm admin-muted">
            No upload job has been run yet.
          </p>
        )}
      </section>

      <section className="admin-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Checkpoint backup</h2>
            <p className="text-sm admin-muted">
              Save your review progress to a JSON file and load it back later,
              even after restarting the dev server.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!hasCheckpointState}
              onClick={saveCheckpoint}
              className="admin-button"
            >
              <Download size={16} />
              Save checkpoint
            </button>
            <button
              type="button"
              onClick={loadCheckpoint}
              className="admin-button"
            >
              <Upload size={16} />
              Load checkpoint
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function ScanPage({
  busy,
  folderPath,
  setFolderPath,
  scanFolders,
  scan,
}: {
  busy: boolean;
  folderPath: string;
  setFolderPath: (path: string) => void;
  scanFolders: () => void;
  scan: ScanResult | null;
}) {
  return (
    <div className="space-y-4">
      <section className="admin-card p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-0 flex-1">
            <span className="text-xs font-semibold uppercase admin-muted">
              Local image folder path
            </span>
            <input
              value={folderPath}
              onChange={(event) => setFolderPath(event.target.value)}
              className="admin-input mt-1 w-full"
            />
          </label>
          <button
            disabled={busy}
            onClick={scanFolders}
            className="admin-button-primary"
          >
            <FolderSearch size={17} />
            Scan
          </button>
        </div>
        {scan ? (
          <div className="mt-3 flex flex-wrap gap-2 text-xs admin-muted">
            <span className="admin-badge bg-mist text-subdued dark:bg-white/10 dark:text-white/65">
              {scan.folders.length} folders
            </span>
            <span className="admin-badge bg-mist text-subdued dark:bg-white/10 dark:text-white/65">
              Root: {scan.rootPath}
            </span>
            <span className="admin-badge bg-mist text-subdued dark:bg-white/10 dark:text-white/65">
              {new Date(scan.scannedAt).toLocaleString()}
            </span>
          </div>
        ) : null}
      </section>
      {scan ? (
        <section className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {scan.folders.map((folder) => (
            <div
              key={folder.id}
              className="admin-card flex items-center gap-3 p-3"
            >
              <div className="grid w-24 shrink-0 grid-cols-2 gap-1">
                {folder.images.slice(0, 4).map((image) => (
                  <img
                    key={image.id}
                    src={image.previewUrl}
                    alt={image.name}
                    className="aspect-square rounded object-cover"
                  />
                ))}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{folder.name}</p>
                <p className="truncate text-xs admin-muted">
                  {folder.category ? `${folder.category} - ` : ""}
                  {folder.relativePath}
                </p>
                <p className="mt-1 text-xs admin-muted">
                  {folder.images.length} image(s)
                </p>
              </div>
            </div>
          ))}
        </section>
      ) : null}
    </div>
  );
}

function MatchingPage({
  busy,
  store,
  fetchProductsAndMatch,
  updateManualMatch,
}: {
  busy: boolean;
  store: Store;
  fetchProductsAndMatch: () => void;
  updateManualMatch: (folderId: string, productIds: string[]) => void;
}) {
  return (
    <div className="space-y-4">
      <section className="admin-card flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <h2 className="text-base font-semibold">Product matching</h2>
          <p className="text-sm admin-muted">
            {store.scan?.folders.length ?? 0} scanned folder(s),{" "}
            {store.products.length} Shopify product(s), {store.matches.length}{" "}
            match row(s).
          </p>
        </div>
        <button
          disabled={busy}
          onClick={fetchProductsAndMatch}
          className="admin-button-primary"
        >
          <RefreshCw size={17} />
          Fetch Products And Match
        </button>
      </section>
      <ProductMatchTable
        matches={store.matches}
        products={store.products}
        onManualMatch={updateManualMatch}
      />
    </div>
  );
}

function SelectorPage({
  store,
  updateSelection,
  onSetDeleteOldMediaForAll,
}: {
  store: Store;
  updateSelection: (
    folder: ImageFolder,
    products: ShopifyProduct[],
    imagePaths: string[],
    firstPath: string,
    mode: UploadMode,
    deleteOldMedia: boolean,
  ) => void;
  onSetDeleteOldMediaForAll: (deleteOldMedia: boolean) => void;
}) {
  const matches = store.matches.filter(
    (match) => match.selectedProducts.length > 0,
  );
  return (
    <div className="space-y-4">
      {matches.length > 0 ? (
        <div className="admin-card flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <h2 className="text-base font-semibold">Image selection queue</h2>
            <p className="text-sm admin-muted">
              Defaults are already active for untouched folders.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onSetDeleteOldMediaForAll(true)}
              className="admin-button"
            >
              Select all delete old media
            </button>
            <span className="admin-badge bg-moss/10 text-moss dark:bg-[#0f3a2f] dark:text-[#8fd6bc]">
              {matches.length} folder(s)
            </span>
          </div>
        </div>
      ) : null}
      {matches.map((match, index) => (
        <ImageSelector
          key={match.folder.id}
          match={match}
          position={index + 1}
          total={matches.length}
          existingSelection={store.selections.find(
            (selection) => selection.folder.id === match.folder.id,
          )}
          onChange={updateSelection}
        />
      ))}
      {matches.length === 0 ? (
        <p className="admin-card p-5 text-sm admin-muted">
          No matched products yet.
        </p>
      ) : null}
    </div>
  );
}

function ReviewPage({
  busy,
  selections,
  includedSelections,
  batchPlan,
  excludedProductIds,
  lastJob,
  secondsPerProduct,
  runUpload,
  onClearAll,
  onSelectAll,
  onToggleProduct,
  onSetDeleteOldMediaForAll,
  onMarkBatchUploaded,
  onResetBatchProgress,
}: {
  busy: boolean;
  selections: UploadSelection[];
  includedSelections: UploadSelection[];
  batchPlan: ReviewBatchPlan;
  excludedProductIds: string[];
  lastJob: UploadJob | null;
  secondsPerProduct: number;
  runUpload: (
    dryRun: boolean,
    removeWhiteBackground: boolean,
    selectionsToUpload?: UploadSelection[],
  ) => void;
  onClearAll: (productIds: string[]) => void;
  onSelectAll: (productIds: string[]) => void;
  onToggleProduct: (productId: string, included: boolean) => void;
  onSetDeleteOldMediaForAll: (deleteOldMedia: boolean) => void;
  onMarkBatchUploaded: (folderIds: string[]) => void;
  onResetBatchProgress: () => void;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [removeWhiteBackground, setRemoveWhiteBackground] = useState(false);
  const excludedProductIdSet = new Set(excludedProductIds);
  const allReviewProductIds = selections.flatMap((selection) =>
    selection.products.map((product) => product.id),
  );
  const includedProductCount = includedSelections.reduce(
    (total, selection) => total + selection.products.length,
    0,
  );
  const currentBatchFolderIds = batchPlan.currentBatchSelections.map(
    (selection) => selection.folder.id,
  );
  const currentBatchEstimate = formatDuration(
    batchPlan.currentProductCount * secondsPerProduct,
  );
  const remainingEstimate = formatDuration(
    batchPlan.remainingProductCount * secondsPerProduct,
  );
  return (
    <div className="space-y-4">
      <ReviewUploadModal
        open={modalOpen}
        disabled={busy || batchPlan.currentBatchSelections.length === 0}
        onClose={() => setModalOpen(false)}
        onDryRun={() =>
          runUpload(
            true,
            removeWhiteBackground,
            batchPlan.currentBatchSelections,
          )
        }
        onUpload={() =>
          runUpload(
            false,
            removeWhiteBackground,
            batchPlan.currentBatchSelections,
          )
        }
      />
      <section className="admin-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Review and confirm</h2>
            <p className="text-sm admin-muted">
              {includedProductCount} of {allReviewProductIds.length} product(s)
              included
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              disabled={busy || allReviewProductIds.length === 0}
              onClick={() => onClearAll(allReviewProductIds)}
              className="admin-button"
            >
              Clear all
            </button>
            <button
              disabled={
                busy ||
                allReviewProductIds.length === 0 ||
                includedProductCount === allReviewProductIds.length
              }
              onClick={() => onSelectAll(allReviewProductIds)}
              className="admin-button"
            >
              Select all
            </button>
            <button
              disabled={busy || selections.length === 0}
              onClick={() => onSetDeleteOldMediaForAll(true)}
              className="admin-button"
            >
              Select all delete old media
            </button>
            <button
              disabled={busy || batchPlan.currentBatchSelections.length === 0}
              onClick={() =>
                runUpload(
                  true,
                  removeWhiteBackground,
                  batchPlan.currentBatchSelections,
                )
              }
              className="admin-button"
            >
              Dry run current batch
            </button>
            <button
              disabled={busy || batchPlan.currentBatchSelections.length === 0}
              onClick={() => setModalOpen(true)}
              className="admin-button-danger"
            >
              <UploadCloud size={17} />
              Upload current batch
            </button>
          </div>
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-4">
          <div className="admin-panel px-3 py-2">
            <p className="text-xs font-semibold uppercase admin-muted">
              Current batch
            </p>
            <p className="mt-1 text-sm font-semibold">
              Batch {batchPlan.currentBatchNumber} of{" "}
              {batchPlan.totalBatchCount || 0}
            </p>
            <p className="text-xs admin-muted">
              {batchPlan.currentGroupCount} groups /{" "}
              {batchPlan.currentProductCount} products
            </p>
          </div>
          <div className="admin-panel px-3 py-2">
            <p className="text-xs font-semibold uppercase admin-muted">
              Remaining
            </p>
            <p className="mt-1 text-sm font-semibold">
              {batchPlan.remainingGroupCount} groups /{" "}
              {batchPlan.remainingProductCount} products
            </p>
            <p className="text-xs admin-muted">
              {batchPlan.uploadedGroupCount} groups uploaded
            </p>
          </div>
          <div className="admin-panel px-3 py-2">
            <p className="text-xs font-semibold uppercase admin-muted">
              Estimated current
            </p>
            <p className="mt-1 text-sm font-semibold">{currentBatchEstimate}</p>
            <p className="text-xs admin-muted">
              {secondsPerProduct}s/product estimate
            </p>
          </div>
          <div className="admin-panel px-3 py-2">
            <p className="text-xs font-semibold uppercase admin-muted">
              Estimated remaining
            </p>
            <p className="mt-1 text-sm font-semibold">{remainingEstimate}</p>
            <p className="text-xs admin-muted">Based on checked products</p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            disabled={busy || currentBatchFolderIds.length === 0}
            onClick={() => onMarkBatchUploaded(currentBatchFolderIds)}
            className="admin-button"
          >
            Mark batch uploaded
          </button>
          <button
            disabled={busy || currentBatchFolderIds.length === 0}
            onClick={() => onMarkBatchUploaded(currentBatchFolderIds)}
            className="admin-button-primary"
          >
            Next batch
          </button>
          <button
            disabled={busy || batchPlan.uploadedGroupCount === 0}
            onClick={onResetBatchProgress}
            className="admin-button"
          >
            Reset batch progress
          </button>
        </div>
        <label className="mt-3 flex items-start gap-3 rounded-md border border-line bg-mist px-3 py-2 text-sm dark:border-white/10 dark:bg-white/5">
          <input
            type="checkbox"
            checked={removeWhiteBackground}
            onChange={(event) => setRemoveWhiteBackground(event.target.checked)}
            className="mt-1 h-4 w-4 rounded border-line text-moss dark:border-white/20 dark:bg-[#0f1115]"
          />
          <span>
            <span className="block font-medium">Remove white background</span>
            <span className="mt-0.5 block admin-muted">
              Upload transparent PNG versions to Shopify while keeping local
              files unchanged.
            </span>
          </span>
        </label>
      </section>
      {batchPlan.uploadedSelections.length ||
      batchPlan.waitingSelections.length ? (
        <section className="admin-card p-4">
          <div className="flex flex-wrap gap-2 text-xs">
            <span className={batchStatusClass("current")}>
              Current batch: {batchPlan.currentGroupCount}
            </span>
            <span className={batchStatusClass("waiting")}>
              Waiting: {batchPlan.waitingSelections.length}
            </span>
            <span className={batchStatusClass("uploaded")}>
              Uploaded: {batchPlan.uploadedSelections.length}
            </span>
          </div>
        </section>
      ) : null}
      <div className="grid gap-4">
        {batchPlan.currentBatchSelections.map((selection) => {
          const batchStatus = batchStatusForSelection(selection, batchPlan);
          return (
            <div key={selection.folder.id} className="admin-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{selection.folder.name}</p>
                  <p className="text-sm admin-muted">
                    {selection.folder.relativePath}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className={batchStatusClass(batchStatus)}>
                    {batchStatusLabel(batchStatus)}
                  </span>
                  <span className="admin-badge bg-mist text-subdued dark:bg-white/10 dark:text-white/65">
                    {modeLabel(selection.mode)}
                  </span>
                  {selection.deleteOldMedia ? (
                    <span className="admin-badge bg-clay/10 text-clay dark:bg-clay/20 dark:text-[#ffb39d]">
                      Delete after verification
                    </span>
                  ) : (
                    <span className="admin-badge bg-mist text-subdued dark:bg-white/10 dark:text-white/65">
                      Keep old media
                    </span>
                  )}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {selection.products.map((product) => (
                  <label
                    key={product.id}
                    className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs ${excludedProductIdSet.has(product.id) ? "border-line text-subdued dark:border-white/10 dark:text-white/45" : "border-moss/30 bg-moss/5 text-ink dark:border-[#2f8f72] dark:bg-[#0f3a2f] dark:text-[#c9f0df]"}`}
                  >
                    <input
                      type="checkbox"
                      checked={!excludedProductIdSet.has(product.id)}
                      onChange={(event) =>
                        onToggleProduct(product.id, event.target.checked)
                      }
                      className="h-3.5 w-3.5 rounded border-line text-moss dark:border-white/20 dark:bg-[#0f1115]"
                    />
                    {product.title}
                  </label>
                ))}
              </div>
              <div className="mt-3 grid gap-4 lg:grid-cols-[190px_1fr]">
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase admin-muted">
                    Old first image
                  </p>
                  {selection.products[0]?.firstImageUrl ? (
                    <img
                      src={selection.products[0].firstImageUrl}
                      alt=""
                      className="aspect-square rounded-md border border-line object-cover dark:border-white/10"
                    />
                  ) : (
                    <div className="aspect-square rounded-md border border-line bg-mist dark:border-white/10 dark:bg-white/10" />
                  )}
                </div>
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase admin-muted">
                    Local upload order
                  </p>
                  <div className="grid grid-cols-5 gap-2 sm:grid-cols-8 lg:grid-cols-10 xl:grid-cols-12">
                    {selection.orderedImagePaths.map((imagePath) => {
                      const image = selection.folder.images.find(
                        (item) => item.absolutePath === imagePath,
                      );
                      return image ? (
                        <img
                          key={imagePath}
                          src={image.previewUrl}
                          alt={image.name}
                          className={`aspect-square rounded-md border border-line object-cover dark:border-white/10 ${imagePath === selection.selectedFirstImagePath ? "ring-2 ring-clay" : ""}`}
                        />
                      ) : null;
                    })}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {batchPlan.currentBatchSelections.length === 0 ? (
        <p className="admin-card p-5 text-sm admin-muted">
          All included image groups are marked uploaded. Reset batch progress if
          you need to run them again.
        </p>
      ) : null}
      {lastJob ? <UploadProgress job={lastJob} /> : null}
    </div>
  );
}

function MigrationPage({
  busy,
  scan,
  selectedSkus,
  batchPlan,
  results,
  progress,
  secondsPerProduct,
  descriptionWorkbook,
  onDescriptionWorkbookChange,
  onScan,
  onRun,
  onToggleSku,
  onSetAll,
  onMarkBatchDone,
  onResetBatchProgress,
}: {
  busy: boolean;
  scan: ProductMigrationScanResult | null;
  selectedSkus: string[];
  batchPlan: MigrationBatchPlan;
  results: ProductMigrationRunResult[];
  progress: MigrationProgress | null;
  secondsPerProduct: number;
  descriptionWorkbook: File | null;
  onDescriptionWorkbookChange: (file: File | null) => void;
  onScan: () => void;
  onRun: () => void;
  onToggleSku: (baseSku: string, selected: boolean) => void;
  onSetAll: (selected: boolean) => void;
  onMarkBatchDone: (baseSkus: string[]) => void;
  onResetBatchProgress: () => void;
}) {
  const selectableCandidates =
    scan?.candidates.filter(
      (candidate) => !candidate.existingUnifiedProductId,
    ) ?? [];
  const selectedSet = new Set(selectedSkus);
  const selectedCount = selectableCandidates.filter((candidate) =>
    selectedSet.has(candidate.baseSku),
  ).length;
  const allSelected =
    selectableCandidates.length > 0 &&
    selectedCount === selectableCandidates.length;
  const currentBatchEstimate = formatDuration(
    batchPlan.currentSkuCount * secondsPerProduct,
  );
  const remainingEstimate = formatDuration(
    batchPlan.remainingSkuCount * secondsPerProduct,
  );
  const progressElapsedSeconds = progress
    ? Math.max(0, Math.floor((progress.now - progress.startedAt) / 1000))
    : 0;
  const progressEstimatedSeconds = progress
    ? Math.max(30, progress.total * FALLBACK_SECONDS_PER_PRODUCT)
    : 0;
  const progressPercent = progress
    ? Math.min(
        95,
        Math.max(
          5,
          Math.round(
            (progressElapsedSeconds / progressEstimatedSeconds) * 100,
          ),
        ),
      )
    : 0;

  return (
    <div className="space-y-4">
      <section className="admin-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">
              Regional product consolidation
            </h2>
            <p className="text-sm admin-muted">
              {scan
                ? `${scan.candidates.length} eligible group(s), ${scan.issues.length} duplicate issue(s), scanned ${new Date(scan.scannedAt).toLocaleString()}`
                : "No migration scan loaded."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <label className="admin-button cursor-pointer">
              <Upload size={17} />
              {descriptionWorkbook ? "Change file" : "Upload file"}
              <input
                type="file"
                accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                className="sr-only"
                disabled={busy}
                onChange={(event) =>
                  onDescriptionWorkbookChange(event.target.files?.[0] ?? null)
                }
              />
            </label>
            <button
              type="button"
              disabled={busy}
              onClick={onScan}
              className="admin-button"
            >
              <RefreshCw size={17} />
              Find regional sets
            </button>
            <button
              type="button"
              disabled={busy || batchPlan.currentBatchSkus.length === 0}
              onClick={onRun}
              className="admin-button-primary"
            >
              <PackagePlus size={17} />
              Create current batch
            </button>
          </div>
        </div>
        {descriptionWorkbook ? (
          <p className="mt-3 text-xs admin-muted">
            Description file: {descriptionWorkbook.name}
          </p>
        ) : (
          <p className="mt-3 text-xs admin-muted">
            Upload an Excel workbook or CSV to populate descriptions and filter
            metafields from Item Code matches.
          </p>
        )}
        {scan ? (
          <div className="mt-3 grid gap-2 md:grid-cols-4">
            <MetricPanel
              label="Eligible groups"
              value={scan.candidates.length}
            />
            <MetricPanel
              label="Selectable"
              value={selectableCandidates.length}
            />
            <MetricPanel label="Selected" value={selectedCount} />
            <MetricPanel
              label="Manual review"
              value={
                scan.issues.length +
                scan.candidates.filter(
                  (candidate) => candidate.manualReviewFields.length > 0,
                ).length
              }
            />
          </div>
        ) : null}
        {scan ? (
          <div className="mt-3 grid gap-2 md:grid-cols-4">
            <div className="admin-panel px-3 py-2">
              <p className="text-xs font-semibold uppercase admin-muted">
                Current batch
              </p>
              <p className="mt-1 text-sm font-semibold">
                Batch {batchPlan.currentBatchNumber} of{" "}
                {batchPlan.totalBatchCount || 0}
              </p>
              <p className="text-xs admin-muted">
                {batchPlan.currentSkuCount} SKU(s)
              </p>
            </div>
            <div className="admin-panel px-3 py-2">
              <p className="text-xs font-semibold uppercase admin-muted">
                Remaining
              </p>
              <p className="mt-1 text-sm font-semibold">
                {batchPlan.remainingSkuCount} SKU(s)
              </p>
              <p className="text-xs admin-muted">
                {batchPlan.uploadedSkuCount} SKU(s) complete
              </p>
            </div>
            <div className="admin-panel px-3 py-2">
              <p className="text-xs font-semibold uppercase admin-muted">
                Estimated current
              </p>
              <p className="mt-1 text-sm font-semibold">
                {currentBatchEstimate}
              </p>
              <p className="text-xs admin-muted">
                {secondsPerProduct}s/SKU estimate
              </p>
            </div>
            <div className="admin-panel px-3 py-2">
              <p className="text-xs font-semibold uppercase admin-muted">
                Estimated remaining
              </p>
              <p className="mt-1 text-sm font-semibold">
                {remainingEstimate}
              </p>
              <p className="text-xs admin-muted">Based on selected SKUs</p>
            </div>
          </div>
        ) : null}
        {scan ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || batchPlan.currentBatchSkus.length === 0}
              onClick={() => onMarkBatchDone(batchPlan.currentBatchSkus)}
              className="admin-button-primary"
            >
              Next batch
            </button>
            <button
              type="button"
              disabled={busy || batchPlan.currentBatchSkus.length === 0}
              onClick={() => onMarkBatchDone(batchPlan.currentBatchSkus)}
              className="admin-button"
            >
              Mark current batch done
            </button>
            <button
              type="button"
              disabled={busy || batchPlan.uploadedSkuCount === 0}
              onClick={onResetBatchProgress}
              className="admin-button"
            >
              Reset migration progress
            </button>
          </div>
        ) : null}
      </section>

      {progress ? (
        <section className="admin-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">
                Migration in progress
              </h2>
              <p className="text-sm admin-muted">
                Processing {progress.total} selected SKU(s). Shopify returns
                exact per-product results when the batch finishes.
              </p>
            </div>
            <div className="text-right text-xs admin-muted">
              <p>Elapsed {formatClockDuration(progressElapsedSeconds)}</p>
              <p>Estimate {formatDuration(progressEstimatedSeconds)}</p>
            </div>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-mist dark:bg-white/10">
            <div
              className="h-full rounded-full bg-ink transition-all duration-500 dark:bg-white"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </section>
      ) : null}

      {scan ? (
        <section className="admin-card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4 dark:border-white/10">
            <div>
              <h2 className="text-base font-semibold">Eligible product sets</h2>
              <p className="text-sm admin-muted">
                {selectedCount} of {selectableCandidates.length} selectable
                SKU(s) checked. Current batch has{" "}
                {batchPlan.currentSkuCount} SKU(s).
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={
                  busy || selectableCandidates.length === 0 || allSelected
                }
                onClick={() => onSetAll(true)}
                className="admin-button"
              >
                Select all
              </button>
              <button
                type="button"
                disabled={busy || selectedCount === 0}
                onClick={() => onSetAll(false)}
                className="admin-button"
              >
                Clear
              </button>
            </div>
          </div>
          {scan.candidates.length ? (
            <div className="overflow-x-auto">
              <table className="admin-table">
                <thead className="admin-table-head">
                  <tr>
                    <th className="w-12 px-3 py-2">Run</th>
                    <th className="px-3 py-2">SKU</th>
                    <th className="px-3 py-2">Regional inventory</th>
                    <th className="px-3 py-2">Price</th>
                    <th className="px-3 py-2">Images</th>
                    <th className="px-3 py-2">Metafields</th>
                    <th className="px-3 py-2">Workbook</th>
                    <th className="px-3 py-2">Review</th>
                  </tr>
                </thead>
                <tbody>
                  {scan.candidates.map((candidate) => (
                    <MigrationCandidateRow
                      key={candidate.baseSku}
                      candidate={candidate}
                      selected={selectedSet.has(candidate.baseSku)}
                      batchStatus={migrationCandidateBatchStatus(
                        candidate.baseSku,
                        batchPlan,
                      )}
                      busy={busy}
                      onToggle={onToggleSku}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="p-5 text-sm admin-muted">
              No eligible regional products were found.
            </p>
          )}
        </section>
      ) : null}

      {scan?.issues.length ? (
        <section className="admin-card overflow-hidden">
          <div className="border-b border-line p-4 dark:border-white/10">
            <h2 className="text-base font-semibold">
              Duplicate sets
            </h2>
            <p className="text-sm admin-muted">
              {scan.issues.length} SKU group(s)
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="admin-table">
              <thead className="admin-table-head">
                <tr>
                  <th className="px-3 py-2">SKU</th>
                  <th className="px-3 py-2">Reason</th>
                  <th className="px-3 py-2">Products found</th>
                </tr>
              </thead>
              <tbody>
                {scan.issues.map((issue) => (
                  <tr key={issue.baseSku} className="admin-table-row align-top">
                    <td className="px-3 py-3 font-mono text-xs">
                      {issue.baseSku}
                    </td>
                    <td className="px-3 py-3 text-sm">{issue.reason}</td>
                    <td className="px-3 py-3 text-xs admin-muted">
                      {issue.products
                        .map(
                          (product) =>
                            `${product.prefix}: ${product.sourceTitle}`,
                        )
                        .join(" | ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {results.length ? (
        <section className="admin-card overflow-hidden">
          <div className="border-b border-line p-4 dark:border-white/10">
            <h2 className="text-base font-semibold">Migration results</h2>
            <p className="text-sm admin-muted">
              {results.length} processed SKU(s)
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="admin-table">
              <thead className="admin-table-head">
                <tr>
                  <th className="px-3 py-2">SKU</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">New product GID</th>
                  <th className="px-3 py-2">Inventory set</th>
                  <th className="px-3 py-2">Images</th>
                  <th className="px-3 py-2">Manual review</th>
                </tr>
              </thead>
              <tbody>
                {results.map((result) => (
                  <tr
                    key={result.baseSku}
                    className="admin-table-row align-top"
                  >
                    <td className="px-3 py-3 font-mono text-xs">
                      {result.baseSku}
                    </td>
                    <td className="px-3 py-3">
                      <span className={migrationStatusClass(result.status)}>
                        {result.status}
                      </span>
                      {result.error ? (
                        <p className="mt-1 max-w-md text-xs text-clay dark:text-[#ffb39d]">
                          {result.error}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 font-mono text-xs">
                      {result.newProductGid ?? "-"}
                    </td>
                    <td className="px-3 py-3 text-xs">
                      <div className="grid gap-1">
                        {result.inventorySet.map((item) => (
                          <span key={item.locationName}>
                            {item.locationName}: {item.quantity}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-sm">
                      {result.imagesAttached}
                    </td>
                    <td className="px-3 py-3 text-xs admin-muted">
                      {result.missingFields.length
                        ? result.missingFields.join(", ")
                        : "None"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {!scan ? (
        <p className="admin-card p-5 text-sm admin-muted">
          Run a migration scan to load regional product sets.
        </p>
      ) : null}
    </div>
  );
}

function MetricPanel({ label, value }: { label: string; value: number }) {
  return (
    <div className="admin-panel px-3 py-2">
      <p className="text-xs font-semibold uppercase admin-muted">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}

function MigrationCandidateRow({
  candidate,
  selected,
  batchStatus,
  busy,
  onToggle,
}: {
  candidate: ProductMigrationCandidate;
  selected: boolean;
  batchStatus: MigrationCandidateBatchStatus;
  busy: boolean;
  onToggle: (baseSku: string, selected: boolean) => void;
}) {
  const disabled = busy || Boolean(candidate.existingUnifiedProductId);
  const migrationMetafieldCount = 17;
  const populatedMetafields =
    migrationMetafieldCount - candidate.missingFields.length;

  return (
    <tr className="admin-table-row align-top">
      <td className="px-3 py-3">
        <input
          type="checkbox"
          checked={selected}
          disabled={disabled}
          onChange={(event) =>
            onToggle(candidate.baseSku, event.target.checked)
          }
          className="h-4 w-4 rounded border-line text-moss dark:border-white/20 dark:bg-[#0f1115]"
          aria-label={`Select ${candidate.baseSku}`}
        />
      </td>
      <td className="px-3 py-3">
        <p className="font-mono text-xs font-semibold">{candidate.baseSku}</p>
        <p className="mt-1 max-w-[220px] truncate text-xs admin-muted">
          {candidate.productType || "No product type"}
        </p>
        {candidate.existingUnifiedProductId ? (
          <p className="mt-1 text-xs text-clay dark:text-[#ffb39d]">
            Existing unified product
          </p>
        ) : null}
        <span className={migrationBatchStatusClass(batchStatus)}>
          {migrationBatchStatusLabel(batchStatus)}
        </span>
      </td>
      <td className="px-3 py-3 text-xs">
        <div className="grid gap-1">
          {candidate.regionalProducts.map((product) => (
            <span key={product.prefix} className="whitespace-nowrap">
              <span className="font-semibold">{product.prefix}</span>{" "}
              {product.locationName}: {product.quantity}
            </span>
          ))}
        </div>
      </td>
      <td className="px-3 py-3 font-mono text-xs">{candidate.price}</td>
      <td className="px-3 py-3 text-sm">{candidate.imageUrls.length}</td>
      <td className="px-3 py-3">
        <span
          className={
            candidate.missingFields.length
              ? "admin-badge bg-clay/10 text-clay dark:bg-clay/20 dark:text-[#ffb39d]"
              : "admin-badge bg-moss/10 text-moss dark:bg-[#0f3a2f] dark:text-[#8fd6bc]"
          }
        >
          {populatedMetafields}/{migrationMetafieldCount}
        </span>
        {candidate.missingFields.length ? (
          <p className="mt-1 max-w-sm text-xs admin-muted">
            {candidate.missingFields.join(", ")}
          </p>
        ) : null}
      </td>
      <td className="px-3 py-3">
        <span
          className={migrationDescriptionDataClass(
            candidate.descriptionDataStatus,
          )}
        >
          {migrationDescriptionDataLabel(candidate.descriptionDataStatus)}
        </span>
        {candidate.descriptionDataSource ? (
          <p className="mt-1 max-w-[220px] truncate text-xs admin-muted">
            {candidate.descriptionDataSource.itemCode}
            {candidate.descriptionDataSource.size
              ? ` | ${candidate.descriptionDataSource.size}`
              : ""}
          </p>
        ) : null}
        {candidate.descriptionDataWarnings.length ? (
          <p className="mt-1 max-w-sm text-xs admin-muted">
            {candidate.descriptionDataWarnings.join(", ")}
          </p>
        ) : null}
      </td>
      <td className="px-3 py-3">
        {candidate.manualReviewFields.length ? (
          <div className="flex max-w-sm flex-wrap gap-1">
            {candidate.manualReviewFields.map((field) => (
              <span
                key={field}
                className="admin-badge bg-mist text-subdued dark:bg-white/10 dark:text-white/65"
              >
                {field}
              </span>
            ))}
          </div>
        ) : (
          <span className="admin-badge bg-moss/10 text-moss dark:bg-[#0f3a2f] dark:text-[#8fd6bc]">
            Ready
          </span>
        )}
      </td>
    </tr>
  );
}

function migrationStatusClass(status: ProductMigrationRunResult["status"]) {
  if (status === "success")
    return "admin-badge bg-moss/10 text-moss dark:bg-[#0f3a2f] dark:text-[#8fd6bc]";
  if (status === "skipped")
    return "admin-badge bg-mist text-subdued dark:bg-white/10 dark:text-white/65";
  return "admin-badge bg-clay/10 text-clay dark:bg-clay/20 dark:text-[#ffb39d]";
}

type MigrationCandidateBatchStatus =
  | "complete"
  | "current"
  | "waiting"
  | "not_selected";

function migrationCandidateBatchStatus(
  baseSku: string,
  plan: MigrationBatchPlan,
): MigrationCandidateBatchStatus {
  if (plan.uploadedSkus.includes(baseSku)) return "complete";
  if (plan.currentBatchSkus.includes(baseSku)) return "current";
  if (plan.waitingSkus.includes(baseSku)) return "waiting";
  return "not_selected";
}

function migrationBatchStatusLabel(status: MigrationCandidateBatchStatus) {
  if (status === "complete") return "Complete";
  if (status === "current") return "Current batch";
  if (status === "waiting") return "Waiting";
  return "Not selected";
}

function migrationBatchStatusClass(status: MigrationCandidateBatchStatus) {
  if (status === "complete")
    return "admin-badge mt-2 bg-moss/10 text-moss dark:bg-[#0f3a2f] dark:text-[#8fd6bc]";
  if (status === "current")
    return "admin-badge mt-2 bg-blue-100 text-blue-800 dark:bg-blue-300/20 dark:text-blue-200";
  if (status === "waiting")
    return "admin-badge mt-2 bg-mist text-subdued dark:bg-white/10 dark:text-white/65";
  return "admin-badge mt-2 bg-line text-subdued dark:bg-white/5 dark:text-white/45";
}

function mergeMigrationResults(
  current: ProductMigrationRunResult[],
  next: ProductMigrationRunResult[],
) {
  const resultsBySku = new Map(
    current.map((result) => [result.baseSku.toUpperCase(), result]),
  );
  for (const result of next) {
    resultsBySku.set(result.baseSku.toUpperCase(), result);
  }
  return Array.from(resultsBySku.values()).sort((first, second) =>
    first.baseSku.localeCompare(second.baseSku),
  );
}

function migrationDescriptionDataLabel(
  status: ProductMigrationCandidate["descriptionDataStatus"],
) {
  if (status === "matched") return "Matched";
  if (status === "warning") return "Warning";
  if (status === "missing") return "Missing";
  return "Not uploaded";
}

function migrationDescriptionDataClass(
  status: ProductMigrationCandidate["descriptionDataStatus"],
) {
  if (status === "matched")
    return "admin-badge bg-moss/10 text-moss dark:bg-[#0f3a2f] dark:text-[#8fd6bc]";
  if (status === "warning")
    return "admin-badge bg-amber-100 text-amber-800 dark:bg-amber-300/20 dark:text-amber-200";
  if (status === "missing")
    return "admin-badge bg-clay/10 text-clay dark:bg-clay/20 dark:text-[#ffb39d]";
  return "admin-badge bg-mist text-subdued dark:bg-white/10 dark:text-white/65";
}

function HistoryPage({
  history,
  refresh,
}: {
  history: UploadJob[];
  refresh: () => void;
}) {
  return (
    <div className="space-y-4">
      <section className="admin-card flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <h2 className="text-base font-semibold">Upload history</h2>
          <p className="text-sm admin-muted">{history.length} saved job(s)</p>
        </div>
        <button onClick={refresh} className="admin-button">
          <RefreshCw size={17} />
          Refresh
        </button>
      </section>
      {history.map((job) => (
        <UploadProgress key={job.id} job={job} />
      ))}
      {history.length === 0 ? (
        <p className="admin-card p-5 text-sm admin-muted">
          No upload jobs logged yet.
        </p>
      ) : null}
    </div>
  );
}

function modeLabel(mode: UploadMode) {
  if (mode === "replace-first") return "Replace first only";
  if (mode === "replace-gallery") return "Replace full gallery";
  return "Replace first + upload all";
}

function formatDuration(totalSeconds: number) {
  if (totalSeconds <= 0) return "~0m";
  const minutes = Math.max(1, Math.round(totalSeconds / 60));
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours === 0) return `~${remainingMinutes}m`;
  if (remainingMinutes === 0) return `~${hours}h`;
  return `~${hours}h ${remainingMinutes}m`;
}

function formatClockDuration(totalSeconds: number) {
  const minutes = Math.floor(Math.max(0, totalSeconds) / 60);
  const seconds = Math.max(0, totalSeconds) % 60;
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

function batchStatusLabel(status: "uploaded" | "current" | "waiting") {
  if (status === "uploaded") return "Uploaded";
  if (status === "waiting") return "Waiting";
  return "Current batch";
}

function batchStatusClass(status: "uploaded" | "current" | "waiting") {
  if (status === "uploaded")
    return "admin-badge bg-moss/10 text-moss dark:bg-[#0f3a2f] dark:text-[#8fd6bc]";
  if (status === "waiting")
    return "admin-badge bg-mist text-subdued dark:bg-white/10 dark:text-white/65";
  return "admin-badge bg-blue-100 text-blue-800 dark:bg-blue-300/20 dark:text-blue-200";
}
