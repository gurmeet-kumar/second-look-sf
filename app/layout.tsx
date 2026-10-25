import type { Metadata } from "next";
import "@fontsource-variable/source-sans-3";
import "./globals.css";

export const metadata: Metadata = {
  title: "Second Look — Good finds, found for you",
  description: "A personal scout for free finds in your U.S. city. Set your brief, go about your day, and hear when something fits.",
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
