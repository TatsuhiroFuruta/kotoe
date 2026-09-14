/**
 * トーストの置き場所。キューの管理だけを担う。React も DOM も知らない。
 *
 * tokenStore（src/lib/auth/token-store.ts）と同じ形にしてある。React の外に
 * 置くのは 2 つの理由による。(1) 7-2.6 で api.ts（React ではない）から通知を
 * 出す選択肢を塞がないため。(2) キュー管理を純粋ロジックとして、レンダリング
 * 抜きに Vitest で検証できるようにするため。
 */

export type ToastType = "success" | "error";

export type Toast = {
  id: number;
  type: ToastType;
  message: string;
};

/**
 * 同時に表示する最大件数。4 件目が来たら一番古いものを押し出す。
 *
 * 同じ文言の連打を 1 件に統合する方式は採らない。aria-live は「DOM のテキストが
 * 変化したこと」で読み上げるため、統合して置き換えると 2 回目以降が無音になる
 * （画面には見えているのに読み上げ環境には存在しない、という状態になる）。
 */
const MAX_VISIBLE = 3;

/**
 * 空配列は必ずこの 1 つを使い回す。useSyncExternalStore は戻り値を Object.is で
 * 比較するので、[] リテラルを毎回作ると無限再レンダリングになる。
 */
const EMPTY: readonly Toast[] = [];

let toasts: readonly Toast[] = EMPTY;
let nextId = 0;

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function push(type: ToastType, message: string): void {
  const id = ++nextId;
  const next = [...toasts, { id, type, message }];

  // 上限を超えた分は古いほうから捨てる。
  while (next.length > MAX_VISIBLE) next.shift();

  toasts = next;
  notify();
}

function dismiss(id: number): void {
  const next = toasts.filter((item) => item.id !== id);

  // 無かった id なら参照を変えない。変えると購読側が無駄に再レンダリングする。
  if (next.length === toasts.length) return;

  toasts = next.length === 0 ? EMPTY : next;
  notify();
}

/**
 * 呼ぶ側の口。イベントハンドラや effect から使う。
 *
 * ここに出すのは**画面遷移を伴わない操作の結果**だけ。フォームの
 * バリデーションエラーは出さないこと（数秒で消えると、入力を直すために
 * 読む必要があるものが読めなくなる）。そちらは TextField の error prop が担当。
 */
export const toast = {
  success(message: string): void {
    push("success", message);
  },

  error(message: string): void {
    push("error", message);
  },

  dismiss(id: number): void {
    dismiss(id);
  },
};

/**
 * 描く側の口。ToastViewport だけが使う。
 *
 * tokenStore と同じく、どのメソッドも `this` を使わないこと。呼び出し側は
 * `useSyncExternalStore(toastStore.subscribe, toastStore.get, ...)` のように
 * メソッドを関数として切り離して渡すため、`this` を書いた瞬間に壊れる。
 */
export const toastStore = {
  /** 変化が無ければ同じ参照を返す（上の EMPTY のコメントを参照）。 */
  get(): readonly Toast[] {
    return toasts;
  },

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  /** SSR 時のスナップショット。サーバーにトーストは存在しない。 */
  getServerSnapshot(): readonly Toast[] {
    return EMPTY;
  },
};
