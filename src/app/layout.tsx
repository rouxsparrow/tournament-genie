import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Image from "next/image";
import Link from "next/link";
import "./globals.css";
import { ThemeToggle } from "@/components/theme-toggle";
import { GlobalLoadingProvider } from "@/components/global-loading-provider";
import { GlobalLoadingIndicator } from "@/components/loading-indicator";
import { clearSession, getRoleFromRequest } from "@/lib/auth";
import { redirect } from "next/navigation";
import logo from "./logo.png";

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
  const navItems = [
    ...(isAdmin ? [{ label: "Matches", href: "/matches" }] : []),
    { label: "Standings", href: "/standings?fromNav=1" },
    {
      label: "Schedule",
      href: isAdmin ? "/schedule" : "/presenting?fromNav=1",
    },
    { label: "Brackets", href: "/brackets?fromNav=1" },
    ...(isAdmin ? [{ label: "Admin", href: "/admin" }] : []),
  ];
  const useMobileMenu = navItems.length > 3;
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} min-h-screen bg-background antialiased`}
      >
        <GlobalLoadingProvider>
          <GlobalLoadingIndicator />
          <header className="border-b border-border bg-card">
            <div className="mx-auto w-full max-w-6xl px-6 py-4">
              {useMobileMenu ? (
                <div className="lg:hidden">
                  <div className="flex items-center justify-between">
                    <Link
                      href="/"
                      className="flex items-center gap-2 text-lg font-semibold text-foreground"
                    >
                      <span className="hidden md:inline">Tournament Genie</span>
                      <span className="md:hidden">
                        <Image
                          src={logo}
                          alt="Tournament Genie"
                          width={28}
                          height={28}
                          className="h-7 w-7"
                        />
                      </span>
                    </Link>
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
                      ) : null}
                      <ThemeToggle />
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-sm font-medium text-muted-foreground">
                    {isAdmin ? (
                      <Link
                        className="hover:text-foreground"
                        href="/matches"
                      >
                        Matches
                      </Link>
                    ) : null}
                    <span className="text-muted-foreground" aria-hidden="true">
                      |
                    </span>
                    <Link
                      className="hover:text-foreground"
                      href="/standings?fromNav=1"
                    >
                      Standings
                    </Link>
                    <span className="text-muted-foreground" aria-hidden="true">
                      |
                    </span>
                    <Link
                      className="hover:text-foreground"
                      href={isAdmin ? "/schedule" : "/presenting?fromNav=1"}
                    >
                      Schedule
                    </Link>
                    <span className="text-muted-foreground" aria-hidden="true">
                      |
                    </span>
                    <Link
                      className="hover:text-foreground"
                      href="/brackets?fromNav=1"
                    >
                      Brackets
                    </Link>
                    {isAdmin ? (
                      <>
                        <span className="text-muted-foreground" aria-hidden="true">
                          |
                        </span>
                        <Link className="hover:text-foreground" href="/admin">
                          Admin
                        </Link>
                      </>
                    ) : null}
                  </div>
                </div>
              ) : null}

              <div className="hidden items-center justify-between lg:flex">
                <Link
                  href="/"
                  className="flex items-center gap-2 text-lg font-semibold text-foreground"
                >
                  <span className="hidden md:inline">Tournament Genie</span>
                  <span className="md:hidden">
                    <Image
                      src={logo}
                      alt="Tournament Genie"
                      width={28}
                      height={28}
                      className="h-7 w-7"
                    />
                  </span>
                </Link>
                <nav className="flex flex-nowrap gap-4 text-sm font-medium text-muted-foreground">
                  {navItems.map((item) => (
                    <Link key={item.href} className="hover:text-foreground" href={item.href}>
                      {item.label}
                    </Link>
                  ))}
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
                  ) : null}
                  <ThemeToggle />
                </div>
              </div>
              {!useMobileMenu ? (
                <div className="flex items-center justify-between lg:hidden">
                  <Link
                    href="/"
                    className="flex items-center gap-2 text-lg font-semibold text-foreground"
                  >
                    <span className="hidden md:inline">Tournament Genie</span>
                    <span className="md:hidden">
                      <Image
                        src={logo}
                        alt="Tournament Genie"
                        width={28}
                        height={28}
                        className="h-7 w-7"
                      />
                    </span>
                  </Link>
                  <nav className="flex flex-wrap gap-3 text-sm font-medium text-muted-foreground">
                    {navItems.map((item) => (
                      <Link key={item.href} className="hover:text-foreground" href={item.href}>
                        {item.label}
                      </Link>
                    ))}
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
                    ) : null}
                    <ThemeToggle />
                  </div>
                </div>
              ) : null}
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
