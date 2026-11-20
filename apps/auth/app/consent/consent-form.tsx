"use client";

import { Check, ShieldCheck } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import type { ConsentRequest } from "@/lib/consent";
import type { AuthLocale } from "@/lib/locale";
import { oauthDestination } from "@/lib/oauth-navigation";

const scopeLabels = {
  openid: ["Sign in", "登录"],
  profile: ["Basic profile", "基本资料"],
  email: ["Email address", "邮箱地址"],
  "content:read": ["Read published content", "读取已发布内容"],
  "content:write": ["Edit content", "编辑内容"],
  "content:publish": ["Publish content", "发布内容"],
  "content:protected:read": ["Read protected content", "读取受保护的内容"],
  "assets:read": ["Read assets", "读取资源"],
  "assets:write": ["Manage assets", "管理资源"],
  "integrations:read": ["Read integrations", "读取集成配置"],
  "integrations:write": ["Manage integrations", "管理集成配置"],
  "jobs:read": ["View jobs", "查看任务"],
  "jobs:run": ["Run jobs", "运行任务"],
} as const;

export default function ConsentForm({
  request,
  language,
}: {
  request: ConsentRequest | null;
  language: AuthLocale;
}) {
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState("");
  const isChinese = language === "zh-CN";
  const copy = isChinese
    ? {
        title: "授权应用",
        invalid: "授权请求已失效。请返回发起授权的应用重试。",
        failed: "授权未完成，请重试。",
        description: "确认此应用可以访问的账户信息。",
        account: "账户",
        scopes: "请求的权限",
        claims: "请求的账户字段",
        allow: "允许访问",
        deny: "拒绝",
        pending: "正在提交授权选择…",
      }
    : {
        title: "Authorize application",
        invalid:
          "This request has expired. Return to the application and start again.",
        failed: "Authorization could not be completed. Try again.",
        description:
          "Review the account access this application has requested.",
        account: "Account",
        scopes: "Requested permissions",
        claims: "Requested account fields",
        allow: "Allow access",
        deny: "Deny",
        pending: "Submitting your decision…",
      };

  async function respond(accept: boolean) {
    if (!request || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/oauth2/consent", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ accept, oauth_query: request.signedQuery }),
      });
      const body = (await response.json()) as {
        redirect?: boolean;
        url?: string;
      };
      const target =
        body.redirect && body.url
          ? oauthDestination(
              body.url,
              request.signedQuery,
              window.location.origin,
            )
          : null;
      if (!response.ok || !target) {
        throw new Error(copy.failed);
      }
      window.location.assign(target);
    } catch {
      setError(copy.failed);
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell auth-consent-shell">
      <div className="auth-frame auth-consent-frame">
        <Card className="auth-card auth-consent-card">
          <CardHeader className="auth-consent-header">
            <div className="auth-consent-icon" aria-hidden="true">
              <ShieldCheck size={20} />
            </div>
            <h1>{copy.title}</h1>
            <CardDescription>
              {request ? copy.description : copy.invalid}
            </CardDescription>
          </CardHeader>
          {request && (
            <CardContent className="auth-consent-content">
              <div className="auth-consent-app">
                <div>
                  {request.appName && (
                    <span className="auth-consent-app-name">
                      {request.appName}
                    </span>
                  )}
                  <span className="auth-consent-app-host">
                    {request.appDestination}
                  </span>
                </div>
              </div>
              <div className="auth-consent-account">
                <span className="auth-consent-label">{copy.account}</span>
                <span className="auth-consent-account-value">
                  {request.email}
                </span>
              </div>
              {request.scopes.length > 0 && (
                <details className="auth-consent-permissions" open>
                  <summary>{copy.scopes}</summary>
                  <ul>
                    {request.scopes.map((scope) => {
                      const label =
                        scopeLabels[scope as keyof typeof scopeLabels];
                      return (
                        <li key={scope}>
                          <Check size={15} aria-hidden="true" />
                          {label?.[isChinese ? 1 : 0] ?? scope}
                        </li>
                      );
                    })}
                  </ul>
                </details>
              )}
              {request.claims.length > 0 && (
                <details className="auth-consent-permissions" open>
                  <summary>{copy.claims}</summary>
                  <ul>
                    {request.claims.map((claim) => (
                      <li key={claim}>{claim}</li>
                    ))}
                  </ul>
                </details>
              )}
              <div
                className="auth-consent-actions"
                aria-busy={busy || undefined}
              >
                <Button
                  className="auth-consent-deny"
                  disabled={busy}
                  size="lg"
                  variant="outline"
                  type="button"
                  onClick={() => void respond(false)}
                >
                  {copy.deny}
                </Button>
                <Button
                  className="auth-button-primary"
                  disabled={busy}
                  size="lg"
                  type="button"
                  onClick={() => void respond(true)}
                >
                  {copy.allow}
                </Button>
              </div>
              <div role="status">{busy ? copy.pending : ""}</div>
              <div role="alert">{error}</div>
            </CardContent>
          )}
        </Card>
      </div>
    </main>
  );
}
