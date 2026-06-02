"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, FolderSearch, History, Images, LayoutDashboard, RefreshCw, Shuffle, UploadCloud } from "lucide-react";
import ImageSelector from "@/components/ImageSelector";
import ProductMatchTable from "@/components/ProductMatchTable";
import ReviewUploadModal from "@/components/ReviewUploadModal";
import ThemeToggle from "@/components/ThemeToggle";
import UploadProgress from "@/components/UploadProgress";
import type { ProductMatch, ScanResult, ShopifyProduct, TileFolder, UploadJob, UploadMode, UploadSelection } from "@/types";

type PageKey = "dashboard" | "scan" | "matching" | "selector" | "review" | "history";

const navItems: { key: PageKey; href: string; label: string; icon: React.ElementType }[] = [
  { key: "dashboard", href: "/", label: "Dashboard", icon: LayoutDashboard },
  { key: "scan", href: "/scan", label: "Folder Scan", icon: FolderSearch },
  { key: "matching", href: "/matching", label: "Product Matching", icon: Shuffle },
  { key: "selector", href: "/selector", label: "Image Selector", icon: Images },
  { key: "review", href: "/review", label: "Review Upload", icon: UploadCloud },
  { key: "history", href: "/history", label: "History", icon: History }
];

type Store = {
  scan: ScanResult | null;
  products: ShopifyProduct[];
  matches: ProductMatch[];
  selections: UploadSelection[];
  lastJob: UploadJob | null;
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
  lastJob: UploadJob | null;
};

const emptyStore: Store = { scan: null, products: [], matches: [], selections: [], lastJob: null };

function normalizeProduct(product: ShopifyProduct): ShopifyProduct {
  return {
    ...product,
    mediaImageUrls: product.mediaImageUrls?.length ? product.mediaImageUrls : product.firstImageUrl ? [product.firstImageUrl] : []
  };
}

function compactStore(store: Store): PersistedStore {
  return {
    scan: store.scan,
    products: store.products,
    matches: store.matches.map((match) => ({
      folderId: match.folder.id,
      confidence: match.confidence,
      productId: match.product?.id ?? null,
      candidateIds: match.candidates.map((product) => product.id),
      selectedProductIds: match.selectedProducts.map((product) => product.id),
      reason: match.reason
    })),
    selections: store.selections.map((selection) => ({
      folderId: selection.folder.id,
      productIds: selection.products.map((product) => product.id),
      selectedFirstImagePath: selection.selectedFirstImagePath,
      orderedImagePaths: selection.orderedImagePaths,
      mode: selection.mode,
      deleteOldMedia: selection.deleteOldMedia
    })),
    lastJob: store.lastJob
  };
}

function normalizeStoredStore(saved: Partial<Store> | Partial<PersistedStore>): Store {
  const scan = saved.scan ?? null;
  const products = (saved.products ?? []).map((product) => normalizeProduct(product));
  const foldersById = new Map(scan?.folders.map((folder) => [folder.id, folder]) ?? []);
  const productsById = new Map(products.map((product) => [product.id, product]));

  const matches = (saved.matches ?? []).flatMap((match) => {
    const legacyMatch = match as Partial<ProductMatch> & Partial<PersistedStore["matches"][number]>;
    const folder = legacyMatch.folder ?? (legacyMatch.folderId ? foldersById.get(legacyMatch.folderId) : null);
    if (!folder) return [];

    const candidateIds = legacyMatch.candidateIds ?? legacyMatch.candidates?.map((product) => product.id) ?? [];
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

    return [{
      folder,
      confidence: legacyMatch.confidence ?? "No Match",
      product: selectedProducts[0] ?? (legacyMatch.product ?? null),
      candidates,
      selectedProducts,
      reason: legacyMatch.reason ?? ""
    }];
  });

  const selections = (saved.selections ?? []).flatMap((selection) => {
    const legacySelection = selection as Partial<UploadSelection> & Partial<PersistedStore["selections"][number]> & { product?: ShopifyProduct };
    const folder = legacySelection.folder ?? (legacySelection.folderId ? foldersById.get(legacySelection.folderId) : null);
    if (!folder) return [];

    const productIds =
      legacySelection.productIds ??
      legacySelection.products?.map((product) => product.id) ??
      (legacySelection.product?.id ? [legacySelection.product.id] : []);
    const nextProducts = productIds
      .map((productId) => productsById.get(productId))
      .filter((product): product is ShopifyProduct => Boolean(product));
    if (nextProducts.length === 0) return [];

    return [{
      folder,
      products: nextProducts,
      selectedFirstImagePath: legacySelection.selectedFirstImagePath ?? folder.images[0]?.absolutePath ?? "",
      orderedImagePaths: legacySelection.orderedImagePaths ?? folder.images.map((image) => image.absolutePath),
      mode: legacySelection.mode ?? "append-folder",
      deleteOldMedia: Boolean(legacySelection.deleteOldMedia)
    }];
  });

  return {
    scan,
    products,
    matches,
    selections,
    lastJob: saved.lastJob ?? null
  };
}

export default function AppShell({ page }: { page: PageKey }) {
  const [store, setStore] = useState<Store>(emptyStore);
  const [folderPath, setFolderPath] = useState("./TILES");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<UploadJob[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const saved = window.localStorage.getItem("tile-uploader-state");
    if (saved) {
      try {
        setStore(normalizeStoredStore(JSON.parse(saved) as Store));
      } catch {
        window.localStorage.removeItem("tile-uploader-state");
      }
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem("tile-uploader-state", JSON.stringify(compactStore(store)));
    } catch (nextError) {
      setError(nextError instanceof Error ? `Could not save browser state: ${nextError.message}` : String(nextError));
    }
  }, [hydrated, store]);

  const matchedSelections = useMemo(
    () => store.matches.reduce((total, match) => total + match.selectedProducts.length, 0),
    [store.matches]
  );

  async function request<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, init);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Request failed.");
    return payload as T;
  }

  async function scanFolders() {
    setBusy(true);
    setError(null);
    try {
      const scan = await request<ScanResult>(`/api/scan?path=${encodeURIComponent(folderPath)}`);
      setStore((current) => ({ ...current, scan, matches: [], selections: [] }));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusy(false);
    }
  }

  async function fetchProductsAndMatch() {
    setBusy(true);
    setError(null);
    try {
      const scan = store.scan ?? await request<ScanResult>(`/api/scan?path=${encodeURIComponent(folderPath)}`);
      const productsResponse = await request<{ products: ShopifyProduct[] }>("/api/products");
      const matchResponse = await request<{ matches: ProductMatch[] }>("/api/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folders: scan.folders, products: productsResponse.products })
      });
      setStore((current) => ({
        ...current,
        scan,
        products: productsResponse.products,
        matches: matchResponse.matches,
        selections: current.scan ? current.selections : []
      }));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusy(false);
    }
  }

  function updateManualMatch(folderId: string, productIds: string[]) {
    setStore((current) => {
      let nextSelectedProducts: ShopifyProduct[] = [];
      const matches = current.matches.map((match) => {
        if (match.folder.id !== folderId) return match;
        const selectedProducts = productIds
          .map((productId) => current.products.find((item) => item.id === productId))
          .filter((product): product is ShopifyProduct => Boolean(product));
        nextSelectedProducts = selectedProducts;
        return {
          ...match,
          product: selectedProducts[0] ?? null,
          selectedProducts,
          reason: selectedProducts.length ? "Manually selected." : match.reason
        };
      });
      const selections = nextSelectedProducts.length
        ? current.selections.map((selection) => selection.folder.id === folderId ? { ...selection, products: nextSelectedProducts } : selection)
        : current.selections.filter((selection) => selection.folder.id !== folderId);
      return { ...current, matches, selections };
    });
  }

  function updateSelection(folder: TileFolder, products: ShopifyProduct[], imagePaths: string[], firstPath: string, mode: UploadMode, deleteOldMedia: boolean) {
    const nextSelection: UploadSelection = {
      folder,
      products,
      selectedFirstImagePath: firstPath,
      orderedImagePaths: imagePaths,
      mode,
      deleteOldMedia
    };
    setStore((current) => ({
      ...current,
      selections: [...current.selections.filter((selection) => selection.folder.id !== folder.id), nextSelection]
    }));
  }

  async function runUpload(dryRun: boolean, removeWhiteBackground: boolean) {
    setBusy(true);
    setError(null);
    try {
      const response = await request<{ job: UploadJob }>(dryRun ? "/api/uploads/dry-run" : "/api/uploads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selections: store.selections, options: { removeWhiteBackground } })
      });
      setStore((current) => ({ ...current, lastJob: response.job }));
      await loadHistory();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusy(false);
    }
  }

  async function loadHistory() {
    const response = await request<{ jobs: UploadJob[] }>("/api/history");
    setHistory(response.jobs);
  }

  useEffect(() => {
    if (page === "history") loadHistory().catch(() => undefined);
  }, [page]);

  return (
    <div className="min-h-screen bg-mist text-ink transition-colors dark:bg-[#0f1511] dark:text-[#edf3ec]">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-ink/10 bg-white px-4 py-5 dark:border-white/10 dark:bg-[#131b16] lg:block">
        <div className="mb-7 flex items-center gap-3 px-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-moss text-white dark:bg-fern">
            <UploadCloud size={21} />
          </div>
          <div>
            <p className="text-sm font-semibold">Tile Uploader</p>
            <p className="text-xs text-ink/55 dark:text-white/55">Local Shopify media tool</p>
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
                  active ? "bg-moss text-white dark:bg-fern" : "text-ink/70 hover:bg-mist hover:text-ink dark:text-white/70 dark:hover:bg-white/10 dark:hover:text-white"
                }`}
              >
                <Icon size={18} />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-6 border-t border-ink/10 pt-4 dark:border-white/10">
          <ThemeToggle />
        </div>
      </aside>

      <main className="lg:pl-64">
        <div className="mx-auto max-w-7xl px-5 py-6">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-normal">{navItems.find((item) => item.key === page)?.label}</h1>
              <p className="mt-1 text-sm text-ink/60 dark:text-white/60">Scan local images, match products, choose order, then upload with verification.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2 lg:hidden">
              <div className="flex flex-wrap gap-2">
                {navItems.map((item) => (
                  <Link key={item.key} href={item.href} className={`rounded-md border px-3 py-2 text-xs ${item.key === page ? "border-moss bg-moss text-white dark:border-fern dark:bg-fern" : "border-ink/10 bg-white dark:border-white/10 dark:bg-white/5 dark:text-white/75"}`}>
                    {item.label}
                  </Link>
                ))}
              </div>
              <ThemeToggle />
            </div>
          </div>

          {error ? <div className="mb-4 rounded-md border border-clay/40 bg-clay/10 px-4 py-3 text-sm text-clay dark:bg-clay/20 dark:text-[#ffb39d]">{error}</div> : null}

          {page === "dashboard" ? (
            <Dashboard store={store} matchedSelections={matchedSelections} />
          ) : page === "scan" ? (
            <ScanPage busy={busy} folderPath={folderPath} setFolderPath={setFolderPath} scanFolders={scanFolders} scan={store.scan} />
          ) : page === "matching" ? (
            <MatchingPage busy={busy} store={store} fetchProductsAndMatch={fetchProductsAndMatch} updateManualMatch={updateManualMatch} />
          ) : page === "selector" ? (
            <SelectorPage store={store} updateSelection={updateSelection} />
          ) : page === "review" ? (
            <ReviewPage busy={busy} store={store} runUpload={runUpload} />
          ) : (
            <HistoryPage history={history} refresh={loadHistory} />
          )}
        </div>
      </main>
    </div>
  );
}

function Dashboard({ store, matchedSelections }: { store: Store; matchedSelections: number }) {
  const cards = [
    ["Scanned folders", store.scan?.folders.length ?? 0],
    ["Fetched products", store.products.length],
    ["Selected products", matchedSelections],
    ["Ready selections", store.selections.length]
  ];

  return (
    <div className="grid gap-4 md:grid-cols-4">
      {cards.map(([label, value]) => (
        <div key={label} className="rounded-md border border-ink/10 bg-white p-5 shadow-soft dark:border-white/10 dark:bg-[#151d18] dark:shadow-none">
          <p className="text-sm text-ink/55 dark:text-white/55">{label}</p>
          <p className="mt-2 text-3xl font-semibold">{value}</p>
        </div>
      ))}
      <div className="rounded-md border border-ink/10 bg-white p-5 dark:border-white/10 dark:bg-[#151d18] md:col-span-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-moss dark:text-[#9fce96]">
          <CheckCircle2 size={18} />
          Workflow
        </div>
        <p className="mt-2 text-sm text-ink/65 dark:text-white/65">Start with Folder Scan, fetch and match Shopify products, select the first image and order, then review with dry-run before live upload.</p>
      </div>
    </div>
  );
}

function ScanPage({ busy, folderPath, setFolderPath, scanFolders, scan }: { busy: boolean; folderPath: string; setFolderPath: (path: string) => void; scanFolders: () => void; scan: ScanResult | null }) {
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-ink/10 bg-white p-5 dark:border-white/10 dark:bg-[#151d18]">
        <label className="text-sm font-medium">Local TILES folder path</label>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <input value={folderPath} onChange={(event) => setFolderPath(event.target.value)} className="focus-ring min-w-0 flex-1 rounded-md border border-ink/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-[#0f1511] dark:text-white" />
          <button disabled={busy} onClick={scanFolders} className="focus-ring inline-flex items-center justify-center gap-2 rounded-md bg-moss px-4 py-2 text-sm font-medium text-white dark:bg-fern">
            <FolderSearch size={17} />
            Scan
          </button>
        </div>
      </div>
      {scan ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {scan.folders.map((folder) => (
            <div key={folder.id} className="rounded-md border border-ink/10 bg-white p-4 dark:border-white/10 dark:bg-[#151d18]">
              <p className="text-sm font-semibold">{folder.size} / {folder.tileName}</p>
              <p className="mt-1 truncate text-xs text-ink/50 dark:text-white/50">{folder.relativePath}</p>
              <div className="mt-3 grid grid-cols-5 gap-2">
                {folder.images.slice(0, 5).map((image) => <img key={image.id} src={image.previewUrl} alt={image.name} className="aspect-square rounded-md object-cover" />)}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function MatchingPage({ busy, store, fetchProductsAndMatch, updateManualMatch }: { busy: boolean; store: Store; fetchProductsAndMatch: () => void; updateManualMatch: (folderId: string, productIds: string[]) => void }) {
  return (
    <div className="space-y-4">
      <button disabled={busy} onClick={fetchProductsAndMatch} className="focus-ring inline-flex items-center gap-2 rounded-md bg-moss px-4 py-2 text-sm font-medium text-white dark:bg-fern">
        <RefreshCw size={17} />
        Fetch Products And Match
      </button>
      <ProductMatchTable matches={store.matches} products={store.products} onManualMatch={updateManualMatch} />
    </div>
  );
}

function SelectorPage({ store, updateSelection }: { store: Store; updateSelection: (folder: TileFolder, products: ShopifyProduct[], imagePaths: string[], firstPath: string, mode: UploadMode, deleteOldMedia: boolean) => void }) {
  const matches = store.matches.filter((match) => match.selectedProducts.length > 0);
  return (
    <div className="space-y-4">
      {matches.map((match) => (
        <ImageSelector key={match.folder.id} match={match} existingSelection={store.selections.find((selection) => selection.folder.id === match.folder.id)} onChange={updateSelection} />
      ))}
      {matches.length === 0 ? <p className="rounded-md border border-ink/10 bg-white p-5 text-sm text-ink/60 dark:border-white/10 dark:bg-[#151d18] dark:text-white/60">No matched products yet.</p> : null}
    </div>
  );
}

function ReviewPage({ busy, store, runUpload }: { busy: boolean; store: Store; runUpload: (dryRun: boolean, removeWhiteBackground: boolean) => void }) {
  const [modalOpen, setModalOpen] = useState(false);
  const [removeWhiteBackground, setRemoveWhiteBackground] = useState(false);
  return (
    <div className="space-y-4">
      <ReviewUploadModal open={modalOpen} disabled={busy || store.selections.length === 0} onClose={() => setModalOpen(false)} onDryRun={() => runUpload(true, removeWhiteBackground)} onUpload={() => runUpload(false, removeWhiteBackground)} />
      <label className="flex max-w-xl items-start gap-3 rounded-md border border-ink/10 bg-white p-4 text-sm dark:border-white/10 dark:bg-[#151d18]">
        <input
          type="checkbox"
          checked={removeWhiteBackground}
          onChange={(event) => setRemoveWhiteBackground(event.target.checked)}
          className="mt-1 h-4 w-4 rounded border-ink/20 text-moss dark:border-white/20 dark:bg-[#0f1511]"
        />
        <span>
          <span className="block font-medium">Remove white background</span>
          <span className="mt-1 block text-ink/60 dark:text-white/60">Upload transparent PNG versions to Shopify while keeping local files unchanged.</span>
        </span>
      </label>
      <button disabled={busy || store.selections.length === 0} onClick={() => setModalOpen(true)} className="focus-ring inline-flex items-center gap-2 rounded-md bg-clay px-4 py-2 text-sm font-semibold text-white">
        <UploadCloud size={17} />
        Review And Confirm
      </button>
      <div className="grid gap-4">
        {store.selections.map((selection) => (
          <div key={selection.folder.id} className="rounded-md border border-ink/10 bg-white p-4 dark:border-white/10 dark:bg-[#151d18]">
            <p className="font-semibold">{selection.products.map((product) => product.title).join(", ")}</p>
            <p className="text-sm text-ink/55 dark:text-white/55">{selection.folder.relativePath}</p>
            <div className="mt-3 grid gap-3 md:grid-cols-[160px_1fr]">
              <div>
                <p className="mb-1 text-xs font-medium text-ink/50 dark:text-white/50">Old first image</p>
                {selection.products[0]?.firstImageUrl ? <img src={selection.products[0].firstImageUrl} alt="" className="aspect-square rounded-md object-cover" /> : <div className="aspect-square rounded-md bg-mist dark:bg-white/10" />}
              </div>
              <div>
                <p className="mb-1 text-xs font-medium text-ink/50 dark:text-white/50">Upload order</p>
                <div className="grid grid-cols-4 gap-2 md:grid-cols-8">
                  {selection.orderedImagePaths.map((imagePath) => {
                    const image = selection.folder.images.find((item) => item.absolutePath === imagePath);
                    return image ? <img key={imagePath} src={image.previewUrl} alt={image.name} className={`aspect-square rounded-md object-cover ${imagePath === selection.selectedFirstImagePath ? "ring-4 ring-clay" : ""}`} /> : null;
                  })}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
      {store.lastJob ? <UploadProgress job={store.lastJob} /> : null}
    </div>
  );
}

function HistoryPage({ history, refresh }: { history: UploadJob[]; refresh: () => void }) {
  return (
    <div className="space-y-4">
      <button onClick={refresh} className="focus-ring inline-flex items-center gap-2 rounded-md border border-ink/15 bg-white px-4 py-2 text-sm font-medium dark:border-white/15 dark:bg-white/5 dark:text-white">
        <RefreshCw size={17} />
        Refresh
      </button>
      {history.map((job) => <UploadProgress key={job.id} job={job} />)}
      {history.length === 0 ? <p className="rounded-md border border-ink/10 bg-white p-5 text-sm text-ink/60 dark:border-white/10 dark:bg-[#151d18] dark:text-white/60">No upload jobs logged yet.</p> : null}
    </div>
  );
}
