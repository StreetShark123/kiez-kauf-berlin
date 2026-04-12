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
  title: "KiezKauf Berlin",
  description: "Busca productos y encuentra tiendas fisicas cercanas en Berlin."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
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
