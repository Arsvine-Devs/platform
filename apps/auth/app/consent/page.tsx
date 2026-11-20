import type { Metadata } from "next";
import { headers } from "next/headers";
import { readConsentRequest, type OAuthSearchParams } from "@/lib/consent";
import { authLocale } from "@/lib/locale-server";
import ConsentForm from "./consent-form";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title:
      (await authLocale()) === "zh-CN" ? "授权应用" : "Authorize application",
  };
}

export default async function ConsentPage({
  searchParams,
}: {
  searchParams: Promise<OAuthSearchParams>;
}) {
  const request = await readConsentRequest(await searchParams, await headers());
  return <ConsentForm request={request} language={await authLocale()} />;
}
