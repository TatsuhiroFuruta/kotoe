/**
 * JWT の置き場所。localStorage の読み書きと、その変更の購読だけを担う。
 * React も fetch も知らない。
 *
 * localStorage を選んだ理由と、cookie を選ばなかった理由は設計書を参照
 * （httpOnly でない cookie は XSS 耐性が localStorage と変わらないため、
 * middleware ガードのためだけに構成を増やす価値が無い）。
 */

const STORAGE_KEY = "kotoe.auth.token";

// 自タブ用の購読者。window の storage イベントは他タブでしか発火しないため、
// 自分で set / clear したときの通知は自前で配る必要がある。
const listeners = new Set<() => void>();

// localStorage へ書き込めない環境（プライベートモード、容量超過など）の
// フォールバック。タブを閉じると消えるが、その 1 セッションは成立する。
// これが無いと、そういうブラウザではログイン直後に未ログインへ戻り、
// 何度ログインしても入れなくなる。
let fallbackToken: string | null = null;

// localStorage が実際に書けているか。書き込みに失敗した時点で false になり、
// 以降は読み出しもフォールバックを見る。
//
// 「localStorage が空ならフォールバックを見る」という書き方にはしない。
// それだと別タブがログアウトして localStorage を空にしたとき、こちらのタブが
// 古いトークンを読み続けてタブ間の同期が壊れる。
let storageWritable = true;

function readStorage(): string | null {
  // SSR では window が無い。サイトデータを拒否している環境では
  // localStorage へのアクセス自体が例外を投げる。どちらも落とさない。
  if (typeof window === "undefined") return null;
  if (!storageWritable) return fallbackToken;

  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return fallbackToken;
  }
}

function writeStorage(token: string | null): void {
  fallbackToken = token;

  if (typeof window === "undefined") return;

  try {
    if (token === null) {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, token);
    }
    storageWritable = true;
  } catch {
    storageWritable = false;
  }
}

function notify(): void {
  for (const listener of listeners) listener();
}

/**
 * どのメソッドも `this` を使わないこと。呼び出し側は
 * `useSyncExternalStore(tokenStore.subscribe, tokenStore.get, ...)` のように
 * メソッドを関数として切り離して渡すため、`this` を書いた瞬間に壊れる。
 */
export const tokenStore = {
  // キャッシュを持たず毎回読む。useSyncExternalStore は戻り値を Object.is で
  // 比較するが、文字列と null は値で比較されるため参照の安定は要らない。
  get(): string | null {
    return readStorage();
  },

  set(token: string): void {
    writeStorage(token);
    notify();
  },

  clear(): void {
    writeStorage(null);
    notify();
  },

  /**
   * useSyncExternalStore 用。自タブの set / clear と、他タブの storage イベントを
   * 購読する。React は subscribe を effect の中でしか呼ばないため、
   * ここでは window があることを前提にしてよい。
   */
  subscribe(listener: () => void): () => void {
    listeners.add(listener);

    const onStorage = (event: StorageEvent) => {
      // key が null なのは localStorage.clear() のとき。これも取りこぼさない。
      if (event.key !== null && event.key !== STORAGE_KEY) return;
      listener();
    };
    window.addEventListener("storage", onStorage);

    return () => {
      listeners.delete(listener);
      window.removeEventListener("storage", onStorage);
    };
  },

  /** SSR 時のスナップショット。サーバーはトークンを持ち得ない。 */
  getServerSnapshot(): null {
    return null;
  },
};
