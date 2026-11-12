import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { request } from "../lib/api";
import { useResource } from "../lib/workspace";
import { safeLink } from "../lib/graph";
import { canManageDemoBadge } from "../lib/access";
import type { CocoState } from "../lib/useCoco";

type Binding = {
  deviceId: string;
  personId: string;
  name: string;
  linkedinUrl: string;
  version: number;
};
const path = "/v1/demo/badges/badge_leo/profile";
export function DemoBadgeControls({ state }: { state: CocoState }) {
  const [open, setOpen] = useState(false);
  const allowed = state.live && canManageDemoBadge(state.data);
  const binding = useResource<Binding>(state.token, path, allowed && open);
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const controller = useRef(new AbortController());
  useEffect(() => {
    controller.current = new AbortController();
    return () => controller.current.abort();
  }, []);
  useEffect(() => {
    if (binding.data) {
      setLinkedinUrl(binding.data.linkedinUrl);
      setName("");
    }
  }, [binding.data]);
  async function update(reset = false) {
    setBusy(true);
    setError("");
    setSaved("");
    try {
      const result = await request<Binding>(
        state.token,
        reset ? "/v1/demo/badges/badge_leo/reset" : path,
        {
          method: "POST",
          body: reset
            ? {}
            : {
                linkedinUrl: linkedinUrl.trim(),
                ...(name.trim() ? { name: name.trim() } : {}),
              },
          retry: false,
          signal: controller.current.signal,
        },
      );
      if (controller.current.signal.aborted) return;
      setSaved(
        `${reset ? "Leo restored" : "Tester updated"}. Next confirmed taps use ${result.name} (${result.linkedinUrl}), binding ${result.version}.`,
      );
      binding.refresh();
      void state.refreshGraphs();
    } catch (e) {
      if (!controller.current.signal.aborted) setError((e as Error).message);
    } finally {
      if (!controller.current.signal.aborted) setBusy(false);
    }
  }
  if (!allowed) return null;
  return (
    <details
      className="source-details demo-badge-controls"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>Leo’s badge profile</summary>
      <p>
        Set the tester’s LinkedIn profile before the next badge tap. Earlier
        encounters keep the profile used at that tap.
      </p>
      <button
        className="text-button"
        disabled={binding.loading || busy}
        onClick={binding.refresh}
      >
        <RefreshCw size={14} />
        Refresh badge profile
      </button>
      {binding.loading && <p role="status">Loading badge profile…</p>}
      {binding.error && (
        <p className="notice error" role="alert">
          Badge controls are unavailable. {binding.error}
        </p>
      )}
      {binding.data && (
        <>
          <p className="subtle">
            Current: {binding.data.name} · binding {binding.data.version}
          </p>
          {safeLink(binding.data.linkedinUrl) && (
            <a
              href={safeLink(binding.data.linkedinUrl)}
              target="_blank"
              rel="noreferrer"
            >
              Open current LinkedIn profile
            </a>
          )}
          <form
            className="workspace-form"
            onSubmit={(e) => {
              e.preventDefault();
              void update();
            }}
          >
            <fieldset disabled={busy || binding.loading || !!binding.error}>
              <label>
                Tester’s LinkedIn URL
                <input
                  type="url"
                  required
                  pattern="https://.*"
                  value={linkedinUrl}
                  onChange={(e) => setLinkedinUrl(e.target.value)}
                />
              </label>
              <label>
                Tester’s name (optional)
                <input
                  maxLength={100}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <button className="primary" disabled={!linkedinUrl.trim()}>
                {busy ? "Saving…" : "Use for next tap"}
              </button>
              <button
                type="button"
                className="text-button"
                onClick={() => void update(true)}
              >
                Restore Leo
              </button>
            </fieldset>
          </form>
        </>
      )}
      {saved && (
        <p className="notice" role="status">
          {saved}
        </p>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
    </details>
  );
}
