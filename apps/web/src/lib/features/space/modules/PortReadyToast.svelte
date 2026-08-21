<script lang="ts">
import { ExternalLink, X } from "lucide-svelte";

type Props = {
	port: string;
	url: string;
	onPreview: () => void;
	onClose: () => void;
};

let { port, url, onPreview, onClose }: Props = $props();
</script>

<div class="pointer-events-none fixed bottom-4 right-4 z-40 max-w-[calc(100vw-2rem)] sm:bottom-5 sm:right-5">
	<div class="port-ready-toast pointer-events-auto">
		<div class="min-w-0 flex-1">
			<div class="text-[12px] font-medium text-text-primary">Port :{port} is ready</div>
			<div class="truncate text-[11px] text-text-tertiary" title={url}>{url}</div>
		</div>
		<div class="flex shrink-0 items-center gap-1">
			<button type="button" class="port-ready-action primary" onclick={onPreview}>Open</button>
			<a class="port-ready-action" href={url} target="_blank" rel="noreferrer" onclick={onClose}>
				<ExternalLink class="h-3 w-3" />
				<span>Open externally</span>
			</a>
			<button type="button" class="port-ready-close" onclick={onClose} title="Dismiss port notification" aria-label="Dismiss port notification">
				<X class="h-3.5 w-3.5" />
			</button>
		</div>
	</div>
</div>
