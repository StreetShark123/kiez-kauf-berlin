import type { Metadata } from "next";
import { IBM_Plex_Mono, Space_Grotesk } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "@/app/globals.css";

const displayFont = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-display"
});

const monoFont = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "500", "600"]
});

export const metadata: Metadata = {
  metadataBase: new URL("https://kiez-kauf-berlin.vercel.app"),
  title: "KiezKauf Berlin — Find it in your Kiez",
  description: "Search for any product and find the nearest local store in Berlin.",
  manifest: "/manifest.json",
  icons: {
    icon: [{ url: "/favicon.ico", sizes: "any" }],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }]
  },
  openGraph: {
    title: "KiezKauf Berlin — Find it in your Kiez",
    description: "Search for any product and find the nearest local store in Berlin.",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "KiezKauf Berlin"
      }
    ],
    url: "https://kiez-kauf-berlin.vercel.app",
    siteName: "KiezKauf Berlin",
    locale: "en_US",
    type: "website"
  },
  twitter: {
    card: "summary_large_image",
    title: "KiezKauf Berlin — Find it in your Kiez",
    description: "Search for any product and find the nearest local store in Berlin.",
    images: ["/og-image.png"]
  }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="manifest" href="/manifest.json" />
        <script
          dangerouslySetInnerHTML={{
            __html: `
(() => {
  try {
    const storageKey = "kiezkauf:theme-preference";
    const stored = localStorage.getItem(storageKey);
    const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const theme = stored === "dark" || stored === "light" ? stored : (systemDark ? "dark" : "light");
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.style.colorScheme = theme;
  } catch (_) {}
})();
            `
          }}
        />
      </head>
      <body className={`${displayFont.variable} ${monoFont.variable}`}>
        {children}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
