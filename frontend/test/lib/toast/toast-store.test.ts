// @vitest-environment node
//
// ストアは DOM を触らないので jsdom は要らない（vitest.config.mts のコメントが
// 定めている切り替え方に沿う）。
import { beforeEach, describe, expect, it, vi } from "vitest";

import { toast, toastStore } from "@/lib/toast/toast-store";

describe("toastStore", () => {
  beforeEach(() => {
    // モジュールスコープの状態はテスト間で持ち越される。テスト専用の export は
    // 足さず、公開 API だけで空に戻す。
    for (const item of toastStore.get()) toast.dismiss(item.id);
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
});
