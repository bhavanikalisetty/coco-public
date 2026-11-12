import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BriefContent, MeetingBrief } from "../src/components/MeetingBrief";
import {
  linkedinSource,
  matchingBrief,
  postDate,
  prepareBrief,
  type BriefPost,
  type MeetingBriefData,
} from "../src/lib/briefs";
import type { CocoState } from "../src/lib/useCoco";

const post: BriefPost = {
  url: "https://www.linkedin.com/feed/update/urn:li:activity:123/",
  authorUrl: null,
  activityOwnerUrl: "https://www.linkedin.com/in/alex/",
  urlKind: "post",
  datePrecision: "relative",
  textTruncated: true,
  text: "A source-backed excerpt.",
  publishedAt: null,
  publishedLabel: "2d",
  kind: "reshare",
  fetchedAt: "2026-10-24T22:00:00Z",
};
const brief: MeetingBriefData = {
  person: { id: "alex", name: "Alex", linkedinUrl: post.activityOwnerUrl },
  graphStatus: "ready",
  sharedTopics: ["memory"],
  sharedSessions: [{ id: "s01", title: "Graph memory workshop" }],
  explanation: { nodes: [], edges: [], source: "falkordb", eventId: "event" },
  recentPosts: { status: "partial", items: [post], evidence: [] },
  preparedAt: "2026-10-24T22:00:00Z",
};
const render = (value: MeetingBriefData) =>
  renderToStaticMarkup(
    createElement(BriefContent, { brief: value, onEvidence: () => {} }),
  );

test("meeting briefs preserve reshared, uncertain-date and truncated source distinctions", () => {
  const html = render(brief);
  assert.match(html, /Reshared activity/);
  assert.match(html, /2d · relative date/);
  assert.match(html, /Excerpt · full text may be longer/);
  assert.match(html, /View source post/);
  assert.doesNotMatch(html, /Original post/);
  const activity = render({
    ...brief,
    recentPosts: {
      ...brief.recentPosts,
      items: [
        {
          ...post,
          kind: "unknown",
          urlKind: "activity",
          datePrecision: "label",
          publishedLabel: "October 20",
          publishedAt: "2026-10-20T00:00:00Z",
        },
      ],
    },
  });
  assert.match(activity, /Authorship unverified/);
  assert.match(activity, /October 20 · exact date unverified/);
  assert.match(activity, /View activity page/);
  assert.equal(
    postDate({
      ...post,
      publishedLabel: "",
      publishedAt: "2026-10-20T00:00:00Z",
    }),
    "Publication date unavailable",
  );
});

test("shared context remains visible across unavailable post providers and graph failure remains distinct", () => {
  for (const status of [
    "missing",
    "failed",
    "pending",
    "stale",
    "needs_login",
  ] as const) {
    const html = render({
      ...brief,
      recentPosts: {
        status,
        items: [],
        evidence: [],
        reason: "Provider unavailable for this account.",
      },
    });
    assert.match(html, /Graph memory workshop/);
    assert.match(html, /Provider unavailable for this account/);
    assert.doesNotMatch(html, /never posted/);
  }
  const html = render({
    ...brief,
    graphStatus: "unavailable",
    sharedTopics: [],
    sharedSessions: [],
  });
  assert.match(html, /Shared context is unavailable/);
  assert.match(html, /A source-backed excerpt/);
  assert.doesNotMatch(html, /No shared interests/);
});

test("the brief shows at most four activities and rejects unsafe source links", () => {
  const html = render({
    ...brief,
    recentPosts: {
      ...brief.recentPosts,
      items: Array.from({ length: 6 }, (_, i) => ({
        ...post,
        text: `activity number ${i}`,
      })),
    },
  });
  assert.equal((html.match(/class="brief-post"/g) ?? []).length, 4);
  assert.doesNotMatch(html, /activity number 4/);
  for (const url of [
    "javascript:alert(1)",
    "http://linkedin.com/in/alex",
    "https://linkedin.com.evil.test/",
    "https://user:secret@linkedin.com/",
    "https://linkedin.com:444/",
  ])
    assert.equal(linkedinSource(url), undefined);
  assert.equal(linkedinSource(post.url), post.url);
  assert.match(
    render({
      ...brief,
      recentPosts: {
        ...brief.recentPosts,
        items: [{ ...post, url: "javascript:alert(1)" }],
      },
    }),
    /Source link unavailable/,
  );
});

test("guest and disconnected sessions cannot access the attendee picker or private brief", () => {
  for (const props of [
    { live: true, demo: true },
    { live: false, demo: false },
  ]) {
    const state = {
      ...props,
      token: "test",
      data: { me: { personId: "owner" }, people: [brief.person] },
    } as unknown as CocoState;
    const html = renderToStaticMarkup(
      createElement(MeetingBrief, {
        state,
        initialPersonId: "alex",
        onEvidence: () => {},
      }),
    );
    assert.match(html, /select[^>]*disabled/);
    assert.doesNotMatch(
      html,
      /Graph memory workshop|Prepare brief<|Reload saved brief/,
    );
  }
});

test("preparation sends only the attendee ID and never automatically retries provider work", async () => {
  const original = globalThis.fetch;
  const calls: { method?: string; body: unknown }[] = [];
  globalThis.fetch = async (_input, init) => {
    calls.push({ method: init?.method, body: JSON.parse(String(init?.body)) });
    return new Response(
      JSON.stringify({
        error: { message: "Provider temporarily unavailable" },
      }),
      { status: 502 },
    );
  };
  try {
    await assert.rejects(
      prepareBrief("test-token", "alex", new AbortController().signal),
      /Provider temporarily unavailable/,
    );
    assert.deepEqual(calls, [{ method: "POST", body: { personId: "alex" } }]);
  } finally {
    globalThis.fetch = original;
  }
  assert.throws(
    () => matchingBrief(brief, "someone_else"),
    /different attendee/,
  );
});

