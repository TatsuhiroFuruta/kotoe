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
 * 同時に表示する最大件数。4 件目が来たら 1 件押し出す
 * （どれを捨てるかは push() を参照。最古ではなく最も早く消えるもの）。
 *
 * 同じ文言の連打を 1 件に統合する方式は採らない。aria-live は「DOM のテキストが
 * 変化したこと」で読み上げるため、統合して置き換えると 2 回目以降が無音になる
 * （画面には見えているのに読み上げ環境には存在しない、という状態になる）。
 */
const MAX_VISIBLE = 3;

/**
 * 自動消去までの時間。error を長くするのは、失敗は読んで判断する必要がある
 * （「生成に失敗しました」→ もう一度押すか決める）のに対し、成功は認識する
 * だけで済むため。同じ 4 秒だと失敗の文面を読み切る前に消える。
 */
const DURATION_MS: Record<ToastType, number> = {
  success: 4000,
  error: 8000,
};

/**
 * 空配列は必ずこの 1 つを使い回す。useSyncExternalStore は戻り値を Object.is で
 * 比較するので、[] リテラルを毎回作ると無限再レンダリングになる。
 */
const EMPTY: readonly Toast[] = [];

let toasts: readonly Toast[] = EMPTY;
let nextId = 0;

const listeners = new Set<() => void>();

/**
 * 自動消去のタイマー。トーストが消える経路すべてで clearTimeout すること。
 *
 * 残り時間を保持するのは 2 つの理由による。
 * (1) ホバー／フォーカスしている間は止めて、離れたら続きから再開するため。
 * (2) 上限を超えたときに「最も早く消えるもの」を捨てるため。
 */
type TimerState =
  | { running: true; handle: ReturnType<typeof setTimeout>; expiresAt: number }
  | { running: false; remainingMs: number };

const timers = new Map<number, TimerState>();

function notify(): void {
  for (const listener of listeners) listener();
}

function startTimer(id: number, ms: number): void {
  timers.set(id, {
    running: true,
    handle: setTimeout(() => dismiss(id), ms),
    expiresAt: Date.now() + ms,
  });
}

function clearTimer(id: number): void {
  const timer = timers.get(id);
  if (timer === undefined) return;
  if (timer.running) clearTimeout(timer.handle);
  timers.delete(id);
}

/**
 * 押し出しの順位づけに使う残り時間。小さいものから捨てる。
 *
 * 一時停止中のものは候補にしない（∞ を返す）。止めているのは触れている
 * 間だけで、そこで捨てると「手の下で消える」ことになり、pause を入れた
 * 目的そのものを押し出しが打ち消す。止めた瞬間の残りが小さいと真っ先に
 * 捨てられるので、実際に起きる。タイマーを持たないものも同じ扱い。
 */
function remainingMs(id: number): number {
  const timer = timers.get(id);
  if (timer === undefined || !timer.running) return Number.POSITIVE_INFINITY;
  return Math.max(0, timer.expiresAt - Date.now());
}

function push(type: ToastType, message: string): void {
  const id = ++nextId;
  const next = [...toasts, { id, type, message }];

  // 押し出しの判定より先にタイマーを張る。残り時間で比較するため。
  startTimer(id, DURATION_MS[type]);

  while (next.length > MAX_VISIBLE) {
    // 最も早く消えるものを捨てる。寿命が同じもの同士では最も古いものになるので、
    // 「最古を押し出す」はこの規則に含まれる。単純に最古を捨てると、error に
    // 8 秒を与えた意味が消える（4 秒の success 3 件に押し出されて読めない）。
    //
    // 末尾＝いま追加したものは候補から外す。寿命の短い新着が寿命の長い既存に
    // 負けて即座に消えると、直前の操作への反応が出ない。
    let victim = 0;
    for (let i = 1; i < next.length - 1; i++) {
      if (remainingMs(next[i].id) < remainingMs(next[victim].id)) victim = i;
    }

    // 捨てるときにタイマーも止める。止め忘れると、既に画面から消えた通知の
    // タイマーが数秒後に発火する。その時点では id が配列に無いので見た目には
    // 何も起きず、配列を見ているだけのテストでは気づけない（だから
    // 動いているタイマーの本数を検査している）。
    const [dropped] = next.splice(victim, 1);
    clearTimer(dropped.id);
  }

  toasts = next;
  notify();
}

/**
 * 自動消去を止める。触れているものが手の下で消えるのを防ぐ。
 *
 * 閉じるボタンにフォーカスしたまま消えると、フォーカスが body に落ちて
 * タブ順がページ先頭に戻る。マウスでも、「×」に手を伸ばしている途中で
 * 消えるとクリックが背後のページに落ちる。
 */
function pause(id: number): void {
  const timer = timers.get(id);
  if (timer === undefined || !timer.running) return;

  clearTimeout(timer.handle);
  timers.set(id, { running: false, remainingMs: Math.max(0, timer.expiresAt - Date.now()) });
}

/** 止めた続きから再開する。経過した分は戻さない（隅に居座り続けるため）。 */
function resume(id: number): void {
  const timer = timers.get(id);
  if (timer === undefined || timer.running) return;

  startTimer(id, timer.remainingMs);
}

function dismiss(id: number): void {
  clearTimer(id);

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

  /**
   * 以下 2 つは ToastViewport がホバー／フォーカスの出入りで呼ぶ。
   * 画面側から使うものではない。
   */
  pause(id: number): void {
    pause(id);
  },

  resume(id: number): void {
    resume(id);
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
