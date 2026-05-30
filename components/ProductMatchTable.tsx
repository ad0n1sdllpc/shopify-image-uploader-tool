"use client";

import type { ProductMatch, ShopifyProduct } from "@/types";

export default function ProductMatchTable({
  matches,
  products,
  onManualMatch
}: {
  matches: ProductMatch[];
  products: ShopifyProduct[];
  onManualMatch: (folderId: string, productId: string) => void;
}) {
  if (matches.length === 0) {
    return <p className="rounded-md border border-ink/10 bg-white p-5 text-sm text-ink/60">Fetch products after scanning folders to generate matches.</p>;
  }

  return (
    <div className="overflow-hidden rounded-md border border-ink/10 bg-white">
      <table className="w-full min-w-[860px] text-left text-sm">
        <thead className="bg-mist text-xs uppercase text-ink/55">
          <tr>
            <th className="px-4 py-3">Folder</th>
            <th className="px-4 py-3">Confidence</th>
            <th className="px-4 py-3">Product</th>
            <th className="px-4 py-3">Reason</th>
            <th className="px-4 py-3">Manual Selection</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink/10">
          {matches.map((match) => (
            <tr key={match.folder.id}>
              <td className="px-4 py-3">
                <p className="font-medium">{match.folder.tileName}</p>
                <p className="text-xs text-ink/50">{match.folder.relativePath}</p>
              </td>
              <td className="px-4 py-3">
                <span className={`rounded px-2 py-1 text-xs font-semibold ${badgeClass(match.confidence)}`}>{match.confidence}</span>
              </td>
              <td className="px-4 py-3">{match.product?.title ?? "Needs selection"}</td>
              <td className="px-4 py-3 text-ink/60">{match.reason}</td>
              <td className="px-4 py-3">
                <select
                  value={match.product?.id ?? ""}
                  onChange={(event) => onManualMatch(match.folder.id, event.target.value)}
                  className="focus-ring w-full rounded-md border border-ink/15 bg-white px-3 py-2 text-sm"
                >
                  <option value="">Choose product</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.title} ({product.handle})
                    </option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function badgeClass(confidence: ProductMatch["confidence"]) {
  if (confidence === "Exact") return "bg-fern/15 text-moss";
  if (confidence === "Partial") return "bg-clay/15 text-clay";
  if (confidence === "Multiple Matches") return "bg-amber-100 text-amber-800";
  return "bg-ink/10 text-ink/60";
}
