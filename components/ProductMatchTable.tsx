"use client";

import type { ProductMatch, ShopifyProduct } from "@/types";

export default function ProductMatchTable({
  matches,
  products,
  onManualMatch
}: {
  matches: ProductMatch[];
  products: ShopifyProduct[];
  onManualMatch: (folderId: string, productIds: string[]) => void;
}) {
  if (matches.length === 0) {
    return <p className="rounded-md border border-ink/10 bg-white p-5 text-sm text-ink/60 dark:border-white/10 dark:bg-[#151d18] dark:text-white/60">Fetch products after scanning folders to generate matches.</p>;
  }

  return (
    <div className="overflow-hidden rounded-md border border-ink/10 bg-white dark:border-white/10 dark:bg-[#151d18]">
      <table className="w-full min-w-[860px] text-left text-sm">
        <thead className="bg-mist text-xs uppercase text-ink/55 dark:bg-white/5 dark:text-white/55">
          <tr>
            <th className="px-4 py-3">Folder</th>
            <th className="px-4 py-3">Confidence</th>
            <th className="px-4 py-3">Product</th>
            <th className="px-4 py-3">Reason</th>
            <th className="px-4 py-3">Manual Selection</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink/10 dark:divide-white/10">
          {matches.map((match) => (
            <tr key={match.folder.id}>
              <td className="px-4 py-3">
                <p className="font-medium">{match.folder.tileName}</p>
                <p className="text-xs text-ink/50 dark:text-white/50">{match.folder.relativePath}</p>
              </td>
              <td className="px-4 py-3">
                <span className={`rounded px-2 py-1 text-xs font-semibold ${badgeClass(match.confidence)}`}>{match.confidence}</span>
              </td>
              <td className="px-4 py-3">
                {match.selectedProducts.length > 0 ? (
                  <div>
                    <p>{match.selectedProducts.length} product(s) selected</p>
                    <p className="mt-1 text-xs text-ink/50 dark:text-white/50">{match.selectedProducts.map((product) => product.title).join(", ")}</p>
                  </div>
                ) : (
                  "Needs selection"
                )}
              </td>
              <td className="px-4 py-3 text-ink/60 dark:text-white/60">{match.reason}</td>
              <td className="px-4 py-3">
                {match.candidates.length > 1 ? (
                  <div className="max-h-44 space-y-2 overflow-auto rounded-md border border-ink/10 p-2 dark:border-white/10">
                    {match.candidates.map((product) => {
                      const checked = match.selectedProducts.some((selectedProduct) => selectedProduct.id === product.id);
                      return (
                        <label key={product.id} className="flex items-start gap-2 text-xs">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(event) => {
                              const currentIds = match.selectedProducts.map((selectedProduct) => selectedProduct.id);
                              const nextIds = event.target.checked
                                ? [...currentIds, product.id]
                                : currentIds.filter((productId) => productId !== product.id);
                              onManualMatch(match.folder.id, nextIds);
                            }}
                            className="mt-0.5"
                          />
                          <span>
                            <span className="block font-medium">{product.title}</span>
                            <span className="text-ink/50 dark:text-white/50">{product.handle}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                ) : (
                  <select
                    value={match.selectedProducts[0]?.id ?? ""}
                    onChange={(event) => onManualMatch(match.folder.id, event.target.value ? [event.target.value] : [])}
                    className="focus-ring w-full rounded-md border border-ink/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-[#0f1511] dark:text-white"
                  >
                    <option value="">Choose product</option>
                    {products.map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.title} ({product.handle})
                      </option>
                    ))}
                  </select>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function badgeClass(confidence: ProductMatch["confidence"]) {
  if (confidence === "Exact") return "bg-fern/15 text-moss dark:bg-fern/20 dark:text-[#9fce96]";
  if (confidence === "Partial") return "bg-clay/15 text-clay dark:bg-clay/20 dark:text-[#ffb39d]";
  if (confidence === "Variant Group") return "bg-fern/15 text-moss dark:bg-fern/20 dark:text-[#9fce96]";
  if (confidence === "Multiple Matches") return "bg-amber-100 text-amber-800 dark:bg-amber-300/20 dark:text-amber-200";
  return "bg-ink/10 text-ink/60 dark:bg-white/10 dark:text-white/60";
}
