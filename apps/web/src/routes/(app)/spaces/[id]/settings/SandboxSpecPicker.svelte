<script lang="ts">
import type { SandboxSpecId } from "@neta-art/cohub";
import { X, Zap } from "lucide-svelte";

type SandboxSpec = {
	id: SandboxSpecId;
	rank: number;
	label: string;
	description: string;
	requiredPlan: string | null;
	resources: {
		limits: Record<string, string>;
		requests: Record<string, string>;
	};
};

const props = $props<{
	open: boolean;
	currentSpec: SandboxSpecId;
	appliedSpec?: SandboxSpecId | null;
	allowedSpec: SandboxSpecId;
	specs: Record<string, SandboxSpec>;
	saving?: boolean;
	onClose: () => void;
	onSelect: (spec: SandboxSpecId) => void;
	onUpgrade: (spec: SandboxSpecId) => void;
}>();

const orderedSpecs = $derived.by<SandboxSpec[]>(() =>
	(Object.values(props.specs) as SandboxSpec[]).sort(
		(left, right) => left.rank - right.rank,
	),
);
const allowedRank = $derived(props.specs[props.allowedSpec]?.rank ?? 0);

function isLocked(spec: SandboxSpec) {
	return spec.rank > allowedRank;
}

function choose(spec: SandboxSpec) {
	if (isLocked(spec)) {
		props.onUpgrade(spec.id);
		return;
	}
	props.onSelect(spec.id);
}
</script>

{#if props.open}
	<button type="button" aria-label="Close spec picker" class="fixed inset-0 z-50 bg-black/35 backdrop-blur-[2px]" onclick={props.onClose}></button>
	<div class="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-[560px] rounded-[18px] border border-border-subtle bg-bg-panel shadow-2xl sm:inset-y-16 sm:bottom-auto sm:flex sm:max-h-[calc(100vh-8rem)] sm:flex-col">
		<div class="flex items-start justify-between gap-4 border-b border-border-subtle px-5 py-4">
			<div>
				<div class="flex items-center gap-2 text-[15px] font-semibold text-text-primary"><Zap class="h-4 w-4 text-brand" />Sandbox spec</div>
				<p class="mt-1 text-[12px] text-text-tertiary">Upgrade instantly. Downgrades may apply after restart.</p>
			</div>
			<button type="button" class="rounded-full p-1.5 text-text-tertiary transition hover:bg-bg-muted hover:text-text-primary" onclick={props.onClose}><X class="h-4 w-4" /></button>
		</div>
		<div class="space-y-3 overflow-y-auto p-4">
			{#each orderedSpecs as spec}
				{@const locked = isLocked(spec)}
				<button type="button" class={`w-full rounded-[14px] border p-4 text-left transition ${props.currentSpec === spec.id ? "border-brand bg-brand/8" : "border-border-subtle bg-bg-surface hover:border-border"} ${locked ? "opacity-90" : ""}`} disabled={props.saving} onclick={() => choose(spec)}>
					<div class="flex items-start justify-between gap-3">
						<div class="min-w-0">
							<div class="flex flex-wrap items-center gap-2">
								<span class="text-[14px] font-semibold text-text-primary">{spec.label}</span>
								{#if spec.requiredPlan}<span class="rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-medium text-brand">{spec.requiredPlan}</span>{/if}
								{#if props.currentSpec === spec.id}<span class="rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success">Selected</span>{/if}
								{#if props.appliedSpec === spec.id}<span class="rounded-full bg-bg-muted px-2 py-0.5 text-[11px] text-text-secondary">Applied</span>{/if}
							</div>
							<div class="mt-1 text-[12px] text-text-tertiary">{spec.description}</div>
						</div>
						<span class="shrink-0 rounded-full bg-bg-muted px-2.5 py-1 text-[12px] font-medium text-text-secondary">{spec.resources.limits.cpu} vCPU · {spec.resources.limits.memory}</span>
					</div>
					<div class="mt-3 grid grid-cols-1 gap-2 text-[11px] text-text-tertiary sm:grid-cols-3">
						<div class="rounded-[10px] bg-bg-muted px-3 py-2"><div class="text-text-secondary">CPU request</div><div>{spec.resources.requests.cpu}</div></div>
						<div class="rounded-[10px] bg-bg-muted px-3 py-2"><div class="text-text-secondary">Memory request</div><div>{spec.resources.requests.memory}</div></div>
						<div class="rounded-[10px] bg-bg-muted px-3 py-2"><div class="text-text-secondary">Storage</div><div>{spec.resources.limits["ephemeral-storage"]}</div></div>
					</div>
					{#if locked}<div class="mt-3 text-[12px] font-medium text-brand">Upgrade to {spec.requiredPlan} to unlock</div>{/if}
				</button>
			{/each}
		</div>
	</div>
{/if}
