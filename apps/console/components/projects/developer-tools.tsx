'use client';

import { useEffect } from 'react';

export function DeveloperTools() {
  useEffect(() => {
    let disposed = false;
    let unregister: (() => void) | undefined;
    void import('@ui-sdk/react/agent').then(({ createAgent, registerTools }) => {
      if (disposed) return;
      const agent = createAgent({ allow: () => false });
      unregister = registerTools(agent, { allow: () => false });
    });
    return () => {
      disposed = true;
      unregister?.();
    };
  }, []);

  return null;
}
