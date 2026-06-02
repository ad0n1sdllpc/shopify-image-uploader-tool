"use client";

import { ShieldCheck, TestTube2, UploadCloud, X } from "lucide-react";

export default function ReviewUploadModal({
  open,
  disabled,
  onClose,
  onDryRun,
  onUpload
}: {
  open: boolean;
  disabled: boolean;
  onClose: () => void;
  onDryRun: () => void;
  onUpload: () => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/35 p-4 dark:bg-black/60">
      <div className="admin-card w-full max-w-xl p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <ShieldCheck size={20} />
              Confirm upload
            </h2>
            <p className="mt-2 text-sm admin-muted">Dry run records the planned job without changing Shopify. Live upload creates Shopify media, verifies it, then runs optional deletion if enabled.</p>
          </div>
          <button onClick={onClose} className="focus-ring rounded p-1 text-subdued hover:text-ink dark:text-white/70 dark:hover:text-white" title="Close">
            <X size={20} />
          </button>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <div className="rounded-md border border-line bg-mist p-3 dark:border-white/10 dark:bg-white/5">
            <p className="text-sm font-semibold">Dry Run</p>
            <p className="mt-1 text-xs admin-muted">Checks the payload and planned products only.</p>
          </div>
          <div className="rounded-md border border-clay/30 bg-clay/5 p-3 dark:bg-clay/10">
            <p className="text-sm font-semibold text-clay dark:text-[#ffb39d]">Live Upload</p>
            <p className="mt-1 text-xs admin-muted">Writes media changes to selected Shopify products.</p>
          </div>
        </div>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <button disabled={disabled} onClick={() => { onDryRun(); onClose(); }} className="admin-button flex-1">
            <TestTube2 size={17} />
            Dry Run
          </button>
          <button disabled={disabled} onClick={() => { onUpload(); onClose(); }} className="admin-button-danger flex-1">
            <UploadCloud size={17} />
            Live Upload
          </button>
        </div>
      </div>
    </div>
  );
}
