import "./globals.css";

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
    <html lang="bn">
      <body>{children}</body>
    </html>
  );
}
