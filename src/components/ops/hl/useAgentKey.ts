import { useEffect, useState } from 'react';
import type { Hex } from 'viem';
import { getAgentKey } from '@/lib/ops/hl/common';

/** Loads the operation's agent key from the secure store. `null` – the key is not on this device. */
export const useAgentKey = (opId: string): Hex | null | undefined => {
  const [key, setKey] = useState<Hex | null>();
  useEffect(() => {
    let stale = false;
    void getAgentKey(opId)
      .then((k) => {
        if (!stale) setKey(k ?? null);
      })
      .catch(() => {
        if (!stale) setKey(null);
      });
    return () => {
      stale = true;
    };
  }, [opId]);
  return key;
};
