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

/**
 * Turns a status code into something that names a cause and a fix.
 *
 * "Request failed: 400" was a dead end in practice — it is the status an app's own middleware
 * returns when it rejects a request before routing reaches CacheLens, which is invisible from
 * here but very actionable once named.
 */
function describeStatus(response: Response): string {
  switch (response.status) {
    case 400:
      return (
        "Rejected with 400 before CacheLens ran. This usually means your app's own middleware " +
        "turned the request away — authentication, tenant resolution, API versioning or a " +
        "required header. CacheLens endpoints go through your full middleware pipeline, so " +
        "anything global applies to them too. Exclude the /_cachelens path from that middleware, " +
        "or register it after the middleware that is rejecting."
      );
    case 401:
      return (
        "Rejected with 401. The token no longer matches — a new one is generated every time the " +
        "app starts, so this is expected after a restart. Refresh to pick up the current token."
      );
    case 403:
      return (
        "Rejected with 403. CacheLens only accepts requests from the same machine as the app. " +
        "For a container or remote host, forward the port and connect to your local address."
      );
    case 404:
      return (
        "No CacheLens endpoint at this address (404). The app is running but MapCacheLens() was " +
        "probably not called — AddCacheLens() alone registers tracking without exposing it. " +
        "Check the URL has no path suffix, and that a custom RoutePrefix matches."
      );
    case 405:
      return "Method not allowed (405). Something else is serving this path — check the port.";
    default:
      if (response.status >= 500) {
        return `The app returned ${response.status} ${response.statusText}. Its logs will say why.`;
      }
      return `Request failed: ${response.status} ${response.statusText}`;
  }
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
