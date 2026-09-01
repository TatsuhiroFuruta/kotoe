"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { apiFetch, apiRequest } from "@/lib/api";
import { tokenStore } from "@/lib/auth/token-store";
import type { MeResponse, User } from "@/types/api";

type AuthState =
  | { status: "loading" }
  | { status: "authenticated"; user: User }
  | { status: "unauthenticated" };

type AuthContextValue = AuthState & {
  signUp(params: { name: string; email: string; password: string }): Promise<void>;
  signIn(params: { email: string; password: string }): Promise<void>;
  signOut(): Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * レスポンスヘッダから JWT を取り出す。
 *
 * 取れなかったときに握り潰さないのが要点。CORS の expose 設定が壊れると
 * 必ずここに来るが、黙って未ログインのままにすると「ログインは成功して
 * いるのに入れない」という原因の分からない症状になる。
 */
function extractToken(response: Response): string {
  const header = response.headers.get("Authorization");
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;

  if (!token) {
    throw new Error(
      "Authorization ヘッダから JWT を取得できませんでした（CORS の expose 設定を確認）",
    );
  }
  return token;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // トークンの変更を購読する。api.ts が失効を検知して捨てたときも、
  // 別タブでログアウトしたときも、ここに通知が来る。
  const token = useSyncExternalStore(
    tokenStore.subscribe,
    tokenStore.get,
    tokenStore.getServerSnapshot,
  );

  // 「どのトークンに対して誰だと分かっているか」を持つ。トークンと一緒に
  // 持つのは、signIn 直後にもう一度 /api/me を叩かずに済ませるため。
  const [session, setSession] = useState<{ token: string; user: User } | null>(null);
  // 復元に失敗したトークン。無限リトライを防ぐ。
  const [restoreFailedFor, setRestoreFailedFor] = useState<string | null>(null);

  // 起動時の復元。トークンが無ければリクエストを一切出さない（未ログインの
  // 訪問者にコストを掛けない）。あるときだけ /api/me を 1 本だけ叩く。
  useEffect(() => {
    if (token === null) return;
    if (session?.token === token) return; // signIn 直後。もう誰か分かっている
    if (restoreFailedFor === token) return;

    let cancelled = false;

    apiFetch<MeResponse>("/api/me")
      .then((me) => {
        if (cancelled) return;
        setSession({ token, user: { id: me.id, name: me.name, email: me.email } });
      })
      .catch(() => {
        if (cancelled) return;
        // 401 なら api.ts が既にトークンを捨てている。その通知で token が
        // null になり、この効果は再実行されて上の早期 return に落ちる。
        //
        // 401 以外（ネットワーク断など）ではトークンを残したまま未ログイン
        // 表示にする。捨てると、通信が戻ったときにログインし直しになるため。
        // リロードで再試行される。
        setRestoreFailedFor(token);
      });

    return () => {
      cancelled = true;
    };
  }, [token, session, restoreFailedFor]);

  const signUp = useCallback(
    async (params: { name: string; email: string; password: string }) => {
      const { data, response } = await apiRequest<User>("/api/auth/sign_up", {
        method: "POST",
        body: JSON.stringify({ user: params }),
        skipAuth: true,
      });
      const newToken = extractToken(response);

      // tokenStore.set より先に session を入れる。逆にすると、通知を受けた
      // 再レンダリングが一瞬 loading になる。同じイベントハンドラ内なので
      // React がまとめて 1 回の再レンダリングにする。
      setSession({ token: newToken, user: data });
      setRestoreFailedFor(null);
      tokenStore.set(newToken);
    },
    [],
  );

  const signIn = useCallback(async (params: { email: string; password: string }) => {
    const { data, response } = await apiRequest<User>("/api/auth/sign_in", {
      method: "POST",
      body: JSON.stringify({ user: params }),
      skipAuth: true,
    });
    const newToken = extractToken(response);

    setSession({ token: newToken, user: data });
    setRestoreFailedFor(null);
    tokenStore.set(newToken);
  }, []);

  const signOut = useCallback(async () => {
    try {
      await apiFetch<null>("/api/auth/sign_out", { method: "DELETE" });
    } catch {
      // サーバー側の失効に失敗しても、ローカルのトークンは必ず捨てる。
      // ここで投げると「ログアウトを押したのにログイン状態のまま」になり、
      // ユーザーが自力で抜け出せない。失効し損ねたトークンは 24 時間で切れる。
    } finally {
      setSession(null);
      setRestoreFailedFor(null);
      tokenStore.clear();
    }
  }, []);

  const value = useMemo<AuthContextValue>(() => {
    const state: AuthState =
      token === null
        ? { status: "unauthenticated" }
        : session?.token === token
          ? { status: "authenticated", user: session.user }
          : restoreFailedFor === token
            ? { status: "unauthenticated" }
            : { status: "loading" };

    return { ...state, signUp, signIn, signOut };
  }, [token, session, restoreFailedFor, signUp, signIn, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth は AuthProvider の内側で呼ぶこと");
  }
  return value;
}
