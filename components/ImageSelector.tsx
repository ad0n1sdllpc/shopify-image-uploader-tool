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
  match: ProductMatch & { product: ShopifyProduct };
  existingSelection?: UploadSelection;
  onChange: (folder: TileFolder, product: ShopifyProduct, imagePaths: string[], firstPath: string, mode: UploadMode, deleteOldMedia: boolean) => void;
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
    onChange(match.folder, match.product, normalizedOrder, nextFirst, nextMode, nextDelete);
  }

  function onDragEnd(event: DragEndEvent) {
    if (!event.over || event.active.id === event.over.id) return;
    const oldIndex = order.indexOf(String(event.active.id));
    const newIndex = order.indexOf(String(event.over.id));
    persist(arrayMove(order, oldIndex, newIndex));
  }

  return (
    <section className="rounded-md border border-ink/10 bg-white p-4 shadow-soft">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="font-semibold">{match.product.title}</h2>
          <p className="text-sm text-ink/55">{match.folder.relativePath}</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <select value={mode} onChange={(event) => { const next = event.target.value as UploadMode; setMode(next); persist(order, firstPath, next, deleteOldMedia); }} className="focus-ring rounded-md border border-ink/15 px-3 py-2 text-sm">
            <option value="append-folder">Replace first + upload all</option>
            <option value="replace-first">Replace first only</option>
            <option value="replace-gallery">Replace full gallery</option>
          </select>
          <label className="flex items-center gap-2 rounded-md border border-ink/15 px-3 py-2 text-sm">
            <input type="checkbox" checked={deleteOldMedia} onChange={(event) => { setDeleteOldMedia(event.target.checked); persist(order, firstPath, mode, event.target.checked); }} />
            Delete old media after verification
          </label>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[180px_1fr]">
        <div>
          <p className="mb-2 text-xs font-medium uppercase text-ink/50">Current Shopify first</p>
          {match.product.firstImageUrl ? <img src={match.product.firstImageUrl} alt="" className="aspect-square rounded-md object-cover" /> : <div className="flex aspect-square items-center justify-center rounded-md bg-mist text-xs text-ink/45">No image</div>}
        </div>

        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          <SortableContext items={order} strategy={rectSortingStrategy}>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
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
    </section>
  );
}

function SortableImage({ image, selected, onSelect }: { image: LocalImage; selected: boolean; onSelect: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: image.absolutePath });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div ref={setNodeRef} style={style} className={`relative rounded-md border bg-white p-2 ${selected ? "border-clay ring-2 ring-clay" : "border-ink/10"}`}>
      <button {...attributes} {...listeners} className="absolute left-3 top-3 z-10 rounded bg-white/90 p-1 text-ink/55 shadow" title="Drag to reorder">
        <GripVertical size={15} />
      </button>
      <button onClick={onSelect} className="focus-ring block w-full text-left" title="Mark as first image">
        <img src={image.previewUrl} alt={image.name} className="aspect-square w-full rounded object-cover" />
        <span className="mt-2 block truncate text-xs text-ink/65">{image.name}</span>
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
