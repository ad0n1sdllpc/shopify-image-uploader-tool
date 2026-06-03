"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { RefreshCw, Search, Trash2 } from "lucide-react";
import { filterMediaGroups, groupedMediaSelected, groupMediaProducts, mediaDeleteItems, nonFirstGroupedMediaIds, productMediaItems, selectedMediaSummary, toggleGroupedMediaSelection } from "@/lib/mediaManager";
import type { MediaDeleteRequestItem, MediaDeleteResult, ShopifyProduct } from "@/types";

export default function MediaManager({
  products,
  busy,
  fetchProducts,
  deleteMedia,
  emptyTitle = "Product media",
  emptyDescription = "Fetch Shopify products to inspect and clean duplicate media.",
  emptyActionHref,
  emptyActionLabel = "Fetch Shopify products"
}: {
  products: ShopifyProduct[];
  busy: boolean;
  fetchProducts: () => Promise<void>;
  deleteMedia: (items: MediaDeleteRequestItem[]) => Promise<MediaDeleteResult[]>;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyActionHref?: string;
  emptyActionLabel?: string;
}) {
  const [query, setQuery] = useState("");
  const [multiMediaOnly, setMultiMediaOnly] = useState(true);
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [selectedMediaIds, setSelectedMediaIds] = useState<string[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [results, setResults] = useState<MediaDeleteResult[] | null>(null);

  const filters = { query, multiMediaOnly, selectedOnly };
  const groups = useMemo(() => groupMediaProducts(products), [products]);
  const visibleGroups = useMemo(() => filterMediaGroups(groups, filters, selectedMediaIds), [groups, query, multiMediaOnly, selectedOnly, selectedMediaIds]);
  const summary = useMemo(() => selectedMediaSummary(products, selectedMediaIds), [products, selectedMediaIds]);
  const selectedSet = new Set(selectedMediaIds);
  const selectedItems = mediaDeleteItems(products, selectedMediaIds);
  const selectedProducts = products.filter((product) => productMediaItems(product).some((media, index) => index > 0 && selectedSet.has(media.id)));

  function toggleGroupedMedia(groupId: string, mediaIndex: number, selected: boolean) {
    const group = groups.find((item) => item.id === groupId);
    if (!group) return;
    setSelectedMediaIds((current) => toggleGroupedMediaSelection(group, mediaIndex, selected, current));
    setResults(null);
  }

  function selectVisible() {
    setSelectedMediaIds((current) => Array.from(new Set([...current, ...nonFirstGroupedMediaIds(visibleGroups)])));
    setResults(null);
  }

  async function confirmDelete() {
    setConfirmOpen(false);
    try {
      const nextResults = await deleteMedia(selectedItems);
      const deletedIds = new Set(nextResults.flatMap((result) => result.deletedMediaIds));
      setSelectedMediaIds((current) => current.filter((mediaId) => !deletedIds.has(mediaId)));
      setResults(nextResults);
    } catch {
      // AppShell owns the visible error banner.
    }
  }

  if (products.length === 0) {
    return (
      <section className="admin-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">{emptyTitle}</h2>
            <p className="text-sm admin-muted">{emptyDescription}</p>
          </div>
          {emptyActionHref ? (
            <Link href={emptyActionHref} className="admin-button-primary">{emptyActionLabel}</Link>
          ) : (
            <button type="button" disabled={busy} onClick={fetchProducts} className="admin-button-primary">
              <RefreshCw size={17} />
              {emptyActionLabel}
            </button>
          )}
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <section className="admin-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Product media cleanup</h2>
            <p className="text-sm admin-muted">{summary.selectedMediaCount} media selected across {summary.selectedProductCount} product(s)</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={busy} onClick={fetchProducts} className="admin-button">
              <RefreshCw size={17} />
              Refresh products
            </button>
            <button type="button" disabled={busy || visibleGroups.length === 0} onClick={selectVisible} className="admin-button">
              Select all non-first visible media
            </button>
            <button type="button" disabled={busy || selectedMediaIds.length === 0} onClick={() => { setSelectedMediaIds([]); setResults(null); }} className="admin-button">
              Clear selection
            </button>
            <button type="button" disabled={busy || summary.selectedMediaCount === 0} onClick={() => setConfirmOpen(true)} className="admin-button-danger">
              <Trash2 size={17} />
              Delete selected media
            </button>
          </div>
        </div>
        <div className="mt-3 grid gap-2 lg:grid-cols-[1fr_auto_auto]">
          <label className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subdued dark:text-white/45" size={16} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search title, handle, or SKU"
              className="admin-input w-full pl-9"
            />
          </label>
          <label className="admin-button justify-start">
            <input type="checkbox" checked={multiMediaOnly} onChange={(event) => setMultiMediaOnly(event.target.checked)} className="h-4 w-4 rounded border-line text-moss dark:border-white/20 dark:bg-[#0f1115]" />
            2+ media only
          </label>
          <label className="admin-button justify-start">
            <input type="checkbox" checked={selectedOnly} onChange={(event) => setSelectedOnly(event.target.checked)} className="h-4 w-4 rounded border-line text-moss dark:border-white/20 dark:bg-[#0f1115]" />
            Selected only
          </label>
        </div>
      </section>

      {results ? <DeleteResults results={results} products={products} /> : null}

      <div className="grid gap-3">
        {visibleGroups.map((group) => {
          const media = group.media;
          return (
            <section key={group.id} className="admin-card p-4">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{group.code}</p>
                  <p className="truncate text-xs admin-muted">
                    {group.products.length} product(s): {group.variantLabels.join(" / ")}
                  </p>
                </div>
                <span className="admin-badge bg-mist text-subdued dark:bg-white/10 dark:text-white/65">{media.length} media per product</span>
              </div>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 md:grid-cols-7 lg:grid-cols-9 xl:grid-cols-12">
                {media.map((item, index) => {
                  const isFirst = index === 0;
                  const selected = groupedMediaSelected(group, index, selectedMediaIds);
                  return (
                    <label key={item.id} className={`relative overflow-hidden rounded-md border ${selected ? "border-clay ring-2 ring-clay/40" : "border-line dark:border-white/10"} ${isFirst ? "cursor-not-allowed opacity-80" : "cursor-pointer"}`}>
                      {item.url ? <img src={item.url} alt="" className="aspect-square w-full object-cover" /> : <div className="aspect-square bg-mist dark:bg-white/10" />}
                      <span className={`absolute left-1 top-1 admin-badge ${isFirst ? "bg-moss text-white" : "bg-black/65 text-white"}`}>
                        {isFirst ? "First" : index + 1}
                      </span>
                      {!isFirst ? (
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={(event) => toggleGroupedMedia(group.id, index, event.target.checked)}
                          className="absolute right-1 top-1 h-4 w-4 rounded border-white text-clay"
                        />
                      ) : null}
                    </label>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      {visibleGroups.length === 0 ? <p className="admin-card p-5 text-sm admin-muted">No product groups match the current media filters.</p> : null}

      {confirmOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="admin-card max-h-[85vh] w-full max-w-3xl overflow-auto p-5 shadow-soft">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Delete selected media?</h2>
                <p className="mt-1 text-sm admin-muted">
                  This will delete {summary.selectedMediaCount} media item(s) across {summary.selectedProductCount} product(s). First images are protected and will not be deleted.
                </p>
              </div>
              <button type="button" onClick={() => setConfirmOpen(false)} className="admin-button">Cancel</button>
            </div>
            <div className="mt-4 space-y-3">
              {selectedProducts.map((product) => {
                const selectedMedia = productMediaItems(product).slice(1).filter((media) => selectedSet.has(media.id));
                return (
                  <div key={product.id} className="admin-panel p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-semibold">{product.title}</p>
                      <span className="admin-badge bg-clay/10 text-clay dark:bg-clay/20 dark:text-[#ffb39d]">{selectedMedia.length} selected</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {selectedMedia.slice(0, 12).map((media) => (
                        media.url ? <img key={media.id} src={media.url} alt="" className="h-14 w-14 rounded border border-line object-cover dark:border-white/10" /> : <div key={media.id} className="h-14 w-14 rounded border border-line bg-mist dark:border-white/10 dark:bg-white/10" />
                      ))}
                      {selectedMedia.length > 12 ? <span className="admin-badge bg-mist text-subdued dark:bg-white/10 dark:text-white/65">+{selectedMedia.length - 12}</span> : null}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmOpen(false)} className="admin-button">Cancel</button>
              <button type="button" disabled={busy} onClick={confirmDelete} className="admin-button-danger">
                <Trash2 size={17} />
                Delete media
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DeleteResults({ results, products }: { results: MediaDeleteResult[]; products: ShopifyProduct[] }) {
  const productsById = new Map(products.map((product) => [product.id, product]));
  const deletedCount = results.reduce((total, result) => total + result.deletedMediaIds.length, 0);
  const failedCount = results.filter((result) => result.status === "failed").length;

  return (
    <section className="admin-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">Delete results</h2>
          <p className="text-sm admin-muted">{deletedCount} deleted, {failedCount} failed</p>
        </div>
      </div>
      <div className="mt-3 divide-y divide-line rounded-md border border-line dark:divide-white/10 dark:border-white/10">
        {results.map((result) => (
          <div key={result.productId} className="p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium">{productsById.get(result.productId)?.title ?? result.productId}</p>
              <span className={`admin-badge ${result.status === "success" ? "bg-moss/10 text-moss dark:bg-[#0f3a2f] dark:text-[#8fd6bc]" : "bg-clay/10 text-clay dark:bg-clay/20 dark:text-[#ffb39d]"}`}>{result.status}</span>
            </div>
            <p className="mt-1 text-xs admin-muted">{result.deletedMediaIds.length} deleted, {result.skippedMediaIds.length} protected or stale skipped</p>
            {result.error ? <p className="mt-1 text-xs text-clay dark:text-[#ffb39d]">{result.error}</p> : null}
          </div>
        ))}
      </div>
    </section>
  );
}
