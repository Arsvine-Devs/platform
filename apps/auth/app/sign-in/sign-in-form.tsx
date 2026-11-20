"use client";

import {
  browserSupportsWebAuthn,
  startAuthentication,
} from "@simplewebauthn/browser";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ChevronRight, KeyRound } from "lucide-react";
import { AUTH_LOCALE_COOKIE, type AuthLocale } from "@/lib/locale";
import { oauthDestination } from "@/lib/oauth-navigation";
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

function scrambleCharacter(character: string, language: AuthLocale) {
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

function localizeAuthError(message: string | null, language: AuthLocale) {
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
  language: AuthLocale;
  runKey: number;
  text: string;
}) {
  const [displayedText, setDisplayedText] = useState(text);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (!animated || runKey === 0 || text.length === 0 || motion.matches) {
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

    const restoreText = (event: MediaQueryListEvent) => {
      if (!event.matches) return;
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
      setDisplayedText(text);
    };
    motion.addEventListener("change", restoreText);
    return () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
      motion.removeEventListener("change", restoreText);
    };
  }, [animated, language, runKey, text]);

  return (
    <span aria-hidden="true" className="auth-key-action-label">
      {displayedText}
    </span>
  );
}

type SignInReply = {
  redirect?: boolean;
  url?: string;
  error?: { message?: string };
  message?: string;
  twoFactorRedirect?: boolean;
};

export default function SignInForm({
  initialLanguage,
  oauthQuery,
}: {
  initialLanguage: AuthLocale;
  oauthQuery: string;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({ email: "", password: "" });
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [keyBusy, setKeyBusy] = useState(false);
  const [twoFactorRequired, setTwoFactorRequired] = useState(false);
  const [showCredentials, setShowCredentials] = useState(false);
  const [language, setLanguage] = useState(initialLanguage);
  const totpInput = useRef<HTMLInputElement>(null);
  const submitting = useRef(false);
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
          showPassword: "显示密码",
          continue: "继续",
          signingIn: "正在登录…",
          language: "语言",
          passkeyCanceled:
            "已取消或未及时完成安全密钥验证。可以重试或使用密码。",
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
          showPassword: "Show password",
          continue: "Continue",
          signingIn: "Signing in…",
          language: "Language",
          passkeyCanceled:
            "Security key verification was canceled or timed out. Try again or use your password.",
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
  useEffect(() => {
    if (twoFactorRequired) totpInput.current?.focus();
  }, [twoFactorRequired]);

  function changeLanguage(locale: AuthLocale) {
    setLanguage(locale);
    document.documentElement.lang = locale;
    document.title =
      locale === "zh-CN" ? "登录 · Arsvine Auth" : "Sign in · Arsvine Auth";
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${AUTH_LOCALE_COOKIE}=${locale}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
  }

  function triggerKeyTypewriter() {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const now = performance.now();
    if (now - keyTypewriterLastRun.current < TYPEWRITER_COOLDOWN_MS) return;
    keyTypewriterLastRun.current = now;
    setKeyTypewriterRun((value) => value + 1);
  }

  function continueAfterAuth(result: SignInReply) {
    if (oauthQuery) {
      const target =
        result.redirect && result.url
          ? oauthDestination(result.url, oauthQuery, window.location.origin)
          : null;
      if (!target) throw new Error(copy.signInFailed);
      window.location.assign(target);
      return;
    }
    window.location.assign("/security");
  }

  async function submitAuth(
    path: string,
    body: object,
    fallback: string,
  ): Promise<SignInReply> {
    const response = await fetch(`/api/auth/${path}`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...body,
        ...(oauthQuery ? { oauth_query: oauthQuery } : {}),
      }),
    });
    const result = (await response
      .json()
      .catch(() => null)) as SignInReply | null;
    if (!response.ok || !result) {
      throw new Error(result?.error?.message ?? result?.message ?? fallback);
    }
    return result;
  }

  async function signInWithPasskey() {
    if (submitting.current) return;
    submitting.current = true;
    setKeyBusy(true);
    setError(null);
    try {
      if (!browserSupportsWebAuthn())
        throw new Error("This browser does not support passkeys.");
      const optionsResponse = await fetch(
        "/api/auth/passkey/generate-authenticate-options",
        { cache: "no-store" },
      );
      const options = (await optionsResponse
        .json()
        .catch(() => null)) as PublicKeyCredentialRequestOptionsJSON | null;
      if (!optionsResponse.ok || !options?.challenge)
        throw new Error(copy.passkeyFailed);
      const assertion =
        typeof PublicKeyCredential.parseRequestOptionsFromJSON === "function" &&
        typeof PublicKeyCredential.prototype.toJSON === "function"
          ? await navigator.credentials
              .get({
                publicKey:
                  PublicKeyCredential.parseRequestOptionsFromJSON(options),
              })
              .then((credential) => {
                if (!(credential instanceof PublicKeyCredential))
                  throw new Error(copy.passkeyFailed);
                return credential.toJSON() as Awaited<
                  ReturnType<typeof startAuthentication>
                >;
              })
          : await startAuthentication({
              optionsJSON: options as Parameters<
                typeof startAuthentication
              >[0]["optionsJSON"],
            });
      const { clientExtensionResults: _extensions, ...response } = assertion;
      const result = await submitAuth(
        "passkey/verify-authentication",
        { response },
        copy.passkeyFailed,
      );
      continueAfterAuth(result);
      return;
    } catch (cause) {
      setError(
        cause instanceof Error && cause.name === "NotAllowedError"
          ? copy.passkeyCanceled
          : cause instanceof Error
            ? cause.message
            : copy.passkeyFailed,
      );
      submitting.current = false;
      setKeyBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await submitAuth(
        "sign-in/email",
        { email: email.trim(), password },
        copy.signInFailed,
      );
      if (result.twoFactorRedirect) {
        setPassword("");
        setTwoFactorRequired(true);
        submitting.current = false;
        setBusy(false);
        return;
      }
      continueAfterAuth(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.signInFailed);
      submitting.current = false;
      setBusy(false);
    }
  }

  async function verifyTwoFactor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await submitAuth(
        "two-factor/verify-totp",
        { code: twoFactorCode, trustDevice: false },
        copy.verificationFailed,
      );
      continueAfterAuth(result);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : copy.verificationFailed,
      );
      totpInput.current?.focus();
      submitting.current = false;
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
              <select
                aria-label={copy.language}
                className="auth-language-trigger"
                value={language}
                onChange={(event) =>
                  changeLanguage(
                    event.target.value === "zh-CN" ? "zh-CN" : "en",
                  )
                }
              >
                <option value="en" lang="en">
                  English
                </option>
                <option value="zh-CN" lang="zh-CN">
                  中文
                </option>
              </select>
            </div>
          </div>
        </section>

        {!twoFactorRequired && (
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
                disabled={keyBusy || busy}
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
                aria-controls="credentials"
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
                id="credentials"
                className="auth-disclosure-panel"
                data-expanded={showCredentials ? "true" : "false"}
              >
                <div
                  className="auth-disclosure-inner"
                  aria-hidden={!showCredentials}
                  inert={!showCredentials ? true : undefined}
                >
                  <form className="auth-form" method="post" onSubmit={submit}>
                    <FieldGroup>
                      <Field>
                        <FieldLabel htmlFor="email">{copy.email}</FieldLabel>
                        <Input
                          id="email"
                          name="email"
                          aria-invalid={Boolean(fieldErrors.email)}
                          aria-describedby={
                            fieldErrors.email ? "email-error" : undefined
                          }
                          autoComplete="username"
                          enterKeyHint="next"
                          spellCheck={false}
                          type="email"
                          required
                          value={email}
                          onChange={(event) => {
                            setEmail(event.target.value);
                            setError(null);
                            setFieldErrors((current) => ({
                              ...current,
                              email: "",
                            }));
                          }}
                          onInvalid={(event) => {
                            const email = event.currentTarget.validationMessage;
                            setFieldErrors((current) => ({
                              ...current,
                              email,
                            }));
                          }}
                        />
                        <FieldError id="email-error">
                          {fieldErrors.email}
                        </FieldError>
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="password">
                          {copy.password}
                        </FieldLabel>
                        <Input
                          id="password"
                          name="password"
                          aria-invalid={Boolean(fieldErrors.password)}
                          aria-describedby={
                            fieldErrors.password ? "password-error" : undefined
                          }
                          autoComplete="current-password"
                          enterKeyHint="go"
                          type={showPassword ? "text" : "password"}
                          required
                          value={password}
                          onChange={(event) => {
                            setPassword(event.target.value);
                            setError(null);
                            setFieldErrors((current) => ({
                              ...current,
                              password: "",
                            }));
                          }}
                          onInvalid={(event) => {
                            const password =
                              event.currentTarget.validationMessage;
                            setFieldErrors((current) => ({
                              ...current,
                              password,
                            }));
                          }}
                        />
                        <FieldError id="password-error">
                          {fieldErrors.password}
                        </FieldError>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="self-start"
                          aria-pressed={showPassword}
                          onClick={() => setShowPassword((value) => !value)}
                        >
                          {copy.showPassword}
                        </Button>
                      </Field>
                    </FieldGroup>
                    <Button
                      className="auth-button auth-button-primary"
                      disabled={busy || keyBusy}
                      size="lg"
                      type="submit"
                    >
                      {busy ? copy.signingIn : copy.continue}
                    </Button>
                  </form>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {twoFactorRequired ? (
          <Card className="auth-card auth-totp">
            <CardHeader className="auth-form-heading">
              <p className="auth-panel-label">{copy.secondFactor}</p>
              <CardTitle>{copy.authenticatorCode}</CardTitle>
              <CardDescription>{copy.authenticatorDescription}</CardDescription>
            </CardHeader>
            <CardContent className="auth-form">
              <form
                className="contents"
                method="post"
                onSubmit={verifyTwoFactor}
              >
                <Field>
                  <FieldLabel htmlFor="two-factor-code">
                    {copy.codeLabel}
                  </FieldLabel>
                  <Input
                    id="two-factor-code"
                    ref={totpInput}
                    name="code"
                    aria-invalid={Boolean(error)}
                    aria-describedby={error ? "sign-in-error" : undefined}
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    enterKeyHint="done"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    required
                    value={twoFactorCode}
                    onChange={(event) => {
                      setTwoFactorCode(
                        event.target.value.replace(/\D/g, "").slice(0, 6),
                      );
                      setError(null);
                    }}
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

        <div role="alert" id="sign-in-error">
          {error && (
            <p className="auth-error">{localizeAuthError(error, language)}</p>
          )}
        </div>
      </div>
    </main>
  );
}
