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
      <div className="w-full max-w-lg rounded-md bg-white p-5 shadow-soft dark:border dark:border-white/10 dark:bg-[#151d18] dark:text-white dark:shadow-none">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <ShieldCheck size={20} />
              Confirm upload
            </h2>
            <p className="mt-2 text-sm text-ink/65 dark:text-white/65">New Shopify media will be uploaded and verified before any optional deletion runs. Dry run records the planned job without mutating Shopify.</p>
          </div>
          <button onClick={onClose} className="focus-ring rounded p-1 text-ink/70 hover:text-ink dark:text-white/70 dark:hover:text-white" title="Close">
            <X size={20} />
          </button>
        </div>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <button disabled={disabled} onClick={() => { onDryRun(); onClose(); }} className="focus-ring inline-flex flex-1 items-center justify-center gap-2 rounded-md border border-ink/15 bg-white px-4 py-2 text-sm font-semibold dark:border-white/15 dark:bg-white/5 dark:text-white">
            <TestTube2 size={17} />
            Dry Run
          </button>
          <button disabled={disabled} onClick={() => { onUpload(); onClose(); }} className="focus-ring inline-flex flex-1 items-center justify-center gap-2 rounded-md bg-clay px-4 py-2 text-sm font-semibold text-white">
            <UploadCloud size={17} />
            Live Upload
          </button>
        </div>
      </div>
    </div>
  );
}
