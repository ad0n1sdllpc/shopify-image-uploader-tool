"use client";

import { useMemo, useState } from "react";
import { DndContext, DragEndEvent, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Star } from "lucide-react";
import { sortProductsByVariantPrefix } from "@/lib/productOrdering";
import type { ImageFolder, LocalImage, ProductMatch, ShopifyProduct, UploadMode, UploadSelection } from "@/types";

export default function ImageSelector({
  match,
  position,
  total,
  existingSelection,
  onChange
}: {
  match: ProductMatch;
  position: number;
  total: number;
  existingSelection?: UploadSelection;
  onChange: (folder: ImageFolder, products: ShopifyProduct[], imagePaths: string[], firstPath: string, mode: UploadMode, deleteOldMedia: boolean) => void;
}) {
  const defaultOrder = useMemo(() => match.folder.images.map((image) => image.absolutePath), [match.folder.images]);
  const [order, setOrder] = useState(existingSelection?.orderedImagePaths ?? defaultOrder);
  const [firstPath, setFirstPath] = useState(existingSelection?.selectedFirstImagePath ?? order[0]);
  const [mode, setMode] = useState<UploadMode>(existingSelection?.mode ?? "append-folder");
  const [deleteOldMedia, setDeleteOldMedia] = useState(existingSelection?.deleteOldMedia ?? true);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const selectedProducts = useMemo(() => sortProductsByVariantPrefix(match.selectedProducts), [match.selectedProducts]);
  const representativeProduct = useMemo(() => {
    return [...selectedProducts].sort((first, second) => productMediaUrls(second).length - productMediaUrls(first).length || second.totalMediaCount - first.totalMediaCount)[0] ?? null;
  }, [selectedProducts]);
  const selectedProductLabels = useMemo(() => {
    const labels = selectedProducts.map((product) => productGroupLabel(product, match.folder.productCode));
    return Array.from(new Set(labels));
  }, [match.folder.productCode, selectedProducts]);
  const shopifyMediaUrls = representativeProduct ? productMediaUrls(representativeProduct) : [];
  const shopifyMediaCount = representativeProduct?.totalMediaCount ?? shopifyMediaUrls.length;

  function persist(nextOrder = order, nextFirst = firstPath, nextMode = mode, nextDelete = deleteOldMedia) {
    const normalizedOrder = [nextFirst, ...nextOrder.filter((imagePath) => imagePath !== nextFirst)];
    setOrder(normalizedOrder);
    onChange(match.folder, selectedProducts, normalizedOrder, nextFirst, nextMode, nextDelete);
  }

  function onDragEnd(event: DragEndEvent) {
    if (!event.over || event.active.id === event.over.id) return;
    const oldIndex = order.indexOf(String(event.active.id));
    const newIndex = order.indexOf(String(event.over.id));
    persist(arrayMove(order, oldIndex, newIndex));
  }

  return (
    <section className="admin-card p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="admin-badge bg-moss/10 text-moss dark:bg-[#0f3a2f] dark:text-[#8fd6bc]">
              {position} of {total}
            </span>
            <h2 className="font-semibold">{match.folder.name}</h2>
          </div>
          <p className="text-sm admin-muted">{match.folder.relativePath}</p>
          <p className="mt-1 text-xs admin-muted">
            {selectedProducts.length} product(s) selected
          </p>
          {selectedProductLabels.length > 0 ? (
            <p className="mt-1 text-xs admin-muted">
              Selected: {selectedProductLabels.join(" / ")}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <select value={mode} onChange={(event) => { const next = event.target.value as UploadMode; setMode(next); persist(order, firstPath, next, deleteOldMedia); }} className="admin-input min-w-64">
            <option value="append-folder">Replace first + upload all</option>
            <option value="replace-first">Replace first only</option>
            <option value="replace-gallery">Replace full gallery</option>
          </select>
          <label className="admin-button cursor-pointer">
            <input type="checkbox" checked={deleteOldMedia} onChange={(event) => { setDeleteOldMedia(event.target.checked); persist(order, firstPath, mode, event.target.checked); }} className="h-4 w-4 rounded border-line text-moss dark:border-white/20 dark:bg-[#0f1115]" />
            Delete old media after verification
          </label>
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(300px,390px)_1fr]">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase admin-muted">Current Shopify media</p>
          <ShopifyMediaGallery title={match.folder.name} mediaUrls={shopifyMediaUrls} mediaCount={shopifyMediaCount} />
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase admin-muted">Local upload order</p>
          <DndContext sensors={sensors} onDragEnd={onDragEnd}>
            <SortableContext items={order} strategy={rectSortingStrategy}>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-6 2xl:grid-cols-8">
                {order.map((imagePath) => {
                  const image = match.folder.images.find((item) => item.absolutePath === imagePath);
                  return image ? (
                    <SortableImage
                      key={image.absolutePath}
                      image={image}
                      selected={image.absolutePath === firstPath}
                      onSelect={() => {
                        setFirstPath(image.absolutePath);
                        persist(order, image.absolutePath);
                      }}
                    />
                  ) : null;
                })}
              </div>
            </SortableContext>
          </DndContext>
        </div>
      </div>
    </section>
  );
}

function productMediaUrls(product: ShopifyProduct) {
  return product.mediaImageUrls?.length ? product.mediaImageUrls : product.firstImageUrl ? [product.firstImageUrl] : [];
}

function productGroupLabel(product: ShopifyProduct, productCode: string) {
  const candidates = [product.title, product.handle, ...product.variantsSkus].filter(Boolean);
  for (const candidate of candidates) {
    const parts = candidate.split("-");
    if (parts.at(-1)?.toLowerCase() === productCode.toLowerCase() && parts.length > 1) {
      return parts.slice(0, -1).join("-").toUpperCase();
    }
  }

  return product.title.toUpperCase();
}

function ShopifyMediaGallery({ title, mediaUrls, mediaCount }: { title: string; mediaUrls: string[]; mediaCount: number }) {
  return (
    <div className="admin-panel p-2">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="truncate text-xs font-semibold" title={title}>{title}</p>
        <span className="shrink-0 text-[11px] admin-muted">
          {mediaUrls.length} shown / {mediaCount} media
        </span>
      </div>
      {mediaUrls.length > 0 ? (
        <>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 xl:grid-cols-3">
            {mediaUrls.map((url, index) => (
              <div key={`${url}-${index}`} className="relative">
                <img src={url} alt={`${title} Shopify media ${index + 1}`} className="aspect-square w-full rounded border border-line object-cover dark:border-white/10" />
                {index === 0 ? <span className="absolute left-1 top-1 rounded bg-moss px-1.5 py-0.5 text-[10px] font-semibold text-white">First</span> : null}
              </div>
            ))}
          </div>
          <details className="mt-2">
            <summary className="cursor-pointer text-xs font-semibold text-moss dark:text-[#8fd6bc]">Expanded preview</summary>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {mediaUrls.slice(0, 4).map((url, index) => (
                <img key={`preview-${url}-${index}`} src={url} alt={`${title} expanded Shopify media ${index + 1}`} className="aspect-video w-full rounded border border-line object-cover dark:border-white/10" />
              ))}
            </div>
          </details>
        </>
      ) : (
        <div className="flex aspect-[3/1] items-center justify-center rounded bg-white text-xs admin-muted dark:bg-white/10">No media</div>
      )}
    </div>
  );
}

function SortableImage({ image, selected, onSelect }: { image: LocalImage; selected: boolean; onSelect: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: image.absolutePath });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div ref={setNodeRef} style={style} className={`relative rounded-md border bg-white p-2 dark:bg-[#0f1115] ${selected ? "border-clay ring-2 ring-clay" : "border-line dark:border-white/10"}`}>
      <button {...attributes} {...listeners} className="absolute left-3 top-3 z-10 rounded bg-white/90 p-1 text-subdued shadow dark:bg-black/70 dark:text-white/70" title="Drag to reorder">
        <GripVertical size={15} />
      </button>
      <button onClick={onSelect} className="focus-ring block w-full text-left" title="Mark as first image">
        <img src={image.previewUrl} alt={image.name} className="aspect-square w-full rounded object-cover" />
        <span className="mt-2 block truncate text-xs admin-muted">{image.name}</span>
      </button>
      {selected ? (
        <span className="absolute right-3 top-3 flex items-center gap-1 rounded bg-clay px-2 py-1 text-xs font-semibold text-white">
          <Star size={12} />
          First
        </span>
      ) : null}
    </div>
  );
}
