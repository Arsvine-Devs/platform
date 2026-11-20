import { cookies, headers } from "next/headers";
import { AUTH_LOCALE_COOKIE, type AuthLocale } from "./locale";

export async function authLocale(): Promise<AuthLocale> {
  const preferred = (await cookies()).get(AUTH_LOCALE_COOKIE)?.value;
  if (preferred === "en" || preferred === "zh-CN") return preferred;
  const accepted = (await headers()).get("accept-language") ?? "";
  for (const item of accepted.split(",")) {
    const language = item.split(";")[0]?.trim().toLowerCase().split("-")[0];
    if (language === "zh") return "zh-CN";
    if (language === "en") return "en";
  }
  return "en";
}
