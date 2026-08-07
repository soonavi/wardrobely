import { useCallback, useEffect, useRef, useState } from "react";
import {
  addToWishlist,
  isWishlisted,
  removeFromWishlist,
} from "../../lib/api/shop";

/**
 * Local wishlist state for a single product, with an optimistic toggle.
 *
 * The heart has to flip on the same frame it is tapped — a save that waits for
 * a round trip reads as a broken button and gets double-tapped, which is
 * exactly the case `addToWishlist`'s upsert exists to survive. So the local
 * flag moves first and the write reconciles afterwards; a failed write rolls
 * the flag back to what it was, rather than to `false`, so a failed *removal*
 * doesn't leave the UI claiming the item was never saved.
 *
 * Deliberately dependency-free (plain useState/useCallback). This project has
 * no TanStack Query — see package.json — and one hook is not worth a cache
 * layer.
 */

export interface UseWishlistOptions {
  /**
   * Known state at mount, which skips the per-product `isWishlisted` read.
   *
   * A 2-column grid renders 20+ cards at once; letting each one issue its own
   * count query would put 20 round trips behind a single scroll. Grid screens
   * therefore fetch the whole wishlist once (`listWishlist`) and hand each card
   * its answer. The product detail screen, which is a single card, omits this
   * and lets the hook fetch.
   */
  initial?: boolean;
  /** Notified on every optimistic change *and* on rollback, so a parent list can stay in sync. */
  onChange?: (wishlisted: boolean) => void;
}

export interface UseWishlistResult {
  wishlisted: boolean;
  /** The initial read is in flight (always false when `initial` was supplied). */
  loading: boolean;
  /** A toggle write is in flight. */
  pending: boolean;
  error: string | null;
  toggle: () => void;
}

export function useWishlist(
  userId: string | undefined,
  productId: string | undefined,
  options: UseWishlistOptions = {}
): UseWishlistResult {
  const { initial, onChange } = options;
  const knowsInitial = typeof initial === "boolean";

  const [wishlisted, setWishlisted] = useState<boolean>(initial ?? false);
  const [loading, setLoading] = useState<boolean>(!knowsInitial);
  const [pending, setPending] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Held in a ref so a caller passing an inline arrow doesn't rebuild `toggle`
  // on every render (and, through it, re-render every card in a grid).
  const onChangeRef = useRef<UseWishlistOptions["onChange"]>(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // Adopt a *changed* `initial`. This only fires when the parent's answer
  // actually differs from what it last passed, so it can't clobber an
  // optimistic flip the parent hasn't heard about yet.
  useEffect(() => {
    if (!knowsInitial) return;
    setWishlisted(initial === true);
    setLoading(false);
  }, [initial, knowsInitial]);

  useEffect(() => {
    if (knowsInitial) return;

    if (!userId || !productId) {
      setWishlisted(false);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    isWishlisted(userId, productId).then(({ data, error: readError }) => {
      if (cancelled) return;
      if (readError) {
        // A failed read is not worth an error banner — an unsaved-looking
        // heart is a recoverable, self-correcting state, and the toggle's
        // upsert makes a wrong guess harmless.
        setError(readError);
      } else {
        setWishlisted(data === true);
      }
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [userId, productId, knowsInitial]);

  const toggle = useCallback(() => {
    if (!userId || !productId || pending) return;

    const previous = wishlisted;
    const next = !previous;

    setWishlisted(next);
    onChangeRef.current?.(next);
    setPending(true);
    setError(null);

    const write = next
      ? addToWishlist(userId, productId)
      : removeFromWishlist(userId, productId);

    // No unmount guard on purpose. The wishlist screen removes a card from its
    // list the moment `onChange(false)` fires, which unmounts *this* hook while
    // the delete is still in flight — so bailing out on unmount would make a
    // failed removal unrecoverable, silently leaving the row in the database
    // and the card gone from the screen until the next refetch. `onChange` must
    // always fire so the parent can put its own state back; the local setState
    // calls after an unmount are harmless no-ops in React 18+.
    const rollback = (message: string) => {
      setWishlisted(previous);
      onChangeRef.current?.(previous);
      setError(message);
    };

    write
      .then(({ error: writeError }) => {
        setPending(false);
        if (writeError) rollback(writeError);
      })
      .catch((thrown: unknown) => {
        setPending(false);
        rollback(
          thrown instanceof Error
            ? thrown.message
            : "Couldn't update your wishlist."
        );
      });
  }, [userId, productId, pending, wishlisted]);

  return { wishlisted, loading, pending, error, toggle };
}
