<script lang="ts">
import { Terminal, ArrowRight } from "lucide-svelte";
</script>

<div class="flex-1 flex flex-col min-h-0 overflow-y-auto">
  <div class="flex-1 flex flex-col items-center justify-center p-6 text-center">
    <!-- Brand -->
    <div class="w-14 h-14 bg-[#FF3E00] rounded-[10px] flex items-center justify-center font-bold text-2xl text-white mb-5">
      C
    </div>

    <h1 class="text-[18px] font-semibold text-text-primary tracking-tight">
      Welcome to Cohub
    </h1>
    <p class="mt-1.5 text-[13px] text-text-tertiary max-w-sm leading-relaxed">
      Select a space from the sidebar to start working, or create a new one.
    </p>

    <!-- CTA -->
    <div class="mt-6">
      <a
        href="/spaces/new"
        class="inline-flex items-center gap-2 px-4 py-2 rounded-[6px] bg-[#FF3E00]/10 border border-[#FF3E00]/20 text-[13px] text-brand font-medium hover:bg-[#FF3E00]/15 transition-colors"
      >
        <Terminal class="w-[14px] h-[14px]" />
        Create a Space
      </a>
    </div>

    <!-- Info Cards -->
    <div class="mt-10 w-full max-w-md grid grid-cols-1 sm:grid-cols-3 gap-3">
      <div class="rounded-[6px] border border-border-subtle bg-bg-content px-3 py-3 text-left">
        <p class="text-[12px] font-medium text-text-primary">Spaces</p>
        <p class="text-[11px] text-text-tertiary mt-1 leading-relaxed">Isolated environments for your agents and files</p>
      </div>
      <div class="rounded-[6px] border border-border-subtle bg-bg-content px-3 py-3 text-left">
        <p class="text-[12px] font-medium text-text-primary">Sessions</p>
        <p class="text-[11px] text-text-tertiary mt-1 leading-relaxed">Conversation threads within each space</p>
      </div>
      <div class="rounded-[6px] border border-border-subtle bg-bg-content px-3 py-3 text-left">
        <p class="text-[12px] font-medium text-text-primary">Sandboxes</p>
        <p class="text-[11px] text-text-tertiary mt-1 leading-relaxed">Cloud execution with full file access</p>
      </div>
    </div>
  </div>
</div>
