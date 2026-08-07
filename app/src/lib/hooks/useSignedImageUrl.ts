import { useEffect, useState } from "react";
import { getGarmentImageUrl } from "../api/garments";

/**
 * Resolves a garment storage image_path into a signed, time-limited URL
 * suitable for <Image source={{ uri }} />. Re-resolves whenever the
 * imagePath changes; returns null while loading or on error. Passing
 * null/undefined is a documented no-op (idle, not loading, no error).
 *
 * This is the **storage-only** primitive. Screens rendering a garment row
 * should call `useGarmentImageUrl` from ../garmentImage instead, which picks
 * between this and a catalog garment's already-public CDN url — a
 * catalog-sourced garment has no `image_path` to sign at all.
 */
export function useSignedImageUrl(imagePath: string | null | undefined): {
  url: string | null;
  loading: boolean;
  error: string | null;
} {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!imagePath);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!imagePath) {
      setUrl(null);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    getGarmentImageUrl(imagePath).then((result) => {
      if (cancelled) return;
      if (result.error) {
        setError(result.error);
        setUrl(null);
      } else {
        setUrl(result.data);
      }
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [imagePath]);

  return { url, loading, error };
}
