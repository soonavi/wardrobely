import { getGarmentImageUrl } from "../../lib/api/garments";

/**
 * Thin wrappers over the garments API's signed-URL helper (the bucket is
 * private). Keeps all Supabase access inside src/lib/api/* per convention.
 */
export async function getSignedGarmentImageUrl(
  imagePath: string
): Promise<string | null> {
  const { data } = await getGarmentImageUrl(imagePath);
  return data ?? null;
}

/** Resolve signed URLs for a batch of image paths, keyed by path. */
export async function getSignedGarmentImageUrls(
  imagePaths: string[]
): Promise<Record<string, string>> {
  const uniquePaths = Array.from(new Set(imagePaths));
  const entries = await Promise.all(
    uniquePaths.map(async (path) => {
      const url = await getSignedGarmentImageUrl(path);
      return [path, url] as const;
    })
  );

  const result: Record<string, string> = {};
  for (const [path, url] of entries) {
    if (url) {
      result[path] = url;
    }
  }
  return result;
}
