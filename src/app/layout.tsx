import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Visibility — LG vs Samsung",
  description:
    "AI search visibility dashboard. Tracks share of AI answers across topics, LG vs Samsung, from SEMrush Enterprise AIO.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
