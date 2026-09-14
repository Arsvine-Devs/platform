'use client';

import { useEffect, useState } from 'react';
import { Analytics } from '@vercel/analytics/react';

export default function AdminAnalytics() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setEnabled(process.env.NEXT_PUBLIC_ANALYTICS_ENABLED === '1');
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  return enabled ? <Analytics /> : null;
}
