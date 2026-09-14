'use client';

import { useEffect, useState } from 'react';
import { Analytics } from '@vercel/analytics/react';

export default function AdminAnalytics() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const hostname = window.location.hostname;
      setEnabled(hostname !== 'localhost' && hostname !== '127.0.0.1' && hostname !== '[::1]');
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  return enabled ? <Analytics /> : null;
}
