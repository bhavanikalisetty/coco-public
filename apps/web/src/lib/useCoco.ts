import { useCallback, useEffect, useRef, useState } from "react";
import fixture from "./fixture.json";
import {
  graphScopes,
  observeDeviceCommands,
  type EntrySession,
  type Registration,
} from "./access";
import { ApiError, request, requestId } from "./api";
import { completeConnectionReturn, connectionReturn } from "./oauthReturn";
import type { Bootstrap, Context, Graph, Job, Turn } from "./types";
import { useReplyAudio } from "./useReplyAudio";
import {
  incomingJobs,
  mergeIncomingJob,
  observeProactive,
  updateJob,
  type BadgeCommand,
  type ProactiveNotification,
} from "./incomingJobs";
const emptyGraph: Graph = {
  nodes: [],
  edges: [],
  source: "unavailable",
  eventId: "enter_si_era_2026",
};
export function useCoco() {
  const [data, setData] = useState<Bootstrap>(fixture as Bootstrap),
    [context, setContext] = useState<Context>({
      conference: fixture.conference,
      location: { zoneId: "f1_entrance", source: "preview" },
      activeIntents: [],
    });
  const [token, setToken] = useState(""),
    [connectionFailure, setConnectionFailure] = useState(
      connectionReturn.failed,
    ),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [syncError, setSyncError] = useState(""),
    [turns, setTurns] = useState<Turn[]>([]);
  const [graphs, setGraphs] = useState<Record<string, Graph>>({
      conference: emptyGraph,
      me: emptyGraph,
      company: emptyGraph,
    }),
    [graphErrors, setGraphErrors] = useState<Record<string, string>>({});
  const activeCount = turns.filter(
    (t) =>
      t.pending ||
      (!t.pollStopped && t.job && ["queued", "running"].includes(t.job.status)),
  ).length;
  const replyAudio = useReplyAudio(token, turns);
  const scope = useRef(new AbortController()),
    generation = useRef(0),
    turnsRef = useRef(turns),
    lastGraph = useRef(0),
    failedIncomingJobs = useRef(new Set<string>()),
    dataRef = useRef(data),
    refreshingAccess = useRef(false);
  dataRef.current = data;
  turnsRef.current = turns;
  const clearConnectionFailure = useCallback(
    () => setConnectionFailure(false),
    [],
  );
  const connect = useCallback(async (value: string, remember = false) => {
    scope.current.abort();
    scope.current = new AbortController();
    const signal = scope.current.signal;
    const current = ++generation.current;
    setLoading(true);
    setError("");
    setToken("");
    setTurns([]);
    failedIncomingJobs.current.clear();
    setGraphs({ conference: emptyGraph, me: emptyGraph, company: emptyGraph });
    setGraphErrors({});
    setSyncError("");
    if (!remember) sessionStorage.removeItem("coco-token");
    setData(fixture as Bootstrap);
    setContext({
      conference: fixture.conference,
      location: { zoneId: "f1_entrance", source: "preview" },
      activeIntents: [],
    });
    try {
      const [bootstrap, ctx] = await Promise.all([
        request<Bootstrap>(value, "/v1/bootstrap", { signal }),
        request<Context>(value, "/v1/context", { signal }),
      ]);
      if (current !== generation.current) return;
      sessionStorage.removeItem("coco-oauth-token");
      setData(bootstrap);
      setContext({
        ...ctx,
        conference: ctx.conference ?? bootstrap.conference,
      });
      setToken(value);
      lastGraph.current = 0;
      if (remember) sessionStorage.setItem("coco-token", value);
      return true;
    } catch (e) {
      if (!signal.aborted) {
        const invalid = e instanceof ApiError && e.status === 401;
        if (invalid) {
          sessionStorage.removeItem("coco-token");
          sessionStorage.removeItem("coco-oauth-token");
        } else if (remember) sessionStorage.setItem("coco-token", value);
        setData(fixture as Bootstrap);
        setError((e as Error).message);
      }
      return false;
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, []);
  const enter = async (path: string, body: unknown, remember = false) => {
    setConnectionFailure(false);
    scope.current.abort();
    scope.current = new AbortController();
    const signal = scope.current.signal;
    const current = ++generation.current;
    setLoading(true);
    setError("");
    try {
      const session = await request<EntrySession>("", path, {
        method: "POST",
        body,
        signal,
        retry: false,
      });
      if (signal.aborted) return false;
      if (
        !session.token ||
        !session.personId ||
        !["demo", "owner"].includes(session.access)
      )
        throw new Error(
          "Coco returned an incomplete session. Please try again.",
        );
      if (remember) sessionStorage.setItem("coco-token", session.token);
      return await connect(session.token, remember);
    } catch (e) {
      if (!signal.aborted) setError((e as Error).message);
      return false;
    } finally {
      if (current === generation.current) setLoading(false);
    }
  };
  const loginDemo = (personId: string) => enter("/v1/demo/login", { personId });
  const register = (profile: Registration, remember: boolean) =>
    enter("/v1/demo/register", profile, remember);
  const refreshAccess = useCallback(async () => {
    if (!token || refreshingAccess.current) return;
    refreshingAccess.current = true;
    const signal = scope.current.signal;
    try {
      const [bootstrap, ctx] = await Promise.all([
        request<Bootstrap>(token, "/v1/bootstrap", { signal }),
        request<Context>(token, "/v1/context", { signal }),
      ]);
      if (signal.aborted) return;
      if (
        bootstrap.access !== dataRef.current.access ||
        bootstrap.me.personId !== dataRef.current.me.personId
      ) {
        scope.current.abort();
        scope.current = new AbortController();
        setTurns([]);
        failedIncomingJobs.current.clear();
        setGraphs({
          conference: emptyGraph,
          me: emptyGraph,
          company: emptyGraph,
        });
        setGraphErrors({});
        lastGraph.current = 0;
      }
      setData(bootstrap);
      setContext({
        ...ctx,
        conference: ctx.conference ?? bootstrap.conference,
      });
      setSyncError("");
    } catch (e) {
      if (!signal.aborted) setSyncError((e as Error).message);
    } finally {
      refreshingAccess.current = false;
    }
  }, [token]);
  const disconnect = () => {
    setConnectionFailure(false);
    scope.current.abort();
    scope.current = new AbortController();
    generation.current++;
    sessionStorage.removeItem("coco-token");
    sessionStorage.removeItem("coco-oauth-token");
    setToken("");
    setData(fixture as Bootstrap);
    setContext({
      conference: fixture.conference,
      location: { zoneId: "f1_entrance", source: "preview" },
      activeIntents: [],
    });
    setTurns([]);
    failedIncomingJobs.current.clear();
    setGraphs({ conference: emptyGraph, me: emptyGraph, company: emptyGraph });
    setError("");
    setSyncError("");
    setGraphErrors({});
    setLoading(false);
  };
  useEffect(() => {
    let active = true;
    if (completeConnectionReturn) {
      sessionStorage.removeItem("coco-token");
      sessionStorage.removeItem("coco-oauth-token");
      setLoading(true);
      void completeConnectionReturn()
        .then((session) => {
          if (!active) return;
          sessionStorage.setItem("coco-token", session.token);
          return connect(session.token, true);
        })
        .catch((e: Error) => {
          if (active) {
            setError(
              `Account sign-in could not finish. ${e.message} Start sign-in again.`,
            );
            setLoading(false);
          }
        });
    } else {
      const saved = sessionStorage.getItem("coco-token");
      const temporary = sessionStorage.getItem("coco-oauth-token");
      if (saved || temporary) void connect(saved || temporary!, !!saved);
    }
    return () => {
      active = false;
      scope.current.abort();
    };
  }, [connect]);
  useEffect(() => {
    const returned = (event: PageTransitionEvent) => {
      if (token) sessionStorage.removeItem("coco-oauth-token");
      if (event.persisted) void refreshAccess();
    };
    window.addEventListener("pageshow", returned);
    return () => window.removeEventListener("pageshow", returned);
  }, [token, refreshAccess]);
  const allowedGraphs = graphScopes(data).join(",");
  const deviceCommands = observeDeviceCommands(data);
  const proactiveNotifications = observeProactive(data);
  const refreshGraphs = useCallback(async () => {
    if (!token) return;
    const signal = scope.current.signal;
    const allowed = allowedGraphs.split(",");
    for (const view of ["me", "company"])
      if (!allowed.includes(view)) {
        setGraphs((old) => ({ ...old, [view]: emptyGraph }));
        setGraphErrors((old) => ({
          ...old,
          [view]:
            "Private graph access is not enabled for this session. Connect your own account to check availability.",
        }));
      }
    await Promise.all(
      allowed.map(async (view) => {
        try {
          const graph = await request<Graph>(token, `/v1/graph?view=${view}`, {
            signal,
          });
          if (signal.aborted) return;
          setGraphs((old) => ({ ...old, [view]: graph }));
          setGraphErrors((old) => ({ ...old, [view]: "" }));
        } catch (e) {
          if (!signal.aborted)
            setGraphErrors((old) => ({ ...old, [view]: (e as Error).message }));
        }
      }),
    );
    lastGraph.current = Date.now();
  }, [token, allowedGraphs]);
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const polling = new AbortController();
    const signal = AbortSignal.any([scope.current.signal, polling.signal]);
    const poll = async () => {
      if (cancelled || signal.aborted) return;
      const fetched = new Map<string, Promise<Job>>();
      const readJob = (id: string) => {
        if (!fetched.has(id))
          fetched.set(
            id,
            request<Job>(token, `/v1/jobs/${encodeURIComponent(id)}`, {
              signal,
            }),
          );
        return fetched.get(id)!;
      };
      const results = await Promise.allSettled([
        (async () => {
          const active = turnsRef.current.filter(
            (t) =>
              !t.pollStopped &&
              t.job &&
              ["queued", "running"].includes(t.job.status),
          );
          const jobs = await Promise.allSettled(
            active.map(async (turn) => {
              try {
                const job = await readJob(turn.job!.jobId);
                if (!cancelled && !signal.aborted) {
                  if (job.jobId !== turn.job!.jobId)
                    throw new Error("Coco returned an unexpected job.");
                  setTurns((old) => updateJob(old, job));
                  if (
                    turn.origin === "proactive" &&
                    job.status === "completed" &&
                    job.result?.origin !== "proactive"
                  ) {
                    failedIncomingJobs.current.add(job.jobId);
                    throw new Error(
                      "A Coco notification could not be verified.",
                    );
                  }
                }
              } catch (error) {
                if (!cancelled && !signal.aborted)
                  setTurns((old) =>
                    old.map((t) =>
                      t.requestId === turn.requestId
                        ? {
                            ...t,
                            error: (error as Error).message,
                            pollStopped:
                              error instanceof ApiError &&
                              [403, 404, 422].includes(error.status),
                          }
                        : t,
                    ),
                  );
                throw error;
              }
            }),
          );
          const failed = jobs.find((r) => r.status === "rejected");
          if (failed?.status === "rejected") throw failed.reason;
        })(),
        (async () => {
          const ctx = await request<Context>(token, "/v1/context", { signal });
          if (!cancelled && !signal.aborted)
            setContext({
              ...ctx,
              conference: ctx.conference ?? dataRef.current.conference,
            });
        })(),
        (async () => {
          const sources = await Promise.allSettled([
            deviceCommands
              ? request<{ commands: BadgeCommand[] }>(
                  token,
                  "/v1/device/commands",
                  { signal },
                )
              : Promise.resolve({ commands: [] }),
            proactiveNotifications
              ? request<{ notifications: ProactiveNotification[] }>(
                  token,
                  "/v1/proactive",
                  { signal },
                )
              : Promise.resolve({ notifications: [] }),
          ]);
          if (cancelled || signal.aborted) return;
          const commands =
            sources[0].status === "fulfilled" ? sources[0].value.commands : [];
          const notifications =
            sources[1].status === "fulfilled"
              ? sources[1].value.notifications
              : [];
          const known = new Set(
            turnsRef.current.map((turn) => turn.job?.jobId),
          );
          const jobs = await Promise.allSettled(
            incomingJobs(commands, notifications, data.me.personId)
              .filter(
                (incoming) =>
                  !known.has(incoming.jobId) &&
                  !failedIncomingJobs.current.has(incoming.jobId),
              )
              .map(async (incoming) => {
                try {
                  const job = await readJob(incoming.jobId);
                  if (!cancelled && !signal.aborted) {
                    if (
                      job.jobId !== incoming.jobId ||
                      (incoming.origin === "proactive" &&
                        job.status === "completed" &&
                        job.result?.origin !== "proactive")
                    ) {
                      failedIncomingJobs.current.add(incoming.jobId);
                      throw new Error(
                        "A Coco notification could not be verified.",
                      );
                    }
                    setTurns((old) => mergeIncomingJob(old, job, incoming));
                  }
                } catch (error) {
                  if (
                    !cancelled &&
                    !signal.aborted &&
                    error instanceof ApiError &&
                    [403, 404, 422].includes(error.status)
                  )
                    failedIncomingJobs.current.add(incoming.jobId);
                  throw error;
                }
              }),
          );
          const failed = [...sources, ...jobs].find(
            (result) => result.status === "rejected",
          );
          if (failed?.status === "rejected") throw failed.reason;
        })(),
        Date.now() - lastGraph.current > 15000
          ? refreshGraphs()
          : Promise.resolve(),
      ]);
      const failures = results.filter(
        (r): r is PromiseRejectedResult => r.status === "rejected",
      );
      const failed = failures.length > 0;
      if (!cancelled && !signal.aborted)
        setSyncError(
          failures
            .map((r) => (r.reason as Error).message)
            .filter((v, i, a) => a.indexOf(v) === i)
            .join(" "),
        );
      if (!cancelled && !signal.aborted)
        timer = setTimeout(
          poll,
          failed
            ? 8000
            : turnsRef.current.some(
                  (t) =>
                    t.pending ||
                    (!t.pollStopped &&
                      t.job &&
                      ["queued", "running"].includes(t.job.status)),
                )
              ? 1500
              : 12000,
        );
    };
    void poll();
    return () => {
      cancelled = true;
      polling.abort();
      clearTimeout(timer);
    };
  }, [
    token,
    refreshGraphs,
    activeCount,
    deviceCommands,
    proactiveNotifications,
    data.access,
    data.me.personId,
  ]);
  const submit = async (prompt: string, body?: Blob, existing?: Turn) => {
    if (
      !token ||
      data.capabilities[body ? "voice" : "chat"] === false ||
      (data.access === "demo" &&
        data.capabilities[body ? "voice" : "chat"] !== true)
    ) {
      setSyncError(
        "This action is not enabled for your session. Connect your own account to check availability.",
      );
      return;
    }
    const signal = scope.current.signal;
    const turn: Turn = existing ?? {
      requestId: requestId(),
      prompt,
      kind: body ? "voice" : "chat",
      createdAt: Date.now(),
      body,
    };
    setTurns((old) =>
      existing
        ? old.map((t) =>
            t.requestId === turn.requestId
              ? { ...turn, pending: true, error: undefined, pollStopped: false }
              : t,
          )
        : [...old, { ...turn, pending: true }],
    );
    try {
      const job = await request<Job>(
        token,
        turn.kind === "voice" ? "/v1/voice" : "/v1/chat",
        {
          method: "POST",
          body:
            turn.kind === "voice"
              ? turn.body
              : { requestId: turn.requestId, text: turn.prompt, speak: true },
          id: turn.kind === "voice" ? turn.requestId : undefined,
          signal,
        },
      );
      if (signal.aborted) return;
      setTurns((old) =>
        old.map((t) =>
          t.requestId === turn.requestId
            ? {
                ...t,
                pending: false,
                job,
                error: undefined,
                pollStopped: false,
              }
            : t,
        ),
      );
    } catch (e) {
      if (!signal.aborted)
        setTurns((old) =>
          old.map((t) =>
            t.requestId === turn.requestId
              ? { ...t, pending: false, error: (e as Error).message }
              : t,
          ),
        );
    }
  };
  const reportLocation = async (zoneId: string) => {
    if (data.access === "demo")
      throw new Error("Location updates are unavailable with guest access.");
    const signal = scope.current.signal;
    const location = await request<Context["location"]>(token, "/v1/location", {
      method: "POST",
      body: { requestId: requestId(), zoneId },
      signal,
    });
    if (!signal.aborted) setContext((old) => ({ ...old, location }));
  };
  return {
    data,
    context,
    token,
    connectionFailure,
    clearConnectionFailure,
    live: !!token,
    demo: data.access === "demo",
    canChat:
      !!token &&
      data.capabilities.chat !== false &&
      (data.access !== "demo" || data.capabilities.chat === true),
    canVoice:
      !!token &&
      data.capabilities.voice !== false &&
      (data.access !== "demo" || data.capabilities.voice === true),
    loading,
    error,
    syncError,
    turns,
    replyAudio,
    graphs,
    graphErrors,
    connect,
    canResume:
      !token &&
      !!(
        sessionStorage.getItem("coco-token") ||
        sessionStorage.getItem("coco-oauth-token")
      ),
    resume: () => {
      const saved = sessionStorage.getItem("coco-token"),
        temporary = sessionStorage.getItem("coco-oauth-token");
      if (saved || temporary) void connect(saved || temporary!, !!saved);
    },
    loginDemo,
    register,
    refreshAccess,
    disconnect,
    submit,
    reportLocation,
    refreshGraphs,
    busy: turns.some(
      (t) =>
        t.pending ||
        (!t.pollStopped &&
          t.job &&
          ["queued", "running"].includes(t.job.status)),
    ),
  };
}
export type CocoState = ReturnType<typeof useCoco>;
