import type { TestInfo } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

type ImageParityOptions = {
  legacy: Buffer;
  next: Buffer;
  label: string;
  testInfo: TestInfo;
  maxDiffRatio: number;
};

function safeLabel(label: string) {
  return label.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "root";
}

async function persistFailure(options: ImageParityOptions, diff: Buffer | undefined) {
  const stem = safeLabel(options.label);
  const legacyPath = options.testInfo.outputPath(`${stem}-legacy.png`);
  const nextPath = options.testInfo.outputPath(`${stem}-next.png`);
  const diffPath = options.testInfo.outputPath(`${stem}-diff.png`);
  await mkdir(path.dirname(legacyPath), { recursive: true });
  await Promise.all([
    writeFile(legacyPath, options.legacy),
    writeFile(nextPath, options.next),
    ...(diff ? [writeFile(diffPath, diff)] : []),
  ]);
  await options.testInfo.attach(`${stem}-legacy`, {
    path: legacyPath,
    contentType: "image/png",
  });
  await options.testInfo.attach(`${stem}-next`, {
    path: nextPath,
    contentType: "image/png",
  });
  if (diff) {
    await options.testInfo.attach(`${stem}-diff`, {
      path: diffPath,
      contentType: "image/png",
    });
  }
}

function dimensionMismatchDiff(legacy: PNG, next: PNG) {
  const width = Math.max(legacy.width, next.width);
  const height = Math.max(legacy.height, next.height);
  const diff = new PNG({ width, height });

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const target = (y * width + x) * 4;
      const hasLegacyPixel = x < legacy.width && y < legacy.height;
      const hasNextPixel = x < next.width && y < next.height;

      if (hasLegacyPixel && hasNextPixel) {
        const legacyPixel = (y * legacy.width + x) * 4;
        const nextPixel = (y * next.width + x) * 4;
        diff.data[target] = Math.abs(legacy.data[legacyPixel]! - next.data[nextPixel]!);
        diff.data[target + 1] = Math.abs(legacy.data[legacyPixel + 1]! - next.data[nextPixel + 1]!);
        diff.data[target + 2] = Math.abs(legacy.data[legacyPixel + 2]! - next.data[nextPixel + 2]!);
      } else if (hasLegacyPixel) {
        diff.data[target] = 255;
        diff.data[target + 2] = 255;
      } else {
        diff.data[target + 1] = 255;
        diff.data[target + 2] = 255;
      }
      diff.data[target + 3] = 255;
    }
  }

  return PNG.sync.write(diff);
}

export async function assertImageParity(options: ImageParityOptions) {
  const legacy = PNG.sync.read(options.legacy);
  const next = PNG.sync.read(options.next);

  if (legacy.width !== next.width || legacy.height !== next.height) {
    await persistFailure(options, dimensionMismatchDiff(legacy, next));
    throw new Error(
      `Screenshot dimensions differ for ${options.label}: legacy ${legacy.width}x${legacy.height}, Next ${next.width}x${next.height}.`,
    );
  }

  const diff = new PNG({ width: legacy.width, height: legacy.height });
  const differingPixels = pixelmatch(
    legacy.data,
    next.data,
    diff.data,
    legacy.width,
    legacy.height,
    { includeAA: false, threshold: 0.1 },
  );
  const totalPixels = legacy.width * legacy.height;
  const diffRatio = differingPixels / totalPixels;

  if (diffRatio > options.maxDiffRatio) {
    await persistFailure(options, PNG.sync.write(diff));
    throw new Error(
      `Visual difference for ${options.label} was ${(diffRatio * 100).toFixed(3)}% (${differingPixels}/${totalPixels} pixels), above ${(options.maxDiffRatio * 100).toFixed(3)}%.`,
    );
  }
}
