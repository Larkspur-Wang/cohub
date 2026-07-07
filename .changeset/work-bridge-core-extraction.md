---
"@neta-art/cohub": minor
---

Extracted the work bridge host logic into a framework-agnostic `createWorkBridgeCore` (pure TS, no Svelte runes) so external hosts like Neta-Studio (React) can reuse the same message handling, token minting, authorization, and purchase flow.

- **New exports**: `createWorkBridgeCore`, `WorkBridgeCore`, `WorkBridgeCoreConfig`, `WorkBridgeCoreWork`, `WorkBridgeDialogState`, `WorkAuthorizeRequest`, `WorkPurchaseRequest`, `WorkBridgeGetAccessToken`, `WorkBridgeGetViewerUuid`, `WorkBridgeRequestSignIn`.
- **Grant cache moved to SDK**: `hasGrantedWorkScopes`, `setGrantedWorkScopes`, `clearGrantedWorkScopes` are now exported from `@neta-art/cohub` (previously internal to the web app). The web app's `work-grant-cache.ts` re-exports them for backward compatibility.
- **`bridge-host.svelte.ts`** is now a thin Svelte 5 wrapper that delegates to the shared core, injecting auth dependencies (`getAuthToken`, `authStore`, `signInWithRedirectPath`). Zero behavior change for existing bridge (WorkSurface) and broker (`/work-auth`) consumers.
