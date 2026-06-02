"use client";

import { AlertCircle, CheckCircle2, Clock, TestTube2 } from "lucide-react";
import type { UploadJob } from "@/types";

export default function UploadProgress({ job }: { job: UploadJob }) {
  return (
    <section className="admin-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-semibold">Job {job.id.slice(0, 8)}</p>
          <p className="text-xs admin-muted">
            {new Date(job.createdAt).toLocaleString()} - {job.mode} - {job.dryRun ? "dry run" : "live"}
            {job.removeWhiteBackground ? " - transparent PNG" : ""}
          </p>
        </div>
        <span className={`admin-badge uppercase ${jobBadgeClass(job.status)}`}>{job.status}</span>
      </div>
      <div className="mt-4 divide-y divide-line overflow-hidden rounded-md border border-line dark:divide-white/10 dark:border-white/10">
        {job.products.map((product) => (
          <div key={product.productId} className="bg-white p-3 dark:bg-white/5">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{product.title}</p>
                <p className="text-xs admin-muted">{product.message}</p>
              </div>
              {iconFor(product.status)}
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-mist dark:bg-white/10">
              <div className="h-full rounded-full bg-fern dark:bg-[#9fce96]" style={{ width: `${product.progress}%` }} />
            </div>
            {product.error ? <p className="mt-2 text-xs text-clay dark:text-[#ffb39d]">{product.error}</p> : null}
          </div>
        ))}
      </div>
    </section>
  );
}

function jobBadgeClass(status: UploadJob["status"]) {
  if (status === "success") return "bg-moss/10 text-moss dark:bg-[#0f3a2f] dark:text-[#8fd6bc]";
  if (status === "failed") return "bg-clay/10 text-clay dark:bg-clay/20 dark:text-[#ffb39d]";
  if (status === "partial") return "bg-amber-100 text-amber-800 dark:bg-amber-300/20 dark:text-amber-200";
  if (status === "running") return "bg-blue-100 text-blue-800 dark:bg-blue-300/20 dark:text-blue-200";
  return "bg-mist text-subdued dark:bg-white/10 dark:text-white/60";
}

function iconFor(status: string) {
  if (status === "success") return <CheckCircle2 className="shrink-0 text-moss dark:text-[#9fce96]" size={19} />;
  if (status === "failed") return <AlertCircle className="shrink-0 text-clay dark:text-[#ffb39d]" size={19} />;
  if (status === "dry-run") return <TestTube2 className="shrink-0 text-fern dark:text-[#9fce96]" size={19} />;
  return <Clock className="shrink-0 text-ink/45 dark:text-white/45" size={19} />;
}
