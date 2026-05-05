import "./globals.css";

export const metadata = {
  title: "Carrom Tracker",
  description: "বন্ধুদের কেরাম ম্যাচ ট্র্যাকার",
};

export default function RootLayout({ children }) {
  return (
    <html lang="bn">
      <body>{children}</body>
    </html>
  );
}
