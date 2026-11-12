import { useEffect, useRef, useState } from "react";
import { ExternalLink, RefreshCw, ShieldCheck } from "lucide-react";
import { request } from "../lib/api";
import { safeLink } from "../lib/graph";
import { useAccountStatus, type AccountStatus } from "../lib/accountStatus";
import type { CocoState } from "../lib/useCoco";

const labels: Record<AccountStatus["status"], string> = {
  disconnected: "Not connected",
  needs_identity: "Account verification needed",
  needs_authorization: "App authorization needed",
  connected: "Connected",
  failed: "Connection failed",
};
export function AccountConnections({ state }: { state: CocoState }) {
  const status = useAccountStatus(state.live ? state.token : "");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const controller = useRef(new AbortController());
  useEffect(() => {
    controller.current = new AbortController();
    return () => controller.current.abort();
  }, []);
  const data = status.data;
  const connectAvailable =
    data?.connectAvailable ??
    state.data.capabilities.connectedAccounts === true;
  const verified = data?.accountIdentityVerified === true;
  const identity = verified ? data.identity : undefined;
  const calendarIdentity = data?.identitySource === "google_primary_calendar";
  useEffect(() => {
    if (data?.status === "connected" && verified) {
      state.clearConnectionFailure();
      setError("");
    }
  }, [data?.status, verified, state.clearConnectionFailure]);
  function navigate(url: string) {
    const target = safeLink(url);
    if (!target)
      throw new Error(
        "The provider returned an invalid sign-in link. Refresh connection status.",
      );
    // Explicit Connect/Authorize navigation retains only this actor's tab session.
    // Existing user-selected tab retention remains unchanged.
    if (!sessionStorage.getItem("coco-token"))
      sessionStorage.setItem("coco-oauth-token", state.token);
    window.location.assign(target);
  }
  async function connect() {
    state.clearConnectionFailure();
    setError("");
    setBusy(true);
    const signal = controller.current.signal;
    try {
      const result = await request<{ connectUrl: string }>(
        state.token,
        "/v1/connections/truefoundry/connect",
        { method: "POST", body: {}, signal, retry: false },
      );
      if (!signal.aborted) navigate(result.connectUrl);
    } catch (e) {
      if (!signal.aborted) setError((e as Error).message);
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }
  return (
    <section className="account-connections">
      <div className="section-heading">
        <h3>Your mail & calendar</h3>
        <button
          className="text-button"
          disabled={!state.live || status.loading || busy}
          onClick={() => {
            setError("");
            state.clearConnectionFailure();
            void status.refresh();
            void state.refreshAccess();
          }}
        >
          <RefreshCw size={14} />
          Check status
        </button>
      </div>
      <p>Connect your Gmail and Calendar to use them with Coco.</p>
      {state.live && (
        <p className="subtle">
          Verification runs only when you choose Check status.
        </p>
      )}
      {!state.live ? (
        <p className="notice">
          Choose an attendee profile or create your own Coco profile first.
        </p>
      ) : status.loading && !data ? (
        <p className="notice" role="status">
          Checking account connection…
        </p>
      ) : null}
      {status.error && (
        <p className="notice error" role="alert">
          Account connection status is unavailable. {status.error}
        </p>
      )}
      {data && (
        <>
          <span
            className={`badge ${data.status === "connected" ? "" : "amber"}`}
          >
            {labels[data.status] ?? "Connection status unavailable"}
          </span>
          {data.reason && (
            <p className="notice" role="status">
              {data.reason}
            </p>
          )}
          {verified ? (
            <div className="connected-identity">
              <ShieldCheck size={18} />
              <div>
                <strong>
                  {identity?.displayName ??
                    identity?.email ??
                    "Verified account"}
                </strong>
                {identity?.email && identity.displayName && (
                  <p>{identity.email}</p>
                )}
                <p className="subtle">
                  {calendarIdentity
                    ? "Calendar account verified."
                    : "Your account is verified."}{" "}
                  Connected apps are listed below.
                </p>
              </div>
            </div>
          ) : (
            <p className="subtle">
              Your Google account has not been verified yet.
            </p>
          )}
          <div className="connected-services">
            {data.connectedServices?.includes("calendar") && (
              <span className="badge">Google Calendar connected</span>
            )}
            {data.connectedServices?.includes("gmail") && (
              <span className="badge">Gmail connected</span>
            )}
          </div>
          {data.tools?.length ? (
            <details className="source-details">
              <summary>
                Tools returned by the provider ({data.tools.length})
              </summary>
              <ul>
                {data.tools.map((tool, i) => (
                  <li key={`${i}:${tool}`}>{tool}</li>
                ))}
              </ul>
              <p className="subtle">
                This tool list does not independently confirm Gmail or Calendar
                authorization.
              </p>
            </details>
          ) : (
            <p className="subtle">No app tools returned.</p>
          )}
          {data.authorizationUrls
            ?.filter((link) => safeLink(link.url))
            .map((link, i) => (
              <button
                key={`${i}:${link.server}`}
                className="secondary full-width"
                disabled={busy || status.loading || !!status.error}
                onClick={() => {
                  try {
                    navigate(link.url);
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                Authorize {link.server}
                <ExternalLink size={14} />
              </button>
            ))}
          <p className="subtle">
            Last checked {new Date(data.checkedAt).toLocaleString()}
          </p>
        </>
      )}
      <div className="button-row">
        <button
          className="primary"
          disabled={!state.live || !connectAvailable || status.loading || busy}
          onClick={() => void connect()}
        >
          {busy
            ? "Opening sign-in…"
            : data?.status === "connected"
              ? "Reconnect account"
              : "Connect mail & calendar"}
          <ExternalLink size={15} />
        </button>
      </div>
      {!connectAvailable && state.live && !status.loading && (
        <p className="subtle">Account connections are unavailable right now.</p>
      )}
      <p className="subtle">
        Sign-in opens in this tab. Your Coco session is kept here while you
        connect. If sign-in stays open, return to Coco to check the connection
        status.
      </p>
      {(error || state.connectionFailure || data?.status === "failed") &&
        !data?.reason && (
          <p className="notice">
            Your Coco profile is ready. This account may need access to the
            event’s TrueFoundry connection before Gmail and Calendar can
            connect.
          </p>
        )}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {state.connectionFailure && (
        <p className="notice error" role="alert">
          Sign-in did not finish. Your Coco profile is still available.
          Connection status above comes from the API.
        </p>
      )}
    </section>
  );
}
