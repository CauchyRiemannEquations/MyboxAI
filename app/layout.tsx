import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MYBOX · GPT 연결",
  description: "네이버 MYBOX 파일을 GPT에서 검색하고 문서를 읽는 개인용 연결",
  robots: { index: false, follow: false },
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
    <html lang="ko">
      <body className="antialiased">{children}</body>
    </html>
  );
}
