import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { ToastViewport } from "@/components/ui/toast-viewport";
import { AuthProvider } from "@/lib/auth/auth-context";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // 各ページが title を持つと「お題を探す | Kotoe（言絵）」になる。
  // title を持たないページ（トップ・ログインなど）は default のまま。
  title: {
    default: "Kotoe（言絵）",
    template: "%s | Kotoe（言絵）",
  },
  description: "画像を言葉だけで描写し、その言葉から AI が再現した画像の再現度を競う Web アプリ",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ja"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      {/*
        AuthProvider はクライアントコンポーネントだが、children として渡された
        サーバーコンポーネントはサーバー描画のままこの中に収まる。全ページが
        クライアントコンポーネントになるわけではない（useAuth を呼ぶものだけ）。
      */}
      <body className="flex min-h-full flex-col">
        <AuthProvider>
          <SiteHeader />
          {/*
            children を flex-1 で包むのは、各ページが flex-1 を付け忘れても
            フッターが最下部に留まるようにするため。ページごとに忘れうる。
          */}
          <div className="flex flex-1 flex-col">{children}</div>
          <SiteFooter />
          {/*
            トーストはここに 1 つだけ置く（7-2.5）。position: fixed なので
            DOM 上の位置は見た目に影響しないが、AuthProvider の内側に置いて
            おくと、将来トーストから認証状態を参照したくなったときに動かさずに済む。
          */}
          <ToastViewport />
        </AuthProvider>
      </body>
    </html>
  );
}
