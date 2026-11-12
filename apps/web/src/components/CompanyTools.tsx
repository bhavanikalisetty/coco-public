import { useState } from "react";
import { RefreshCw } from "lucide-react";
import type { CocoState } from "../lib/useCoco";
import { requestId } from "../lib/api";
import { nodeName } from "../lib/graph";
import {
  useMutation,
  useResource,
  retrySource,
  dateLabel,
  type CrmData,
} from "../lib/workspace";
import { MutationStatus, SourceDetails } from "./MemoryWorkspace";

export function CompanyTools({ state }: { state: CocoState }) {
  const enabled = state.live && state.data.capabilities.companyCrm === true;
  const crm = useResource<CrmData>(state.token, "/v1/crm", enabled);
  const [contactId, setContactId] = useState(""),
    [note, setNote] = useState(""),
    [email, setEmail] = useState(""),
    [atBooth, setAtBooth] = useState(true),
    [demo, setDemo] = useState(false),
    [task, setTask] = useState(""),
    [assignedTo, setAssignedTo] = useState(state.data.me.personId),
    [due, setDue] = useState(""),
    [saved, setSaved] = useState("");
  const mutation = useMutation<unknown>(state.token, () => {
    setSaved("Company update saved.");
    setNote("");
    setTask("");
    setEmail("");
    crm.refresh();
    void state.refreshGraphs();
  });
  const graph = crm.data?.graph ?? state.graphs.company;
  const staff = graph.nodes.filter(
    (n) =>
      n.labels.includes("Employee") ||
      graph.edges.some((e) => e.source === n.id && e.type === "WORKS_AT"),
  );
  const employees = new Map([
    [
      state.data.me.personId,
      state.data.people.find((p) => p.id === state.data.me.personId)?.name ??
        "Me",
    ],
    ...staff.map(
      (n) => [String(n.properties.id), nodeName(n)] as [string, string],
    ),
  ]);
  const selected = crm.data?.contacts.find((c) => c.id === contactId);
  const tasks =
    crm.data?.followUps.filter(
      (f) => !contactId || f.contactId === contactId,
    ) ?? [];
  const sources =
    crm.data?.records.filter(
      (r) => !contactId || r.data.contactId === contactId,
    ) ?? [];
  const available = enabled && !mutation.pending;
  function send(path: string, body: unknown) {
    setSaved("");
    void mutation.send({ path, body });
  }
  return (
    <section className="editor-paper company-workspace">
      <div className="section-heading">
        <div>
          <span className="eyebrow">SHARED WITH YOUR COMPANY</span>
          <h2>Keep the conversation moving.</h2>
        </div>
        <button
          className="secondary"
          disabled={!enabled || crm.loading}
          onClick={crm.refresh}
        >
          <RefreshCw size={14} />
          Refresh CRM
        </button>
      </div>
      <p>
        Record a visit, share a note or assign an internal follow-up. These
        actions do not send a message.
      </p>
      {!enabled && (
        <p className="notice">
          {state.live
            ? "Company updates are unavailable from this API."
            : "Connect your badge to read and update your company CRM."}
        </p>
      )}
      {crm.loading && !crm.data && (
        <p role="status">Loading company records…</p>
      )}
      {crm.error && (
        <p className="notice error" role="alert">
          {crm.error} {crm.data ? "Showing the last loaded records." : ""}
        </p>
      )}
      {crm.data?.graphStatus === "unavailable" && (
        <p className="notice error">
          Company graph retrieval is unavailable. Existing records may be
          missing from this view; pending sources remain below.
        </p>
      )}
      <label className="form-label">
        Choose a contact
        <select
          disabled={!available}
          value={contactId}
          onChange={(e) => setContactId(e.target.value)}
        >
          <option value="">All contacts / choose to add an update</option>
          {state.data.people
            .filter((p) => p.id !== state.data.me.personId)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </select>
      </label>
      {selected && (
        <div className="contact-summary">
          <strong>{selected.name}</strong>
          <p>
            Met through:{" "}
            {selected.employees.map((e) => e.name ?? e.id).join(", ") ||
              "No employee returned"}
          </p>
          {selected.emails.length > 0 && (
            <p>
              Reported email: {selected.emails.join(", ")}{" "}
              <span className="subtle">
                Supplied by a teammate; not verified or contacted.
              </span>
            </p>
          )}
        </div>
      )}
      <div className="crm-forms">
        <form
          className="workspace-form"
          onSubmit={(e) => {
            e.preventDefault();
            send("/v1/crm/visits", {
              requestId: requestId(),
              contactId,
              note: note.trim(),
              ...(email.trim() ? { email: email.trim() } : {}),
              atBooth,
              topicIds: [],
              isDemo: demo,
            });
          }}
        >
          <h3>Log a conversation</h3>
          <fieldset disabled={!available || !contactId}>
            <label>
              Shared visit note
              <textarea
                required
                rows={4}
                maxLength={5000}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="What did you discuss? What should your teammate know?"
              />
            </label>
            <label>
              Contact email (optional)
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Only an email they supplied"
              />
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={atBooth}
                onChange={(e) => setAtBooth(e.target.checked)}
              />
              Met at our booth
            </label>
            <details className="source-details">
              <summary>Source options</summary>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={demo}
                  onChange={(e) => setDemo(e.target.checked)}
                />
                Test record
              </label>
            </details>
            <button className="primary" disabled={!note.trim()}>
              Save shared visit
            </button>
          </fieldset>
        </form>
        <form
          className="workspace-form"
          onSubmit={(e) => {
            e.preventDefault();
            send("/v1/crm/follow-ups", {
              requestId: requestId(),
              contactId,
              text: task.trim(),
              assignedTo,
              ...(due ? { dueAt: new Date(due).toISOString() } : {}),
            });
          }}
        >
          <h3>Create a follow-up</h3>
          <fieldset disabled={!available || !contactId}>
            <label>
              Internal task
              <textarea
                required
                rows={4}
                maxLength={2000}
                value={task}
                onChange={(e) => setTask(e.target.value)}
                placeholder="What should happen next?"
              />
            </label>
            <label>
              Assign to
              <select
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value)}
              >
                {[...employees].map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Due date (optional, your local time)
              <input
                type="datetime-local"
                value={due}
                onChange={(e) => setDue(e.target.value)}
              />
            </label>
            <p className="subtle">
              Only provisioned company teammates can receive assignments.
            </p>
            <button className="primary" disabled={!task.trim()}>
              Create internal task
            </button>
          </fieldset>
        </form>
      </div>
      <MutationStatus mutation={mutation} />
      {saved && (
        <p role="status" className="notice">
          {saved}
        </p>
      )}
      {crm.data?.pendingRecords.map((record) => (
        <article key={record.id} className="memory-entry pending">
          <span className="badge amber">Waiting for graph projection</span>
          <p>
            {String(
              record.data.note ?? record.data.text ?? "Pending company source",
            )}
          </p>
          <SourceDetails record={record} />
          {retrySource(record, state.data.me.personId, true) ? (
            <button
              className="secondary"
              disabled={!!mutation.pending}
              onClick={() =>
                void mutation.send(
                  retrySource(record, state.data.me.personId, true)!,
                )
              }
            >
              Retry pending company update
            </button>
          ) : (
            <p className="subtle">
              This source belongs to another author or a badge workflow. It
              cannot be replayed from this form.
            </p>
          )}
        </article>
      ))}
      <h3>Internal follow-ups</h3>
      {tasks.map((f) => (
        <article key={f.id} className="memory-entry">
          <span className="badge">{f.status}</span>
          <p>{f.text}</p>
          <p className="subtle">
            {state.data.people.find((p) => p.id === f.contactId)?.name ??
              f.contactId}{" "}
            · Assigned to {employees.get(f.assignedTo) ?? f.assignedTo}
            {f.dueAt ? ` · Due ${dateLabel(f.dueAt)}` : ""}
          </p>
          {f.status === "open" && (
            <div className="button-row">
              <button
                className="secondary"
                disabled={!available}
                onClick={() =>
                  send(
                    `/v1/crm/follow-ups/${encodeURIComponent(f.id)}/status`,
                    { status: "done" },
                  )
                }
              >
                Mark done
              </button>
              <button
                className="text-button"
                disabled={!available}
                onClick={() =>
                  send(
                    `/v1/crm/follow-ups/${encodeURIComponent(f.id)}/status`,
                    { status: "cancelled" },
                  )
                }
              >
                Cancel task
              </button>
            </div>
          )}
        </article>
      ))}
      {crm.data?.graphStatus === "ready" && !tasks.length && (
        <p className="empty-copy">No follow-ups returned for this selection.</p>
      )}
      <details className="source-details">
        <summary>Shared source history ({sources.length})</summary>
        {sources.map((record) => (
          <article key={record.id} className="memory-entry">
            <span className="badge">
              {String(record.data.type ?? "record")}
            </span>
            <p className="preserve-lines">
              {String(record.data.note ?? record.data.text ?? "")}
            </p>
            <SourceDetails record={record} />
          </article>
        ))}
      </details>
    </section>
  );
}
