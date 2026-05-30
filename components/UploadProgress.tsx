"use client";

import { AlertCircle, CheckCircle2, Clock, TestTube2 } from "lucide-react";
import type { UploadJob } from "@/types";

export default function UploadProgress({ job }: { job: UploadJob }) {
  return (
    <section className="rounded-md border border-ink/10 bg-white p-4 shadow-soft">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-semibold">Job {job.id.slice(0, 8)}</p>
          <p className="text-xs text-ink/50">{new Date(job.createdAt).toLocaleString()} · {job.mode} · {job.dryRun ? "dry run" : "live"}</p>
        </div>
        <span className="rounded bg-mist px-2 py-1 text-xs font-semibold uppercase text-ink/60">{job.status}</span>
      </div>
      <div className="mt-4 space-y-3">
        {job.products.map((product) => (
          <div key={product.productId} className="rounded-md border border-ink/10 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{product.title}</p>
                <p className="text-xs text-ink/55">{product.message}</p>
              </div>
              {iconFor(product.status)}
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-mist">
              <div className="h-full rounded-full bg-fern" style={{ width: `${product.progress}%` }} />
            </div>
            {product.error ? <p className="mt-2 text-xs text-clay">{product.error}</p> : null}
          </div>
        ))}
      </div>
    </section>
  );
}

function iconFor(status: string) {
  if (status === "success") return <CheckCircle2 className="shrink-0 text-moss" size={19} />;
  if (status === "failed") return <AlertCircle className="shrink-0 text-clay" size={19} />;
  if (status === "dry-run") return <TestTube2 className="shrink-0 text-fern" size={19} />;
  return <Clock className="shrink-0 text-ink/45" size={19} />;
}
