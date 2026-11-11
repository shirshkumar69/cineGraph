import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CineGraph — Your next favourite",
  description: "Movie recommendations based on your taste and real connections.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
