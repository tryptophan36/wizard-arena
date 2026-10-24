/**
 * Server-side compatibility barrel. The Colyseus schema lives in shared/ so
 * browser clients can consume the same state contract without importing the
 * room implementation.
 */
export * from "../shared/match-state";
