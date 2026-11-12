import { useEffect, useRef, useState } from "react";
import { ApiError, requestId } from "../lib/api";
import { safeLink } from "../lib/graph";
import { useResource } from "../lib/workspace";
import {
  publishRecap,
  recapReview,
  type RecapReview,
  type RecapDraft,
  type RecapPublishResult,
  type RecapPostingStatus,
} from "../lib/recaps";

export function RecapPublishing({
  token,
  ownerId,
  draft,
  available,
  disabled,
  onDecline,
  onConflict,
  onBusy,
}: {
  token: string;
  ownerId: string;
  draft: RecapDraft;
  available: boolean;
  disabled: boolean;
  onDecline: () => void;
  onConflict: () => void;
  onBusy: (value: boolean) => void;
}) {
  const [confirming, setConfirming] = useState<RecapReview>();
  const [attempt, setAttempt] = useState<RecapReview & { requestId: string }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<RecapPublishResult>();
  const controller = useRef(new AbortController());
  const inFlight = useRef(false);
  const activity = useResource<RecapPostingStatus>(
    token,
    "/v1/actions/recaps",
    available || !!draft.publication,
  );
  const storedTask = activity.data?.tasks.find(
    (task) =>
      task.actorPersonId === ownerId &&
      task.draftId === draft.id &&
      task.draftRevision === draft.revision,
  );
  const taskStatus =
    storedTask?.status ?? result?.task?.status ?? draft.publication?.status;
  const hasResult = !!(
    storedTask ||
    result ||
    draft.publication ||
    draft.published
  );
  const published =
    draft.published || result?.published === true || taskStatus === "confirmed";
  const senderUrl = safeLink(activity.data?.sender?.linkedinUrl);
  const postUrl = safeLink(storedTask?.outcome?.url ?? draft.publication?.url);
  const resultText =
    storedTask?.outcome?.detail ??
    (!storedTask || storedTask.status === result?.task?.status
      ? result?.text
      : undefined);
  const canPost =
    available &&
    activity.data?.enabled === true &&
    activity.data.sender?.personId === ownerId &&
    !!senderUrl &&
    !activity.loading &&
    !activity.error &&
    !hasResult;
  useEffect(() => {
    controller.current = new AbortController();
    return () => controller.current.abort();
  }, []);
  useEffect(() => {
    if (disabled) setConfirming(undefined);
  }, [disabled]);
  useEffect(() => {
    if (
      !activity.data?.enabled ||
      !taskStatus ||
      !["queued", "running", "pending", "uncertain"].includes(taskStatus) ||
      activity.loading ||
      activity.error
    )
      return;
    const timer = setInterval(() => {
      if (!document.hidden) activity.refresh();
    }, 8000);
    return () => clearInterval(timer);
  }, [
    taskStatus,
    activity.data?.enabled,
    activity.loading,
    activity.error,
    activity.refresh,
  ]);

  async function post() {
    if (!canPost || disabled || inFlight.current) return;
    const review = attempt ?? confirming;
    if (
      !review ||
      review.revision !== draft.revision ||
      review.revocationVersion !== (draft.revocationVersion ?? 0)
    )
      return;
    const body = attempt ?? {
      requestId: requestId(),
      ...review,
    };
    setAttempt(body);
    setBusy(true);
    onBusy(true);
    setError("");
    inFlight.current = true;
    const signal = controller.current.signal;
    try {
      const response = await publishRecap(token, draft.id, body, signal);
      if (signal.aborted) return;
      setResult(response);
      setConfirming(undefined);
      activity.refresh();
    } catch (e) {
      if (signal.aborted) return;
      if (e instanceof ApiError && e.status === 409) {
        setAttempt(undefined);
        setConfirming(undefined);
        onConflict();
      } else {
        setError(
          (e as Error).message +
            " Posting may already be in progress. Check its status before retrying; a retry keeps this request ID.",
        );
        activity.refresh();
      }
    } finally {
      inFlight.current = false;
      if (!signal.aborted) {
        setBusy(false);
        onBusy(false);
      }
    }
  }
  return (
    <section className="recap-publishing" aria-label="Recap posting">
      <p className="subtle">Approval records your review of this version.</p>
      {!available && !hasResult && (
        <p className="subtle">LinkedIn publishing is unavailable.</p>
      )}
      {activity.loading && available && !hasResult && (
        <p role="status">Checking your LinkedIn sender and posting history…</p>
      )}
      {activity.error && (
        <p className="notice" role="status">
          Posting status is unavailable right now.{" "}
          {hasResult
            ? "Showing the last received result."
            : "Posting remains unavailable until status can be checked."}
        </p>
      )}
      {available &&
        !activity.loading &&
        !activity.error &&
        !canPost &&
        !hasResult && (
          <p className="subtle">
            A LinkedIn sender is not available for this account.
          </p>
        )}
      {hasResult ? (
        <div className="notice" role="status">
          <strong>
            {published ? "Published on LinkedIn" : "Publication not verified"}
          </strong>
          {resultText && <p>{resultText}</p>}
          {taskStatus && <p className="subtle">Posting status: {taskStatus}</p>}
          {postUrl && (
            <a href={postUrl} target="_blank" rel="noreferrer">
              View LinkedIn post
            </a>
          )}
        </div>
      ) : (
        <>
          {canPost && !confirming && !attempt && (
            <button
              className="secondary"
              disabled={disabled || busy}
              onClick={() => setConfirming(recapReview(draft))}
            >
              Post to LinkedIn
            </button>
          )}
          {((confirming && canPost && !disabled) || attempt) && (
            <div className="notice recap-post-confirmation">
              <h3>Post version {draft.revision} to LinkedIn?</h3>
              <p>
                This posts the saved text below from{" "}
                {senderUrl ? (
                  <a href={senderUrl} target="_blank" rel="noreferrer">
                    your connected LinkedIn profile
                  </a>
                ) : (
                  "your connected LinkedIn account"
                )}
                .
              </p>
              <p className="preserve-lines">{draft.text}</p>
              {error && <p role="alert">{error}</p>}
              <button
                className="primary"
                disabled={disabled || busy || !canPost}
                onClick={() => void post()}
              >
                {busy
                  ? "Checking publication…"
                  : attempt
                    ? "Retry this posting request"
                    : "Approve and post version " + draft.revision}
              </button>
              {!attempt && (
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => setConfirming(undefined)}
                >
                  Back to review
                </button>
              )}
            </div>
          )}
          {!attempt && (
            <button
              className="text-button"
              disabled={disabled || busy || draft.postDecision === "declined"}
              onClick={onDecline}
            >
              Not now
            </button>
          )}
          {attempt && (
            <p className="subtle">
              This request has already been submitted. “Not now” cannot cancel a
              request in progress.
            </p>
          )}
        </>
      )}
      {(available || draft.publication) && (
        <button
          className="text-button"
          disabled={activity.loading || busy}
          onClick={activity.refresh}
        >
          Check posting status
        </button>
      )}
    </section>
  );
}
