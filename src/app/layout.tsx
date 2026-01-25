import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { ThemeToggle } from "@/components/theme-toggle";
import { GlobalLoadingProvider } from "@/components/global-loading-provider";
import { GlobalLoadingIndicator } from "@/components/loading-indicator";
import { clearSession, getRoleFromRequest } from "@/lib/auth";
import { redirect } from "next/navigation";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Tournament Genie",
  description: "Admin-first tournament management for badminton doubles.",
};

async function logout() {
  "use server";
  await clearSession();
  redirect("/login");
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const role = await getRoleFromRequest();
  const isAdmin = role === "admin";
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} min-h-screen bg-background antialiased`}
      >
        <GlobalLoadingProvider>
          <GlobalLoadingIndicator />
          <header className="border-b border-border bg-card">
            <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-4">
              <Link href="/" className="text-lg font-semibold text-foreground">
                Tournament Genie
              </Link>
              <nav className="flex flex-wrap gap-3 text-sm font-medium text-muted-foreground">
                {isAdmin ? (
                  <>
                    <Link className="hover:text-foreground" href="/players">
                      Players
                    </Link>
                    <Link className="hover:text-foreground" href="/teams">
                      Teams
                    </Link>
                    <Link className="hover:text-foreground" href="/groups">
                      Groups
                    </Link>
                    <Link className="hover:text-foreground" href="/matches">
                      Matches
                    </Link>
                  </>
                ) : null}
                <Link className="hover:text-foreground" href="/standings">
                  Standings
                </Link>
                <Link className="hover:text-foreground" href="/schedule">
                  Schedule
                </Link>
                {isAdmin ? (
                  <Link
                    className="hover:text-foreground"
                    href="/schedule-overview"
                  >
                    Schedule Overview
                  </Link>
                ) : null}
                {isAdmin ? (
                  <Link className="hover:text-foreground" href="/knockout">
                    Knockout
                  </Link>
                ) : null}
                <Link className="hover:text-foreground" href="/brackets">
                  Brackets
                </Link>
              </nav>
              <div className="flex items-center gap-3">
                {isAdmin ? (
                  <form action={logout}>
                    <button
                      className="text-sm font-medium text-muted-foreground hover:text-foreground"
                      type="submit"
                    >
                      Logout
                    </button>
                  </form>
                ) : (
                  <Link
                    className="text-sm font-medium text-muted-foreground hover:text-foreground"
                    href="/login"
                  >
                    Admin Login
                  </Link>
                )}
                <ThemeToggle />
              </div>
            </div>
          </header>
          <main className="mx-auto w-full max-w-6xl px-6 py-8">
            {children}
          </main>
        </GlobalLoadingProvider>
      </body>
    </html>
  );
}
