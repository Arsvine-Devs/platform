import Link from 'next/link';
import { AlertTriangle, ArrowLeft, RotateCw } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const messages = {
  invalid_callback: {
    title: 'Authorization expired',
    description: 'This sign-in attempt is no longer valid. Start a fresh authorization request from Console.',
  },
  identity_claims_incomplete: {
    title: 'Account handoff incomplete',
    description: 'Your identity was verified, but Console did not receive the required account role. Please try again.',
  },
  oidc_callback_failed: {
    title: 'Could not finish sign-in',
    description: 'The authorization service returned an incomplete response. Start a new sign-in attempt.',
  },
} as const;

export default async function AuthErrorPage({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const { reason } = await searchParams;
  const message = messages[reason as keyof typeof messages] ?? messages.oidc_callback_failed;

  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-4 py-12 text-foreground">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-2 text-sm font-semibold tracking-tight">
          <span className="grid size-8 place-items-center rounded-lg bg-foreground text-background">A</span>
          <span>ARSVINE <span className="font-normal text-muted-foreground">CONSOLE</span></span>
        </div>
        <Card className="shadow-sm">
          <CardHeader className="gap-4 p-6 sm:p-8">
            <div className="grid size-11 place-items-center rounded-xl border bg-muted text-muted-foreground">
              <AlertTriangle size={21} aria-hidden="true" />
            </div>
            <div className="grid gap-2">
              <CardTitle className="text-2xl tracking-tight">{message.title}</CardTitle>
              <CardDescription className="text-sm leading-6">{message.description}</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 border-t p-6 sm:flex-row sm:p-8">
            <Link className={cn(buttonVariants({ size: 'lg' }), 'flex-1')} href="/login?returnTo=/library">
              <RotateCw size={16} aria-hidden="true" />
              Try again
            </Link>
            <Link className={cn(buttonVariants({ size: 'lg', variant: 'outline' }), 'flex-1')} href="/">
              <ArrowLeft size={16} aria-hidden="true" />
              Back home
            </Link>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
