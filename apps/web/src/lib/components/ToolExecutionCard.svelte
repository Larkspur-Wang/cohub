<script lang="ts">
import ToolCallItem from "$lib/components/ToolCallItem.svelte";
import { toolStateToViewModel } from "$lib/components/tool-call-format";
import type { ToolState } from "$lib/session-tree";

type Props = {
	tool: ToolState;
};

const { tool }: Props = $props();
const viewModel = $derived(toolStateToViewModel(tool));
</script>

<ToolCallItem tool={viewModel} />
