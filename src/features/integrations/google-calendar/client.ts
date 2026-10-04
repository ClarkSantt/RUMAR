import { invoke } from '@tauri-apps/api/core';
import type { GoogleEvent } from './domain';

export class GoogleClientError extends Error {
  constructor(
    public code:
      | 'network'
      | 'auth'
      | 'forbidden'
      | 'rate_limit'
      | 'server'
      | 'not_found'
      | 'conflict'
      | 'invalid',
    message = code,
  ) {
    super(message);
  }
}
export interface GoogleCalendarClient {
  hasCredential(integrationId: string): Promise<boolean>;
  connect(integrationId: string, clientId: string): Promise<void>;
  disconnect(integrationId: string): Promise<void>;
  createCalendar(
    integrationId: string,
    clientId: string,
    zone: string,
  ): Promise<{ id: string; summary: string }>;
  getCalendar(
    integrationId: string,
    clientId: string,
    calendarId: string,
  ): Promise<{ id: string; summary: string } | null>;
  deleteCalendar(integrationId: string, clientId: string, calendarId: string): Promise<void>;
  createEvent(
    integrationId: string,
    clientId: string,
    calendarId: string,
    event: GoogleEvent,
  ): Promise<{ id: string }>;
  getEvent(
    integrationId: string,
    clientId: string,
    calendarId: string,
    eventId: string,
  ): Promise<{ id: string } | null>;
  patchEvent(
    integrationId: string,
    clientId: string,
    calendarId: string,
    eventId: string,
    event: GoogleEvent,
  ): Promise<void>;
  deleteEvent(
    integrationId: string,
    clientId: string,
    calendarId: string,
    eventId: string,
  ): Promise<void>;
}

type Request = {
  integrationId: string;
  clientId: string;
  operation: string;
  calendarId?: string;
  eventId?: string;
  body?: GoogleEvent | Record<string, string>;
};
function translate(error: unknown): never {
  const code = String(error).replace(/^Error:\s*/, '');
  if (/^(network|auth|forbidden|rate_limit|server|not_found|conflict|invalid)$/.test(code))
    throw new GoogleClientError(code as GoogleClientError['code']);
  throw new GoogleClientError('network');
}
async function request<T>(input: Request): Promise<T> {
  try {
    return await invoke<T>('google_calendar_request', { request: input });
  } catch (error) {
    translate(error);
  }
}
export class RealGoogleCalendarClient implements GoogleCalendarClient {
  async hasCredential(integrationId: string) {
    return invoke<boolean>('google_has_credential', { integrationId });
  }
  async connect(integrationId: string, clientId: string) {
    try {
      await invoke('google_connect', { integrationId, clientId });
    } catch (error) {
      translate(error);
    }
  }
  async disconnect(integrationId: string) {
    await invoke('google_disconnect', { integrationId });
  }
  createCalendar(integrationId: string, clientId: string, zone: string) {
    return request<{ id: string; summary: string }>({
      integrationId,
      clientId,
      operation: 'create_calendar',
      body: { summary: 'RUMO', description: 'Eventos sincronizados pelo RUMO.', timeZone: zone },
    });
  }
  async getCalendar(integrationId: string, clientId: string, calendarId: string) {
    try {
      return await request<{ id: string; summary: string }>({
        integrationId,
        clientId,
        operation: 'get_calendar',
        calendarId,
      });
    } catch (error) {
      if (error instanceof GoogleClientError && error.code === 'not_found') return null;
      throw error;
    }
  }
  deleteCalendar(integrationId: string, clientId: string, calendarId: string) {
    return request<void>({ integrationId, clientId, operation: 'delete_calendar', calendarId });
  }
  createEvent(integrationId: string, clientId: string, calendarId: string, event: GoogleEvent) {
    return request<{ id: string }>({
      integrationId,
      clientId,
      operation: 'create_event',
      calendarId,
      body: event,
    });
  }
  async getEvent(integrationId: string, clientId: string, calendarId: string, eventId: string) {
    try {
      return await request<{ id: string }>({
        integrationId,
        clientId,
        operation: 'get_event',
        calendarId,
        eventId,
      });
    } catch (error) {
      if (error instanceof GoogleClientError && error.code === 'not_found') return null;
      throw error;
    }
  }
  patchEvent(
    integrationId: string,
    clientId: string,
    calendarId: string,
    eventId: string,
    event: GoogleEvent,
  ) {
    return request<void>({
      integrationId,
      clientId,
      operation: 'patch_event',
      calendarId,
      eventId,
      body: event,
    });
  }
  deleteEvent(integrationId: string, clientId: string, calendarId: string, eventId: string) {
    return request<void>({
      integrationId,
      clientId,
      operation: 'delete_event',
      calendarId,
      eventId,
    });
  }
}
