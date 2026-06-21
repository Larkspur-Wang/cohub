import type { WorkRecord, WorkVersionRecord } from "@neta-art/cohub";
import { goto } from "$app/navigation";
import { sdk } from "$lib/sdk";
import { buildSpaceLandingRoute } from "$lib/space-routes";
import {
	scopeState,
	selectedScopeList,
	WORK_SCOPE_OPTIONS,
	WORK_VIEWER_SCOPE_OPTIONS,
} from "./work-utils";

export type WorkTargetType = "file" | "directory" | "port";
export type WorkStatus = "draft" | "published" | "disabled";

export function createWorkDetailController(options: {
	getSpaceId: () => string;
	getRouteWorkId: () => string | null;
	getOwnerUsername: () => string | null;
	getSpaceSlug: () => string | null;
	onDetailLoaded?: (work: WorkRecord | null) => void;
}) {
	let detail = $state<WorkRecord | null>(null);
	let loading = $state(false);
	let error = $state("");
	let actionInProgress = $state(false);
	let deleteInProgress = $state(false);
	let editMode = $state(false);
	let formSlug = $state("");
	let formTargetType = $state<WorkTargetType>("file");
	let formTargetRef = $state("");
	let formStatus = $state<WorkStatus>("published");
	let formScopes = $state<Record<string, boolean>>({});
	let formViewerScopes = $state<Record<string, boolean>>({});
	let formSubmitting = $state(false);
	let formError = $state("");
	let copiedId = $state(false);
	let copiedTimer: ReturnType<typeof setTimeout> | null = null;
	let routeStateKey = "";
	let versions = $state<WorkVersionRecord[]>([]);
	let versionsLoading = $state(false);
	let versionsError = $state("");
	let publishTargetType = $state<WorkTargetType>("file");
	let publishTargetRef = $state("");
	let publishSubmitting = $state(false);
	let publishError = $state("");

	function notify(work: WorkRecord | null) {
		options.onDetailLoaded?.(work);
	}

	function syncFormFromDetail() {
		if (!detail) return;
		formSlug = detail.slug;
		formTargetType = detail.targetType;
		formTargetRef = detail.targetRef;
		formStatus = detail.status;
		formScopes = scopeState(detail.workScopes, WORK_SCOPE_OPTIONS);
		formViewerScopes = scopeState(
			detail.allowedViewerScopes,
			WORK_VIEWER_SCOPE_OPTIONS,
		);
		formError = "";
		publishTargetType = detail.targetType;
		publishTargetRef = detail.targetRef;
		publishError = "";
	}

	function notifyWorksUpdated() {
		if (typeof window === "undefined") return;
		window.dispatchEvent(
			new CustomEvent("cohub:works-changed", {
				detail: { spaceId: options.getSpaceId() },
			}),
		);
	}

	function publicRoute(work: WorkRecord | null = detail) {
		const ownerUsername = options.getOwnerUsername();
		const spaceSlug = options.getSpaceSlug();
		return ownerUsername && spaceSlug && work?.slug
			? `/${encodeURIComponent(ownerUsername)}/${encodeURIComponent(spaceSlug)}/w/${encodeURIComponent(work.slug)}`
			: null;
	}

	async function loadDetail(workId: string) {
		const requestSpaceId = options.getSpaceId();
		const isCurrentRequest = () =>
			options.getSpaceId() === requestSpaceId &&
			options.getRouteWorkId() === workId;
		loading = true;
		error = "";
		try {
			const { work } = await sdk.works.get(workId);
			if (!isCurrentRequest()) return;
			detail = work;
			notify(work);
			syncFormFromDetail();
			void loadVersions(work.id);
		} catch (cause) {
			if (!isCurrentRequest()) return;
			detail = null;
			notify(null);
			error = cause instanceof Error ? cause.message : "Failed to load work";
		} finally {
			if (isCurrentRequest()) loading = false;
		}
	}

	async function loadVersions(workId: string) {
		versionsLoading = true;
		versionsError = "";
		try {
			const { versions: nextVersions } = await sdk.works.listVersions(workId);
			if (options.getRouteWorkId() === workId) versions = nextVersions;
		} catch (cause) {
			if (options.getRouteWorkId() === workId) {
				versionsError =
					cause instanceof Error ? cause.message : "Failed to load versions";
			}
		} finally {
			if (options.getRouteWorkId() === workId) versionsLoading = false;
		}
	}

	async function publishVersion() {
		if (!detail || publishSubmitting) return;
		publishError = "";
		if (!publishTargetRef.trim()) {
			publishError = "Target is required";
			return;
		}
		publishSubmitting = true;
		try {
			const { work } = await sdk.works.update(detail.id, {
				status: "published",
				targetType: publishTargetType,
				targetRef: publishTargetRef.trim(),
				publishVersion: true,
			});
			detail = work;
			notify(work);
			syncFormFromDetail();
			await loadVersions(work.id);
			notifyWorksUpdated();
		} catch (cause) {
			publishError =
				cause instanceof Error ? cause.message : "Failed to publish version";
		} finally {
			publishSubmitting = false;
		}
	}

	async function copyId(id: string) {
		try {
			await navigator.clipboard.writeText(id);
			copiedId = true;
			if (copiedTimer) clearTimeout(copiedTimer);
			copiedTimer = setTimeout(() => {
				copiedId = false;
			}, 1600);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : "Failed to copy work ID";
		}
	}

	async function toggleStatus(status: "published" | "disabled") {
		if (!detail || actionInProgress) return;
		actionInProgress = true;
		error = "";
		try {
			const { work } = await sdk.works.update(detail.id, { status });
			detail = work;
			notify(work);
			syncFormFromDetail();
			void loadVersions(work.id);
			notifyWorksUpdated();
		} catch (cause) {
			error = cause instanceof Error ? cause.message : "Failed to update work";
			void loadDetail(detail.id);
		} finally {
			actionInProgress = false;
		}
	}

	async function deleteWork() {
		if (
			!detail ||
			actionInProgress ||
			deleteInProgress ||
			!confirm(
				"Delete this work? This removes the management record and public link.",
			)
		)
			return;
		const deletedWorkId = detail.id;
		let deleted = false;
		actionInProgress = true;
		deleteInProgress = true;
		error = "";
		try {
			await sdk.works.delete(deletedWorkId);
			deleted = true;
			detail = null;
			notify(null);
			notifyWorksUpdated();
			await goto(buildSpaceLandingRoute(options.getSpaceId()), {
				replaceState: true,
			});
		} catch (cause) {
			error = cause instanceof Error ? cause.message : "Failed to delete work";
		} finally {
			if (!deleted) {
				actionInProgress = false;
				deleteInProgress = false;
			}
		}
	}

	async function submitUpdate(event: SubmitEvent) {
		event.preventDefault();
		if (!detail || formSubmitting) return;
		formError = "";
		if (!formSlug.trim()) {
			formError = "Slug is required";
			return;
		}
		if (!formTargetRef.trim()) {
			formError = "Target is required";
			return;
		}
		formSubmitting = true;
		try {
			const { work } = await sdk.works.update(detail.id, {
				slug: formSlug.trim(),
				status: formStatus,
				targetType: formTargetType,
				targetRef: formTargetRef.trim(),
				workScopes: selectedScopeList(formScopes, WORK_SCOPE_OPTIONS),
				allowedViewerScopes: selectedScopeList(
					formViewerScopes,
					WORK_VIEWER_SCOPE_OPTIONS,
				),
			});
			detail = work;
			notify(work);
			editMode = false;
			syncFormFromDetail();
			void loadVersions(work.id);
			notifyWorksUpdated();
		} catch (cause) {
			formError =
				cause instanceof Error ? cause.message : "Failed to save work";
		} finally {
			formSubmitting = false;
		}
	}

	function resetTransientState() {
		loading = false;
		versions = [];
		versionsLoading = false;
		versionsError = "";
		editMode = false;
		actionInProgress = false;
		deleteInProgress = false;
		formError = "";
		publishError = "";
	}

	function syncRoute() {
		const workId = options.getRouteWorkId();
		const stateKey = `${options.getSpaceId()}:${workId ?? ""}`;
		if (routeStateKey === stateKey) return;
		routeStateKey = stateKey;
		resetTransientState();
		if (workId) {
			void loadDetail(workId);
			return;
		}
		detail = null;
		notify(null);
	}

	function dispose() {
		if (copiedTimer) clearTimeout(copiedTimer);
		copiedTimer = null;
	}

	return {
		get detail() {
			return detail;
		},
		get loading() {
			return loading;
		},
		get error() {
			return error;
		},
		get actionInProgress() {
			return actionInProgress;
		},
		get deleteInProgress() {
			return deleteInProgress;
		},
		get editMode() {
			return editMode;
		},
		set editMode(value: boolean) {
			editMode = value;
		},
		get formSlug() {
			return formSlug;
		},
		set formSlug(value: string) {
			formSlug = value;
		},
		get formTargetType() {
			return formTargetType;
		},
		set formTargetType(value: WorkTargetType) {
			formTargetType = value;
		},
		get formTargetRef() {
			return formTargetRef;
		},
		set formTargetRef(value: string) {
			formTargetRef = value;
		},
		get formStatus() {
			return formStatus;
		},
		set formStatus(value: WorkStatus) {
			formStatus = value;
		},
		get formScopes() {
			return formScopes;
		},
		set formScopes(value: Record<string, boolean>) {
			formScopes = value;
		},
		get formViewerScopes() {
			return formViewerScopes;
		},
		set formViewerScopes(value: Record<string, boolean>) {
			formViewerScopes = value;
		},
		get formSubmitting() {
			return formSubmitting;
		},
		get formError() {
			return formError;
		},
		get copiedId() {
			return copiedId;
		},
		get versions() {
			return versions;
		},
		get versionsLoading() {
			return versionsLoading;
		},
		get versionsError() {
			return versionsError;
		},
		get publishTargetType() {
			return publishTargetType;
		},
		set publishTargetType(value: WorkTargetType) {
			publishTargetType = value;
		},
		get publishTargetRef() {
			return publishTargetRef;
		},
		set publishTargetRef(value: string) {
			publishTargetRef = value;
		},
		get publishSubmitting() {
			return publishSubmitting;
		},
		get publishError() {
			return publishError;
		},
		syncFormFromDetail,
		publicRoute,
		publishVersion,
		copyId,
		toggleStatus,
		deleteWork,
		submitUpdate,
		syncRoute,
		dispose,
	};
}
