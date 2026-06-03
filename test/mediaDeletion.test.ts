import { beforeEach, describe, expect, it, vi } from "vitest";
import { deleteSelectedProductMedia } from "@/lib/mediaDeletion";
import { deleteProductMedia, fetchProductMedia } from "@/lib/shopify";

vi.mock("@/lib/shopify", () => ({
  deleteProductMedia: vi.fn(),
  fetchProductMedia: vi.fn()
}));

const mockedDeleteProductMedia = vi.mocked(deleteProductMedia);
const mockedFetchProductMedia = vi.mocked(fetchProductMedia);

describe("protected media deletion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refuses to delete the current first media", async () => {
    mockedFetchProductMedia.mockResolvedValueOnce([
      { id: "first", url: null, position: 0 },
      { id: "second", url: null, position: 1 }
    ]);
    mockedDeleteProductMedia.mockResolvedValueOnce(["second"]);

    const [result] = await deleteSelectedProductMedia([{ productId: "product-1", mediaIds: ["first", "second"] }]);

    expect(mockedDeleteProductMedia).toHaveBeenCalledWith("product-1", ["second"]);
    expect(result.deletedMediaIds).toEqual(["second"]);
    expect(result.skippedMediaIds).toEqual(["first"]);
  });
});
