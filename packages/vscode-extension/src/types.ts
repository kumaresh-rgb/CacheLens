// Mirrors CacheLens.Core's wire-protocol DTOs (packages/dotnet/CacheLens.Core/*.cs). Keep these
// two in sync by hand for now — see docs/architecture.md's "Wire Protocol & Compatibility"
// section for how version skew between the package and the extension is meant to be handled.
// Field names are camelCase to match System.Text.Json's web defaults, which both the HTTP
// endpoints and (as of the casing fix) the discovery file now use consistently.

export enum CacheKind {
  Memory = 0,
  Distributed = 1,
  Hybrid = 2,
}

export enum ValueOmittedReason {
  RedactedByKeyPattern = 0,
  ExceedsMaxSize = 1,
  NotSerializable = 2,
}

export interface CacheEntrySnapshot {
  key: string;
  kind: CacheKind;
  valueType: string | null;
  valueJson: string | null;
  valueOmitted: ValueOmittedReason | null;
  sizeBytes: number | null;
  absoluteExpiration: string | null;
  slidingExpirationSeconds: number | null;
  createdAt: string;
  lastAccessedAt: string | null;
  hitCount: number;
}

export interface HandshakeInfo {
  protocolVersion: number;
  applicationName: string;
  processId: number;
  availableCacheKinds: CacheKind[];
  packageVersion: string;
}

/** Shape of the discovery file CacheLens.AspNetCore writes to %TEMP%/cachelens/instances/. */
export interface CacheLensInstanceFile {
  processId: number;
  processName: string;
  url: string;
  token: string;
  startedAt: string;
}

/** Wire protocol version this build of the extension understands. Bump alongside CacheLens.Core.ProtocolVersion. */
export const SUPPORTED_PROTOCOL_VERSION = 1;
