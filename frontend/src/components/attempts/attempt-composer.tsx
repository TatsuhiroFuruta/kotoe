"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

import {
  GenerationPanel,
  type GenerationPanelState,
} from "@/components/attempts/generation-panel";
import { buttonClasses } from "@/components/ui/button";
import { ApiError, apiFetch } from "@/lib/api";
import {
  apiErrorCode,
  DESCRIPTION_MAX_LENGTH,
  descriptionFieldError,
  DRAFT_GONE_MESSAGE,
  DRAFT_SAVED_MESSAGE,
  fallbackErrorMessage,
  GENERATE_TARGET_GONE_MESSAGE,
  GENERATION_NOT_STARTED_MESSAGE,
  generationErrorMessage,
  POST_GONE_MESSAGE,
} from "@/lib/attempts/attempt-messages";
import { type PollOutcome, shouldConfirmGeneration } from "@/lib/attempts/poll-attempt";
import { useAttemptPolling } from "@/lib/attempts/use-attempt-polling";
import { useAuth } from "@/lib/auth/auth-context";
import { SESSION_EXPIRED_MESSAGE } from "@/lib/auth/error-messages";
import { postDetailHref } from "@/lib/posts/post-detail-query";
import { toast } from "@/lib/toast/toast-store";
import type { Attempt, AttemptResponse } from "@/types/api";

/**
 * フォームの進行状態。状態遷移は reducer に切り出さない（7-3c 設計書「決定 7」）。
 * polling の immediate は「応答が不明だったので最初の 1 回を待たずに確かめる」（決定 10）。
 */
type Phase =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "starting" }
  | { kind: "polling"; attemptId: number; immediate: boolean }
  | { kind: "published"; attempt: Attempt }
  | { kind: "failed"; attempt: Attempt }
  | { kind: "stalled"; attemptId: number; reason: "timed_out" | "not_found" };

/**
 * 保存の結果。失敗のうち「下書きがもう generating 以降になっていた」（PATCH の
 * attempt_not_draft）ときは、その挑戦を確かめに行く（joinAttemptId）。
 */
type SaveResult = { ok: true; attemptId: number } | { ok: false; joinAttemptId: number | null };

const PLACEHOLDER = "色・形・配置・雰囲気など、見えるものを言葉で書いてみましょう";

function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

function panelStateOf(phase: Phase): GenerationPanelState | null {
  switch (phase.kind) {
    case "polling":
      return { kind: "generating" };
    case "published":
    case "failed":
      return phase;
    case "stalled":
      return { kind: phase.reason };
    default:
      return null;
  }
}

/** 読み上げ用の短い文。パネル全体を live region にしない理由は GenerationPanel を参照。 */
function announcementOf(phase: Phase): string {
  switch (phase.kind) {
    case "starting":
      return "生成を開始しています";
    case "polling":
      return "生成中です";
    case "published":
      return "画像が完成しました";
    case "failed":
      return "生成できませんでした";
    case "stalled":
      return phase.reason === "timed_out" ? "まだ生成しています" : "生成中の挑戦が見つかりませんでした";
    default:
      return "";
  }
}

/**
 * 描写フォーム（7-3c）。「保存」＝下書きの作成・更新、「画像を生成」＝ジョブの起動
 * （CLAUDE.md「ドメインの重要ルール」）。生成が成功したら即公開で、結果はこのフォームの
 * 下のパネルに出す（決定 8）。
 *
 * 下書き id は画面の中だけで持つ（決定 1）。入力欄は認証状態によらず常に出し、ボタン
 * 領域だけを出し分ける（決定 4。失効でアンマウントされると書きかけの文面が消えるため）。
 */
export function AttemptComposer({
  postId,
  onPublished,
}: {
  postId: number;
  onPublished: () => void;
}) {
  const auth = useAuth();
  const [text, setText] = useState("");
  const [draftId, setDraftId] = useState<number | null>(null);
  const [savedText, setSavedText] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // 入力欄へのフォーカス要求。値そのものに意味は無く、増えるたびに下の effect が走る。
  const [focusRequest, setFocusRequest] = useState(0);
  const baseId = useId();
  const headingId = `${baseId}-heading`;
  const textareaId = `${baseId}-description`;
  const fieldErrorId = `${baseId}-description-error`;
  const counterId = `${baseId}-description-counter`;

  useAttemptPolling(phase.kind === "polling" ? phase : null, handlePollOutcome);

  const busy = phase.kind === "saving" || phase.kind === "starting" || phase.kind === "polling";
  // 打ち切り（まだ生成しているかもしれない）の間も押せなくする。下書きは捨ててあるので、
  // 押すと新しい下書きで二度目の生成になり、枠を二重に使う。やり直すときはパネルの
  // 「新しく描写する」を明示的に押してもらう。
  const blocked = busy || (phase.kind === "stalled" && phase.reason === "timed_out");
  const isSaved = draftId !== null && text === savedText;
  const overLimit = text.length > DESCRIPTION_MAX_LENGTH;
  const panelState = panelStateOf(phase);

  function clearMessages() {
    setFormError(null);
    setFieldError(null);
  }

  function forgetDraft() {
    setDraftId(null);
    setSavedText(null);
  }

  /**
   * 入力欄へフォーカスを戻す。描画の確定後（effect）に行うのは、エラーの id が
   * aria-describedby に載ってからにするため（載る前に移すと、スクリーンリーダーが
   * エラーを読まない）。requestAnimationFrame で移す形は、実測でフォーカスが移らなかった
   * （2026-09-30）ので使わない。
   *
   * 使うのは 2 つの場面。入力欄のエラーは live region に出ないので、フォーカスを移して
   * 読ませる。失効ではボタン領域がログイン導線に置き換わり、押したボタンが消えて
   * フォーカスが body に落ちる（キーボード利用者がページの先頭へ戻される）。
   */
  function focusTextareaAfterRender() {
    setFocusRequest((count) => count + 1);
  }

  useEffect(() => {
    if (focusRequest > 0) textareaRef.current?.focus();
  }, [focusRequest]);

  /**
   * 下書きの作成（POST）か更新（PATCH）。savedText には、応答時点の text ではなく
   * **送った文面**を入れる（保存中にも入力できるため）。
   */
  async function persistDraft(): Promise<SaveResult> {
    const sending = text;
    const body = JSON.stringify({ attempt: { description: sending } });
    const isUpdate = draftId !== null;

    try {
      const { attempt } = isUpdate
        ? await apiFetch<AttemptResponse>(`/api/attempts/${draftId}`, { method: "PATCH", body })
        : await apiFetch<AttemptResponse>(`/api/posts/${postId}/attempts`, { method: "POST", body });
      setDraftId(attempt.id);
      setSavedText(sending);
      return { ok: true, attemptId: attempt.id };
    } catch (error: unknown) {
      return { ok: false, joinAttemptId: showSaveError(error, draftId) };
    }
  }

  /**
   * 保存の失敗を表示する。下書きが既に generating 以降だった（attempt_not_draft）ときは、
   * 表示せずにその id を返す。呼び出し側は確認のポーリングに入る。
   * 別タブで生成した・応答が不明だった生成が実は起動していた、のどちらでも、
   * 進んでいる生成を追うのが正しい（「下書きが無くなった」と言って捨てると、
   * 次に押したとき新しい下書きで二度目の生成になり、枠を二重に使う）。
   */
  function showSaveError(error: unknown, updatingId: number | null): number | null {
    const isUpdate = updatingId !== null;

    // 失効。文面は残す（入力欄は常に表示）。ボタン領域はログイン導線に変わる。
    if (isUnauthorized(error)) {
      toast.error(SESSION_EXPIRED_MESSAGE);
      focusTextareaAfterRender();
      return null;
    }

    const field = descriptionFieldError(error);
    if (field !== null) {
      setFieldError(field);
      focusTextareaAfterRender();
      return null;
    }

    if (isUpdate && apiErrorCode(error) === "attempt_not_draft") {
      forgetDraft();
      return updatingId;
    }

    // 別タブで削除された、またはお題が削除された下書き。次の保存は新しい下書きになる。
    if (isUpdate && error instanceof ApiError && error.status === 404) {
      forgetDraft();
      setFieldError(DRAFT_GONE_MESSAGE);
      focusTextareaAfterRender();
      return null;
    }

    if (!isUpdate && error instanceof ApiError && error.status === 404) {
      setFormError(POST_GONE_MESSAGE);
      return null;
    }

    setFormError(fallbackErrorMessage(error));
    return null;
  }

  /** 保存に失敗したあとの行き先。進んでいる生成があれば確かめに行き、無ければ入力に戻す。 */
  function settleAfterSaveFailure(joinAttemptId: number | null) {
    setPhase(
      joinAttemptId === null
        ? { kind: "idle" }
        : { kind: "polling", attemptId: joinAttemptId, immediate: true },
    );
  }

  async function handleSave() {
    clearMessages();
    setPhase({ kind: "saving" });
    const result = await persistDraft();
    if (!result.ok) {
      settleAfterSaveFailure(result.joinAttemptId);
      return;
    }
    setPhase({ kind: "idle" });
    // 押しても画面が変わらない操作なので、成功をトーストで伝える（7-2.5）。
    toast.success(DRAFT_SAVED_MESSAGE);
  }

  /**
   * 未保存の変更があれば保存してから起動する（決定 2）。生成はサーバーに保存された文面を
   * 使うので、保存せずに起動すると古い文面で生成され、枠が 1 つ消える。
   */
  async function handleGenerate() {
    clearMessages();
    setPhase({ kind: "starting" });

    let attemptId = draftId;
    if (attemptId === null || text !== savedText) {
      const result = await persistDraft();
      if (!result.ok) {
        settleAfterSaveFailure(result.joinAttemptId);
        return;
      }
      attemptId = result.attemptId;
    }

    try {
      const { attempt } = await apiFetch<AttemptResponse>(`/api/attempts/${attemptId}/generate`, {
        method: "POST",
      });
      // 受け付けられた時点で、この挑戦はもう下書きではない（generating）。持ち続けると
      // 「保存済み」と表示し、直して押すと PATCH が attempt_not_draft になる。
      forgetDraft();
      setPhase({ kind: "polling", attemptId: attempt.id, immediate: false });
    } catch (error: unknown) {
      showGenerateError(error, attemptId);
    }
  }

  function showGenerateError(error: unknown, attemptId: number) {
    if (isUnauthorized(error)) {
      toast.error(SESSION_EXPIRED_MESSAGE);
      setPhase({ kind: "idle" });
      focusTextareaAfterRender();
      return;
    }

    // 上限・キルスイッチ。挑戦は draft のままなので、回復後にまた押せる。
    const message = generationErrorMessage(error, Date.now());
    if (message !== null) {
      setFormError(message);
      setPhase({ kind: "idle" });
      return;
    }

    if (error instanceof ApiError && error.status === 404) {
      forgetDraft();
      setFormError(GENERATE_TARGET_GONE_MESSAGE);
      setPhase({ kind: "idle" });
      return;
    }

    // 応答が不明（サーバー側では起動済みかもしれない）。挑戦を取得して確かめる（決定 10）。
    if (shouldConfirmGeneration(error)) {
      setPhase({ kind: "polling", attemptId, immediate: true });
      return;
    }

    setFormError(fallbackErrorMessage(error));
    setPhase({ kind: "idle" });
  }

  function handlePollOutcome(outcome: PollOutcome, attemptId: number) {
    if (outcome.kind === "not_found" || outcome.kind === "timed_out") {
      // どちらも「下書きとしてはもう使えない」側に倒す。応答不明の確認が通信エラーの
      // まま打ち切られた場合は実は draft のこともあるが、そのとき次の保存で下書きが
      // 1 つ増えるだけで済む（generating の挑戦を PATCH して迷わせるより軽い）。
      forgetDraft();
      setPhase({ kind: "stalled", attemptId, reason: outcome.kind });
      return;
    }

    const { attempt } = outcome;
    if (attempt.status === "published" || attempt.status === "failed") {
      // 終端状態の挑戦は二度と draft に戻らない。次の保存・生成は新しい下書きにする。
      // 文面は残す（少し直して再挑戦できるように。決定 6）。
      forgetDraft();
      setPhase(
        attempt.status === "published"
          ? { kind: "published", attempt }
          : { kind: "failed", attempt },
      );
      if (attempt.status === "published") onPublished();
      return;
    }

    // draft：確かめた結果、起動していなかった。下書きはそのまま使える。
    setFormError(GENERATION_NOT_STARTED_MESSAGE);
    setPhase({ kind: "idle" });
  }

  function startOver() {
    setPhase({ kind: "idle" });
    // 押した「新しく描写する」はパネルごと消えるので、描画の確定後に入力欄へ移す。
    focusTextareaAfterRender();
  }

  function recheck() {
    if (phase.kind !== "stalled") return;
    setPhase({ kind: "polling", attemptId: phase.attemptId, immediate: true });
    // 押した「もう一度確認」はパネルの切り替えで消え、フォーカスが body に落ちる。
    focusTextareaAfterRender();
  }

  const describedBy = [fieldError !== null ? fieldErrorId : null, counterId]
    .filter((id): id is string => id !== null)
    .join(" ");

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-4 rounded-card border border-line bg-surface p-4 sm:p-6"
    >
      <h2 id={headingId} className="text-lg font-semibold text-ink">
        描写を書く
      </h2>

      {formError !== null && (
        <p role="alert" className="rounded-card border border-danger p-3 text-sm text-danger">
          {formError}
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor={textareaId} className="sr-only">
          描写文
        </label>
        <textarea
          id={textareaId}
          ref={textareaRef}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            // 直している最中に、もう当てはまらないエラーと aria-invalid を残さない。
            if (fieldError !== null) setFieldError(null);
          }}
          rows={6}
          placeholder={PLACEHOLDER}
          aria-invalid={fieldError === null ? undefined : true}
          aria-describedby={describedBy}
          className="resize-y rounded-card border border-line bg-canvas px-3 py-2 text-ink outline-none focus:border-accent"
        />
        <div className="flex items-start justify-between gap-3 text-sm">
          {fieldError !== null ? (
            <p id={fieldErrorId} className="text-danger">
              {fieldError}
            </p>
          ) : (
            <span />
          )}
          {/*
            表示だけ。判定はサーバーの 422 に任せる（決定 9）。aria-live にしない
            （1 文字ごとに読み上げられる）。text.length は UTF-16 の単位なので、絵文字などで
            サーバーより多く数えることがあるが、多めの側のずれなので「超えていない」表示で
            422 になることは無い。
          */}
          <p
            id={counterId}
            className={`shrink-0 tabular-nums ${overLimit ? "text-danger" : "text-ink-muted"}`}
          >
            {text.length} / {DESCRIPTION_MAX_LENGTH}
          </p>
        </div>
      </div>

      {auth.status === "unauthenticated" ? (
        <div className="flex sm:justify-end">
          <Link
            href={`/login?next=${encodeURIComponent(postDetailHref(postId))}`}
            className={`${buttonClasses({ variant: "primary" })} text-center`}
          >
            ログインして描写する
          </Link>
        </div>
      ) : (
        // スマホ幅は縦に積み、主役の「画像を生成」を上にする（flex-col-reverse）。
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={handleSave}
            // loading の間は押せない（ログイン中か確定していない）。unreachable は押せる。
            disabled={blocked || auth.status === "loading" || isSaved}
            className={buttonClasses({ variant: "secondary" })}
          >
            {phase.kind === "saving" ? "保存中…" : isSaved ? "保存済み" : "保存"}
          </button>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={blocked || auth.status === "loading"}
            className={buttonClasses({ variant: "primary" })}
          >
            {phase.kind === "starting"
              ? "生成を開始しています…"
              : phase.kind === "polling"
                ? "生成中…"
                : "画像を生成"}
          </button>
        </div>
      )}

      <p role="status" className="sr-only">
        {announcementOf(phase)}
      </p>

      {panelState !== null && (
        <GenerationPanel state={panelState} onStartOver={startOver} onRecheck={recheck} />
      )}
    </section>
  );
}
