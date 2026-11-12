import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { safeLink } from "../lib/graph";
import { useResource } from "../lib/workspace";
import {
  newestTapTasks,
  tapStatus,
  type LinkedinTapTask,
} from "../lib/tapStatus";
import type { CocoState } from "../lib/useCoco";

export function LinkedinTapStatus({ state }: { state: CocoState }) {
  const [expanded, setExpanded] = useState(false);
  const allowed =
    state.live && !state.demo && state.data.me.personId === "person_maya";
  const activity = useResource<{ enabled: boolean; tasks: LinkedinTapTask[] }>(
    state.token,
    "/v1/actions/linkedin",
    allowed,
  );
  const data = activity.data;
  const tasks = newestTapTasks(data?.tasks ?? []);
  useEffect(() => {
    if (!allowed || !data?.enabled || activity.error || activity.loading)
      return;
    const timer = setInterval(() => {
      if (!document.hidden) activity.refresh();
    }, 8000);
    return () => clearInterval(timer);
  }, [
    allowed,
    data?.enabled,
    activity.error,
    activity.loading,
    activity.refresh,
  ]);
  if (!allowed) return null;
  return (
    <section
      className="linkedin-tap-status"
      aria-label="LinkedIn requests from badge taps"
    >
      <div className="section-heading">
        <h3>LinkedIn requests</h3>
        <button
          className="text-button"
          disabled={activity.loading}
          onClick={activity.refresh}
        >
          <RefreshCw size={14} />
          Refresh requests
        </button>
      </div>
      <p className="subtle">
        From Maya’s confirmed badge taps. Each result keeps the LinkedIn
        profile from that tap.
      </p>
      {activity.loading && !data && (
        <p role="status">Checking LinkedIn requests…</p>
      )}
      {activity.error && (
        <p className="notice" role="status">
          LinkedIn status is unavailable right now.
          {data ? " Showing the last received results." : ""}
        </p>
      )}
      {data && !data.enabled && (
        <p className="notice">
          Automatic LinkedIn requests are unavailable right now.
        </p>
      )}
      {data && !activity.error && data.tasks.length === 0 && (
        <p className="subtle">
          No LinkedIn tasks have been recorded for your taps.
        </p>
      )}
      {!!data?.tasks.length && (
        <ul className="tap-task-list">
          {(expanded ? tasks : tasks.slice(0, 3)).map((task) => {
            const status = tapStatus(task);
            const url = safeLink(task.targetLinkedinUrl);
            const when = new Date(task.updatedAt);
            return (
              <li key={task.id}>
                <div className="tap-task-heading">
                  {url ? (
                    <a href={url} target="_blank" rel="noreferrer">
                      {task.targetName || "LinkedIn profile"}
                    </a>
                  ) : (
                    <strong>{task.targetName || "LinkedIn profile"}</strong>
                  )}
                  <span className={`badge ${status.verified ? "" : "amber"}`}>
                    {status.label}
                  </span>
                </div>
                <p>{status.description}</p>
                {Number.isFinite(when.getTime()) && (
                  <time dateTime={task.updatedAt} className="subtle">
                    Updated {when.toLocaleString()}
                  </time>
                )}
                {task.outcome?.detail && task.status !== "confirmed" && (
                  <details className="source-details">
                    <summary>Result details</summary>
                    <p>{task.outcome.detail}</p>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {data && data.tasks.length > 3 && (
        <button
          className="text-button"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded
            ? "Show latest three taps"
            : `Show all results (${data.tasks.length})`}
        </button>
      )}
      <p className="subtle">
        Refreshing only checks the result. It does not send another request.
      </p>
    </section>
  );
}
