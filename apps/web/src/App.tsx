import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronRight,
  Coffee,
  Compass,
  MapPin,
  Network,
  NotebookPen,
  PanelLeftClose,
  Search,
  Settings2,
  Users,
  Utensils,
  Building2,
  Lock,
  Monitor,
  LogOut,
  X,
  Clock,
  Plus,
  Mic,
  ShieldCheck,
  Radio,
  RefreshCw,
} from "lucide-react";
import { useCoco, type CocoState } from "./lib/useCoco";
import { attendanceSource, sessionAttendance } from "./lib/attendance";
import { Coco } from "./components/Coco";
import { Conversation } from "./components/Conversation";
import { MemoryWorkspace } from "./components/MemoryWorkspace";
import { DailyRecap } from "./components/DailyRecap";
import { MeetingBrief } from "./components/MeetingBrief";
import { DemoEntrance, CreateProfile } from "./components/WelcomeAccess";
import { AccountConnections } from "./components/AccountConnections";
import { DemoBadgeControls } from "./components/DemoBadgeControls";
import { LinkedinTapStatus } from "./components/LinkedinTapStatus";
import { CompanyTools } from "./components/CompanyTools";
import { GraphView } from "./components/GraphView";
import {
  conflicts,
  isFixture,
  nodeName,
  safeLink,
  time,
  projectorGraph,
  companyRecords,
} from "./lib/graph";
import {
  topicNames,
  type Graph,
  type Person,
  type Session,
  type View,
} from "./lib/types";
const nav = [
  ["today", "Today", Compass],
  ["schedule", "My agenda", CalendarDays],
  ["map", "Venue map", MapPin],
  ["people", "People", Users],
  ["memory", "My memory", NotebookPen],
  ["company", "Company", Building2],
  ["graph", "Connections", Network],
] as const;
const links = [
  ["f1_entrance", "f1_coffee"],
  ["f1_coffee", "f1_booth_hall"],
  ["f1_booth_hall", "f1_stairs"],
  ["f1_stairs", "f2_stairs"],
  ["f2_stairs", "f2_lab"],
  ["f2_stairs", "f2_summit"],
  ["f2_summit", "f2_harbor"],
];
function estimate(from: string, to: string) {
  const queue = [[from]],
    seen = new Set([from]);
  while (queue.length) {
    const path = queue.shift()!,
      last = path.at(-1)!;
    if (last === to) return Math.max(1, path.length - 1);
    for (const [a, b] of links) {
      const next = a === last ? b : b === last ? a : "";
      if (next && !seen.has(next)) {
        seen.add(next);
        queue.push([...path, next]);
      }
    }
  }
  return undefined;
}
import { connectionReturn } from "./lib/oauthReturn";
export default function App() {
  const state = useCoco();
  const [view, setView] = useState<View>("today"),
    [settings, setSettings] = useState(connectionReturn.returned),
    [registration, setRegistration] = useState(false),
    [projector, setProjector] = useState(false),
    [graphScope, setGraphScope] = useState("conference"),
    [focus, setFocus] = useState(""),
    [person, setPerson] = useState<Person | null>(null),
    [briefPersonId, setBriefPersonId] = useState(""),
    [talk, setTalk] = useState(false),
    [answerEvidence, setAnswerEvidence] = useState<Graph | null>(null);
  useEffect(() => {
    setAnswerEvidence(null);
    setGraphScope("conference");
    setFocus("");
    setBriefPersonId("");
  }, [state.token]);
  const [plan, setPlan] = useState<string[]>([]),
    [planOnly, setPlanOnly] = useState(false),
    [toast, setToast] = useState("");
  const [evidenceOrigin, setEvidenceOrigin] = useState<
    "answer" | "recap" | "brief"
  >("answer");
  const planKey = `coco-plan:${state.data.me.personId}`;
  useEffect(() => {
    try {
      setPlan(JSON.parse(localStorage.getItem(planKey) ?? "[]"));
    } catch {
      setPlan([]);
    }
  }, [planKey]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 5500);
    return () => clearTimeout(timer);
  }, [toast]);
  const select = (session: Session) => {
    const next = plan.includes(session.id)
      ? plan.filter((id) => id !== session.id)
      : [...plan, session.id];
    setPlan(next);
    localStorage.setItem(planKey, JSON.stringify(next));
    setToast(
      next.includes(session.id)
        ? "Added to your plan on this browser."
        : "Removed from your plan.",
    );
  };
  const showEvidence = (
    graph: Graph,
    sourceId = "",
    origin: "answer" | "recap" | "brief" = "answer",
  ) => {
    setAnswerEvidence(graph);
    setEvidenceOrigin(origin);
    setFocus(sourceId);
    setGraphScope("me");
    setView("graph");
    setTalk(false);
  };
  const openGraph = (id?: string, scope = "conference") => {
    setAnswerEvidence(null);
    setFocus(id ?? "");
    setGraphScope(state.demo ? "conference" : scope);
    setView("graph");
    setPerson(null);
  };
  const name =
    state.data.people
      .find((p) => p.id === state.data.me.personId)
      ?.name.split(" ")[0] ?? "friend";
  const attendanceAvailable =
    state.live &&
    !state.demo &&
    state.data.capabilities.personalMemory === true;
  const attendance = sessionAttendance(
    attendanceAvailable
      ? state.graphs.me
      : { ...state.graphs.me, source: "unavailable" },
    state.data.me.personId,
  );
  const now = Date.parse(state.context.conference.time),
    upcoming = state.data.sessions.filter(
      (s) => !attendance.has(s.id) && Date.parse(s.startsAt) >= now,
    ),
    next = upcoming.find((s) => plan.includes(s.id)) ?? upcoming[0];
  const shared = state.graphs.me.nodes
    .filter((n) => n.labels.includes("Topic"))
    .map((n) => String(n.properties.id).replace("topic_", ""));
  const busy = state.busy;
  const ask = (text: string) => {
    if (!state.canChat) {
      setSettings(true);
      return;
    }
    setView("today");
    void state.submit(text);
  };
  const projectedGraph = projectorGraph(
    answerEvidence ?? state.graphs[graphScope],
    state.graphs.conference,
  );
  if (projector)
    return (
      <div className="projector">
        <header>
          <div className="brand">
            <Coco small />
            <div>
              <strong>Coco</strong>
              <span>Enter the SI Era</span>
            </div>
          </div>
          <div className="projector-title">
            <span className="eyebrow">Live relationship explorer</span>
            <h1>The connections behind the conversation.</h1>
          </div>
          <button className="secondary" onClick={() => setProjector(false)}>
            <PanelLeftClose size={17} />
            Exit projector
          </button>
        </header>
        <div className="projector-notice">
          <span className={`status-dot ${state.live ? "online" : ""}`} />
          {state.live
            ? answerEvidence
              ? "Turn evidence snapshot · FalkorDB"
              : "Live graph · FalkorDB"
            : "Preview · connect a badge to load FalkorDB"}
          <span>Private contact details, notes and recordings are hidden.</span>
        </div>
        <div className="toolbar">
          <div className="segmented">
            {[
              ["conference", "Conference"],
              ["me", "My encounter paths"],
              ["company", "Company paths"],
            ].map(([id, label]) => (
              <button
                key={id}
                className={graphScope === id ? "active" : ""}
                onClick={() => {
                  setAnswerEvidence(null);
                  setGraphScope(id);
                  setFocus("");
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="subtle">
            Select a node or relationship. Confirmed badge taps appear in
            personal and company paths.
          </span>
        </div>
        <GraphView
          key={graphScope}
          graph={projectedGraph}
          error={answerEvidence ? undefined : state.graphErrors[graphScope]}
          focusId={focus}
          onRefresh={() => {
            setAnswerEvidence(null);
            void state.refreshGraphs();
          }}
          refreshLabel={answerEvidence ? "Show live graph" : "Refresh"}
          projector
        />
      </div>
    );
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="sidebar">
        <a
          className="brand"
          href="#today"
          onClick={(e) => {
            e.preventDefault();
            setView("today");
          }}
        >
          <Coco small />
          <div>
            <strong>
              Coco<span className="brand-period">.</span>
            </strong>
          </div>
        </a>
        <div className="event-label">
          <span className="eyebrow">YOUR CONFERENCE</span>
          <strong>Enter the SI Era</strong>
          <span>
            <MapPin size={12} /> Moscone West, San Francisco
          </span>
        </div>
        <nav aria-label="Main navigation">
          {nav.map(([id, label, Icon]) => (
            <button
              key={id}
              aria-label={label}
              className={view === id ? "active" : ""}
              aria-current={view === id ? "page" : undefined}
              onClick={() => setView(id)}
            >
              <Icon size={19} />
              <span>{label}</span>
              {view === id && <span className="nav-mark" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button
            onClick={() => {
              setProjector(true);
              setFocus("");
              setGraphScope("conference");
            }}
          >
            <Monitor size={18} />
            Projector view
            <ArrowUpRight size={15} />
          </button>
          <button onClick={() => setSettings(true)}>
            <Settings2 size={18} />
            {state.live ? "Badge connection" : "Connect your badge"}
            <span className={`status-dot ${state.live ? "online" : ""}`} />
          </button>
          <div className="profile">
            <span className="avatar">{state.live ? name[0] : "C"}</span>
            <div>
              <strong>{state.live ? name : "Take a look around"}</strong>
              <small>
                {state.demo
                  ? "Guest access · real attendee"
                  : state.live
                    ? "Personal workspace"
                    : "Conference preview"}
              </small>
            </div>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <span className="topbar-date">
            SATURDAY, OCTOBER 24 <span>2026</span>
          </span>
          <div>
            <span className="clock-label">
              <Clock size={14} />
              {time(state.context.conference.time)} PT{" "}
              <span className="badge">
                {state.context.conference.clockMode === "demo"
                  ? "Conference time"
                  : "Live clock"}
              </span>
            </span>
            <button
              className="mobile-connect icon-button"
              aria-label="Badge connection"
              onClick={() => setSettings(true)}
            >
              <Settings2 size={20} />
            </button>
          </div>
        </header>
        {!state.live && (
          <div className="preview-bar">
            <span>
              <span className="status-dot" />
              Choose an attendee profile or create your own to begin.
            </span>
            <button onClick={() => setSettings(true)}>
              {state.loading ? "Connecting…" : "Get started"}
              <ArrowRight size={14} />
            </button>
          </div>
        )}
        {state.demo && (
          <div className="preview-bar">
            <span>
              Guest view: {name}. Public conference access; private accounts are
              not connected.
            </span>
            <button onClick={() => setSettings(true)}>
              Connect your own account
              <ArrowRight size={14} />
            </button>
          </div>
        )}
        {state.syncError && (
          <div className="sync-error" role="alert">
            Connection interrupted: {state.syncError} Retrying automatically.
            Last received data remains visible.
          </div>
        )}
        <main id="main" tabIndex={-1}>
          {view === "today" && (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">A LITTLE COMPANY FOR YOUR DAY</span>
                  <h1>
                    {state.live
                      ? `Good morning, ${name}.`
                      : "Your day, with Coco."}
                  </h1>
                  <p>
                    Find your next session. Make room for a good conversation.
                  </p>
                </div>
                <span className="date-stamp">
                  <strong>24</strong>OCT
                </span>
              </div>
              {!state.live && (
                <DemoEntrance
                  state={state}
                  onCreate={() => {
                    setRegistration(true);
                    setSettings(true);
                  }}
                />
              )}
              <div className="today-layout">
                <div className="day-column">
                  <section className="next-card">
                    <div className="section-label">
                      <span className="eyebrow">
                        {plan.includes(next?.id)
                          ? "NEXT IN YOUR PLAN"
                          : "UP NEXT AT THE CONFERENCE"}
                      </span>
                    </div>
                    {next ? (
                      <>
                        <div className="next-time">
                          <span>{time(next.startsAt)}</span>
                          <span>→ {time(next.endsAt)}</span>
                        </div>
                        <h2>{next.title}</h2>
                        <div className="session-meta">
                          <span>
                            <MapPin size={15} />
                            {
                              state.data.zones.find((z) => z.id === next.room)
                                ?.name
                            }{" "}
                            · Floor{" "}
                            {
                              state.data.zones.find((z) => z.id === next.room)
                                ?.floor
                            }
                          </span>
                          <span>
                            <Clock size={15} />
                            {estimate(
                              state.context.location.zoneId,
                              next.room,
                            )}{" "}
                            min estimated walk
                          </span>
                        </div>
                        <p className="why-line">
                          <span className="tiny-paw">✦</span>
                          {next.topics.some((t) => shared.includes(t))
                            ? `Connects to your interest in ${next.topics
                                .filter((t) => shared.includes(t))
                                .map((t) => topicNames[t])
                                .join(" and ")}.`
                            : "Next on the event agenda. Add a session to make your own plan."}
                        </p>
                        <p className="subtle">
                          Walk estimate uses the conference map and{" "}
                          {state.context.location.source === "reported_zone"
                            ? "your reported zone"
                            : "the starting zone"}
                          .
                        </p>
                        <div className="button-row">
                          <button
                            className="primary"
                            onClick={() => setView("map")}
                          >
                            See the way <ArrowRight size={17} />
                          </button>
                          <button
                            className="text-button"
                            onClick={() => openGraph(next.id)}
                          >
                            Why this session? <Network size={17} />
                          </button>
                        </div>
                      </>
                    ) : (
                      <p>
                        That’s the end of today’s agenda. There’s still time for
                        one last hello.
                      </p>
                    )}
                  </section>
                  <section className="meetup-section">
                    <div className="section-heading">
                      <h2>Make time for a hello.</h2>
                      <span className="subtle">
                        A shared break, a new connection.
                      </span>
                    </div>
                    <div className="meetup-actions">
                      <button
                        disabled={
                          busy ||
                          (state.live && !state.canChat) ||
                          state.data.capabilities.coffeeMatching === false
                        }
                        onClick={() =>
                          ask(
                            "I would like a coffee buddy now. Please create a coffee request.",
                          )
                        }
                      >
                        <Coffee size={22} />
                        <span>
                          <strong>Find a coffee buddy</strong>
                          <small>Open a 10-minute request</small>
                        </span>
                        <ArrowUpRight size={17} />
                      </button>
                      <button
                        disabled={
                          busy ||
                          (state.live && !state.canChat) ||
                          state.data.capabilities.coffeeMatching === false
                        }
                        onClick={() =>
                          ask(
                            "I would like a lunch buddy now. Please create a lunch request.",
                          )
                        }
                      >
                        <Utensils size={22} />
                        <span>
                          <strong>Meet for lunch</strong>
                          <small>Find someone with time to talk</small>
                        </span>
                        <ArrowUpRight size={17} />
                      </button>
                    </div>
                    <IntentStatus state={state} />
                  </section>
                  <section className="day-agenda">
                    <div className="section-heading">
                      <h2>A little later</h2>
                      <button
                        className="text-button"
                        onClick={() => setView("schedule")}
                      >
                        Full agenda
                        <ArrowRight size={15} />
                      </button>
                    </div>
                    {upcoming.slice(1, 4).map((session) => (
                      <button
                        className="agenda-preview"
                        key={session.id}
                        onClick={() => {
                          setView("schedule");
                          setPlanOnly(false);
                        }}
                      >
                        <time>{time(session.startsAt)}</time>
                        <div>
                          <strong>{session.title}</strong>
                          <span>
                            {
                              state.data.zones.find(
                                (z) => z.id === session.room,
                              )?.name
                            }
                          </span>
                        </div>
                        <ChevronRight size={17} />
                      </button>
                    ))}
                  </section>
                  <button
                    className="memory-teaser"
                    onClick={() => setView("memory")}
                  >
                    <NotebookPen size={22} />
                    <div>
                      <strong>A place for what stays with you.</strong>
                      <span>Notes, people and the ideas you want to keep.</span>
                    </div>
                    <ArrowRight size={19} />
                  </button>
                </div>
                <div className="companion-column">
                  <div className="companion-scene">
                    <span className="scene-label">
                      <span
                        className={`status-dot ${state.live ? "online" : ""}`}
                      />
                      {busy
                        ? "Coco is thinking"
                        : state.live
                          ? "Coco is here"
                          : "Meet your companion"}
                    </span>
                    <Coco state={busy ? "thinking" : "idle"} />
                    <div className="scene-path" />
                    <span className="scene-caption">
                      Small badge. Good company.
                    </span>
                  </div>
                  <Conversation
                    key={`${state.token}:${state.data.access}:${state.data.me.personId}`}
                    state={state}
                    onConnect={() => setSettings(true)}
                    onEvidence={showEvidence}
                    onGraph={(scope) => {
                      openGraph(undefined, scope);
                      setTalk(false);
                    }}
                  />
                </div>
              </div>
            </>
          )}
          {view === "schedule" && (
            <>
              <PageHeading
                eyebrow="MAKE THE DAY YOURS"
                title="A little planning. More discovery."
                description="October 24 · Pacific time"
              />
              <div className="toolbar">
                <div className="segmented">
                  <button
                    className={!planOnly ? "active" : ""}
                    onClick={() => setPlanOnly(false)}
                  >
                    All sessions
                  </button>
                  <button
                    className={planOnly ? "active" : ""}
                    onClick={() => setPlanOnly(true)}
                  >
                    My plan <span>{plan.length}</span>
                  </button>
                </div>
                <span className="subtle">
                  Your plan stays on this browser. It does not mark attendance.
                </span>
              </div>
              {state.live && !state.demo && (
                <div className="toolbar">
                  <span className="subtle" role="status">
                    {!attendanceAvailable
                      ? "Saved attendance is unavailable for this account."
                      : state.graphErrors.me
                        ? state.graphs.me.source === "falkordb"
                          ? "Attendance could not be refreshed. Showing the last saved graph."
                          : "Attendance is unavailable. Refresh to try again."
                        : state.graphs.me.source !== "falkordb"
                          ? "Checking your saved attendance…"
                          : `${attendance.size} done · ${upcoming.length} upcoming choices`}
                  </span>
                  <button
                    className="text-button"
                    disabled={!attendanceAvailable}
                    onClick={() => void state.refreshGraphs()}
                  >
                    <RefreshCw size={14} /> Refresh attendance
                  </button>
                </div>
              )}
              <div className="schedule-list">
                {state.data.sessions
                  .filter((s) => !planOnly || plan.includes(s.id))
                  .map((session) => {
                    const attended = attendance.get(session.id);
                    const source = attended
                      ? attendanceSource(state.graphs.me, attended)
                      : undefined;
                    const overlap = conflicts(
                      session,
                      state.data.sessions.filter(
                        (s) => plan.includes(s.id) && !attendance.has(s.id),
                      ),
                    );
                    return (
                      <article
                        key={session.id}
                        className={`schedule-row ${plan.includes(session.id) ? "planned" : ""}`}
                      >
                        <div className="schedule-time">
                          <strong>{time(session.startsAt)}</strong>
                          <span>{time(session.endsAt)}</span>
                        </div>
                        <div className="schedule-info">
                          <span className="eyebrow">
                            {
                              state.data.zones.find(
                                (z) => z.id === session.room,
                              )?.name
                            }{" "}
                            · FLOOR{" "}
                            {
                              state.data.zones.find(
                                (z) => z.id === session.room,
                              )?.floor
                            }
                          </span>
                          <h2>{session.title}</h2>
                          {attended && (
                            <p className="badge">
                              <Check size={13} /> Done
                            </p>
                          )}
                          <div className="tags">
                            {session.topics.map((t) => (
                              <span key={t}>{topicNames[t] ?? t}</span>
                            ))}
                          </div>
                          {!attended && overlap.length > 0 && (
                            <p className="conflict">
                              Overlaps with{" "}
                              {overlap.map((s) => s.title).join(", ")}
                            </p>
                          )}
                          <button
                            className="text-button"
                            disabled={!!attended && !source}
                            title={
                              attended && !source
                                ? "Refresh attendance to check for this source."
                                : undefined
                            }
                            onClick={() =>
                              openGraph(
                                source ?? session.id,
                                attended ? "me" : "conference",
                              )
                            }
                          >
                            {attended
                              ? source
                                ? "View attendance source"
                                : "Attendance source unavailable"
                              : "Explore connections"}{" "}
                            <Network size={14} />
                          </button>
                        </div>
                        <button
                          className={`plan-button ${plan.includes(session.id) ? "selected" : ""}`}
                          disabled={!!attended && !plan.includes(session.id)}
                          aria-label={
                            attended && !plan.includes(session.id)
                              ? `${session.title} completed`
                              : `${plan.includes(session.id) ? "Remove" : "Add"} ${session.title} ${plan.includes(session.id) ? "from" : "to"} plan`
                          }
                          aria-pressed={plan.includes(session.id)}
                          onClick={() => select(session)}
                        >
                          {attended || plan.includes(session.id) ? (
                            <Check size={18} />
                          ) : (
                            <Plus size={18} />
                          )}
                          <span>
                            {attended
                              ? plan.includes(session.id)
                                ? "Remove from plan"
                                : "Done"
                              : plan.includes(session.id)
                                ? "In my plan"
                                : "Add to plan"}
                          </span>
                        </button>
                      </article>
                    );
                  })}
                {planOnly && !plan.length && (
                  <Empty
                    icon={<CalendarDays />}
                    title="Leave some room for curiosity."
                    text="Add a session from the full agenda to start your plan."
                  />
                )}
              </div>
            </>
          )}
          {view === "map" && <Venue state={state} ask={ask} />}
          {view === "people" && <People state={state} onPerson={setPerson} />}
          {view === "memory" && (
            <Memory
              key={`${state.token}:${state.data.access}:${state.data.me.personId}`}
              state={state}
              openGraph={openGraph}
              openSourceGraph={(graph, id) => showEvidence(graph, id, "recap")}
              initialBriefPersonId={briefPersonId}
              openBriefGraph={(graph) => showEvidence(graph, "", "brief")}
            />
          )}
          {view === "company" && (
            <Company
              key={`${state.token}:${state.data.access}:${state.data.me.personId}`}
              state={state}
              openGraph={openGraph}
              onPerson={setPerson}
            />
          )}
          {view === "graph" && (
            <>
              <PageHeading
                eyebrow="FOLLOW THE CONNECTION"
                title="Good conversations have a beginning."
                description="Explore the relationships returned by FalkorDB. Select a connection to see what supports it."
              />
              <div className="toolbar">
                <div className="segmented">
                  {[
                    ["conference", "Conference"],
                    ["me", "My connections"],
                    ["company", "Company"],
                  ].map(([id, label]) => (
                    <button
                      key={id}
                      className={graphScope === id ? "active" : ""}
                      onClick={() => {
                        setAnswerEvidence(null);
                        setGraphScope(id);
                        setFocus("");
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <button
                  className="secondary"
                  onClick={() => setProjector(true)}
                >
                  <Monitor size={16} />
                  Open projector
                </button>
              </div>
              {answerEvidence && (
                <p className="notice">
                  {evidenceOrigin === "recap"
                    ? "This personal graph was fetched for the selected recap source. It may include private memory. "
                    : evidenceOrigin === "brief"
                      ? "These graph records explain the shared context in this meeting brief. "
                      : "These graph records were returned by tools during this turn. They may include candidate sessions or people beyond the final recommendation. This snapshot may include private memory. "}
                  {answerEvidence.partial
                    ? "The API returned a bounded subset of the evidence."
                    : ""}
                  Projector mode hides private sources and contact details.
                </p>
              )}
              <GraphView
                key={graphScope}
                graph={answerEvidence ?? state.graphs[graphScope]}
                error={
                  answerEvidence ? undefined : state.graphErrors[graphScope]
                }
                focusId={focus}
                onRefresh={() => {
                  setAnswerEvidence(null);
                  void state.refreshGraphs();
                }}
                refreshLabel={answerEvidence ? "Show live graph" : "Refresh"}
              />
            </>
          )}
        </main>
        <footer className="app-footer">
          <span>Coco</span>
          <span>Enter the SI Era · Moscone West</span>
          <span>Made for a day of good conversations.</span>
        </footer>
      </div>
      <button className="mobile-talk primary" onClick={() => setTalk(true)}>
        <Mic size={17} />
        Talk to Coco
      </button>
      {talk && (
        <Dialog title="A moment with Coco" onClose={() => setTalk(false)}>
          <Conversation
            key={`${state.token}:${state.data.access}:${state.data.me.personId}`}
            state={state}
            onEvidence={showEvidence}
            onGraph={(scope) => {
              openGraph(undefined, scope);
              setTalk(false);
            }}
            onConnect={() => {
              setTalk(false);
              setSettings(true);
            }}
          />
        </Dialog>
      )}
      {settings && (
        <ConnectionDialog
          state={state}
          initialCreate={registration}
          onClose={() => {
            setSettings(false);
            setRegistration(false);
            state.clearConnectionFailure();
          }}
        />
      )}
      {person && (
        <PersonDialog
          person={person}
          state={state}
          onClose={() => setPerson(null)}
          openGraph={openGraph}
          openBrief={() => {
            setBriefPersonId(person.id);
            setPerson(null);
            setView("memory");
          }}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={16} />
          {toast}
        </div>
      )}
    </div>
  );
}
function PageHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="page-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
    </div>
  );
}
function Empty({
  icon,
  title,
  text,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="empty">
      {icon}
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
function IntentStatus({ state }: { state: CocoState }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <div aria-live="polite">
      {state.context.activeIntents.map((intent) => {
        const expired = intent.expiresAt <= Date.now();
        return (
          <div
            className={`intent ${intent.matchId && !expired ? "matched" : ""}`}
            key={intent.requestId}
          >
            <Coffee size={20} />
            <div>
              <strong>
                {expired
                  ? "Request expired"
                  : intent.matchId
                    ? "Your buddy is ready"
                    : "Looking for a buddy"}
              </strong>
              <p>
                {expired
                  ? "Open a new request when you have time."
                  : intent.matchId
                    ? `Meet ${state.data.people.find((p) => p.id === intent.peerId)?.name ?? "your matched participant"} at Coffee Commons, floor 1.`
                    : `Your ${intent.kind} request is open for ${Math.ceil((intent.expiresAt - Date.now()) / 60000)} more minutes. No match yet.`}
              </p>
            </div>
            <span className="badge">
              {expired ? "Expired" : intent.matchId ? "Matched" : "Waiting"}
            </span>
          </div>
        );
      })}
    </div>
  );
}
function ConnectionDialog({
  state,
  onClose,
  initialCreate = false,
}: {
  state: CocoState;
  onClose: () => void;
  initialCreate?: boolean;
}) {
  const [create, setCreate] = useState(initialCreate);
  const [value, setValue] = useState(""),
    [remember, setRemember] = useState(false);
  return (
    <Dialog
      title={state.live ? "Your Coco connection" : "Welcome to Coco"}
      onClose={onClose}
    >
      <Coco small />

      {state.live ? (
        <div className="connected-details">
          <p>
            <ShieldCheck size={18} />
            {state.demo
              ? "Guest access to this attendee profile. Private accounts remain separate."
              : "Connected to your personal workspace."}
          </p>
          <button
            className="secondary"
            onClick={() => {
              state.disconnect();
              onClose();
            }}
          >
            <LogOut size={16} />
            Disconnect and clear this session
          </button>
        </div>
      ) : (
        <>
          {create ? (
            <>
              <CreateProfile state={state} />
              <button
                className="text-button"
                disabled={state.loading}
                onClick={() => setCreate(false)}
              >
                Back to attendee profiles
              </button>
            </>
          ) : (
            <DemoEntrance state={state} onCreate={() => setCreate(true)} />
          )}
          <details className="source-details">
            <summary>Have a provisioned badge token?</summary>
            <p className="subtle">
              Open the same personal workspace as your physical badge.
            </p>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                state.clearConnectionFailure();
                await state.connect(value.trim(), remember);
                setValue("");
              }}
            >
              <label className="form-label" htmlFor="badge-token">
                Badge token
              </label>
              <input
                id="badge-token"
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder="Paste your Coco bearer token"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                required
              />
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                />
                Keep connected in this tab until it closes
              </label>
              <p className="subtle">
                Tokens stay in browser memory unless you select this option.
                Provider keys do not belong here.
              </p>
              {state.error && (
                <p className="notice error" role="alert">
                  {state.error}
                </p>
              )}
              <button
                className="primary full-width"
                disabled={state.loading || !value.trim()}
              >
                {state.loading ? "Connecting…" : "Connect badge"}
                <ArrowRight size={16} />
              </button>
            </form>
          </details>
        </>
      )}
      <AccountConnections
        key={`${state.token}:${state.data.access}:${state.data.me.personId}`}
        state={state}
      />
      <DemoBadgeControls key={state.token || "preview"} state={state} />
      <LinkedinTapStatus
        key={`${state.token}:${state.data.access}`}
        state={state}
      />
    </Dialog>
  );
}
function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    ref.current?.showModal();
    return () => {
      ref.current?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="dialog"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="dialog-heading">
        <h2>{title}</h2>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function Venue({ state, ask }: { state: CocoState; ask: (s: string) => void }) {
  const [floor, setFloor] = useState(1),
    [selected, setSelected] = useState("f1_coffee"),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const zone = state.data.zones.find((z) => z.id === selected)!;
  return (
    <>
      <PageHeading
        eyebrow="FIND YOUR WAY"
        title="A familiar face. A new corner."
        description="Moscone West · Two floors. Location is reported by you, never tracked."
      />
      <div className="toolbar">
        <div className="segmented">
          {[1, 2].map((n) => (
            <button
              className={floor === n ? "active" : ""}
              key={n}
              onClick={() => {
                setFloor(n);
                setSelected(state.data.zones.find((z) => z.floor === n)!.id);
              }}
            >
              Floor {n}
            </button>
          ))}
        </div>
      </div>
      <div className="venue-layout">
        <section className="venue-map">
          <div className="map-grid" />
          <div className="map-north">N ↑</div>
          <svg viewBox="0 0 600 400" aria-hidden="true">
            {links.map(([a, b]) => {
              const za = state.data.zones.find((z) => z.id === a)!,
                zb = state.data.zones.find((z) => z.id === b)!;
              return za.floor === floor && zb.floor === floor ? (
                <path
                  key={a + b}
                  d={`M${za.x},${za.y} L${zb.x},${zb.y}`}
                  className="map-corridor"
                />
              ) : null;
            })}
          </svg>
          {state.data.zones
            .filter((z) => z.floor === floor)
            .map((z) => (
              <button
                key={z.id}
                className={`map-zone ${selected === z.id ? "selected" : ""} ${state.context.location.zoneId === z.id ? "reported" : ""}`}
                style={{ left: `${z.x / 6}%`, top: `${z.y / 4}%` }}
                onClick={() => setSelected(z.id)}
              >
                <span>
                  {z.id.includes("coffee") ? (
                    <Coffee size={22} />
                  ) : z.id.includes("stairs") ? (
                    "↗"
                  ) : z.id.includes("entrance") ? (
                    <Compass size={22} />
                  ) : (
                    <Building2 size={22} />
                  )}
                </span>
                <strong>{z.name}</strong>
                {state.context.location.zoneId === z.id && (
                  <small>
                    {state.context.location.source === "reported_zone"
                      ? "Your reported zone"
                      : "Starting point"}
                  </small>
                )}
              </button>
            ))}
          <span className="map-caption">MOSCONE WEST · FLOOR {floor}</span>
        </section>
        <aside className="venue-detail">
          <span className="eyebrow">SELECTED PLACE</span>
          <h2>{zone.name}</h2>
          <p>
            Floor {zone.floor} ·{" "}
            {estimate(state.context.location.zoneId, zone.id)} min estimated
            walk from{" "}
            {
              state.data.zones.find(
                (z) => z.id === state.context.location.zoneId,
              )?.name
            }
            .
          </p>
          <div className="rule" />
          <span className="eyebrow">YOUR LOCATION</span>
          <p>
            {
              state.data.zones.find(
                (z) => z.id === state.context.location.zoneId,
              )?.name
            }
            <br />
            <span className="subtle">
              {state.context.location.source === "reported_zone"
                ? "You reported this zone."
                : "Starting zone. Set your location below."}
            </span>
          </p>
          <button
            className="primary full-width"
            disabled={!state.live || state.demo || saving}
            onClick={async () => {
              setSaving(true);
              setError("");
              try {
                await state.reportLocation(zone.id);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setSaving(false);
              }
            }}
          >
            <MapPin size={16} />
            {saving ? "Saving…" : "I’m here"}
          </button>
          <button
            className="secondary full-width"
            disabled={state.busy || (state.live && !state.canChat)}
            onClick={() =>
              ask(`How do I get to ${zone.name} from my reported location?`)
            }
          >
            Ask Coco for directions
            <ArrowRight size={16} />
          </button>
          {(!state.live || state.demo) && (
            <p className="subtle">
              Location reporting is unavailable in guest access.
            </p>
          )}
          {error && (
            <p role="alert" className="notice error">
              {error}
            </p>
          )}
          <p className="map-disclaimer">
            This is a simplified conference map. Follow venue signs for routes
            and accessibility.
          </p>
        </aside>
      </div>
    </>
  );
}
function People({
  state,
  onPerson,
}: {
  state: CocoState;
  onPerson: (p: Person) => void;
}) {
  const [search, setSearch] = useState("");
  const people = state.data.people.filter(
    (p) =>
      p.id !== state.data.me.personId &&
      p.name.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <PageHeading
        eyebrow="THERE’S SOMEONE WORTH MEETING"
        title="Start with a shared curiosity."
        description="Explore conference profiles. Being listed here does not mean someone is available to meet."
      />
      <div className="toolbar">
        <label className="search-field">
          <Search size={17} />
          <input
            aria-label="Search people"
            placeholder="Find someone by name"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <span className="subtle">{people.length} people</span>
      </div>
      <div className="people-list">
        {people.map((p, i) => (
          <button className="person-row" key={p.id} onClick={() => onPerson(p)}>
            <span className={`avatar color-${i % 4}`}>
              {p.name
                .split(" ")
                .map((w) => w[0])
                .slice(0, 2)
                .join("")}
            </span>
            <div>
              <strong>{p.name}</strong>
              <span>Profile</span>
            </div>
            <span className="person-source">
              {p.enrichmentStatus === "enriched"
                ? "Profile sources available"
                : "Profile not enriched"}
            </span>
            <ChevronRight size={18} />
          </button>
        ))}
        {!people.length && (
          <Empty
            icon={<Users />}
            title="No one by that name."
            text="Try a different name to search the participant list."
          />
        )}
      </div>
    </>
  );
}
function PersonDialog({
  person,
  state,
  onClose,
  openGraph,
  openBrief,
}: {
  person: Person;
  state: CocoState;
  onClose: () => void;
  openGraph: (id?: string, scope?: string) => void;
  openBrief: () => void;
}) {
  const graph = state.graphs.conference,
    node = graph.nodes.find((n) => n.properties.id === person.id);
  const ids = node
    ? graph.edges
        .filter((e) => e.source === node.id || e.target === node.id)
        .map((e) => (e.source === node.id ? e.target : e.source))
    : [];
  const topics = graph.nodes.filter(
    (n) => ids.includes(n.id) && n.labels.includes("Topic"),
  );
  const planned = graph.edges.filter(
    (e) => e.source === node?.id && e.type === "PLANS_TO_ATTEND",
  );
  return (
    <Dialog title={person.name} onClose={onClose}>
      <div className="person-dialog-meta">
        <span className="badge amber">Conference profile</span>
        {safeLink(person.linkedinUrl) && (
          <a
            href={safeLink(person.linkedinUrl)}
            target="_blank"
            rel="noreferrer"
          >
            LinkedIn profile
            <ArrowUpRight size={15} />
          </a>
        )}
      </div>
      <h3>Topics to start with</h3>
      <div className="tags">
        {topics.length ? (
          topics.map((t) => <span key={t.id}>{nodeName(t)}</span>)
        ) : (
          <p className="subtle">
            No declared topics returned for this profile.
          </p>
        )}
      </div>
      <h3>Planned sessions</h3>
      {planned.length ? (
        planned.map((e) => (
          <p key={e.id}>
            {nodeName(graph.nodes.find((n) => n.id === e.target)!)}{" "}
            <span className="badge">Planned</span>
          </p>
        ))
      ) : (
        <p className="subtle">No session plans returned.</p>
      )}
      <h3>Before you meet</h3>
      <p>
        Review shared interests and saved LinkedIn activity in a meeting brief.
        Recent activity is checked only when you choose Prepare or Refresh.
      </p>
      <button
        className="secondary"
        disabled={
          !state.live || state.demo || person.id === state.data.me.personId
        }
        onClick={openBrief}
      >
        Open meeting brief
      </button>
      <h3>Meeting history</h3>
      {state.graphs.me.edges
        .filter((e) => e.type === "MET")
        .some((e) =>
          [e.source, e.target].includes(
            state.graphs.me.nodes.find((n) => n.properties.id === person.id)
              ?.id ?? "",
          ),
        ) ? (
        <p>
          A relationship is available in your graph. Open it to inspect the
          source.
        </p>
      ) : (
        <p className="subtle">No meeting history returned for this person.</p>
      )}
      {companyRecords(state.graphs.company)
        .filter((r) => r.node.properties.id === person.id)
        .map((record) => (
          <section key={record.node.id}>
            <h3>Company interaction timeline</h3>
            {record.encounters.map((n) => (
              <article className="contact-timeline" key={n.id}>
                <strong>{nodeName(n)}</strong>
                <span className="badge amber">Graph evidence</span>
                <p>
                  {String(n.properties.excerpt ?? "No shared note returned.")}
                </p>
              </article>
            ))}
            {record.followups.map((n) => (
              <article className="contact-timeline" key={n.id}>
                <strong>
                  Follow-up · {String(n.properties.status ?? "Unknown")}
                </strong>
                <p>{String(n.properties.text ?? "No action text returned.")}</p>
              </article>
            ))}
          </section>
        ))}
      <button className="primary" onClick={() => openGraph(person.id)}>
        Why this person?
        <Network size={17} />
      </button>
    </Dialog>
  );
}
function Memory({
  state,
  openGraph,
  openSourceGraph,
  initialBriefPersonId,
  openBriefGraph,
}: {
  state: CocoState;
  openGraph: (id?: string, scope?: string) => void;
  openSourceGraph: (graph: Graph, id: string) => void;
  initialBriefPersonId: string;
  openBriefGraph: (graph: Graph) => void;
}) {
  const [tab, setTab] = useState(initialBriefPersonId ? "brief" : "notes");
  return (
    <>
      <PageHeading
        eyebrow="KEEP THE PARTS THAT MATTER"
        title="Your day becomes your memory."
        description="Personal notes stay private. A planned session is never counted as attendance."
      />
      <div className="toolbar">
        <div className="segmented">
          {[
            ["notes", "Notes & recordings"],
            ["brief", "Meeting briefs"],
            ["draft", "Daily recap"],
          ].map(([id, label]) => (
            <button
              key={id}
              className={tab === id ? "active" : ""}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="private-label">
          <Lock size={14} />
          Only you
        </span>
      </div>
      {tab === "notes" ? (
        <MemoryWorkspace state={state} openGraph={openGraph} />
      ) : tab === "brief" ? (
        <MeetingBrief
          state={state}
          initialPersonId={initialBriefPersonId}
          onEvidence={openBriefGraph}
        />
      ) : (
        <DailyRecap state={state} openSourceGraph={openSourceGraph} />
      )}
    </>
  );
}
function Company({
  state,
  openGraph,
  onPerson,
}: {
  state: CocoState;
  openGraph: (id?: string, scope?: string) => void;
  onPerson: (p: Person) => void;
}) {
  const graph = state.graphs.company;
  const [filter, setFilter] = useState("all"),
    [search, setSearch] = useState(""),
    [employee, setEmployee] = useState("all");
  const company = graph.nodes.find((n) => n.labels.includes("Company"));
  const records = companyRecords(graph);
  const staff = graph.nodes.filter((n) =>
    graph.edges.some((e) => e.source === n.id && e.type === "WORKS_AT"),
  );
  const contacts = records
    .filter((c) =>
      nodeName(c.node).toLowerCase().includes(search.toLowerCase()),
    )
    .filter(
      (c) =>
        filter === "all" ||
        (filter === "booth" && c.booth) ||
        (filter === "real" && c.evidence.some((p) => !isFixture(p))),
    )
    .filter(
      (c) => employee === "all" || c.employees.some((n) => n.id === employee),
    );
  return (
    <>
      <PageHeading
        eyebrow="THE COMPANY REMEMBERS TOGETHER"
        title={
          company
            ? `${nodeName(company)} connections.`
            : "Your company, in good company."
        }
        description="Shared encounter evidence from FalkorDB. Private personal notes are not copied into this workspace."
      />
      <div className="toolbar">
        <label className="search-field">
          <Search size={17} />
          <input
            aria-label="Search company contacts"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search contacts"
          />
        </label>
        <select
          aria-label="Filter contact evidence"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="all">All evidence</option>
          <option value="real">Recorded activity</option>
          <option value="booth">Booth visitors</option>
        </select>
        <select
          aria-label="Filter by teammate"
          value={employee}
          onChange={(e) => setEmployee(e.target.value)}
        >
          <option value="all">All teammates</option>
          {staff.map((n) => (
            <option key={n.id} value={n.id}>
              {nodeName(n)}
            </option>
          ))}
        </select>
        <button
          className="secondary"
          onClick={() => openGraph(undefined, "company")}
        >
          <Network size={16} />
          Company graph
        </button>
      </div>
      <div className="notice">
        <Building2 size={18} />
        <p>
          These connections come from the company graph. Use the workspace below
          to record shared visits and manage internal follow-ups.
        </p>
      </div>
      {state.graphErrors.company && (
        <p className="notice error">{state.graphErrors.company}</p>
      )}
      <CompanyTools state={state} />
      <div className="company-table">
        <table>
          <thead>
            <tr>
              <th>Contact</th>
              <th>Met through</th>
              <th>Latest shared context</th>
              <th>Follow-up</th>
            </tr>
          </thead>
          <tbody>
            {contacts.map((record) => (
              <tr key={record.node.id}>
                <td>
                  <button
                    className="text-button"
                    onClick={() =>
                      onPerson(
                        state.data.people.find(
                          (p) => p.id === record.node.properties.id,
                        ) ?? {
                          id: String(record.node.properties.id),
                          name: nodeName(record.node),
                          isFictional:
                            record.node.properties.isFictional === true,
                        },
                      )
                    }
                  >
                    {nodeName(record.node)}
                    <ArrowUpRight size={14} />
                  </button>
                  <br />
                  <span className="badge amber">
                    {record.evidence.length
                      ? "Sources available"
                      : "No encounter evidence"}
                  </span>
                </td>
                <td>
                  {record.employees.map(nodeName).join(", ") || "Not returned"}
                  <br />
                  <small>{record.booth ? "Booth visitor" : ""}</small>
                </td>
                <td className="shared-excerpt">
                  {String(
                    record.latest?.properties.excerpt ??
                      record.met[0]?.properties.context ??
                      "No shared note returned.",
                  )}
                </td>
                <td>
                  {record.followups.length ? (
                    record.followups.map((n) => (
                      <div key={n.id}>
                        <span className="badge">
                          {String(n.properties.status ?? "Status unavailable")}
                        </span>
                        <p className="subtle">
                          {graph.nodes
                            .filter((a) =>
                              graph.edges.some(
                                (e) =>
                                  e.source === n.id &&
                                  e.target === a.id &&
                                  e.type === "ASSIGNED_TO",
                              ),
                            )
                            .map(nodeName)
                            .join(", ") || "Unassigned"}
                        </p>
                      </div>
                    ))
                  ) : (
                    <span className="subtle">No follow-up returned</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!contacts.length && (
          <Empty
            icon={<Users />}
            title="No matching contacts returned."
            text="Refresh the graph after a confirmed encounter or shared company update."
          />
        )}
      </div>
      <div className="company-footnote">
        <ShieldCheck size={18} />
        <p>
          Contacts are grouped by their graph identity. Shared names alone never
          merge two people.
        </p>
      </div>
    </>
  );
}
