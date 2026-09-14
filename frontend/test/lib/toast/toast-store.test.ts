// @vitest-environment node
//
// ストアは DOM を触らないので jsdom は要らない（vitest.config.mts のコメントが
// 定めている切り替え方に沿う）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { toast, toastStore } from "@/lib/toast/toast-store";

describe("toastStore", () => {
  beforeEach(() => {
    // モジュールスコープの状態はテスト間で持ち越される。テスト専用の export は
    // 足さず、公開 API だけで空に戻す。
    //
    // 片付けを先に済ませてからフェイクタイマーに切り替える。逆にすると、
    // 前のテストが張った実タイマーのハンドルをフェイク側で消すことになる。
    for (const item of toastStore.get()) toast.dismiss(item.id);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("success で追加したトーストに type が付く", () => {
    toast.success("下書きを保存しました");

    expect(toastStore.get()).toEqual([
      { id: expect.any(Number), type: "success", message: "下書きを保存しました" },
    ]);
  });

  it("error で追加したトーストに type が付く", () => {
    toast.error("画像の生成に失敗しました");

    expect(toastStore.get()).toEqual([
      { id: expect.any(Number), type: "error", message: "画像の生成に失敗しました" },
    ]);
  });

  it("4 件目が来ると一番古いものを押し出し、残りは投入順で並ぶ", () => {
    // 投入順と五十音順をわざと逆相関させる。一致する文言（あ・い・う・え）を
    // 使うと、実装がうっかりソートしていてもこのテストが通ってしまう。
    toast.success("ぬま");
    toast.success("たき");
    toast.success("そら");
    toast.success("かぜ");

    expect(toastStore.get().map((item) => item.message)).toEqual(["たき", "そら", "かぜ"]);
  });

  it("dismiss は指定した 1 件だけ消す", () => {
    toast.success("ぬま");
    toast.success("たき");
    const second = toastStore.get()[1];

    toast.dismiss(second.id);

    expect(toastStore.get().map((item) => item.message)).toEqual(["ぬま"]);
  });

  it("存在しない id を dismiss しても配列の参照を変えない", () => {
    toast.success("ぬま");
    const before = toastStore.get();

    toast.dismiss(-1);

    expect(toastStore.get()).toBe(before);
  });

  it("変化が無ければ get は同じ参照を返す", () => {
    // useSyncExternalStore は戻り値を Object.is で比較する。毎回新しい配列を
    // 返すと「変わっていないのに変わった」と判定され、無限再レンダリングになる。
    toast.success("ぬま");

    expect(toastStore.get()).toBe(toastStore.get());
  });

  it("getServerSnapshot は毎回同じ参照の空配列を返す", () => {
    expect(toastStore.getServerSnapshot()).toEqual([]);
    expect(toastStore.getServerSnapshot()).toBe(toastStore.getServerSnapshot());
  });

  it("追加と削除で購読者に通知し、解除後は通知しない", () => {
    const listener = vi.fn();
    const unsubscribe = toastStore.subscribe(listener);

    toast.success("ぬま");
    toast.dismiss(toastStore.get()[0].id);

    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    toast.success("たき");

    // 解除後に増えていないこと（2 のまま）。
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("success は 4 秒で自動的に消える", () => {
    toast.success("ぬま");

    vi.advanceTimersByTime(3999);
    expect(toastStore.get()).toHaveLength(1);

    vi.advanceTimersByTime(1);
    expect(toastStore.get()).toHaveLength(0);
  });

  it("error は 8 秒表示される（4 秒では消えない）", () => {
    // 失敗は読んで判断する必要がある（もう一度押すか決める）ので長くしてある。
    toast.error("画像の生成に失敗しました");

    vi.advanceTimersByTime(4000);
    expect(toastStore.get()).toHaveLength(1);

    vi.advanceTimersByTime(4000);
    expect(toastStore.get()).toHaveLength(0);
  });

  it("押し出されたトーストのタイマーを止める", () => {
    // 配列の中身だけを見るテストではこれを検知できない。止め忘れたタイマーが
    // 発火しても、その id は既に配列に無いので dismiss は何もせず、見た目は
    // 正しいままになる。動いているタイマーの本数を直接見る。
    toast.success("ぬま");
    toast.success("たき");
    toast.success("そら");
    expect(vi.getTimerCount()).toBe(3);

    toast.success("かぜ"); // ここで「ぬま」が押し出される

    expect(vi.getTimerCount()).toBe(3);
  });

  it("手動で閉じたトーストのタイマーを止める", () => {
    toast.success("ぬま");
    toast.success("たき");
    expect(vi.getTimerCount()).toBe(2);

    toast.dismiss(toastStore.get()[0].id);

    expect(vi.getTimerCount()).toBe(1);
  });

  it("pause すると自動消去が止まる", () => {
    toast.success("ぬま");

    vi.advanceTimersByTime(1000);
    toast.pause(toastStore.get()[0].id);
    vi.advanceTimersByTime(60000);

    expect(toastStore.get()).toHaveLength(1);
  });

  it("resume すると pause した時点の残り時間から再開する", () => {
    // 経過した分は戻さない。離れるたびに寿命が延びると、画面の隅に
    // トーストが居座り続けることになる。
    toast.success("ぬま");
    const id = toastStore.get()[0].id;

    vi.advanceTimersByTime(1000); // 残り 3000
    toast.pause(id);
    vi.advanceTimersByTime(60000); // 止まっているので減らない
    toast.resume(id);

    vi.advanceTimersByTime(2999);
    expect(toastStore.get()).toHaveLength(1);

    vi.advanceTimersByTime(1);
    expect(toastStore.get()).toHaveLength(0);
  });

  it("上限を超えたら最も早く消えるものを捨てる（error が success に押し出されない）", () => {
    // error は 8 秒、success は 4 秒。最古を捨てる実装だと、error に 8 秒を
    // 与えた意味が消える（読む前に success 3 件で押し出される）。
    toast.error("しっぱい");
    vi.advanceTimersByTime(1000);
    toast.success("ぬま"); // 残り 4000。この時点で最も早く消える
    vi.advanceTimersByTime(1000);
    toast.success("たき");
    vi.advanceTimersByTime(1000);
    toast.success("そら"); // ここで 4 件目

    expect(toastStore.get().map((item) => item.message)).toEqual([
      "しっぱい",
      "たき",
      "そら",
    ]);
  });

  it("一時停止中のトーストは押し出しの候補にしない", () => {
    // pause の目的は「触れているものが手の下で消えるのを防ぐ」こと。
    // 残り時間だけで選ぶと、止めた瞬間の残りが小さいトーストが最初に
    // 捨てられ、押し出しが pause を打ち消す。
    toast.success("ぬま");
    vi.advanceTimersByTime(3000); // 残り 1000。止めなければ真っ先に捨てられる
    toast.pause(toastStore.get()[0].id);

    toast.success("たき");
    toast.success("そら");
    toast.success("かぜ"); // 4 件目

    expect(toastStore.get().map((item) => item.message)).toEqual(["ぬま", "そら", "かぜ"]);
  });

  it("いま追加したトーストは押し出しの候補にしない", () => {
    // 残り時間だけで選ぶと、寿命の短い新着（success 4 秒）が寿命の長い既存
    // （error 8 秒）に負けて即座に消える。直前の操作への反応が出ないのは
    // この機能の目的そのものを損なう。
    toast.error("いち");
    toast.error("に");
    toast.error("さん");

    toast.success("よん");

    expect(toastStore.get().map((item) => item.message)).toEqual(["に", "さん", "よん"]);
  });
});
