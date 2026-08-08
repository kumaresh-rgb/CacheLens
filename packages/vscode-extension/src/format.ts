import { CacheEntrySnapshot, ValueOmittedReason } from "./types";

export function formatSize(bytes: number | null): string {
  if (bytes === null) {
    return "—";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Renders a future ISO timestamp as a countdown, or "expired" once it's passed. */
export function formatExpiresIn(isoTimestamp: string | null): string | undefined {
  if (!isoTimestamp) {
    return undefined;
  }
  const remainingMs = new Date(isoTimestamp).getTime() - Date.now();
  if (remainingMs <= 0) {
    return "expired";
  }
  const seconds = Math.round(remainingMs / 1000);
  if (seconds < 60) {
    return `expires in ${seconds}s`;
  }
  if (seconds < 3600) {
    return `expires in ${Math.round(seconds / 60)}m`;
  }
  return `expires in ${Math.round(seconds / 3600)}h`;
}

export function formatExpiration(entry: CacheEntrySnapshot): string | undefined {
  if (entry.absoluteExpiration) {
    return formatExpiresIn(entry.absoluteExpiration);
  }
  if (entry.slidingExpirationSeconds !== null) {
    return `sliding ${entry.slidingExpirationSeconds}s`;
  }
  return undefined;
}

export function describeOmittedReason(reason: ValueOmittedReason): string {
  switch (reason) {
    case ValueOmittedReason.RedactedByKeyPattern:
      return "Redacted — this key matches a configured secret-shaped pattern (see CacheLensOptions.RedactKeyPatterns).";
    case ValueOmittedReason.ExceedsMaxSize:
      return "Value too large to display — exceeds CacheLensOptions.MaxValuePayloadBytes.";
    case ValueOmittedReason.NotSerializable:
      return "Value isn't JSON-serializable, so CacheLens can't display it.";
  }
}

export function formatRelativeTime(isoTimestamp: string | null): string {
  if (!isoTimestamp) {
    return "—";
  }
  const deltaMs = Date.now() - new Date(isoTimestamp).getTime();
  const seconds = Math.round(deltaMs / 1000);
  if (seconds < 5) {
    return "just now";
  }
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  if (seconds < 3600) {
    return `${Math.round(seconds / 60)}m ago`;
  }
  return `${Math.round(seconds / 3600)}h ago`;
}
