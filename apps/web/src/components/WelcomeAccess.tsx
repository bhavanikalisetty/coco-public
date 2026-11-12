import { useEffect, useState } from "react";
import { ArrowRight, UserPlus } from "lucide-react";
import type { CocoState } from "../lib/useCoco";
import { useResource } from "../lib/workspace";
import { reviewableTopics, usernameSuggestion } from "../lib/access";
import { ProfileConversation } from "./ProfileConversation";

export function DemoEntrance({
  state,
  onCreate,
}: {
  state: CocoState;
  onCreate: () => void;
}) {
  return (
    <section className="demo-entrance" aria-label="Choose a Coco profile">
      <div>
        <span className="eyebrow">COME ON IN</span>
        <h2>Make yourself at home.</h2>
        <p>
          Explore a real attendee profile with guest access, or create your own.
        </p>
      </div>
      <div className="demo-picks">
        {[
          ["person_maya", "Maya"],
          ["person_leo", "Leo"],
        ].map(([id, name]) => (
          <button
            className="demo-person"
            aria-label={`Continue as ${name}`}
            key={id}
            disabled={state.loading || state.canResume}
            onClick={() => void state.loginDemo(id)}
          >
            <span className="avatar">{name[0]}</span>
            <span>
              <strong>Continue as {name}</strong>
              <small>Real attendee · guest access</small>
            </span>
            <ArrowRight size={16} />
          </button>
        ))}
      </div>
      <button
        className="text-button"
        disabled={state.loading || state.canResume}
        onClick={onCreate}
      >
        <UserPlus size={16} />
        Create your Coco profile
        <ArrowRight size={15} />
      </button>
      <p className="subtle">
        Guest access does not open this attendee’s private notes, email or
        connected accounts.
      </p>
      {state.canResume && (
        <p className="notice">
          Your session is saved in this tab.
          <button
            className="text-button"
            disabled={state.loading}
            onClick={state.resume}
          >
            Reconnect saved profile
          </button>
        </p>
      )}
      {state.loading && <p role="status">Opening your session…</p>}
      {state.error && (
        <p className="notice error" role="alert">
          {state.error}
        </p>
      )}
    </section>
  );
}
export function CreateProfile({ state }: { state: CocoState }) {
  const catalogue = useResource<{
    topics: { id: string; key: string; name: string }[];
    capabilities?: {
      conversationalOnboarding?: boolean;
      eventPreferences?: boolean;
    };
  }>("", "/v1/demo/profiles", true, true);
  const [firstName, setFirstName] = useState(""),
    [lastName, setLastName] = useState(""),
    [username, setUsername] = useState(""),
    [edited, setEdited] = useState(false),
    [email, setEmail] = useState(""),
    [linkedinUrl, setLinkedin] = useState(""),
    [instagram, setInstagram] = useState(""),
    [x, setX] = useState(""),
    [eventPreferences, setEventPreferences] = useState(""),
    [conversationBusy, setConversationBusy] = useState(false),
    [topics, setTopics] = useState<string[]>([]);
  useEffect(() => {
    if (!edited) setUsername(usernameSuggestion(firstName, lastName));
  }, [firstName, lastName, edited]);
  const conversationAvailable =
    catalogue.data?.capabilities?.conversationalOnboarding === true;
  const preferencesAvailable =
    catalogue.data?.capabilities?.eventPreferences === true;
  return (
    <section className="create-profile">
      <span className="eyebrow">A PROFILE THAT'S YOURS</span>
      <h2>Create your Coco profile</h2>
      <p>
        Find useful sessions and people. Add your interests now; connecting
        Gmail and Calendar comes later if you want it.
      </p>
      <ProfileConversation
        available={conversationAvailable}
        disabled={state.loading || state.canResume}
        draft={{
          firstName,
          lastName,
          username,
          email,
          linkedinUrl,
          socials: { instagram, x },
          topicIds: topics,
          eventPreferences,
        }}
        onBusy={setConversationBusy}
        onDraft={(next) => {
          if (typeof next.firstName === "string") setFirstName(next.firstName);
          if (typeof next.lastName === "string") setLastName(next.lastName);
          if (typeof next.username === "string" && next.username) {
            setUsername(next.username);
            setEdited(true);
          }
          if (typeof next.email === "string" && next.email.trim())
            setEmail(next.email.trim());
          if (typeof next.linkedinUrl === "string" && next.linkedinUrl.trim())
            setLinkedin(next.linkedinUrl.trim());
          if (typeof next.socials?.instagram === "string")
            setInstagram(next.socials.instagram);
          if (typeof next.socials?.x === "string") setX(next.socials.x);
          if (Array.isArray(next.topicIds))
            setTopics(reviewableTopics(next.topicIds, catalogue.data?.topics));
          if (typeof next.eventPreferences === "string")
            setEventPreferences(next.eventPreferences);
        }}
      />
      <form
        className="workspace-form"
        onSubmit={(e) => {
          e.preventDefault();
          void state.register(
            {
              username,
              firstName: firstName.trim(),
              lastName: lastName.trim(),
              email: email.trim(),
              linkedinUrl: linkedinUrl.trim(),
              ...(instagram.trim() || x.trim()
                ? {
                    socials: {
                      ...(instagram.trim()
                        ? { instagram: instagram.trim() }
                        : {}),
                      ...(x.trim() ? { x: x.trim() } : {}),
                    },
                  }
                : {}),
              topicIds: topics,
              ...(preferencesAvailable && eventPreferences.trim()
                ? { eventPreferences: eventPreferences.trim() }
                : {}),
            },
            true,
          );
        }}
      >
        <fieldset
          disabled={state.loading || state.canResume || conversationBusy}
        >
          <div className="form-grid">
            <label>
              First name
              <input
                autoComplete="given-name"
                required
                maxLength={100}
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
              />
            </label>
            <label>
              Last name
              <input
                autoComplete="family-name"
                required
                maxLength={100}
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
              />
            </label>
          </div>
          <label>
            Username
            <input
              autoComplete="username"
              required
              pattern="[a-z0-9_]{3,30}"
              minLength={3}
              maxLength={30}
              value={username}
              onChange={(e) => {
                setEdited(true);
                setUsername(e.target.value.toLowerCase());
              }}
              aria-describedby="username-help"
            />
          </label>
          <p id="username-help" className="subtle">
            3–30 lowercase letters, numbers or underscores. You can change the
            suggestion.
          </p>
          <label>
            Email
            <input
              type="email"
              autoComplete="email"
              required
              maxLength={254}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            LinkedIn profile URL
            <input
              type="url"
              required
              pattern="https://.*"
              placeholder="https://www.linkedin.com/in/your-name"
              value={linkedinUrl}
              onChange={(e) => setLinkedin(e.target.value)}
            />
          </label>
          <details className="source-details">
            <summary>Add social profiles (optional)</summary>
            <label>
              Instagram URL
              <input
                type="url"
                pattern="https://.*"
                placeholder="https://www.instagram.com/your-name"
                value={instagram}
                onChange={(e) => setInstagram(e.target.value)}
              />
            </label>
            <label>
              X URL
              <input
                type="url"
                pattern="https://.*"
                placeholder="https://x.com/your-name"
                value={x}
                onChange={(e) => setX(e.target.value)}
              />
            </label>
          </details>
          <fieldset className="interest-picker">
            <legend>Your interests (optional)</legend>
            <p className="subtle">
              Choose up to 8 to help Coco find relevant sessions.
            </p>
            {catalogue.loading && <p role="status">Loading interests…</p>}
            {catalogue.error && (
              <p className="notice">
                Interests are unavailable right now. You can create your profile
                without them.
              </p>
            )}
            <div className="interest-options">
              {catalogue.data?.topics.map((topic) => (
                <label key={topic.id} className="check-row">
                  <input
                    type="checkbox"
                    checked={topics.includes(topic.id)}
                    disabled={!topics.includes(topic.id) && topics.length >= 8}
                    onChange={(e) =>
                      setTopics((old) =>
                        e.target.checked
                          ? [...old, topic.id]
                          : old.filter((id) => id !== topic.id),
                      )
                    }
                  />
                  {topic.name}
                </label>
              ))}
            </div>
          </fieldset>
          {preferencesAvailable && (
            <>
              <label htmlFor="event-preferences">
                What kinds of events interest you? (optional)
              </label>
              <textarea
                id="event-preferences"
                rows={3}
                maxLength={1500}
                value={eventPreferences}
                onChange={(e) => setEventPreferences(e.target.value)}
                placeholder="Small technical workshops, founder meetups, accessible design…"
              />
            </>
          )}
          <p className="subtle">
            No password needed. Your profile stays connected in this tab,
            including after refresh. Closing the tab signs you out; entering the
            same username later does not recover the account.
          </p>
          <button className="primary full-width">
            {state.loading ? "Creating your profile…" : "Create my profile"}
            <ArrowRight size={15} />
          </button>
        </fieldset>
      </form>
      {state.canResume && (
        <p className="notice">
          Your profile session is saved in this tab. Reconnect to finish opening
          it.
          <button
            className="text-button"
            disabled={state.loading}
            onClick={state.resume}
          >
            Reconnect saved profile
          </button>
        </p>
      )}
      {state.error && (
        <p className="notice error" role="alert">
          {state.error}
        </p>
      )}
    </section>
  );
}
