import { useEffect, useRef, useState } from "react";
import { request } from "./api";

export type AccountStatus = {
  status:
    | "disconnected"
    | "needs_identity"
    | "needs_authorization"
    | "connected"
    | "failed";
  checkedAt: string;
  reason?: string;
  tools?: string[];
  authorizationUrls?: { server: string; url: string }[];
  accountIdentityVerified: boolean;
  connectAvailable: boolean;
  identity?: { displayName?: string; email?: string };
  identitySource?: string;
  connectedServices?: string[];
  verifiedServices?: string[];
};

export function readAccountStatus(token: string, signal: AbortSignal) {
  // Verification can consume a Zapier task. One explicit click gets one attempt.
  return request<AccountStatus>(token, "/v1/connections/truefoundry/status", {
    signal,
    retry: false,
  });
}

export function useAccountStatus(token: string) {
  const [snapshot, setSnapshot] = useState<{
    token: string;
    data: AccountStatus;
  }>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const controller = useRef(new AbortController());
  const inFlight = useRef(false);
  useEffect(() => {
    const clear = () => {
      controller.current.abort();
      controller.current = new AbortController();
      inFlight.current = false;
      setSnapshot(undefined);
      setError("");
      setLoading(false);
    };
    const returned = (event: PageTransitionEvent) => {
      if (event.persisted) clear();
    };
    clear();
    window.addEventListener("pageshow", returned);
    return () => {
      window.removeEventListener("pageshow", returned);
      controller.current.abort();
    };
  }, [token]);
  async function refresh() {
    if (!token || inFlight.current) return;
    const signal = controller.current.signal;
    inFlight.current = true;
    setLoading(true);
    setError("");
    try {
      const data = await readAccountStatus(token, signal);
      if (!signal.aborted) setSnapshot({ token, data });
    } catch (e) {
      if (!signal.aborted) setError((e as Error).message);
    } finally {
      if (!signal.aborted) {
        setLoading(false);
        inFlight.current = false;
      }
    }
  }
  return {
    data: snapshot?.token === token ? snapshot.data : undefined,
    error,
    loading,
    refresh,
  };
}
