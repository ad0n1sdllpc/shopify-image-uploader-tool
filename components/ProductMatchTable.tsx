"use client";

import { useMemo, useState } from "react";
import { Copy, Download } from "lucide-react";
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
    return <p className="admin-card p-5 text-sm admin-muted">Fetch products after scanning folders to generate matches.</p>;
  }

  const noMatches = matches.filter((match) => match.confidence === "No Match");
  const matchedRows = matches.filter((match) => match.confidence !== "No Match");

  return (
    <div className="space-y-4">
      {matchedRows.length > 0 ? <MatchTable matches={matchedRows} products={products} onManualMatch={onManualMatch} /> : null}
      {noMatches.length > 0 ? (
        <section className="space-y-2">
          <NoMatchesSummary noMatches={noMatches} />
          <MatchTable matches={noMatches} products={products} onManualMatch={onManualMatch} />
        </section>
      ) : null}
    </div>
  );
}

function NoMatchesSummary({ noMatches }: { noMatches: ProductMatch[] }) {
  const [copied, setCopied] = useState(false);
  const exportText = useMemo(() => noMatchExportText(noMatches), [noMatches]);

  async function copyText() {
    await navigator.clipboard.writeText(exportText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  function downloadText() {
    const blob = new Blob([exportText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `no-match-products-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="admin-card border-clay/25 bg-clay/5 p-4 dark:border-clay/30 dark:bg-clay/10">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold">No matches</h2>
          <p className="text-xs admin-muted">{noMatches.length} folder(s) need manual product selection.</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button type="button" onClick={copyText} className="admin-button text-xs" title="Copy no-match product folders">
            <Copy className="h-3.5 w-3.5" />
            {copied ? "Copied" : "Copy"}
          </button>
          <button type="button" onClick={downloadText} className="admin-button text-xs" title="Export no-match product folders">
            <Download className="h-3.5 w-3.5" />
            Export
          </button>
        </div>
      </div>
    </div>
  );
}

function noMatchExportText(noMatches: ProductMatch[]) {
  const lines = [
    "No matches",
    `${noMatches.length} folder(s) need manual product selection.`,
    "",
    ...noMatches.map((match, index) => `${index + 1}. ${match.folder.relativePath || match.folder.tileName}`)
  ];
  return lines.join("\n");
}

function MatchTable({
  matches,
  products,
  onManualMatch
}: {
  matches: ProductMatch[];
  products: ShopifyProduct[];
  onManualMatch: (folderId: string, productIds: string[]) => void;
}) {
  if (matches.length === 0) {
    return <p className="admin-card p-5 text-sm admin-muted">No rows in this section.</p>;
  }

  return (
    <div className="admin-card overflow-x-auto">
      <table className="admin-table">
        <thead className="admin-table-head sticky top-0 z-10">
          <tr>
            <th className="px-3 py-2">Folder</th>
            <th className="px-3 py-2">Confidence</th>
            <th className="px-3 py-2">Selected products</th>
            <th className="px-3 py-2">Reason</th>
            <th className="px-3 py-2">Manual selection</th>
          </tr>
        </thead>
        <tbody>
          {matches.map((match) => (
            <tr key={match.folder.id} className="admin-table-row align-top">
              <td className="px-3 py-2">
                <p className="font-medium">{match.folder.tileName}</p>
                <p className="text-xs admin-muted">{match.folder.relativePath}</p>
              </td>
              <td className="px-3 py-2">
                <span className={`admin-badge ${badgeClass(match.confidence)}`}>{match.confidence}</span>
              </td>
              <td className="px-3 py-2">
                {match.selectedProducts.length > 0 ? (
                  <div>
                    <p className="text-xs font-semibold admin-muted">{match.selectedProducts.length} product(s) selected</p>
                    <div className="mt-1 flex max-w-md flex-wrap gap-1">
                      {match.selectedProducts.map((product) => (
                        <span key={product.id} className="admin-badge bg-moss/10 text-moss dark:bg-[#0f3a2f] dark:text-[#8fd6bc]">{product.title}</span>
                      ))}
                    </div>
                  </div>
                ) : (
                  <span className="text-sm admin-muted">Needs selection</span>
                )}
              </td>
              <td className="max-w-sm px-3 py-2 text-sm admin-muted">{match.reason}</td>
              <td className="px-3 py-2">
                {match.candidates.length > 1 ? (
                  <div className="max-h-44 min-w-72 space-y-1 overflow-auto rounded-md border border-line bg-mist/60 p-2 dark:border-white/10 dark:bg-white/5">
                    {match.candidates.map((product) => {
                      const checked = match.selectedProducts.some((selectedProduct) => selectedProduct.id === product.id);
                      return (
                        <label key={product.id} className={`flex items-start gap-2 rounded px-2 py-1.5 text-xs ${checked ? "bg-white text-ink dark:bg-white/10 dark:text-white" : "text-subdued dark:text-white/60"}`}>
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
                            className="mt-0.5 h-3.5 w-3.5 rounded border-line text-moss dark:border-white/20 dark:bg-[#0f1115]"
                          />
                          <span>
                            <span className="block font-medium">{product.title}</span>
                            <span className="admin-muted">{product.handle}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                ) : (
                  <select
                    value={match.selectedProducts[0]?.id ?? ""}
                    onChange={(event) => onManualMatch(match.folder.id, event.target.value ? [event.target.value] : [])}
                    className="admin-input w-full min-w-72"
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
