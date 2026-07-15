import type { Metadata, Viewport } from "next";
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

const description =
  "The operational context control plane that versions every decision, compiles the right context, and explains every agent action.";

const vercelHost =
  process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (vercelHost ? `https://${vercelHost}` : "http://localhost:3000");

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Commonstate — Every human. Every agent. Same state.",
    template: "%s · Commonstate",
  },
  description,
  applicationName: "Commonstate",
  keywords: [
    "agent memory",
    "operational context",
    "company brain",
    "AI agents",
    "human in the loop",
  ],
  creator: "Commonstate",
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
    shortcut: "/favicon.svg",
  },
  robots: { index: true, follow: true },
  openGraph: {
    title: "Commonstate — Every human. Every agent. Same state.",
    description,
    type: "website",
    url: siteUrl,
    images: [
      {
        url: "/og.png",
        width: 1728,
        height: 910,
        alt: "Commonstate — Every human. Every agent. Same state.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Commonstate — Every human. Every agent. Same state.",
    description,
    images: ["/og.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0a0a0a",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
