import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { setAdminSession, validateAdminCredentials } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Login" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string }>;
}) {
  const resolvedParams = (await searchParams) ?? {};
  const error = resolvedParams.error;

  async function login(formData: FormData) {
    "use server";
    const username = String(formData.get("username") ?? "");
    const password = String(formData.get("password") ?? "");

    if (!process.env.AUTH_SECRET) {
      redirect(`/login?error=${encodeURIComponent("Missing AUTH_SECRET.")}`);
    }

    const isValid = validateAdminCredentials(username, password);
    if (!isValid) {
      redirect(`/login?error=${encodeURIComponent("Invalid credentials.")}`);
    }

    const ok = await setAdminSession();
    if (!ok) {
      redirect(`/login?error=${encodeURIComponent("Unable to start session.")}`);
    }

    redirect("/schedule");
  }

  return (
    <section className="mx-auto max-w-md rounded-2xl border border-border bg-card p-8">
      <h1 className="text-2xl font-semibold text-foreground">Admin Login</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Sign in to manage the tournament.
      </p>

      {error ? (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <form action={login} className="mt-6 space-y-4">
        <div>
          <label className="text-xs font-medium text-muted-foreground">Username</label>
          <input
            name="username"
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            autoComplete="username"
            required
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Password</label>
          <input
            name="password"
            type="password"
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            autoComplete="current-password"
            required
          />
        </div>
        <Button type="submit" className="w-full">
          Login
        </Button>
      </form>
    </section>
  );
}
