export default function AuthPage() {
  const displayName = process.env.AUTH_DISPLAY_NAME?.trim() || "Authentication";

  return (
    <main>
      <h1>{displayName}</h1>
      <p>The unified identity authority is being brought online.</p>
    </main>
  );
}
