import { readFileSync } from "node:fs";
import path from "node:path";

import type { APIRequestContext } from "@playwright/test";

import { API_BASE_URL } from "./env";

export type TestUser = {
  name: string;
  email: string;
  password: string;
  token: string;
};

export const POST_IMAGE_PATH = path.join(__dirname, "fixtures", "post-image.png");

// ユーザー名・メールアドレスを実行ごと・呼び出しごとに別にするための接尾辞。
export function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// 実行ごとに新しいユーザーを作る（1 人 1 日の生成上限に繰り返しの実行が当たらないように）。
export async function createUser(request: APIRequestContext): Promise<TestUser> {
  const suffix = uniqueSuffix();
  const name = `e2e-${suffix}`;
  const email = `e2e-${suffix}@example.com`;
  const password = "password123";

  const response = await request.post(`${API_BASE_URL}/api/auth/sign_up`, {
    data: { user: { name, email, password } },
  });
  if (response.status() !== 201) {
    throw new Error(`createUser: sign_up が ${response.status()} を返した`);
  }

  const header = response.headers()["authorization"];
  if (!header?.startsWith("Bearer ")) {
    throw new Error("createUser: 応答に Authorization ヘッダーが無い");
  }
  return { name, email, password, token: header.slice("Bearer ".length) };
}

// お題を API で作る。画像は fixtures の 3:4 の PNG。
export async function createPost(
  request: APIRequestContext,
  user: TestUser,
  title = `e2e お題 ${Date.now()}`,
): Promise<{ id: number }> {
  const response = await request.post(`${API_BASE_URL}/api/posts`, {
    headers: { Authorization: `Bearer ${user.token}` },
    multipart: {
      "post[title]": title,
      "post[image]": {
        name: "post-image.png",
        mimeType: "image/png",
        buffer: readFileSync(POST_IMAGE_PATH),
      },
    },
  });
  if (response.status() !== 201) {
    throw new Error(`createPost: posts が ${response.status()} を返した`);
  }
  // 応答は { post: {...} } の形。
  const body = (await response.json()) as { post: { id: number } };
  return { id: body.post.id };
}
