<script lang="ts">
import type { SandboxSpecId } from "@neta-art/cohub";
import { Check, Lock, Zap } from "lucide-svelte";
import Sheet from "$lib/components/Sheet.svelte";

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

<Sheet open={props.open} onClose={props.onClose} maxWidth="560px">
	<div class="flex max-h-[88vh] flex-col">
		<!-- Header -->
		<div class="flex items-start justify-between gap-4 border-b border-border-subtle px-5 py-4">
			<div class="flex items-center gap-2.5">
				<span class="flex h-7 w-7 items-center justify-center rounded-[6px] bg-brand-bg text-brand">
					<Zap class="h-4 w-4" />
				</span>
				<div>
					<div class="text-[15px] font-semibold text-text-primary">Compute spec</div>
					<div class="mt-0.5 text-[12px] text-text-tertiary">Upgrade instantly. Downgrades apply after restart.</div>
				</div>
			</div>
			<div class="shrink-0 text-[11px] text-text-tertiary">{props.currentSpec}</div>
		</div>

		<!-- Spec list -->
		<div class="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-4">
			{#each orderedSpecs as spec (spec.id)}
				{@const locked = isLocked(spec)}
				{@const selected = props.currentSpec === spec.id}
				<button
					type="button"
					class="group w-full rounded-[10px] border p-3.5 text-left transition-colors {selected
						? 'border-brand/50 bg-brand-bg'
						: 'border-border-subtle bg-bg-content hover:border-border-primary'} {locked ? 'opacity-95' : ''}"
					disabled={props.saving}
					onclick={() => choose(spec)}
				>
					<div class="flex items-start justify-between gap-3">
						<div class="min-w-0">
							<div class="flex flex-wrap items-center gap-2">
								<span class="text-[14px] font-semibold text-text-primary">{spec.label}</span>
								{#if selected}
									<span class="inline-flex items-center gap-1 rounded-full bg-success-bg px-2 py-0.5 text-[11px] font-medium text-success-soft">
										<Check class="h-3 w-3" /> Selected
									</span>
								{/if}
								{#if props.appliedSpec === spec.id && !selected}
									<span class="rounded-full bg-bg-hover px-2 py-0.5 text-[11px] text-text-secondary">Applied</span>
								{/if}
							</div>
							<div class="mt-1 text-[12px] text-text-tertiary">{spec.description}</div>
						</div>
						<div class="flex shrink-0 items-center gap-2">
							<span class="rounded-[6px] bg-bg-hover px-2.5 py-1 font-mono text-[12px] font-medium text-text-secondary">{spec.resources.limits.cpu}<span class="ml-0.5 text-text-tertiary">vCPU</span></span>
							<span class="rounded-[6px] bg-bg-hover px-2.5 py-1 font-mono text-[12px] font-medium text-text-secondary">{spec.resources.limits.memory}</span>
						</div>
					</div>

					<div class="mt-3 grid grid-cols-1 gap-1.5 text-[11px] sm:grid-cols-2">
						<div class="rounded-[6px] bg-bg-hover px-2.5 py-1.5">
							<div class="text-text-tertiary">CPU request</div>
							<div class="mt-0.5 font-mono text-text-secondary">{spec.resources.requests.cpu}</div>
						</div>
						<div class="rounded-[6px] bg-bg-hover px-2.5 py-1.5">
							<div class="text-text-tertiary">Memory request</div>
							<div class="mt-0.5 font-mono text-text-secondary">{spec.resources.requests.memory}</div>
						</div>
					</div>

					{#if locked}
						<div class="mt-3 flex items-center gap-1.5 text-[12px] font-medium text-brand">
							<Lock class="h-3.5 w-3.5" />
							<span>Upgrade to {spec.requiredPlan} to unlock</span>
						</div>
					{/if}
				</button>
			{/each}
		</div>
	</div>
</Sheet>
