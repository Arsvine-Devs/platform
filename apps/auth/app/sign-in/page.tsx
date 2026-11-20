import type { Metadata } from "next";
import { authLocale } from "@/lib/locale-server";
import { signedOAuthQuery, type OAuthSearchParams } from "@/lib/consent";
import SignInForm from "./sign-in-form";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await authLocale()) === "zh-CN" ? "登录" : "Sign in" };
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<OAuthSearchParams>;
}) {
  const query = signedOAuthQuery(await searchParams);
  return (
    <SignInForm
      initialLanguage={await authLocale()}
      oauthQuery={query.has("sig") ? query.toString() : ""}
    />
  );
}
