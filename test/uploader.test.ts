import { describe, expect, it } from "vitest";
import { createDryRunJob } from "@/lib/uploader";
import type { UploadSelection } from "@/types";

const selection: UploadSelection = {
  folder: {
    id: "folder",
    size: "60x60",
    tileName: "LUZ-14MEA",
    absolutePath: "/TILES/60x60/LUZ-14MEA",
    relativePath: "60x60/LUZ-14MEA",
    images: []
  },
  product: {
    id: "gid://shopify/Product/1",
    title: "Luz Tile",
    handle: "luz-tile",
    variantsSkus: ["LUZ-14MEA"],
    mediaIds: ["old-media"],
    firstImageUrl: null,
    totalMediaCount: 1
  },
  selectedFirstImagePath: "/first.jpg",
  orderedImagePaths: ["/first.jpg", "/second.jpg"],
  mode: "append-folder",
  deleteOldMedia: false
};

describe("uploader planning", () => {
  it("creates a successful dry-run job without uploaded media", () => {
    const job = createDryRunJob([selection]);

    expect(job.dryRun).toBe(true);
    expect(job.removeWhiteBackground).toBe(false);
    expect(job.status).toBe("success");
    expect(job.products[0].status).toBe("dry-run");
    expect(job.products[0].uploadedMediaIds).toEqual([]);
    expect(job.products[0].message).toContain("2 image");
  });

  it("mentions white background removal in dry-run jobs", () => {
    const job = createDryRunJob([selection], { removeWhiteBackground: true });

    expect(job.removeWhiteBackground).toBe(true);
    expect(job.products[0].message).toContain("white backgrounds removed");
  });
});
