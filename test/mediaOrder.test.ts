import { beforeEach, describe, expect, it, vi } from "vitest";
import { pollShopifyJob } from "@/lib/mediaOrder";
import { shopifyGraphql } from "@/lib/shopify";

vi.mock("@/lib/shopify", () => ({
  fetchProductMediaIds: vi.fn(),
  shopifyGraphql: vi.fn()
}));

const mockedShopifyGraphql = vi.mocked(shopifyGraphql);

describe("media order polling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("polls Shopify reorder jobs using fields available on Job", async () => {
    mockedShopifyGraphql.mockResolvedValueOnce({ job: { id: "gid://shopify/Job/1", done: true } });

    await pollShopifyJob("gid://shopify/Job/1");

    const query = mockedShopifyGraphql.mock.calls[0][0];
    expect(query).toContain("id done");
    expect(query).not.toContain("status");
  });
});
