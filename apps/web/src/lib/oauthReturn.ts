import { request } from "./api";
import type { EntrySession } from "./access";

// Capture and remove the one-time code before React renders or issues requests.
export function takeConnectionReturn(
  url: URL,
  replace: (path: string) => void,
) {
  const returned = url.searchParams.get("connection") === "truefoundry";
  const code = returned ? url.searchParams.get("connectionExchange") : null;
  const status = url.searchParams.get("status");
  const failed =
    returned && (status === "failed" || (!code && status === "needs_identity"));
  if (returned || url.searchParams.has("connectionExchange")) {
    for (const key of ["connection", "status", "connectionExchange"])
      url.searchParams.delete(key);
    replace(url.pathname + url.search + url.hash);
  }
  return { returned, code, failed };
}
export const connectionReturn =
  typeof window === "undefined"
    ? { returned: false, code: null, failed: false }
    : takeConnectionReturn(new URL(window.location.href), (path) =>
        window.history.replaceState(null, "", path),
      );

// React StrictMode replays effects. Exchange a single-use code only once.
export function exchangeOnce(code: string) {
  let pending: Promise<EntrySession> | undefined;
  return () =>
    (pending ??= request<EntrySession>(
      "",
      "/v1/connections/truefoundry/complete",
      { method: "POST", body: { code }, retry: false },
    ).then((session) => {
      if (!session.token || !session.personId || session.access !== "owner")
        throw new Error("Coco could not verify the returned account session.");
      return session;
    }));
}
export const completeConnectionReturn = connectionReturn.code
  ? exchangeOnce(connectionReturn.code)
  : undefined;
