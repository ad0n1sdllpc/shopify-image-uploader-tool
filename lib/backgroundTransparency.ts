import "server-only";
import path from "node:path";
import sharp from "sharp";

const NEAR_WHITE_THRESHOLD = 245;

export type PreparedImageUpload = {
  bytes: Buffer;
  fileName: string;
  mimeType: string;
};

function transparentFileName(filePath: string) {
  const parsed = path.parse(filePath);
  return `${parsed.name}.png`;
}

export async function removeWhiteBackground(filePath: string): Promise<PreparedImageUpload> {
  const image = sharp(filePath).ensureAlpha();
  const metadata = await image.metadata();

  if (!metadata.width || !metadata.height) {
    throw new Error(`Could not read image dimensions for ${path.basename(filePath)}.`);
  }

  const pixels = await image.raw().toBuffer();

  for (let index = 0; index < pixels.length; index += 4) {
    const red = pixels[index];
    const green = pixels[index + 1];
    const blue = pixels[index + 2];

    if (red >= NEAR_WHITE_THRESHOLD && green >= NEAR_WHITE_THRESHOLD && blue >= NEAR_WHITE_THRESHOLD) {
      pixels[index + 3] = 0;
    }
  }

  const bytes = await sharp(pixels, {
    raw: {
      width: metadata.width,
      height: metadata.height,
      channels: 4
    }
  }).png().toBuffer();

  return {
    bytes,
    fileName: transparentFileName(filePath),
    mimeType: "image/png"
  };
}
