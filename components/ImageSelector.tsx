"use client";

import { useMemo, useState } from "react";
import { DndContext, DragEndEvent, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Star } from "lucide-react";
import type { LocalImage, ProductMatch, ShopifyProduct, TileFolder, UploadMode, UploadSelection } from "@/types";

export default function ImageSelector({
  match,
  existingSelection,
  onChange
}: {
  match: ProductMatch;
  existingSelection?: UploadSelection;
  onChange: (folder: TileFolder, products: ShopifyProduct[], imagePaths: string[], firstPath: string, mode: UploadMode, deleteOldMedia: boolean) => void;
}) {
  const defaultOrder = useMemo(() => match.folder.images.map((image) => image.absolutePath), [match.folder.images]);
  const [order, setOrder] = useState(existingSelection?.orderedImagePaths ?? defaultOrder);
  const [firstPath, setFirstPath] = useState(existingSelection?.selectedFirstImagePath ?? order[0]);
  const [mode, setMode] = useState<UploadMode>(existingSelection?.mode ?? "append-folder");
  const [deleteOldMedia, setDeleteOldMedia] = useState(existingSelection?.deleteOldMedia ?? false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  function persist(nextOrder = order, nextFirst = firstPath, nextMode = mode, nextDelete = deleteOldMedia) {
    const normalizedOrder = [nextFirst, ...nextOrder.filter((imagePath) => imagePath !== nextFirst)];
    setOrder(normalizedOrder);
    onChange(match.folder, match.selectedProducts, normalizedOrder, nextFirst, nextMode, nextDelete);
  }

  function onDragEnd(event: DragEndEvent) {
    if (!event.over || event.active.id === event.over.id) return;
    const oldIndex = order.indexOf(String(event.active.id));
    const newIndex = order.indexOf(String(event.over.id));
    persist(arrayMove(order, oldIndex, newIndex));
  }

  return (
    <section className="rounded-md border border-ink/10 bg-white p-4 shadow-soft dark:border-white/10 dark:bg-[#151d18] dark:shadow-none">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="font-semibold">{match.folder.tileName}</h2>
          <p className="text-sm text-ink/55 dark:text-white/55">{match.folder.relativePath}</p>
          <p className="mt-1 text-xs text-ink/60 dark:text-white/60">
            {match.selectedProducts.length} product(s): {match.selectedProducts.map((product) => product.title).join(", ")}
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <select value={mode} onChange={(event) => { const next = event.target.value as UploadMode; setMode(next); persist(order, firstPath, next, deleteOldMedia); }} className="focus-ring rounded-md border border-ink/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-[#0f1511] dark:text-white">
            <option value="append-folder">Replace first + upload all</option>
            <option value="replace-first">Replace first only</option>
            <option value="replace-gallery">Replace full gallery</option>
          </select>
          <label className="flex items-center gap-2 rounded-md border border-ink/15 px-3 py-2 text-sm dark:border-white/15">
            <input type="checkbox" checked={deleteOldMedia} onChange={(event) => { setDeleteOldMedia(event.target.checked); persist(order, firstPath, mode, event.target.checked); }} className="dark:bg-[#0f1511]" />
            Delete old media after verification
          </label>
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(260px,360px)_1fr]">
        <div>
          <p className="mb-2 text-xs font-medium uppercase text-ink/50 dark:text-white/50">Current Shopify media</p>
          <div className="space-y-3">
            {match.selectedProducts.map((product) => (
              <ShopifyMediaStrip key={product.id} product={product} />
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-medium uppercase text-ink/50 dark:text-white/50">Local upload order</p>
          <DndContext sensors={sensors} onDragEnd={onDragEnd}>
            <SortableContext items={order} strategy={rectSortingStrategy}>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5 2xl:grid-cols-6">
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

function ShopifyMediaStrip({ product }: { product: ShopifyProduct }) {
  const mediaUrls = product.mediaImageUrls?.length ? product.mediaImageUrls : product.firstImageUrl ? [product.firstImageUrl] : [];

  return (
    <div className="rounded-md border border-ink/10 bg-mist/60 p-2 dark:border-white/10 dark:bg-[#0f1511]">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="truncate text-xs font-semibold text-ink/70 dark:text-white/75" title={product.title}>{product.title}</p>
        <span className="shrink-0 text-[11px] text-ink/45 dark:text-white/45">{product.totalMediaCount} media</span>
      </div>
      {mediaUrls.length > 0 ? (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 xl:grid-cols-3">
          {mediaUrls.map((url, index) => (
            <div key={`${product.id}-${url}-${index}`} className="relative">
              <img src={url} alt={`${product.title} media ${index + 1}`} className="aspect-square w-full rounded object-cover" />
              {index === 0 ? <span className="absolute left-1 top-1 rounded bg-moss px-1.5 py-0.5 text-[10px] font-semibold text-white dark:bg-fern">First</span> : null}
            </div>
          ))}
        </div>
      ) : (
        <div className="flex aspect-[3/1] items-center justify-center rounded bg-white text-xs text-ink/45 dark:bg-white/10 dark:text-white/45">No media</div>
      )}
    </div>
  );
}

function SortableImage({ image, selected, onSelect }: { image: LocalImage; selected: boolean; onSelect: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: image.absolutePath });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div ref={setNodeRef} style={style} className={`relative rounded-md border bg-white p-2 dark:bg-[#0f1511] ${selected ? "border-clay ring-2 ring-clay" : "border-ink/10 dark:border-white/10"}`}>
      <button {...attributes} {...listeners} className="absolute left-3 top-3 z-10 rounded bg-white/90 p-1 text-ink/55 shadow dark:bg-black/70 dark:text-white/70" title="Drag to reorder">
        <GripVertical size={15} />
      </button>
      <button onClick={onSelect} className="focus-ring block w-full text-left" title="Mark as first image">
        <img src={image.previewUrl} alt={image.name} className="aspect-square w-full rounded object-cover" />
        <span className="mt-2 block truncate text-xs text-ink/65 dark:text-white/65">{image.name}</span>
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
