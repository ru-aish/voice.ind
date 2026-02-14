import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Voice AI",
  description: "Real-time voice agent powered by Gemini Live API",
  icons: {
    icon: "/favicon.ico",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <Script src="/config.js" strategy="beforeInteractive" />
      </head>
      <body className={inter.className} style={{
        margin: 0,
        padding: 0,
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column'
      }}>
        {children}
      </body>
    </html>
  );
}