import Link from 'next/link';
import { ArrowRight, Check } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export default function SignedOutPage() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-4 py-12 text-foreground">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-2 text-sm font-semibold tracking-tight">
          <span className="grid size-8 place-items-center rounded-lg bg-foreground text-background">
            A
          </span>
          <span>
            ARSVINE <span className="font-normal text-muted-foreground">CONSOLE</span>
          </span>
        </div>
        <Card className="shadow-sm">
          <CardHeader className="gap-4 p-6 sm:p-8">
            <div className="grid size-11 place-items-center rounded-xl border bg-muted text-foreground">
              <Check size={21} aria-hidden="true" />
            </div>
            <div className="grid gap-2">
              <CardTitle className="text-2xl tracking-tight">You’re signed out</CardTitle>
              <CardDescription className="text-sm leading-6">
                Console and Auth sessions have been closed. Sign in again when you are ready.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="border-t p-6 sm:p-8">
            <Link className={cn(buttonVariants({ size: 'lg' }), 'w-full')} href="/login">
              Sign in again
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
