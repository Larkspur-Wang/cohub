// Re-exported from the Cohub SDK so the web app and external hosts (e.g.
// Neta-Studio) share the same grant-cache implementation. The logic now lives
// in @neta-art/cohub (packages/sdk/src/work-grant-cache.ts).
export {
	clearGrantedWorkScopes,
	hasGrantedWorkScopes,
	setGrantedWorkScopes,
} from "@neta-art/cohub";
