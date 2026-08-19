import { Inter, Sora } from "next/font/google";
import "./globals.css";

// Self-hosts these fonts at build time (served from our own domain, no
// fonts.googleapis.com/fonts.gstatic.com round trips) and exposes them as
// CSS variables consumed by globals.css. display: "swap" keeps text visible
// with a fallback font while the real one loads, and next/font automatically
// sizes that fallback to match — this is what removes the font-swap layout
// shift that was contributing to the CLS score.
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});

const sora = Sora({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-sora",
  display: "swap",
});

export const metadata = {
  title: "FCT - Carrom Tracker",
  description: "বন্ধুদের কেরাম ম্যাচ ট্র্যাকার",
  manifest: "/manifest.json",
  themeColor: "#15803d",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "FCT",
  },
  icons: {
    icon: [
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16.png", sizes: "16x16", type: "image/png" },
    ],
    shortcut: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="bn" className={`${inter.variable} ${sora.variable}`}>
      <body>{children}</body>
    </html>
  );
}
