import { useEffect, useRef, useState } from "react";
import { request } from "../lib/api";

type Schedule = {
  enabled: boolean;
  time: string;
  timezone: string;
  conferenceDate: string;
};

export function RecapSchedule({ token }: { token: string }) {
  const [saved, setSaved] = useState<Schedule>();
  const [enabled, setEnabled] = useState(false);
  const [time, setTime] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const controller = useRef(new AbortController());
  const locked = useRef(false);
  function apply(schedule: Schedule) {
    setSaved(schedule);
    setEnabled(schedule.enabled);
    setTime(schedule.time);
  }
  useEffect(() => {
    const initial = new AbortController();
    controller.current = initial;
    setBusy(true);
    request<Schedule>(token, "/v1/recaps/schedule", {
      signal: initial.signal,
      retry: false,
    })
      .then((data) => {
        if (!initial.signal.aborted) apply(data);
      })
      .catch(() => {
        if (!initial.signal.aborted)
          setError("The recap schedule is unavailable right now.");
      })
      .finally(() => {
        if (!initial.signal.aborted) setBusy(false);
      });
    return () => initial.abort();
  }, [token]);
  async function update(reload: boolean) {
    if (locked.current || busy) return;
    locked.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    const signal = controller.current.signal;
    try {
      const data = await request<Schedule>(token, "/v1/recaps/schedule", {
        signal,
        retry: false,
        ...(reload
          ? {}
          : {
              method: "PUT",
              body: { enabled, time, timezone: saved?.timezone },
            }),
      });
      if (signal.aborted) return;
      apply(data);
      setNotice(
        reload
          ? "Schedule reloaded."
          : data.enabled
            ? "Recap reminder saved. It will prepare a draft, without posting it."
            : "Automatic recap turned off.",
      );
    } catch (e) {
      if (!signal.aborted)
        setError(
          `${(e as Error).message} Reload the schedule to check its saved state.`,
        );
    } finally {
      locked.current = false;
      if (!signal.aborted) setBusy(false);
    }
  }
  return (
    <details className="recap-schedule">
      <summary>End-of-day recap</summary>
      <p>
        Have Coco prepare a summary for review. Scheduling a recap does not
        authorize posting.
      </p>
      {busy && <p role="status">Checking your schedule…</p>}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {saved && (
        <form
          className="workspace-form"
          onSubmit={(e) => {
            e.preventDefault();
            void update(false);
          }}
        >
          <fieldset disabled={busy}>
            <label className="check-row">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              Prepare my end-of-day recap
            </label>
            <label>
              Recap time
              <input
                type="time"
                value={time}
                required
                disabled={!enabled}
                onChange={(e) => setTime(e.target.value)}
              />
            </label>
            <p className="subtle">
              Conference date: {saved.conferenceDate}. Times use{" "}
              {saved.timezone === "America/Los_Angeles"
                ? "Pacific Time"
                : saved.timezone}
              .
            </p>
            <button
              className="secondary"
              disabled={enabled === saved.enabled && time === saved.time}
            >
              Save recap schedule
            </button>
          </fieldset>
        </form>
      )}
      <button
        className="text-button"
        disabled={busy}
        onClick={() => void update(true)}
      >
        Reload schedule
      </button>
    </details>
  );
}
