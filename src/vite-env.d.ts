/// <reference types="vite/client" />

// Without this the project has no types for `import.meta.env`, which forced
// `(import.meta as any).env` casts at every use. That cast is not merely ugly:
// Vite substitutes the *exact* text `import.meta.env.DEV` at transform time, so
// wrapping it in a cast-and-fallback expression produced something the minifier
// could not fold to a constant — leaving the dev-only auth fallback present (if
// unreachable) in the production bundle. With this reference the plain form
// type-checks and folds to `false`, so the branch is eliminated outright.
