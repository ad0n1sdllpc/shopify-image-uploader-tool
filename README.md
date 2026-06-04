# Shopify Tile Image Uploader

A local Shopify Admin media tool for high-volume tile product image work. It scans local tile folders, matches them to Shopify products, lets you review image order, uploads in batches, and includes media cleanup tools for duplicate Shopify images.

This project is intended for store operators who manage many tile or surface products with repeated variants such as `LUZ-11AW1`, `VIS-11AW1`, and `MIN-11AW1`.

## Features

- Scan local image folders such as `./TILES`.
- Match local tile folders to Shopify products by tile code.
- Group sibling product variants like `LUZ / VIS / MIN`.
- Review local upload order before uploading.
- Upload by batches of tile groups.
- Replace first image, append images, or replace full gallery.
- Optionally remove white backgrounds during upload without changing local files.
- Delete old Shopify media after verification.
- Media Manager for viewing and bulk-deleting duplicate non-first product media.
- Checkpoint save/load for long review sessions.
- Dark mode and compact Shopify-admin-style UI.

## Tech Stack

- Next.js 14
- React 18
- TypeScript
- Tailwind CSS
- Shopify Admin GraphQL API
- Sharp for image processing
- Vitest for tests
- SQL.js for local upload history

## Requirements

- Node.js 20 or newer
- npm
- A Shopify custom app with Admin API access
- A Shopify Admin API access token with product/media permissions

Typical required Shopify scopes:

- `read_products`
- `write_products`
- `read_files`
- `write_files`

Your exact scopes may depend on the Shopify API version and store setup.

## Setup

Install dependencies:

```bash
npm install
```

Create `.env.local`:

```bash
SHOPIFY_STORE_DOMAIN=your-store.myshopify.com
SHOPIFY_ADMIN_ACCESS_TOKEN=shpat_your_admin_api_token
SHOPIFY_API_VERSION=2026-01
TILE_UPLOAD_DB_PATH=./tile-uploader.db
```

Start the local app:

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

## Expected Folder Structure

The scanner expects a local folder containing tile folders and image files. Example:

```text
TILES/
  10x10/
    11AW1/
      1.jpg
      2.jpg
    11BC3/
      1.png
      2.jpg
  30x30/
    L31/
      1.jpg
      2.jpg
```

The app uses the folder tile code, such as `11AW1`, to match Shopify products like:

```text
LUZ-11AW1
VIS-11AW1
MIN-11AW1
```

## Workflow

1. **Folder Scan**
   - Enter the local folder path.
   - Scan local image folders.

2. **Product Matching**
   - Fetch Shopify products.
   - Match local folder tile codes to Shopify products.
   - Variant products are grouped by tile code where possible.

3. **Image Selector**
   - Review each tile folder.
   - Choose upload mode.
   - Reorder local images.
   - Choose whether old media should be deleted after verification.

4. **Review Upload**
   - Products are included by default.
   - Use Clear all / Select all to control what uploads.
   - Upload current batch by tile group.
   - Use dry run before live upload when needed.

5. **Media Manager**
   - View matched Shopify product media.
   - Group variants under the same tile code.
   - Select non-first duplicate images.
   - Bulk delete selected media with confirmation.

6. **History**
   - Review previous upload jobs and failures.

## Upload Behavior

The upload process is designed to avoid blind destructive changes:

- New images are staged through Shopify.
- Product media is created through the Admin API.
- Media order is updated.
- Shopify media order is verified.
- Old media is deleted only after verification when the option is enabled.

Local source image files are not modified.

## Generated Filenames And Alt Text

The uploader can control Shopify filenames by passing generated filenames during staged upload. Shopify filenames are set at upload time and cannot be renamed afterward through the Admin API.

Recommended naming pattern:

```text
product-handle.jpg
product-handle-room.jpg
product-handle-gallery-3.jpg
```

Recommended alt text pattern:

```text
Product Title tile
Product Title room view
Product Title gallery image 3
```

Shopify may append a unique suffix if the same filename already exists in the store.

## White Background Removal

The Review Upload page includes a **Remove white background** option.

When enabled:

- Local files remain unchanged.
- Uploaded versions are processed with Sharp.
- Near-white pixels are converted to transparency.
- Processed files upload as PNG because JPEG does not support transparency.

## Checkpoints

For large catalogs, use **Save checkpoint** before stopping work. The checkpoint stores scan, matching, review, and batch progress so you can continue later.

Browser state is intentionally compact. Full Shopify media URLs should be refreshed from Shopify when needed instead of being stored permanently in browser localStorage.

## Safety Notes

- Test with a small product batch first.
- Use dry run before live upload for large batches.
- First media is protected in Media Manager delete flows.
- Old media deletion during upload happens only after successful verification.
- Keep a Shopify backup/export process outside this tool for important production catalogs.

## Useful Commands

```bash
npm run dev
npm test
npm run build
npx tsc --noEmit
```

## Troubleshooting

### Invalid API key or access token

Check:

- `SHOPIFY_STORE_DOMAIN`
- `SHOPIFY_ADMIN_ACCESS_TOKEN`
- Admin API scopes
- Shopify API version

### Product matching takes a long time

Large catalogs can take time because the app fetches many Shopify products and media records. Use batching in Review Upload for live uploads.

### Browser localStorage quota exceeded

Use the latest compact-state version of the app. Save a checkpoint if you are doing long review sessions.

### Images do not show in Media Manager

Click **Refresh products** or run **Fetch Products And Match** again so the app reloads current Shopify media URLs.

## Project Status

This is a local operations tool, not a hosted SaaS product. Run it only in a trusted local environment and protect your Shopify Admin API token.
