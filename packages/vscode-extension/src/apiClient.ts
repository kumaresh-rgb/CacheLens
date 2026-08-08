import { CacheEntrySnapshot, HandshakeInfo } from "./types";

/** What a tree node needs to reach a running app's CacheLens endpoints. */
export interface CacheLensConnection {
  /** Base URL, e.g. "http://127.0.0.1:53214" — no trailing slash. */
  url: string;
  token: string;
}

export class CacheLensApiError extends Error {
  constructor(
    message: string,
    readonly status: number | undefined,
  ) {
    super(message);
    this.name = "CacheLensApiError";
  }
}

async function get<T>(connection: CacheLensConnection, routePath: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${connection.url}${routePath}`, {
      headers: { Authorization: `Bearer ${connection.token}` },
    });
  } catch (err) {
    throw new CacheLensApiError(`Couldn't reach ${connection.url}: ${describeError(err)}`, undefined);
  }

  if (!response.ok) {
    throw new CacheLensApiError(describeStatus(response), response.status);
  }

  return (await response.json()) as T;
}

async function post(connection: CacheLensConnection, routePath: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${connection.url}${routePath}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${connection.token}` },
    });
  } catch (err) {
    throw new CacheLensApiError(`Couldn't reach ${connection.url}: ${describeError(err)}`, undefined);
  }

  if (!response.ok) {
    throw new CacheLensApiError(describeStatus(response), response.status);
  }
}

export function getMeta(connection: CacheLensConnection): Promise<HandshakeInfo> {
  return get<HandshakeInfo>(connection, "/_cachelens/meta");
}

export function getSnapshot(connection: CacheLensConnection): Promise<CacheEntrySnapshot[]> {
  return get<CacheEntrySnapshot[]>(connection, "/_cachelens/snapshot");
}

export function evictEntry(connection: CacheLensConnection, key: string): Promise<void> {
  return post(connection, `/_cachelens/evict/${encodeURIComponent(key)}`);
}

export function clearAll(connection: CacheLensConnection): Promise<void> {
  return post(connection, "/_cachelens/clear");
}

function describeStatus(response: Response): string {
  if (response.status === 401) {
    return "Rejected (401) — the app's CacheLens token has changed, most likely because it restarted. Refresh to reconnect.";
  }
  if (response.status === 403) {
    return "Rejected (403) — CacheLens only accepts connections from the same machine.";
  }
  return `Request failed: ${response.status} ${response.statusText}`;
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
