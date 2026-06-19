<script lang="ts">
import type { SessionRecord } from "@neta-art/cohub";
import { Link2Off, Pencil, TextCursorInput } from "lucide-svelte";
import SessionSidebarRowContent from "$lib/components/SessionSidebarRowContent.svelte";
import SidebarActionButton from "$lib/components/sidebar/SidebarActionButton.svelte";
import type { ModelCatalogItem } from "$lib/model-catalog";

export type SidebarSessionRowState = {
	isFork?: boolean;
	isLastVisibleChild?: boolean;
	style?: string;
	titleText?: string;
	ariaLabel?: string;
};

const {
	session,
	title,
	href,
	active = false,
	isMobile = false,
	modelsCatalog,
	rowState,
	draggable = false,
	showInsert = true,
	showRename = true,
	removeLabelTitle,
	removeLabelDisabled = false,
	onNavigate,
	onDoubleClick,
	onInsert,
	onRename,
	onRemoveLabel,
	onDragStart,
	onDragEnd,
}: {
	session: SessionRecord;
	title: string;
	href: string;
	active?: boolean;
	isMobile?: boolean;
	modelsCatalog?: ModelCatalogItem[] | null;
	rowState?: SidebarSessionRowState | null;
	draggable?: boolean;
	showInsert?: boolean;
	showRename?: boolean;
	removeLabelTitle?: string;
	removeLabelDisabled?: boolean;
	onNavigate: (session: SessionRecord) => void;
	onDoubleClick?: (event: MouseEvent, session: SessionRecord) => void;
	onInsert?: (path: string) => void;
	onRename?: (session: SessionRecord) => void;
	onRemoveLabel?: () => void;
	onDragStart?: (
		event: DragEvent,
		session: SessionRecord,
		title: string,
	) => void;
	onDragEnd?: () => void;
} = $props();

const actionCount = $derived(
	(showInsert ? 1 : 0) + (showRename ? 1 : 0) + (onRemoveLabel ? 1 : 0),
);
const hoverPaddingClass = $derived.by(() => {
	if (isMobile || actionCount <= 0) return "";
	if (actionCount >= 3) return "hover:pr-24 focus-within:pr-24";
	if (actionCount === 2) return "hover:pr-20 focus-within:pr-20";
	return "hover:pr-12 focus-within:pr-12";
});
</script>

<a
	{href}
	class="sidebar-flyout-item group/session relative flex items-center gap-1.5 overflow-hidden rounded-[6px] px-2 py-1.5 pr-4 text-[13px] transition-colors duration-100 {hoverPaddingClass} {rowState?.isFork ? 'session-fork-row' : ''} {rowState?.isLastVisibleChild ? 'session-fork-row--last' : ''} {active ? 'bg-bg-active font-medium text-text-primary' : 'text-text-tertiary hover:bg-bg-hover hover:text-text-secondary'}"
	style={rowState?.style}
	onclick={(event) => {
		event.preventDefault();
		onNavigate(session);
	}}
	ondblclick={(event) => onDoubleClick?.(event, session)}
	draggable={!isMobile && draggable}
	ondragstart={(event) => onDragStart?.(event, session, title)}
	ondragend={onDragEnd}
	title={rowState?.titleText}
	aria-label={rowState?.ariaLabel ?? title}
>
	<SessionSidebarRowContent {session} {title} {isMobile} modelsCatalog={modelsCatalog ?? undefined} />
	{#if !isMobile && actionCount > 0}
		<span class="absolute right-1 top-1/2 inline-flex -translate-y-1/2 items-center gap-0.5 opacity-0 pointer-events-none transition-opacity group-hover/session:opacity-100 group-hover/session:pointer-events-auto group-focus-within/session:opacity-100 group-focus-within/session:pointer-events-auto">
			{#if showInsert && onInsert}
				<SidebarActionButton icon={TextCursorInput} title="Insert" onClick={() => onInsert(`/sessions/${session.id}.jsonl`)} />
			{/if}
			{#if showRename && onRename}
				<SidebarActionButton icon={Pencil} title="Rename" onClick={() => onRename(session)} />
			{/if}
			{#if onRemoveLabel}
				<SidebarActionButton icon={Link2Off} title={removeLabelTitle ?? "Remove from label"} disabled={removeLabelDisabled} tone="danger" onClick={onRemoveLabel} />
			{/if}
		</span>
	{/if}
</a>
