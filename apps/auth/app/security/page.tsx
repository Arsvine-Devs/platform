"use client";

import { passkeyClient } from "@better-auth/passkey/client";
import { twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/client";
import Image from "next/image";
import Link from "next/link";
import * as QRCode from "qrcode";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Check,
  KeyRound,
  LockKeyhole,
  ShieldCheck,
  Smartphone,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

type SessionUser = {
  id: string;
  email: string;
  role?: string;
  twoFactorEnabled?: boolean;
};

type SecurityKey = {
  id: string;
  name?: string;
  deviceType?: string;
  backedUp?: boolean;
  createdAt: string | Date;
};

function formatDate(value: string | Date) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(date);
}

function deviceLabel(deviceType?: string) {
  if (deviceType === "singleDevice") return "This device";
  if (deviceType === "multiDevice") return "Synced passkey";
  return "Security key";
}

function SecurityKeyRow({ passkey }: { passkey: SecurityKey }) {
  return (
    <li className="auth-security-item">
      <span className="auth-security-item-icon" aria-hidden="true">
        <KeyRound size={17} />
      </span>
      <span className="auth-security-item-copy">
        <strong>{passkey.name?.trim() || "Unnamed security key"}</strong>
        <span>
          {deviceLabel(passkey.deviceType)} · Registered{" "}
          {formatDate(passkey.createdAt)}
        </span>
      </span>
      <span className="auth-security-status">
        <Check size={14} aria-hidden="true" />
        Active
      </span>
    </li>
  );
}

export default function SecurityPage() {
  const authClient = useMemo(
    () => createAuthClient({ plugins: [passkeyClient(), twoFactorClient()] }),
    [],
  );
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [securityError, setSecurityError] = useState<string | null>(null);
  const [passkeys, setPasskeys] = useState<SecurityKey[]>([]);
  const [passkeysLoading, setPasskeysLoading] = useState(true);
  const [label, setLabel] = useState("Primary security key");
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyMessage, setKeyMessage] = useState<string | null>(null);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [totpQr, setTotpQr] = useState<string | null>(null);
  const [totpBackupCodes, setTotpBackupCodes] = useState<string[]>([]);
  const [totpCode, setTotpCode] = useState("");
  const [totpPassword, setTotpPassword] = useState("");
  const [totpBusy, setTotpBusy] = useState(false);
  const [totpMessage, setTotpMessage] = useState<string | null>(null);
  const [totpError, setTotpError] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadSecuritySettings() {
      try {
        const sessionResult = await authClient.getSession();
        if (!active) return;
        if (sessionResult.error || !sessionResult.data?.user) {
          setUser(null);
          return;
        }

        setUser(sessionResult.data.user as SessionUser);
        const passkeyResult = await authClient.passkey.listUserPasskeys();
        if (!active) return;
        if (passkeyResult.error) {
          throw new Error(
            passkeyResult.error.message ?? "Unable to load security keys.",
          );
        }
        setPasskeys((passkeyResult.data ?? []) as SecurityKey[]);
      } catch (cause) {
        if (active) {
          setSecurityError(
            cause instanceof Error
              ? cause.message
              : "Unable to load security settings.",
          );
        }
      } finally {
        if (active) {
          setLoading(false);
          setPasskeysLoading(false);
        }
      }
    }

    void loadSecuritySettings();
    return () => {
      active = false;
    };
  }, [authClient]);

  async function refreshPasskeys() {
    const result = await authClient.passkey.listUserPasskeys();
    if (result.error) {
      throw new Error(result.error.message ?? "Unable to load security keys.");
    }
    setPasskeys((result.data ?? []) as SecurityKey[]);
  }

  async function registerKey() {
    setKeyBusy(true);
    setKeyError(null);
    setKeyMessage(null);
    try {
      const result = await authClient.passkey.addPasskey({
        name: label.trim() || "Security key",
        authenticatorAttachment: "cross-platform",
        createSession: false,
      });
      if (result.error) {
        throw new Error(
          result.error.message ?? "Security key registration failed.",
        );
      }
      await refreshPasskeys();
      setKeyMessage("Security key registered and ready for Owner sign-in.");
      setLabel("");
    } catch (cause) {
      setKeyError(
        cause instanceof Error
          ? cause.message
          : "Security key registration failed.",
      );
    } finally {
      setKeyBusy(false);
    }
  }

  async function startTotpSetup() {
    setTotpBusy(true);
    setTotpError(null);
    setTotpMessage(null);
    try {
      const result = await authClient.twoFactor.enable({
        method: "totp",
        password: totpPassword,
      });
      if (result.error || result.data?.method !== "totp") {
        throw new Error(result.error?.message ?? "Authenticator setup failed.");
      }
      const qr = await QRCode.toDataURL(result.data.totpURI, {
        errorCorrectionLevel: "M",
        margin: 1,
        width: 240,
      });
      setTotpQr(qr);
      setTotpBackupCodes(result.data.backupCodes);
      setTotpPassword("");
    } catch (cause) {
      setTotpError(
        cause instanceof Error ? cause.message : "Authenticator setup failed.",
      );
    } finally {
      setTotpBusy(false);
    }
  }

  async function verifyTotp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTotpBusy(true);
    setTotpError(null);
    setTotpMessage(null);
    try {
      const result = await authClient.twoFactor.verifyTotp({
        code: totpCode,
        trustDevice: false,
      });
      if (result.error) {
        throw new Error(
          result.error.message ?? "Authenticator verification failed.",
        );
      }
      setTotpMessage("Authenticator enabled. Keep your backup codes offline.");
      setTotpCode("");
      setUser((current) =>
        current ? { ...current, twoFactorEnabled: true } : current,
      );
      setTotpQr(null);
      setTotpBackupCodes([]);
    } catch (cause) {
      setTotpError(
        cause instanceof Error
          ? cause.message
          : "Authenticator verification failed.",
      );
    } finally {
      setTotpBusy(false);
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordError(null);
    setPasswordMessage(null);
    if (newPassword.length < 8) {
      setPasswordError("Use at least 8 characters for the new password.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("The new passwords do not match.");
      return;
    }

    setPasswordBusy(true);
    try {
      const result = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      });
      if (result.error) {
        throw new Error(result.error.message ?? "Password change failed.");
      }
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordMessage(
        "Password changed. Other sessions have been signed out.",
      );
    } catch (cause) {
      setPasswordError(
        cause instanceof Error ? cause.message : "Password change failed.",
      );
    } finally {
      setPasswordBusy(false);
    }
  }

  if (loading) {
    return (
      <main className="auth-shell">
        <div className="auth-frame">
          <p className="auth-loading">Loading account security…</p>
        </div>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="auth-shell">
        <Card className="auth-frame auth-card auth-empty">
          <p className="auth-kicker">ARSVINE AUTH</p>
          <h1>Sign in to manage your account</h1>
          <p>
            Your Auth session is required before security settings can be
            changed.
          </p>
          <Button asChild className="auth-button auth-button-primary">
            <Link href="/sign-in">Return to sign in</Link>
          </Button>
        </Card>
      </main>
    );
  }

  const twoFactorEnabled = Boolean(user.twoFactorEnabled);

  return (
    <main className="auth-shell auth-security-shell">
      <div className="auth-frame auth-security-frame">
        <header className="auth-header">
          <Link className="auth-brand" href="/">
            <span className="auth-mark">A</span>
            <span>ARSVINE</span>
            <small>AUTH</small>
          </Link>
          <div className="auth-account-chip">
            <span className="auth-account-chip-label">Account</span>
            <span>{user.email}</span>
          </div>
        </header>

        <section className="auth-intro auth-security-intro">
          <p className="auth-kicker">ACCOUNT / SECURITY</p>
          <h1>Account security</h1>
          <p>
            Manage the credentials and second factors used to protect your
            ARSVINE account.
          </p>
        </section>

        {securityError ? (
          <p className="auth-error" role="alert">
            {securityError}
          </p>
        ) : null}

        <div className="auth-security-layout">
          <Card className="auth-card auth-security-card">
            <CardHeader className="auth-section-header">
              <div className="auth-section-icon" aria-hidden="true">
                <KeyRound size={19} />
              </div>
              <div>
                <p className="auth-panel-label">Sign-in method</p>
                <CardTitle>Security keys</CardTitle>
                <CardDescription>
                  Passkeys stay on your device and can be used for Owner
                  sign-in.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="auth-security-content">
              <div className="auth-subsection-heading">
                <div>
                  <h2>Registered keys</h2>
                  <p>Only these keys can complete a passkey sign-in.</p>
                </div>
                <span className="auth-count-badge">{passkeys.length}</span>
              </div>

              {passkeysLoading ? (
                <p className="auth-inline-state">Loading registered keys…</p>
              ) : passkeys.length > 0 ? (
                <ul className="auth-security-list">
                  {passkeys.map((passkey) => (
                    <SecurityKeyRow key={passkey.id} passkey={passkey} />
                  ))}
                </ul>
              ) : (
                <div className="auth-empty-inline">
                  <ShieldCheck size={18} aria-hidden="true" />
                  <div>
                    <strong>No security keys registered</strong>
                    <p>Add one below before relying on passkey sign-in.</p>
                  </div>
                </div>
              )}

              <div className="auth-form-divider" />
              <div className="auth-subsection-heading auth-subsection-heading-compact">
                <div>
                  <h2>Add a security key</h2>
                  <p>Your browser will ask you to touch or unlock the key.</p>
                </div>
              </div>
              <div className="auth-form">
                <Field>
                  <FieldLabel htmlFor="key-label">Key name</FieldLabel>
                  <Input
                    id="key-label"
                    placeholder="For example: daily YubiKey"
                    value={label}
                    onChange={(event) => setLabel(event.target.value)}
                    maxLength={80}
                  />
                  <FieldDescription>
                    Used only to identify this key on the account.
                  </FieldDescription>
                </Field>
                <Button
                  className="auth-button auth-button-primary"
                  disabled={keyBusy}
                  size="lg"
                  type="button"
                  onClick={() => void registerKey()}
                >
                  {keyBusy ? "Waiting for your key…" : "Register security key"}
                </Button>
                {keyMessage ? (
                  <p className="auth-success" role="status">
                    {keyMessage}
                  </p>
                ) : null}
                {keyError ? (
                  <p className="auth-error" role="alert">
                    {keyError}
                  </p>
                ) : null}
              </div>
            </CardContent>
          </Card>

          <div className="auth-security-stack">
            <Card className="auth-card auth-security-card">
              <CardHeader className="auth-section-header">
                <div className="auth-section-icon" aria-hidden="true">
                  <Smartphone size={19} />
                </div>
                <div>
                  <p className="auth-panel-label">Second factor</p>
                  <CardTitle>Authenticator app</CardTitle>
                  <CardDescription>
                    Use a time-based code as an additional sign-in factor.
                  </CardDescription>
                </div>
                <span
                  className={`auth-status-pill${twoFactorEnabled ? " is-active" : ""}`}
                >
                  {twoFactorEnabled ? "Enabled" : "Not set up"}
                </span>
              </CardHeader>
              <CardContent className="auth-security-content">
                {twoFactorEnabled && !totpQr ? (
                  <div className="auth-enabled-state">
                    <Check size={17} aria-hidden="true" />
                    <div>
                      <strong>Authenticator is active</strong>
                      <p>
                        Codes are required when Auth requests a second factor.
                      </p>
                    </div>
                  </div>
                ) : !totpQr ? (
                  <div className="auth-form">
                    <Field>
                      <FieldLabel htmlFor="totp-password">
                        Current password
                      </FieldLabel>
                      <Input
                        id="totp-password"
                        autoComplete="current-password"
                        type="password"
                        value={totpPassword}
                        onChange={(event) =>
                          setTotpPassword(event.target.value)
                        }
                      />
                    </Field>
                    <Button
                      className="auth-button auth-button-primary"
                      disabled={totpBusy || !totpPassword}
                      size="lg"
                      type="button"
                      onClick={() => void startTotpSetup()}
                    >
                      {totpBusy
                        ? "Preparing authenticator…"
                        : "Set up authenticator"}
                    </Button>
                  </div>
                ) : (
                  <div className="auth-form">
                    <div className="auth-totp-setup">
                      <div className="auth-totp-qr">
                        <Image
                          src={totpQr}
                          alt="QR code for authenticator setup"
                          width={240}
                          height={240}
                          unoptimized
                        />
                        <p>Scan this code with your authenticator app.</p>
                      </div>
                      <form className="auth-form" onSubmit={verifyTotp}>
                        <Field>
                          <FieldLabel htmlFor="setup-totp-code">
                            Six-digit code
                          </FieldLabel>
                          <Input
                            id="setup-totp-code"
                            autoComplete="one-time-code"
                            inputMode="numeric"
                            maxLength={6}
                            required
                            value={totpCode}
                            onChange={(event) =>
                              setTotpCode(
                                event.target.value
                                  .replace(/\D/g, "")
                                  .slice(0, 6),
                              )
                            }
                          />
                        </Field>
                        <Button
                          className="auth-button auth-button-primary"
                          disabled={totpBusy}
                          size="lg"
                          type="submit"
                        >
                          {totpBusy ? "Verifying…" : "Verify and enable"}
                        </Button>
                      </form>
                    </div>
                    <details className="auth-totp-backup">
                      <summary>Show backup codes</summary>
                      <code>{totpBackupCodes.join("\n")}</code>
                      <p>
                        Store these codes offline. Each code can be used once.
                      </p>
                    </details>
                  </div>
                )}
                {totpMessage ? (
                  <p className="auth-success" role="status">
                    {totpMessage}
                  </p>
                ) : null}
                {totpError ? (
                  <p className="auth-error" role="alert">
                    {totpError}
                  </p>
                ) : null}
              </CardContent>
            </Card>

            <Card className="auth-card auth-security-card">
              <CardHeader className="auth-section-header">
                <div className="auth-section-icon" aria-hidden="true">
                  <LockKeyhole size={19} />
                </div>
                <div>
                  <p className="auth-panel-label">Account credential</p>
                  <CardTitle>Change password</CardTitle>
                  <CardDescription>
                    Update your password and close other Auth sessions.
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="auth-security-content">
                <form className="auth-form" onSubmit={changePassword}>
                  <Field>
                    <FieldLabel htmlFor="current-password">
                      Current password
                    </FieldLabel>
                    <Input
                      id="current-password"
                      autoComplete="current-password"
                      type="password"
                      required
                      value={currentPassword}
                      onChange={(event) =>
                        setCurrentPassword(event.target.value)
                      }
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="new-password">New password</FieldLabel>
                    <Input
                      id="new-password"
                      autoComplete="new-password"
                      type="password"
                      minLength={8}
                      required
                      value={newPassword}
                      onChange={(event) => setNewPassword(event.target.value)}
                    />
                    <FieldDescription>
                      Use at least 8 characters.
                    </FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="confirm-password">
                      Confirm new password
                    </FieldLabel>
                    <Input
                      id="confirm-password"
                      autoComplete="new-password"
                      type="password"
                      minLength={8}
                      required
                      value={confirmPassword}
                      onChange={(event) =>
                        setConfirmPassword(event.target.value)
                      }
                    />
                  </Field>
                  <Button
                    className="auth-button auth-button-primary"
                    disabled={passwordBusy}
                    size="lg"
                    type="submit"
                  >
                    {passwordBusy ? "Changing password…" : "Change password"}
                  </Button>
                  {passwordMessage ? (
                    <p className="auth-success" role="status">
                      {passwordMessage}
                    </p>
                  ) : null}
                  {passwordError ? (
                    <p className="auth-error" role="alert">
                      {passwordError}
                    </p>
                  ) : null}
                </form>
              </CardContent>
            </Card>
          </div>
        </div>

        <footer className="auth-footer">
          <Link className="auth-text-link" href="/">
            Return to Auth home
          </Link>
        </footer>
      </div>
    </main>
  );
}
