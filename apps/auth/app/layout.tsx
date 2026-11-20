import { Geist } from "next/font/google";
import type { Metadata, Viewport } from "next";
import { cn } from "@/lib/utils";
import { authLocale } from "@/lib/locale-server";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: { default: "Arsvine Auth", template: "%s · Arsvine Auth" },
};

export const viewport: Viewport = { colorScheme: "light dark" };

export default async function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang={await authLocale()} className={cn("font-sans", geist.variable)}>
      <body>{children}</body>
    </html>
  );
}
