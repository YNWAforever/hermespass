export function AccessDenied() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-16">
      <section className="panel w-full max-w-lg p-8">
        <p className="font-mono text-[10px] tracking-[0.24em] text-amber-300 uppercase">
          Access denied
        </p>
        <h1 className="mt-3 text-2xl font-semibold">No HermesPass organization membership</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Your Neon Auth account is valid, but an administrator has not assigned it to a HermesPass
          organization.
        </p>
      </section>
    </main>
  );
}
