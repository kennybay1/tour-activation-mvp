import type { Metadata } from "next";
import { Fraunces, Archivo, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  style: ["normal", "italic"],
  weight: ["400", "500", "600"],
});

const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: {
    default: "Moments — geo-fenced fan engagement for artist teams",
    template: "%s — Moments",
  },
  description:
    "Drop rewards at real-world spots — voice notes, discounts, first listens — that fans unlock by being there. Geo-fenced fan engagement for artist teams.",
  openGraph: {
    title: "Moments — geo-fenced fan engagement for artist teams",
    description:
      "Drop rewards at real-world spots that fans unlock by being there.",
    siteName: "Moments",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${fraunces.variable} ${archivo.variable} ${plexMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
