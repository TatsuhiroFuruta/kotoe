import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // dangerouslySetInnerHTML を禁止する。
      //
      // Kotoe は公開 UGC（お題タイトル・描写文・ユーザー名）を表示するため、
      // ここが XSS の最短経路になる。React は JSX 内の値を自動でエスケープ
      // するので、この API を使わない限りテキスト由来の XSS は起きない。
      //
      // 踏みやすいのは「描写文の改行を反映したい」場面：
      //   ✗ <p dangerouslySetInnerHTML={{ __html: text.replace(/\n/g, "<br>") }} />
      //   ○ <p className="whitespace-pre-wrap">{text}</p>
      // 後者ならエスケープを保ったまま改行が表示される。
      //
      // 人の注意力ではなく CI で塞ぐ。どうしても必要になったら、
      // サニタイズの方法と理由を PR に書いたうえで個別に無効化すること。
      "react/no-danger": "error",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
