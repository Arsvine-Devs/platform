"use client";

import { createAuthClient } from "better-auth/client";
import { twoFactorClient } from "better-auth/client/plugins";
import { passkeyClient } from "@better-auth/passkey/client";
import {
  browserSupportsWebAuthn,
  startAuthentication,
} from "@simplewebauthn/browser";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, KeyRound, Languages } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";

type AuthLanguage = "en" | "zh-CN";

const LATIN_BASE_CHARS = Array.from(
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
);
const LATIN_DIACRITIC_CHARS = Array.from(
  "ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØŒÙÚÛÜÝÞàáâãäåæçèéêëìíîïðñòóôõöøœùúûüýþĀĂĄĆĈĊČĎĐĒĖĘĚĜĞĠĢĪĮİĴĶĹĽŁŃŇŅŌŎŐŔŘŚŠŞŤŪŮŰŲŴŶŹŻŽāăąćĉċčďđēėęěĝğġģīįıĵķĺľłńňņōŏőŕřśšşťūůűųŵŷźżž",
);
const CJK_COMMON_CHARS = Array.from("安全密钥使用继续登录邮箱密码");
const CJK_SCRAMBLE_CHARS = Array.from(
  "⼀⼁⼂⼃⼄⼅⼆⼇⼈⼉⼊⼋⼌⼍⼎⼏⼐⼑⼒⼓⼔⼕⼖⼗⼘⼙⼚⼛⼜⼝⼞⼟⼠⼡⼢⼣⼤⼥⼦⼧⼨⼩⼪⼫⼬⼭⼮⼯⼰⼱⼲⼳⼴⼵⼶⼷⼸⼹⼺⼻⼼⼽⼾⼿⽀⽁⽂⽃⽄⽅⽆⽇⽈⽉⽊⽋⽌⽍⽎⽏⽐⽑⽒⽓⽔⽕⽖⽗⽘⽙⽚⽛⽜⽝⽞⽟⽠⽡⽢⽣⽤⽥⽦⽧⽨⽩⽪⽫⽬⽭⽮⽯⽰⽱⽲⽳⽴⽵⽶⽷⽸⽹⽺⽻⽼⽽⽾⽿ㄅㄆㄇㄈㄉㄊㄋㄌㄍㄎㄏㄐㄑㄒㄓㄔㄕㄖㄗㄘㄙㄚㄛㄜㄝㄞㄟㄠㄡㄢㄣㄤㄥㄦㄧㄨㄩ",
);
const BLOCK_SCRAMBLE_CHARS = Array.from("▪▫◼◻");
const TYPEWRITER_TOTAL_MS = 760;
const TYPEWRITER_COOLDOWN_MS = 1600;

function randomCharacter(pool: string[]) {
  return pool[Math.floor(Math.random() * pool.length)] ?? "";
}

function scrambleCharacter(character: string, language: AuthLanguage) {
  if (/\s/u.test(character)) return character;
  const roll = Math.random();
  if (roll < 0.04) return randomCharacter(BLOCK_SCRAMBLE_CHARS);
  if (language === "zh-CN") {
    return randomCharacter(roll < 0.18 ? CJK_SCRAMBLE_CHARS : CJK_COMMON_CHARS);
  }
  return randomCharacter(
    roll < 0.18 ? LATIN_DIACRITIC_CHARS : LATIN_BASE_CHARS,
  );
}

function localizeAuthError(message: string | null, language: AuthLanguage) {
  if (!message || language === "en") return message;
  const messages: Record<string, string> = {
    "Enter a valid email address.": "请输入有效的邮箱地址。",
    "Enter your password.": "请输入密码。",
    "Invalid code": "验证码无效。",
    "Invalid password": "密码错误。",
    "Verification failed.": "验证失败。",
    "Sign-in failed.": "登录失败。",
    "Passkey sign-in failed.": "安全密钥登录失败。",
    "This browser does not support passkeys.": "此浏览器不支持安全密钥。",
  };
  return messages[message] ?? message;
}

function TypewriterLabel({
  animated,
  language,
  runKey,
  text,
}: {
  animated: boolean;
  language: AuthLanguage;
  runKey: number;
  text: string;
}) {
  const [displayedText, setDisplayedText] = useState(text);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    if (!animated || runKey === 0 || text.length === 0) {
      // The typewriter frame is produced by the timer-driven animation.
      // oxlint-disable-next-line react/set-state-in-effect -- animation state follows the external timer.
      setDisplayedText(text);
      return;
    }

    const targetCharacters = Array.from(text);
    const currentCharacters = targetCharacters.map((character) =>
      scrambleCharacter(character, language),
    );
    let typedLength = 0;
    let correctionIndex = 0;
    setDisplayedText("");
    const stepInterval =
      TYPEWRITER_TOTAL_MS / Math.max(1, targetCharacters.length * 2);

    timerRef.current = window.setInterval(() => {
      if (typedLength < targetCharacters.length) {
        typedLength += 1;
        setDisplayedText(currentCharacters.slice(0, typedLength).join(""));
        return;
      }

      while (
        correctionIndex < targetCharacters.length &&
        /\s/u.test(targetCharacters[correctionIndex] ?? "")
      ) {
        correctionIndex += 1;
      }
      if (correctionIndex >= targetCharacters.length) {
        setDisplayedText(text);
        if (timerRef.current !== null) window.clearInterval(timerRef.current);
        return;
      }

      currentCharacters[correctionIndex] =
        targetCharacters[correctionIndex] ?? "";
      correctionIndex += 1;
      for (
        let index = correctionIndex;
        index < targetCharacters.length;
        index += 1
      ) {
        currentCharacters[index] = scrambleCharacter(
          targetCharacters[index] ?? "",
          language,
        );
      }
      setDisplayedText(currentCharacters.join(""));
    }, stepInterval);

    return () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
    };
  }, [animated, language, runKey, text]);

  return (
    <span aria-hidden="true" className="auth-key-action-label">
      {displayedText}
    </span>
  );
}

export default function SignInPage() {
  const oauthQuery = useMemo(
    () =>
      typeof window === "undefined" ? "" : window.location.search.slice(1),
    [],
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [keyBusy, setKeyBusy] = useState(false);
  const [twoFactorRequired, setTwoFactorRequired] = useState(false);
  const [showCredentials, setShowCredentials] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [language, setLanguage] = useState<AuthLanguage>("en");
  const [languageOpen, setLanguageOpen] = useState(false);
  const [keyTypewriterRun, setKeyTypewriterRun] = useState(0);
  const keyTypewriterLastRun = useRef(0);
  const copy =
    language === "zh-CN"
      ? {
          kicker: "ARSVINE AUTH",
          title: "登录",
          key: "安全密钥",
          helper: "密钥绑定设备，触碰一次即可继续。",
          useKey: "使用安全密钥继续",
          waiting: "等待密钥…",
          credentials: "使用邮箱和密码",
          hideCredentials: "收起邮箱登录",
          account: "邮箱和密码",
          email: "邮箱",
          password: "密码",
          continue: "继续",
          invalidEmail: "请输入有效的邮箱地址。",
          passwordRequired: "请输入密码。",
          signInFailed: "登录失败。",
          passkeyFailed: "安全密钥登录失败。",
          secondFactor: "二次验证",
          authenticatorCode: "验证器代码",
          authenticatorDescription: "请输入已注册验证器生成的六位验证码。",
          codeLabel: "六位验证码",
          verify: "验证",
          verifying: "验证中…",
          verificationFailed: "验证失败。",
        }
      : {
          kicker: "ARSVINE AUTH",
          title: "Sign in",
          key: "Security key",
          helper: "Device-bound access. Touch once to continue.",
          useKey: "Continue with security key",
          waiting: "Waiting for key…",
          credentials: "Use email and password",
          hideCredentials: "Hide account sign-in",
          account: "Email and password",
          email: "Email",
          password: "Password",
          continue: "Continue",
          invalidEmail: "Enter a valid email address.",
          passwordRequired: "Enter your password.",
          signInFailed: "Sign-in failed.",
          passkeyFailed: "Passkey sign-in failed.",
          secondFactor: "SECOND FACTOR",
          authenticatorCode: "Authenticator code",
          authenticatorDescription:
            "Enter the six-digit code from your registered authenticator.",
          codeLabel: "Six-digit code",
          verify: "Verify code",
          verifying: "Verifying…",
          verificationFailed: "Verification failed.",
        };
  const authClient = useMemo(
    () =>
      createAuthClient({
        plugins: [
          passkeyClient(),
          twoFactorClient({
            onTwoFactorRedirect: () => setTwoFactorRequired(true),
          }),
        ],
      }),
    [],
  );

  function triggerKeyTypewriter() {
    const now = performance.now();
    if (now - keyTypewriterLastRun.current < TYPEWRITER_COOLDOWN_MS) return;
    keyTypewriterLastRun.current = now;
    setKeyTypewriterRun((value) => value + 1);
  }

  function continueAfterAuth() {
    window.location.assign(oauthQuery ? `/consent?${oauthQuery}` : "/security");
  }

  async function signInWithPasskey() {
    setKeyBusy(true);
    setError(null);
    try {
      if (!browserSupportsWebAuthn())
        throw new Error("This browser does not support passkeys.");
      if (oauthQuery) {
        const optionsResponse = await fetch(
          "/api/auth/passkey/generate-authenticate-options",
        );
        const options = (await optionsResponse
          .json()
          .catch(() => null)) as Record<string, unknown> | null;
        if (!optionsResponse.ok || !options?.challenge)
          throw new Error("Passkey sign-in failed.");
        const authentication = await startAuthentication({
          optionsJSON: options as unknown as Parameters<
            typeof startAuthentication
          >[0]["optionsJSON"],
        });
        const { clientExtensionResults: _clientExtensionResults, ...response } =
          authentication;
        const verifyResponse = await fetch(
          "/api/auth/passkey/verify-authentication",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ response, oauth_query: oauthQuery }),
          },
        );
        const verifyBody = (await verifyResponse.json().catch(() => null)) as {
          error?: { message?: string };
          message?: string;
        } | null;
        if (!verifyResponse.ok)
          throw new Error(
            verifyBody?.error?.message ??
              verifyBody?.message ??
              "Passkey sign-in failed.",
          );
      } else {
        const result = await authClient.signIn.passkey();
        if (result.error)
          throw new Error(result.error.message ?? "Passkey sign-in failed.");
      }
      continueAfterAuth();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Passkey sign-in failed.",
      );
    } finally {
      setKeyBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFormError(null);
    if (!email.trim() || !email.includes("@")) {
      setFormError(copy.invalidEmail);
      setBusy(false);
      return;
    }
    if (!password) {
      setFormError(copy.passwordRequired);
      setBusy(false);
      return;
    }
    try {
      const response = await fetch("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          ...(oauthQuery ? { oauth_query: oauthQuery } : {}),
        }),
      });
      const signInData = (await response.json().catch(() => null)) as {
        error?: { message?: string };
        message?: string;
        twoFactorRedirect?: boolean;
      } | null;
      if (!response.ok) {
        throw new Error(
          signInData?.error?.message ??
            signInData?.message ??
            copy.signInFailed,
        );
      }
      if (signInData?.twoFactorRedirect) {
        setTwoFactorRequired(true);
        setBusy(false);
        return;
      }
      continueAfterAuth();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sign-in failed.");
      setBusy(false);
    }
  }

  async function verifyTwoFactor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await authClient.twoFactor.verifyTotp({
        code: twoFactorCode,
        trustDevice: false,
      });
      if (result.error)
        throw new Error(result.error.message ?? copy.verificationFailed);
      continueAfterAuth();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Verification failed.");
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <div className="auth-frame">
        <section className="auth-intro">
          <div className="auth-intro-head">
            <div>
              <p className="auth-kicker">{copy.kicker}</p>
              <h1>{copy.title}</h1>
            </div>
            <div className="auth-language">
              <Button
                aria-expanded={languageOpen}
                aria-haspopup="menu"
                className="auth-language-trigger"
                size="sm"
                variant="outline"
                type="button"
                onClick={() => setLanguageOpen((value) => !value)}
              >
                <Languages size={14} aria-hidden="true" />
                {language === "en" ? "EN" : "中文"}
                <ChevronDown size={14} aria-hidden="true" />
              </Button>
              {languageOpen ? (
                <div className="auth-language-menu" role="menu">
                  <Button
                    className="auth-language-option"
                    size="sm"
                    variant="ghost"
                    role="menuitem"
                    type="button"
                    onClick={() => {
                      setLanguage("en");
                      setLanguageOpen(false);
                    }}
                  >
                    English
                  </Button>
                  <Button
                    className="auth-language-option"
                    size="sm"
                    variant="ghost"
                    role="menuitem"
                    type="button"
                    onClick={() => {
                      setLanguage("zh-CN");
                      setLanguageOpen(false);
                    }}
                  >
                    中文
                  </Button>
                </div>
              ) : null}
            </div>
          </div>
        </section>

        <Card className="auth-card">
          <CardHeader className="auth-key-panel">
            <div>
              <CardTitle>{copy.key}</CardTitle>
              <CardDescription className="auth-panel-copy">
                {copy.helper}
              </CardDescription>
            </div>
            <Button
              aria-label={keyBusy ? copy.waiting : copy.useKey}
              className="auth-button auth-button-primary auth-key-action"
              disabled={keyBusy}
              size="lg"
              title={copy.useKey}
              type="button"
              onClick={() => void signInWithPasskey()}
              onFocus={triggerKeyTypewriter}
              onMouseEnter={triggerKeyTypewriter}
            >
              <span className="auth-key-action-icon">
                <KeyRound size={18} aria-hidden="true" />
              </span>
              <TypewriterLabel
                animated={!keyBusy}
                language={language}
                runKey={keyTypewriterRun}
                text={keyBusy ? copy.waiting : copy.useKey}
              />
            </Button>
          </CardHeader>

          <CardContent className="auth-disclosure">
            <Button
              aria-expanded={showCredentials}
              className="auth-disclosure-trigger"
              variant="ghost"
              type="button"
              onClick={() => setShowCredentials((value) => !value)}
            >
              <span>
                {showCredentials ? copy.hideCredentials : copy.credentials}
              </span>
              <ChevronRight
                className={showCredentials ? "rotate-90" : ""}
                aria-hidden="true"
              />
            </Button>
            <div
              className="auth-disclosure-panel"
              data-expanded={showCredentials ? "true" : "false"}
            >
              <div
                className="auth-disclosure-inner"
                aria-hidden={!showCredentials}
                inert={!showCredentials ? true : undefined}
              >
                <form className="auth-form" onSubmit={submit}>
                  <FieldGroup>
                    <Field>
                      <FieldLabel htmlFor="email">{copy.email}</FieldLabel>
                      <Input
                        id="email"
                        aria-describedby={
                          formError ? "credentials-error" : undefined
                        }
                        aria-invalid={Boolean(formError)}
                        autoComplete="email"
                        inputMode="email"
                        type="text"
                        value={email}
                        onChange={(event) => {
                          setEmail(event.target.value);
                          setFormError(null);
                        }}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="password">
                        {copy.password}
                      </FieldLabel>
                      <Input
                        id="password"
                        aria-describedby={
                          formError ? "credentials-error" : undefined
                        }
                        aria-invalid={Boolean(formError)}
                        autoComplete="current-password"
                        type="password"
                        value={password}
                        onChange={(event) => {
                          setPassword(event.target.value);
                          setFormError(null);
                        }}
                      />
                    </Field>
                  </FieldGroup>
                  <FieldError id="credentials-error">{formError}</FieldError>
                  <Button
                    className="auth-button auth-button-primary"
                    disabled={busy}
                    size="lg"
                    type="submit"
                  >
                    {busy ? "Signing in…" : copy.continue}
                  </Button>
                </form>
              </div>
            </div>
          </CardContent>
        </Card>

        {twoFactorRequired ? (
          <Card className="auth-card auth-totp">
            <CardHeader className="auth-form-heading">
              <p className="auth-panel-label">{copy.secondFactor}</p>
              <CardTitle>{copy.authenticatorCode}</CardTitle>
              <CardDescription>{copy.authenticatorDescription}</CardDescription>
            </CardHeader>
            <CardContent className="auth-form">
              <form className="contents" onSubmit={verifyTwoFactor}>
                <Field>
                  <FieldLabel htmlFor="two-factor-code">
                    {copy.codeLabel}
                  </FieldLabel>
                  <Input
                    id="two-factor-code"
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    maxLength={6}
                    required
                    value={twoFactorCode}
                    onChange={(event) =>
                      setTwoFactorCode(
                        event.target.value.replace(/\D/g, "").slice(0, 6),
                      )
                    }
                  />
                </Field>
                <Button
                  className="auth-button auth-button-primary"
                  disabled={busy}
                  size="lg"
                  type="submit"
                >
                  {busy ? copy.verifying : copy.verify}
                </Button>
              </form>
            </CardContent>
          </Card>
        ) : null}

        {error ? (
          <p className="auth-error" role="alert">
            {localizeAuthError(error, language)}
          </p>
        ) : null}
      </div>
    </main>
  );
}
