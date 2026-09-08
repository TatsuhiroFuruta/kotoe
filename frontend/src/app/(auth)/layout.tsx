import type { ReactNode } from "react";

/**
 * /login と /signup が共有するカードの外枠。
 * ヘッダーとフッターはルートレイアウトが出すので、ここは本文だけを持つ。
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm rounded-card border border-line bg-surface p-6 shadow-sm">
        {children}
      </div>
    </main>
  );
}
