import { Suspense } from 'react';
import ActivationPageClient from '../../components/auth/activation-page-client';

export default function ActivatePage() {
  return (
    <Suspense fallback={null}>
      <ActivationPageClient />
    </Suspense>
  );
}
