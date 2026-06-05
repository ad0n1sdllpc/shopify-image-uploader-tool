import { describe, expect, it } from "vitest";
import { createDryRunJob } from "@/lib/uploader";
import type { UploadSelection } from "@/types";

const selection: UploadSelection = {
  folder: {
    id: "folder",
    name: "LUZ-14MEA",
    productCode: "LUZ-14MEA",
    category: "60x60",
    absolutePath: "/IMAGES/60x60/LUZ-14MEA",
    relativePath: "60x60/LUZ-14MEA",
    images: []
  },
  products: [{
    id: "gid://shopify/Product/1",
    title: "Luz Product",
    handle: "luz-product",
    variantsSkus: ["LUZ-14MEA"],
    media: [{ id: "old-media", url: null, position: 0 }],
    mediaIds: ["old-media"],
    firstImageUrl: null,
    mediaImageUrls: [],
    totalMediaCount: 1
  }],
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

  it("expands grouped selections into one dry-run product entry per target product", () => {
    const job = createDryRunJob([{
      ...selection,
      products: [
        ...selection.products,
        {
          ...selection.products[0],
          id: "gid://shopify/Product/2",
          title: "Min Product"
        }
      ]
    }]);

    expect(job.products.map((product) => product.title)).toEqual(["Luz Product", "Min Product"]);
  });
});
