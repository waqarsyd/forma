/**
 * The Firestore operation vocabulary, kept away from the SDK on purpose.
 *
 * `OperationType` is an *enum*, so every `OperationType.GET` in a caller is a
 * value reference, not a type one. While it lived in `services/firebase.ts`, a
 * single `OperationType.WRITE` was enough to pull the whole Firebase SDK into
 * whatever chunk referenced it — which is exactly what kept 471 kB of it in the
 * eager bundle after the rest of the call sites had been deferred behind
 * `lib/firebaseClient.ts`.
 *
 * Nothing here imports `firebase/*`, and nothing here should: the moment it
 * does, every caller pays for the SDK again. `handleFirestoreError` stays in
 * `services/firebase.ts` because it reads `auth.currentUser`.
 */

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}
