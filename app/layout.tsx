import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "TTB Label Verification",
  description:
    "Verify alcohol beverage labels against application data — extract the seven required fields and flag mismatches for agent review.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <nav
          aria-label="Primary"
          className="border-b border-black/10 bg-white/80 backdrop-blur dark:border-white/10 dark:bg-neutral-950/80"
        >
          <div className="mx-auto flex w-full max-w-3xl items-center gap-1 px-4 py-3">
            <span className="mr-3 font-semibold text-neutral-900 dark:text-neutral-100">
              TTB Labels
            </span>
            <a
              href="/"
              className="rounded px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              Single review
            </a>
            <a
              href="/batch"
              className="rounded px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              Batch
            </a>
          </div>
        </nav>
        {children}
      </body>
    </html>
  );
}
