(function () {
  "use strict";

  const DEFAULT_CLOUD_SYNC_URL = "https://feastsync-sync.benjamin4pres.workers.dev";
  const FALLBACK_KITCHEN = { ovens: 1, largeBurners: 2, mediumBurners: 0, smallBurners: 2 };

  let autoSaveDebounceId = null;
  let cloudLockoutTimerId = null;

  // In-memory session only — PIN is NEVER written to cookies
  let cloudSession = {
    unlocked: false,
    username: "",
    pin: "",
    authProof: "",
    lastSyncedAt: null,
    dirty: false
  };

  // =========================================================================
  // 1. UI INJECTION (Header Button, Setup Pill, AI Banner & Cloud Vault Modal)
  // =========================================================================
  function injectCloudUI() {
    const btnAi = document.getElementById("btn-ai-settings");
    if (btnAi && !document.getElementById("btn-cloud-sync")) {
      btnAi.insertAdjacentHTML("beforebegin", `
        <button id="btn-cloud-sync" type="button" onclick="openCloudModal()" class="relative px-2.5 sm:px-3 py-2 rounded-xl border border-stone-200 bg-white hover:bg-stone-50 text-xs font-semibold text-stone-700 hover:text-terracotta-700 flex items-center gap-1.5 transition-colors" title="Encrypted Cloud Vault" aria-label="Open Encrypted Cloud Vault">
          <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z"/>
          </svg>
          <span id="header-cloud-label" class="hidden sm:inline">Cloud</span>
          <span id="header-cloud-dot" class="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white bg-stone-300"></span>
        </button>
      `);
    }

    const aiPill = document.getElementById("setup-ai-status-dot")?.closest("button");
    if (aiPill && !document.getElementById("setup-cloud-dot")) {
      aiPill.insertAdjacentHTML("afterend", `
        <button type="button" onclick="openCloudModal()" class="px-3 py-1.5 rounded-xl border border-stone-200 bg-cream/80 hover:bg-parchment text-xs font-semibold text-charcoal flex items-center gap-2 transition-colors">
          <span id="setup-cloud-dot" class="w-2 h-2 rounded-full bg-stone-400 shrink-0"></span>
          <span id="setup-cloud-text">Cloud Vault: Sign In / Save</span>
        </button>
      `);
    }

    const aiModalBody = document.querySelector("#modal-ai-settings .overflow-y-auto");
    if (aiModalBody && !document.getElementById("ai-modal-cloud-banner")) {
      aiModalBody.insertAdjacentHTML("afterbegin", `
        <div id="ai-modal-cloud-banner" class="rounded-xl bg-parchment/80 border border-stone-200/90 px-4 py-3 flex flex-wrap items-center justify-between gap-2.5">
          <div class="flex items-center gap-2.5 text-xs text-stone-700">
            <svg class="w-4 h-4 text-sage-700 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/>
            </svg>
            <span>Already saved your keys &amp; recipes in <strong>Cloud Vault</strong>?</span>
          </div>
          <button type="button" onclick="openCloudFromAiModal()" class="px-3 py-1.5 rounded-lg bg-charcoal hover:bg-stone-800 text-white text-xs font-bold transition-colors shrink-0">
            Sign In with PIN
          </button>
        </div>
      `);
    }

    if (!document.getElementById("modal-cloud")) {
      document.body.insertAdjacentHTML("beforeend", `
        <div id="modal-cloud" class="hidden fixed inset-0 z-50 bg-charcoal/60 backdrop-blur-sm flex items-center justify-center p-4 print:hidden">
          <div class="bg-white rounded-2xl shadow-2xl border border-stone-200 w-full max-w-lg max-h-[92vh] flex flex-col overflow-hidden">
            <div class="px-6 py-4 border-b border-stone-200 flex items-start justify-between gap-3">
              <div>
                <div class="flex items-center gap-2">
                  <h3 class="text-lg font-bold text-charcoal">Encrypted Cloud Vault</h3>
                  <span class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-sage-100 text-sage-700">AES-256-GCM</span>
                </div>
                <p class="text-xs text-stone-500 mt-0.5">Zero-knowledge sync via Cloudflare Workers + D1. Encrypted in your browser before leaving your device.</p>
              </div>
              <button type="button" onclick="closeCloudModal()" class="p-2 rounded-lg text-stone-400 hover:text-charcoal hover:bg-stone-100 shrink-0" aria-label="Close cloud vault modal">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
                </svg>
              </button>
            </div>

            <div class="p-6 space-y-5 overflow-y-auto">
              <div class="space-y-1.5">
                <label for="cloud-worker-url" class="block text-xs font-semibold uppercase tracking-wider text-stone-500">Cloudflare Worker URL</label>
                <div class="flex gap-2">
                  <input id="cloud-worker-url" type="url" placeholder="https://feastsync-sync.benjamin4pres.workers.dev" class="flex-1 rounded-xl border border-stone-300 bg-cream/40 px-3.5 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-terracotta-500" oninput="handleCloudUrlInput()">
                  <button id="btn-cloud-health" type="button" onclick="testCloudHealth()" class="px-3 py-2 rounded-xl border border-stone-300 bg-white hover:bg-stone-50 text-xs font-bold text-charcoal shrink-0 transition-colors">
                    Test /health
                  </button>
                </div>
                <div id="cloud-health-status" class="text-[11px] text-stone-500"></div>
              </div>

              <div id="cloud-alert" class="hidden rounded-xl p-3 text-xs font-medium"></div>

              <!-- SIGNED OUT VIEW -->
              <div id="cloud-signed-out-view" class="space-y-4">
                <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div class="sm:col-span-2">
                    <label for="cloud-username" class="block text-xs font-semibold uppercase tracking-wider text-stone-500 mb-1">Username</label>
                    <input id="cloud-username" type="text" autocomplete="username" placeholder="e.g., chef_ben" class="w-full rounded-xl border border-stone-300 bg-cream/40 px-3.5 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-terracotta-500">
                    <p class="text-[10px] text-stone-400 mt-1">3–32 letters, numbers, _ or -</p>
                  </div>
                  <div>
                    <label for="cloud-pin" class="block text-xs font-semibold uppercase tracking-wider text-stone-500 mb-1">4-Digit PIN</label>
                    <input id="cloud-pin" type="password" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" autocomplete="current-password" placeholder="••••" class="w-full rounded-xl border border-stone-300 bg-cream/40 px-3.5 py-2.5 text-center text-base font-mono font-bold tracking-[0.35em] focus:outline-none focus:ring-2 focus:ring-terracotta-500">
                    <p class="text-[10px] text-stone-400 mt-1 text-center">Never saved in cookies</p>
                  </div>
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <button id="btn-cloud-login" type="button" onclick="cloudSignInAndLoad()" class="px-4 py-3 rounded-xl bg-terracotta-600 hover:bg-
