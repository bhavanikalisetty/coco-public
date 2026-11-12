import { z } from 'zod';

export const API_VERSION = 'v1';
export const EVENT_ID = 'enter_si_era_2026';
export const EVENT_NAME = 'Enter the SI Era';
export const RequestId = z.string().min(8).max(100).regex(/^[a-zA-Z0-9_-]+$/);
export const TextRequest = z.object({ requestId: RequestId, text: z.string().trim().min(1).max(2000), speak: z.boolean().default(true) }).strict();
export const LocationRequest = z.object({ requestId: RequestId, zoneId: z.enum(['f1_entrance','f1_coffee','f1_booth_hall','f1_stairs','f2_stairs','f2_harbor','f2_summit','f2_lab']) }).strict();
export const EncounterRequest = z.object({ requestId: RequestId, peerToken: z.string().min(16).max(200), context: z.string().max(500).default('Badge tap at Enter the SI Era') }).strict();
export const AckRequest = z.object({ requestId: RequestId }).strict();
export type Actor = { personId: string; deviceId: string; companyId: string; role: 'attendee' | 'operator'; nfcToken: string };
export type Command = { id: string; deviceId: string; type: 'display' | 'speak' | 'encounter_offer'; createdAt: string; expiresAt: string; payload: Record<string, unknown>; acknowledgedAt?: string };
export type MeetingSuggestion = {recipientPersonId:string;placeId:string;kind:'coffee'|'lunch';start:string;end:string};
export type ConferenceNotification = {kind:'coffee'|'lunch'|'session'|'meetup';text:string;evidence?:unknown;proposal?:MeetingSuggestion;displayCommandId?:string};
export type Job = { id: string; actor: Actor; kind: 'chat' | 'voice' | 'recording'; requestId: string; fingerprint: string; input: {text?: string; audioId?: string; speak: boolean; recording?: {sessionId?:string};notification?:ConferenceNotification}; status: 'queued'|'running'|'completed'|'failed'; createdAt: string; updatedAt: string; result?: Record<string, unknown>; error?: {code:string;message:string}; leaseUntil?: number };
export type GraphNode = { id: string; labels: string[]; properties: Record<string, unknown> };
export type GraphEdge = { id: string; source: string; target: string; type: string; properties: Record<string, unknown> };
export type GraphView = { nodes: GraphNode[]; edges: GraphEdge[]; source: 'falkordb'; eventId: string };
