"use client";

import { AlertCircle, ArrowUpRight, Check, LockKeyhole, ShieldCheck, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const scopeLabels = {
  openid: ["Sign in", "登录"],
  profile: ["Basic profile", "基本资料"],
  email: ["Email address", "邮箱地址"],
  "content:read": ["Read published content", "读取已发布内容"],
  "content:write": ["Edit content", "编辑内容"],
  "content:publish": ["Publish content", "发布内容"],
  "assets:read": ["Read assets", "读取资源"],
  "assets:write": ["Manage assets", "管理资源"],
  "integrations:read": ["Read integrations", "读取集成配置"],
  "integrations:write": ["Manage integrations", "管理集成配置"],
  "jobs:read": ["View jobs", "查看任务"],
  "jobs:run": ["Run jobs", "运行任务"],
} as const;

export default function ConsentPage() {
  const oauthQuery = useMemo(
    () => (typeof window === "undefined" ? "" : window.location.search.slice(1)),
    [],
  );
  const isChinese = useMemo(
    () => typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("zh"),
    [],
  );
  const request = useMemo(() => {
    const params = new URLSearchParams(oauthQuery);
    const redirectUri = params.get("redirect_uri") ?? "";
    let appName = "Arsvine Console";
    let appHost = "console.arsvine.com";
    try {
      const url = new URL(redirectUri);
      appHost = url.host;
      appName = url.hostname === "console.arsvine.com" ? "Arsvine Console" : url.hostname;
    } catch {
      // The API will reject an invalid request; keep the page recoverable.
    }
    const scopes = (params.get("scope") ?? "openid").split(" ").filter(Boolean);
    return { appHost, appName, hasQuery: Boolean(oauthQuery), scopes };
  }, [oauthQuery]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const copy = isChinese
    ? {
        kicker: "安全授权",
        title: "授权应用",
        description: "此应用正在请求访问你的 ARSVINE 账户。",
        account: "你的账户",
        permissions: "查看请求的权限",
        noPermissions: "未指定额外权限",
        allow: "允许访问",
        deny: "拒绝",
        note: "你可以随时在账户设置中撤销访问权限。",
        errorTitle: "授权未完成",
        retry: "重试",
        invalid: "授权请求已失效，请从 Console 重新开始。",
      }
    : {
        kicker: "SECURE AUTHORIZATION",
        title: "Authorize application",
        description: "This application is requesting access to your ARSVINE account.",
        account: "Your account",
        permissions: "View requested permissions",
        noPermissions: "No additional permissions requested",
        allow: "Allow access",
        deny: "Deny",
        note: "You can revoke access at any time from your account settings.",
        errorTitle: "Authorization incomplete",
        retry: "Try again",
        invalid: "This authorization request has expired. Start again from Console.",
      };

  async function respond(accept: boolean) {
    if (!request.hasQuery) {
      setError(copy.invalid);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/oauth2/consent", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ accept, oauth_query: oauthQuery }),
      });
      const body = (await response.json().catch(() => null)) as { redirect_uri?: string; message?: string; error_description?: string } | null;
      if (!response.ok || !body?.redirect_uri) {
        throw new Error(body?.error_description ?? body?.message ?? copy.invalid);
      }
      window.location.assign(body.redirect_uri);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.invalid);
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell auth-consent-shell">
      <div className="auth-frame auth-consent-frame">
        <header className="auth-consent-brand">
          <span className="auth-mark">A</span>
          <span>ARSVINE <small>AUTH</small></span>
        </header>

        <Card className="auth-card auth-consent-card">
          <CardHeader className="auth-consent-header">
            <div className="auth-consent-icon" aria-hidden="true"><ShieldCheck size={20} /></div>
            <p className="auth-kicker">{copy.kicker}</p>
            <CardTitle>{copy.title}</CardTitle>
            <CardDescription>{copy.description}</CardDescription>
          </CardHeader>
          <CardContent className="auth-consent-content">
            <div className="auth-consent-app">
              <div>
                <span className="auth-consent-app-name">{request.appName}</span>
                <span className="auth-consent-app-host">{request.appHost}</span>
              </div>
              <ArrowUpRight size={17} aria-hidden="true" />
            </div>

            <div className="auth-consent-account">
              <span className="auth-consent-label">{copy.account}</span>
              <span className="auth-consent-account-value">ARSVINE owner account</span>
            </div>

            <details className="auth-consent-permissions">
              <summary>{copy.permissions} <span>{request.scopes.length}</span></summary>
              {request.scopes.length ? (
                <ul>
                  {request.scopes.map((scope) => {
                    const label = scopeLabels[scope as keyof typeof scopeLabels];
                    return <li key={scope}><Check size={15} aria-hidden="true" /><span>{label ? label[isChinese ? 1 : 0] : scope}</span></li>;
                  })}
                </ul>
              ) : <p>{copy.noPermissions}</p>}
            </details>

            <div className="auth-consent-actions">
              <Button className="auth-consent-deny" disabled={busy} size="lg" variant="outline" type="button" onClick={() => void respond(false)}>
                <X size={16} aria-hidden="true" />
                {copy.deny}
              </Button>
              <Button className="auth-button-primary" disabled={busy} size="lg" type="button" onClick={() => void respond(true)}>
                <Check size={16} aria-hidden="true" />
                {busy ? "…" : copy.allow}
              </Button>
            </div>

            {error ? (
              <div className="auth-consent-error" role="alert">
                <AlertCircle size={17} aria-hidden="true" />
                <div><strong>{copy.errorTitle}</strong><p>{error}</p><Button size="sm" variant="ghost" type="button" onClick={() => { setError(null); setBusy(false); }}>{copy.retry}</Button></div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <p className="auth-consent-note"><LockKeyhole size={14} aria-hidden="true" /> {copy.note}</p>
      </div>
    </main>
  );
}
