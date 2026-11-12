import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MeetingProposal } from "../src/components/MeetingProposal";
import {
  meetingTime,
  meetingView,
  type MeetingReply,
} from "../src/lib/meetings";

const reply: MeetingReply = {
  meetingId: `meet_${"a".repeat(40)}`,
  revision: 1,
  status: "proposed",
  text: "Shall I send the invitation?",
  confirmationRequired: true,
  sent: false,
  meeting: {
    id: `meet_${"a".repeat(40)}`,
    revision: 1,
    actorPersonId: "owner",
    status: "proposed",
    kind: "coffee",
    recipient: {
      personId: "recipient",
      name: "Alex",
    },
    start: "2026-10-24T22:30:00Z",
    end: "2026-10-24T22:50:00Z",
    expiresAt: "2026-10-24T22:20:00Z",
    venue: {
      id: "place",
      name: "Coffee shop",
      address: "123 Test Street",
      mapUrl: "https://maps.google.com/",
      fetchedAt: "2026-10-24T22:00:00Z",
    },
  },
};

test("meeting cards never expose private invitation details to guests or another owner", () => {
  const props = {
    reply,
    token: "test-token",
    personId: "owner",
    allowed: true,
  };
  const render = (overrides: Partial<typeof props>) =>
    renderToStaticMarkup(
      createElement(MeetingProposal, { ...props, ...overrides }),
    );
  assert.match(render({}), /Coffee with Alex/);
  assert.match(render({}), /123 Test Street/);
  for (const overrides of [
    { allowed: false },
    { token: "" },
    { personId: "someone_else" },
    { reply: { ...reply, revision: 2 } },
  ])
    assert.equal(render(overrides), "");
});

test("cards need only the recipient name and never display email from an older response", () => {
  const legacy = {
    ...reply,
    meeting: {
      ...reply.meeting,
      recipient: { ...reply.meeting.recipient, email: "alex@example.test" },
    },
  };
  const html = renderToStaticMarkup(
    createElement(MeetingProposal, {
      reply: legacy,
      token: "test-token",
      personId: "owner",
      allowed: true,
    }),
  );
  assert.match(html, /Coffee with Alex/);
  assert.doesNotMatch(html, /alex@example.test/);
});

test("declined, expired and review-required replies cannot become proposals again on a status read", () => {
  for (const status of ["declined", "expired", "review_required"] as const) {
    const view = meetingView({ ...reply, status }, reply.meeting);
    assert.equal(view.status, status);
    assert.equal(view.canRefresh, false);
    assert.equal(view.eventUrl, undefined);
  }
});

test("status checks cannot replace an invitation with another owner, ID or revision", () => {
  for (const change of [
    { actorPersonId: "someone_else" },
    { id: "different" },
    { revision: 2 },
  ]) {
    const view = meetingView(reply, {
      ...reply.meeting,
      ...change,
      status: "confirmed",
    });
    assert.equal(view.status, "proposed");
    assert.equal(view.meeting, reply.meeting);
  }
});

test("event links require a confirmed outcome and an HTTPS URL", () => {
  const outcome = {
    status: "confirmed" as const,
    url: "https://calendar.google.com/calendar/event?eid=test",
  };
  for (const status of [
    "proposed",
    "queued",
    "pending",
    "running",
    "uncertain",
    "failed",
  ] as const)
    assert.equal(
      meetingView(reply, { ...reply.meeting, status, outcome }).eventUrl,
      undefined,
    );
  assert.equal(
    meetingView(reply, { ...reply.meeting, status: "confirmed", outcome })
      .eventUrl,
    outcome.url,
  );
  for (const url of [
    "javascript:alert(1)",
    "http://calendar.google.com",
    "invalid",
  ])
    assert.equal(
      meetingView(reply, {
        ...reply.meeting,
        status: "confirmed",
        outcome: { ...outcome, url },
      }).eventUrl,
      undefined,
    );
});

test("meeting dates use actual proposal timestamps in Pacific time including the date and year", () => {
  const label = meetingTime(reply.meeting.start, reply.meeting.end);
  for (const detail of ["Oct 24", "2026", "3:30", "3:50", "PDT"])
    assert.ok(label.includes(detail), label);
  assert.match(
    meetingTime("2026-12-01T21:00:00Z", "2026-12-01T22:00:00Z"),
    /PST/,
  );
  assert.equal(
    meetingTime("invalid", reply.meeting.end),
    "Meeting time unavailable",
  );
  assert.equal(
    meetingTime(reply.meeting.end, reply.meeting.start),
    "Meeting time unavailable",
  );
});

