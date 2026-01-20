import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { ThemeToggle } from "@/components/theme-toggle";

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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} min-h-screen bg-background antialiased`}
      >
        <header className="border-b border-border bg-card">
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-4">
            <Link href="/" className="text-lg font-semibold text-foreground">
              Tournament Genie
            </Link>
            <nav className="flex flex-wrap gap-3 text-sm font-medium text-muted-foreground">
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
              <Link className="hover:text-foreground" href="/standings">
                Standings
              </Link>
              <Link className="hover:text-foreground" href="/schedule">
                Schedule
              </Link>
              <Link className="hover:text-foreground" href="/schedule-overview">
                Schedule Overview
              </Link>
              <Link className="hover:text-foreground" href="/knockout">
                Knockout
              </Link>
              <Link className="hover:text-foreground" href="/brackets">
                Brackets
              </Link>
            </nav>
            <ThemeToggle />
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
