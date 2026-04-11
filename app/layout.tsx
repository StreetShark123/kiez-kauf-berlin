import type { Metadata } from "next";
import { IBM_Plex_Mono, Space_Grotesk } from "next/font/google";
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
    <html lang="en">
      <body className={`${displayFont.variable} ${monoFont.variable}`}>{children}</body>
    </html>
  );
}
