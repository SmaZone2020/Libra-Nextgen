import { useCallback, useEffect, useState } from 'react';
import { getBuilderStatus } from '../../api/build';
import type { BuilderStatus } from '../../api/build';

/**
 * Fetch the builder status (mode + per-platform template cache) once on mount
 * and expose a reload() for refreshing it (e.g. when the platform dropdown
 * opens). Failures are swallowed — the Builder UI degrades to a static
 * fallback platform list.
 */
export function useBuilderStatus() {
  const [status, setStatus] = useState<BuilderStatus | null>(null);

  const reload = useCallback(async () => {
    try {
      setStatus(await getBuilderStatus());
    } catch {
      // Advisory only; the fallback list keeps the selector usable.
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return { status, reload };
}
