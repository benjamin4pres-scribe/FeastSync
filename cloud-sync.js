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
                  <button id="btn-cloud-login" type="button" onclick="cloudSignInAndLoad()" class="px-4 py-3 rounded-xl bg-terracotta-600 hover:bg-terracotta-700 disabled:opacity-60 text-white text-xs sm:text-sm font-bold shadow-sm transition-colors">
                    Sign In &amp; Load Vault
                  </button>
                  <button id="btn-cloud-register" type="button" onclick="cloudCreateVault()" class="px-4 py-3 rounded-xl bg-charcoal hover:bg-stone-800 disabled:opacity-60 text-white text-xs sm:text-sm font-bold shadow-sm transition-colors">
                    Create New Vault
                  </button>
                </div>

                <div class="rounded-xl bg-parchment/70 border border-stone-200/80 p-3 text-[11px] text-stone-600 leading-relaxed">
                  <strong>Security guarantee:</strong> Your browser derives separate auth and AES-256-GCM keys via PBKDF2 (210,000 rounds). 5 wrong PIN guesses trigger a 30-minute server lockout.
                </div>
              </div>

              <!-- SIGNED IN VIEW -->
              <div id="cloud-signed-in-view" class="hidden space-y-4">
                <div class="rounded-xl bg-sage-50 border border-sage-600/20 p-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div class="flex items-center gap-2">
                      <span class="w-2.5 h-2.5 rounded-full bg-sage-600"></span>
                      <span class="text-sm font-bold text-sage-700">Unlocked as <span id="cloud-active-user" class="font-mono">@user</span></span>
                    </div>
                    <div id="cloud-last-synced" class="text-[11px] text-sage-700/80 mt-0.5">Last synced: Just now</div>
                  </div>
                  <span id="cloud-dirty-badge" class="hidden text-[11px] font-bold px-2.5 py-1 rounded-full bg-amber-100 text-amber-800">Unsaved changes</span>
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <button id="btn-cloud-save" type="button" onclick="cloudSaveNow(false)" class="px-4 py-2.5 rounded-xl bg-terracotta-600 hover:bg-terracotta-700 disabled:opacity-60 text-white text-xs sm:text-sm font-bold shadow-sm transition-colors">
                    Encrypt &amp; Save Now
                  </button>
                  <button id="btn-cloud-reload" type="button" onclick="requestCloudReload()" class="px-4 py-2.5 rounded-xl border border-stone-300 bg-white hover:bg-stone-50 disabled:opacity-60 text-charcoal text-xs sm:text-sm font-bold transition-colors">
                    Reload from Cloud
                  </button>
                </div>

                <div id="cloud-reload-confirm" class="hidden rounded-xl bg-amber-50 border border-amber-300 p-3.5 space-y-2.5">
                  <p class="text-xs font-bold text-amber-900">You have unsaved local changes. Overwrite them with the cloud copy?</p>
                  <div class="flex justify-end gap-2">
                    <button type="button" onclick="cancelCloudReload()" class="px-3 py-1.5 rounded-lg bg-white border border-stone-300 text-xs font-semibold text-stone-700">Cancel</button>
                    <button type="button" onclick="confirmCloudReload()" class="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold">Overwrite Local</button>
                  </div>
                </div>

                <label class="flex items-start gap-2.5 p-3 rounded-xl bg-stone-50 border border-stone-200/80 cursor-pointer">
                  <input id="chk-cloud-autosave" type="checkbox" checked onchange="handleCloudAutoSaveToggle()" class="mt-0.5 h-4 w-4 rounded border-stone-300 accent-terracotta-600">
                  <span class="text-xs text-stone-700">
                    <strong class="text-charcoal">Auto-encrypt &amp; save while signed in</strong> — syncs edits automatically after 2 seconds.
                  </span>
                </label>

                <details class="rounded-xl border border-stone-200 p-3.5 text-xs">
                  <summary class="font-bold text-charcoal cursor-pointer select-none">Change 4-Digit PIN (Re-encrypts Vault)</summary>
                  <div class="mt-3 space-y-2.5">
                    <div class="grid grid-cols-2 gap-2.5">
                      <div>
                        <label for="cloud-new-pin" class="block text-[11px] font-semibold text-stone-500 mb-1">New 4-Digit PIN</label>
                        <input id="cloud-new-pin" type="password" inputmode="numeric" maxlength="4" placeholder="••••" class="w-full rounded-lg border border-stone-300 px-3 py-2 text-center font-mono font-bold tracking-widest">
                      </div>
                      <div>
                        <label for="cloud-new-pin-confirm" class="block text-[11px] font-semibold text-stone-500 mb-1">Confirm PIN</label>
                        <input id="cloud-new-pin-confirm" type="password" inputmode="numeric" maxlength="4" placeholder="••••" class="w-full rounded-lg border border-stone-300 px-3 py-2 text-center font-mono font-bold tracking-widest">
                      </div>
                    </div>
                    <button id="btn-cloud-change-pin" type="button" onclick="cloudChangePin()" class="w-full py-2 rounded-lg bg-charcoal hover:bg-stone-800 text-white font-bold transition-colors">
                      Rotate PIN &amp; Re-Encrypt Vault
                    </button>
                  </div>
                </details>

                <div class="pt-2 border-t border-stone-200 flex flex-wrap items-center justify-between gap-2">
                  <button type="button" onclick="requestCloudDelete()" class="text-xs font-bold text-red-600 hover:underline">
                    Delete Cloud Vault
                  </button>
                  <button type="button" onclick="cloudLockSignOut()" class="px-4 py-2 rounded-xl border border-stone-300 bg-white hover:bg-stone-50 text-xs font-bold text-charcoal transition-colors">
                    Lock / Sign Out
                  </button>
                </div>

                <div id="cloud-delete-confirm" class="hidden rounded-xl bg-red-50 border border-red-300 p-3.5 space-y-2.5">
                  <p class="text-xs font-bold text-red-800">Permanently delete your encrypted cloud vault from Cloudflare D1? Your local browser copy will stay untouched.</p>
                  <div class="flex justify-end gap-2">
                    <button type="button" onclick="cancelCloudDelete()" class="px-3 py-1.5 rounded-lg bg-white border border-stone-300 text-xs font-semibold text-stone-700">Keep Vault</button>
                    <button id="btn-cloud-delete-confirm" type="button" onclick="confirmCloudDelete()" class="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-bold">Yes, Delete Cloud Vault</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      `);
    }
  }

  // =========================================================================
  // 2. WEB CRYPTO HELPERS (PBKDF2 210,000 ROUNDS + AES-256-GCM)
  // =========================================================================
  function bytesToBase64(bytes) {
    let bin = "";
    const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
    return btoa(bin);
  }

  function base64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function bytesToBase64Url(bytes) {
    return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function normalizeCloudUrl(raw) {
    return String(raw || "").trim().replace(/\/+$/, "");
  }

  function getCloudBaseUrl() {
    const inputVal = document.getElementById("cloud-worker-url")?.value;
    return normalizeCloudUrl(inputVal || state.config.cloudSyncUrl || DEFAULT_CLOUD_SYNC_URL);
  }

  function validateCloudCredentials(rawUsername, rawPin) {
    const normUser = String(rawUsername || "").trim().toLowerCase();
    const pin = String(rawPin || "").trim();
    if (!/^[a-z0-9_-]{3,32}$/.test(normUser)) {
      throw new Error("Username must be 3–32 characters using only letters, numbers, _ or -.");
    }
    if (!/^\d{4}$/.test(pin)) {
      throw new Error("PIN must be exactly 4 digits (0–9).");
    }
    return { normUser, pin };
  }

  async function deriveCloudKeys(normUser, pin) {
    if (!window.crypto || !window.crypto.subtle) {
      throw new Error("Web Crypto API requires HTTPS or localhost.");
    }
    const enc = new TextEncoder();
    const baseKey = await crypto.subtle.importKey(
      "raw",
      enc.encode(`${normUser}:${pin}`),
      { name: "PBKDF2" },
      false,
      ["deriveBits", "deriveKey"]
    );

    const authBits = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt: enc.encode(`feastsync-auth-v1:${normUser}`),
        iterations: 210000,
        hash: "SHA-256"
      },
      baseKey,
      256
    );
    const authProof = bytesToBase64Url(new Uint8Array(authBits));

    const encKey = await crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: enc.encode(`feastsync-vault-v1:${normUser}`),
        iterations: 210000,
        hash: "SHA-256"
      },
      baseKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );

    return { authProof, encKey };
  }

  function buildVaultPayloadObject() {
    return {
      schemaVersion: 1,
      savedAt: Date.now(),
      config: state.config,
      recipes: state.recipes,
      plan: state.plan,
      completedSteps: state.completedSteps,
      timers: state.timers
    };
  }

  /** Encrypt vault state into a single serialized string for the Worker's `encryptedVault` field */
  async function encryptVaultString(encKey) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode(JSON.stringify(buildVaultPayloadObject()));
    const ctBuffer = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, encKey, plaintext);
    return JSON.stringify({
      v: 1,
      iv: bytesToBase64(iv),
      ct: bytesToBase64(new Uint8Array(ctBuffer))
    });
  }

  /** Parse and decrypt the Worker's `encryptedVault` string back into FeastSync state */
  async function decryptVaultString(encryptedVaultStr, encKey) {
    let envelope;
    try {
      envelope = JSON.parse(encryptedVaultStr);
    } catch {
      throw new Error("Encrypted vault format is unrecognized.");
    }
    const ivB64 = envelope.iv;
    const ctB64 = envelope.ct || envelope.ciphertext;
    if (!ivB64 || !ctB64) {
      throw new Error("Encrypted vault is missing IV or ciphertext.");
    }
    const iv = base64ToBytes(ivB64);
    const ct = base64ToBytes(ctB64);
    const plainBuffer = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, encKey, ct);
    return JSON.parse(new TextDecoder().decode(plainBuffer));
  }

  // =========================================================================
  // 3. ALERTS, LOCKOUT COUNTDOWN & WORKER API CALLS
  // =========================================================================
  function showCloudAlert(message, type = "info") {
    const el = document.getElementById("cloud-alert");
    if (!el) return;
    const styles = {
      error: "bg-red-50 border border-red-200 text-red-800",
      success: "bg-sage-50 border border-sage-600/25 text-sage-700",
      warning: "bg-amber-50 border border-amber-300 text-amber-900",
      info: "bg-stone-100 border border-stone-200 text-stone-700"
    };
    el.className = `rounded-xl p-3 text-xs font-medium ${styles[type] || styles.info}`;
    el.textContent = message;
    el.classList.remove("hidden");
  }

  function hideCloudAlert() {
    const el = document.getElementById("cloud-alert");
    if (el) el.classList.add("hidden");
    if (cloudLockoutTimerId) {
      clearInterval(cloudLockoutTimerId);
      cloudLockoutTimerId = null;
    }
  }

  function startLockoutCountdown(seconds) {
    if (cloudLockoutTimerId) clearInterval(cloudLockoutTimerId);
    let remaining = Math.max(1, Math.ceil(Number(seconds) || 1800));
    const renderTick = () => {
      const mins = Math.floor(remaining / 60);
      const secs = remaining % 60;
      showCloudAlert(
        `Too many incorrect PIN attempts. Account locked for ${mins}m ${String(secs).padStart(2, "0")}s.`,
        "error"
      );
    };
    renderTick();
    cloudLockoutTimerId = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        clearInterval(cloudLockoutTimerId);
        cloudLockoutTimerId = null;
        showCloudAlert("Lockout expired. You may try signing in again.", "info");
      } else {
        renderTick();
      }
    }, 1000);
  }

  async function cloudApiPost(path, bodyObj) {
    const baseUrl = getCloudBaseUrl();
    if (!baseUrl) throw new Error("Enter your Cloudflare Worker URL first.");

    const resp = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bodyObj)
    });
    const data = await resp.json().catch(() => ({}));

    if (resp.status === 429) {
      const headerRetry = parseInt(resp.headers.get("Retry-After") || "0", 10);
      const untilSecs = data.lockedUntil
        ? Math.ceil((Number(data.lockedUntil) - Date.now()) / 1000)
        : 0;
      const secs = data.retryAfterSeconds || data.retryAfter || untilSecs || headerRetry || 1800;
      startLockoutCountdown(secs);
      const err = new Error(data.error || "Account temporarily locked.");
      err.isLockout = true;
      throw err;
    }

    if (!resp.ok) {
      throw new Error(data.error || data.message || `HTTP ${resp.status} ${resp.statusText}`);
    }
    return data;
  }

  // =========================================================================
  // 4. VAULT HYDRATION & ACTIONS (MATCHES /api/* WORKER ENDPOINTS)
  // =========================================================================
  function applyDecryptedVault(payload) {
    if (!payload || typeof payload !== "object") return;
    const keepUrl = state.config.cloudSyncUrl || DEFAULT_CLOUD_SYNC_URL;
    const incomingConfig = payload.config || payload.settings;

    if (incomingConfig && typeof incomingConfig === "object") {
      state.config = {
        ...state.config,
        ...incomingConfig,
        kitchen: {
          ...FALLBACK_KITCHEN,
          ...(incomingConfig.kitchen || {})
        }
      };
      if (keepUrl) state.config.cloudSyncUrl = keepUrl;
    }

    state.recipes = Array.isArray(payload.recipes) ? payload.recipes : [];
    state.plan = payload.plan || null;
    state.completedSteps = payload.completedSteps || {};

    const now = Date.now();
    state.timers = Array.isArray(payload.timers)
      ? payload.timers.map((t) => {
          if (t.status === "running" && t.endTimestamp) {
            const left = Math.max(0, Math.round((t.endTimestamp - now) / 1000));
            return { ...t, remainingSeconds: left, status: left === 0 ? "ringing" : "running" };
          }
          return t;
        })
      : [];

    CookieStore.saveJSON("fs_cfg", state.config);
    CookieStore.saveJSON("fs_rec", state.recipes);
    CookieStore.saveJSON("fs_plan", { plan: state.plan, completedSteps: state.completedSteps });
    CookieStore.saveJSON("fs_tmr", state.timers);

    syncConfigInputs();
    renderKitchenConfigUI();
    renderStationFilters();
    renderRecipes();
    renderPlan();
    renderTimers();
    renderActiveTimersDock();
    renderAlarmBanner();
    updateCookieStatusBadge();
    updateSoundIcons();
    updateAiStatusIndicator();
  }

  function openCloudModal() {
    hideCloudAlert();
    document.getElementById("cloud-worker-url").value = state.config.cloudSyncUrl || DEFAULT_CLOUD_SYNC_URL;
    document.getElementById("cloud-username").value = cloudSession.username || state.config.cloudLastUsername || "";
    document.getElementById("cloud-pin").value = "";
    document.getElementById("chk-cloud-autosave").checked = state.config.cloudAutoSave !== false;
    document.getElementById("cloud-reload-confirm").classList.add("hidden");
    document.getElementById("cloud-delete-confirm").classList.add("hidden");
    updateCloudStatusUI();
    document.getElementById("modal-cloud").classList.remove("hidden");
  }

  function closeCloudModal() {
    document.getElementById("modal-cloud")?.classList.add("hidden");
  }

  function openCloudFromAiModal() {
    if (typeof closeAiSettingsModal === "function") closeAiSettingsModal();
    openCloudModal();
  }

  function handleCloudUrlInput() {
    state.config.cloudSyncUrl = normalizeCloudUrl(document.getElementById("cloud-worker-url").value);
    CookieStore.saveJSON("fs_cfg", state.config);
    updateCookieStatusBadge();
  }

  async function testCloudHealth() {
    const baseUrl = getCloudBaseUrl();
    const statusEl = document.getElementById("cloud-health-status");
    const btn = document.getElementById("btn-cloud-health");
    if (!baseUrl) {
      statusEl.textContent = "Paste your Worker URL above first.";
      return;
    }
    btn.disabled = true;
    statusEl.textContent = `Checking ${baseUrl}/health ...`;
    try {
      const t0 = performance.now();
      const resp = await fetch(`${baseUrl}/health`, { method: "GET" });
      const ms = Math.round(performance.now() - t0);
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || data.ok === false) {
        throw new Error(data.error || `HTTP ${resp.status} ${resp.statusText}`);
      }
      statusEl.textContent = `Connected! D1 database ready (${ms}ms).`;
      showToast("Cloudflare Worker & D1 ready!", "success");
    } catch (err) {
      statusEl.textContent = `Health check failed: ${err.message}`;
    } finally {
      btn.disabled = false;
    }
  }

  async function cloudCreateVault() {
    hideCloudAlert();
    const btn = document.getElementById("btn-cloud-register");
    btn.disabled = true;
    btn.textContent = "Encrypting & Creating...";
    try {
      const { normUser, pin } = validateCloudCredentials(
        document.getElementById("cloud-username").value,
        document.getElementById("cloud-pin").value
      );
      const { authProof, encKey } = await deriveCloudKeys(normUser, pin);
      const encryptedVault = await encryptVaultString(encKey);

      const data = await cloudApiPost("/api/register", {
        username: normUser,
        authProof,
        encryptedVault
      });

      state.config.cloudLastUsername = normUser;
      CookieStore.saveJSON("fs_cfg", state.config);
      cloudSession = {
        unlocked: true,
        username: normUser,
        pin,
        authProof,
        lastSyncedAt: data.updatedAt || Date.now(),
        dirty: false
      };
      document.getElementById("cloud-pin").value = "";
      updateCloudStatusUI();
      showCloudAlert(`Encrypted vault created for @${normUser}!`, "success");
      showToast("Cloud Vault created & synced!", "success");
    } catch (err) {
      if (!err.isLockout) showCloudAlert(err.message, "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "Create New Vault";
    }
  }

  async function cloudSignInAndLoad() {
    hideCloudAlert();
    const btn = document.getElementById("btn-cloud-login");
    btn.disabled = true;
    btn.textContent = "Deriving Keys & Loading...";
    try {
      const { normUser, pin } = validateCloudCredentials(
        document.getElementById("cloud-username").value,
        document.getElementById("cloud-pin").value
      );
      const { authProof, encKey } = await deriveCloudKeys(normUser, pin);
      const data = await cloudApiPost("/api/load", { username: normUser, authProof });

      if (!data.encryptedVault) {
        throw new Error("Server returned an empty vault payload.");
      }
      const decrypted = await decryptVaultString(data.encryptedVault, encKey);

      state.config.cloudLastUsername = normUser;
      applyDecryptedVault(decrypted);
      cloudSession = {
        unlocked: true,
        username: normUser,
        pin,
        authProof,
        lastSyncedAt: data.updatedAt || Date.now(),
        dirty: false
      };
      document.getElementById("cloud-pin").value = "";
      updateCloudStatusUI();
      showCloudAlert(`Vault unlocked and loaded for @${normUser}.`, "success");
      showToast(`Loaded encrypted vault for @${normUser}!`, "success");
    } catch (err) {
      if (!err.isLockout) showCloudAlert(err.message, "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "Sign In & Load Vault";
    }
  }

  async function cloudSaveNow(isAuto = false) {
    if (!cloudSession.unlocked || !cloudSession.username || !cloudSession.pin) return;
    const btn = document.getElementById("btn-cloud-save");
    if (!isAuto && btn) {
      btn.disabled = true;
      btn.textContent = "Encrypting & Saving...";
    }
    try {
      const { authProof, encKey } = await deriveCloudKeys(cloudSession.username, cloudSession.pin);
      const encryptedVault = await encryptVaultString(encKey);
      const data = await cloudApiPost("/api/save", {
        username: cloudSession.username,
        authProof,
        encryptedVault
      });
      cloudSession.lastSyncedAt = data.updatedAt || Date.now();
      cloudSession.dirty = false;
      updateCloudStatusUI();
      if (!isAuto) {
        showCloudAlert("Vault encrypted and saved to Cloudflare D1.", "success");
        showToast("Cloud Vault saved!", "success");
      }
    } catch (err) {
      if (!isAuto && !err.isLockout) showCloudAlert(`Save failed: ${err.message}`, "error");
      else if (isAuto) showToast(`Auto-sync paused: ${err.message}`, "error");
    } finally {
      if (!isAuto && btn) {
        btn.disabled = false;
        btn.textContent = "Encrypt & Save Now";
      }
    }
  }

  function requestCloudReload() {
    if (cloudSession.dirty) {
      document.getElementById("cloud-reload-confirm").classList.remove("hidden");
    } else {
      confirmCloudReload();
    }
  }

  function cancelCloudReload() {
    document.getElementById("cloud-reload-confirm").classList.add("hidden");
  }

  async function confirmCloudReload() {
    document.getElementById("cloud-reload-confirm").classList.add("hidden");
    if (!cloudSession.unlocked) return;
    const btn = document.getElementById("btn-cloud-reload");
    btn.disabled = true;
    try {
      const { authProof, encKey } = await deriveCloudKeys(cloudSession.username, cloudSession.pin);
      const data = await cloudApiPost("/api/load", { username: cloudSession.username, authProof });
      const decrypted = await decryptVaultString(data.encryptedVault, encKey);
      applyDecryptedVault(decrypted);
      cloudSession.lastSyncedAt = data.updatedAt || Date.now();
      cloudSession.dirty = false;
      updateCloudStatusUI();
      showCloudAlert("Reloaded latest encrypted copy from cloud.", "success");
      showToast("Reloaded from Cloud Vault!", "success");
    } catch (err) {
      if (!err.isLockout) showCloudAlert(`Reload failed: ${err.message}`, "error");
    } finally {
      btn.disabled = false;
    }
  }

  function handleCloudAutoSaveToggle() {
    state.config.cloudAutoSave = document.getElementById("chk-cloud-autosave").checked;
    CookieStore.saveJSON("fs_cfg", state.config);
    updateCookieStatusBadge();
  }

  async function cloudChangePin() {
    hideCloudAlert();
    if (!cloudSession.unlocked) return;
    const p1 = document.getElementById("cloud-new-pin").value.trim();
    const p2 = document.getElementById("cloud-new-pin-confirm").value.trim();
    if (!/^\d{4}$/.test(p1)) {
      showCloudAlert("New PIN must be exactly 4 digits.", "error");
      return;
    }
    if (p1 !== p2) {
      showCloudAlert("New PIN and confirmation do not match.", "error");
      return;
    }
    const btn = document.getElementById("btn-cloud-change-pin");
    btn.disabled = true;
    btn.textContent = "Re-Encrypting Vault...";
    try {
      const oldKeys = await deriveCloudKeys(cloudSession.username, cloudSession.pin);
      const newKeys = await deriveCloudKeys(cloudSession.username, p1);
      const encryptedVault = await encryptVaultString(newKeys.encKey);

      const data = await cloudApiPost("/api/change-pin", {
        username: cloudSession.username,
        authProof: oldKeys.authProof,
        newAuthProof: newKeys.authProof,
        encryptedVault
      });

      cloudSession.pin = p1;
      cloudSession.authProof = newKeys.authProof;
      cloudSession.lastSyncedAt = data.updatedAt || Date.now();
      cloudSession.dirty = false;
      document.getElementById("cloud-new-pin").value = "";
      document.getElementById("cloud-new-pin-confirm").value = "";
      updateCloudStatusUI();
      showCloudAlert("PIN rotated and vault re-encrypted with new keys!", "success");
      showToast("Cloud Vault PIN updated!", "success");
    } catch (err) {
      if (!err.isLockout) showCloudAlert(`PIN change failed: ${err.message}`, "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "Rotate PIN & Re-Encrypt Vault";
    }
  }

  function requestCloudDelete() {
    document.getElementById("cloud-delete-confirm").classList.remove("hidden");
  }

  function cancelCloudDelete() {
    document.getElementById("cloud-delete-confirm").classList.add("hidden");
  }

  async function confirmCloudDelete() {
    if (!cloudSession.unlocked) return;
    const btn = document.getElementById("btn-cloud-delete-confirm");
    btn.disabled = true;
    try {
      const { authProof } = await deriveCloudKeys(cloudSession.username, cloudSession.pin);
      await cloudApiPost("/api/delete", { username: cloudSession.username, authProof });
      cloudLockSignOut(true);
      showCloudAlert("Cloud vault permanently deleted. Your local copy was kept.", "info");
      showToast("Cloud Vault deleted.", "info");
    } catch (err) {
      if (!err.isLockout) showCloudAlert(`Delete failed: ${err.message}`, "error");
    } finally {
      btn.disabled = false;
      document.getElementById("cloud-delete-confirm").classList.add("hidden");
    }
  }

  function cloudLockSignOut(silent = false) {
    clearTimeout(autoSaveDebounceId);
    cloudSession = {
      unlocked: false,
      username: "",
      pin: "",
      authProof: "",
      lastSyncedAt: null,
      dirty: false
    };
    updateCloudStatusUI();
    if (!silent) {
      showCloudAlert("Vault locked and PIN cleared from memory.", "info");
      showToast("Signed out of Cloud Vault.", "info");
    }
  }

  function markCloudDirtyAndMaybeAutoSave() {
    if (!cloudSession.unlocked) return;
    cloudSession.dirty = true;
    updateCloudStatusUI();
    if (state.config.cloudAutoSave !== false) {
      clearTimeout(autoSaveDebounceId);
      autoSaveDebounceId = setTimeout(() => cloudSaveNow(true), 2000);
    }
  }

  function updateCloudStatusUI() {
    const signedOutEl = document.getElementById("cloud-signed-out-view");
    const signedInEl = document.getElementById("cloud-signed-in-view");
    const headerDot = document.getElementById("header-cloud-dot");
    const headerLabel = document.getElementById("header-cloud-label");
    const setupDot = document.getElementById("setup-cloud-dot");
    const setupText = document.getElementById("setup-cloud-text");

    if (cloudSession.unlocked) {
      signedOutEl?.classList.add("hidden");
      signedInEl?.classList.remove("hidden");
      document.getElementById("cloud-active-user").textContent = `@${cloudSession.username}`;
      const ts = cloudSession.lastSyncedAt ? new Date(cloudSession.lastSyncedAt).toLocaleTimeString() : "Just now";
      document.getElementById("cloud-last-synced").textContent = `Last synced: ${ts}`;
      document.getElementById("cloud-dirty-badge").classList.toggle("hidden", !cloudSession.dirty);

      if (headerDot) headerDot.className = `absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white ${cloudSession.dirty ? "bg-amber-500" : "bg-sage-600"}`;
      if (headerLabel) headerLabel.textContent = `@${cloudSession.username}`;
      if (setupDot) setupDot.className = `w-2 h-2 rounded-full shrink-0 ${cloudSession.dirty ? "bg-amber-500" : "bg-sage-600"}`;
      if (setupText) setupText.textContent = cloudSession.dirty ? `Cloud: @${cloudSession.username} (Syncing...)` : `Cloud: @${cloudSession.username} (Synced)`;
    } else {
      signedOutEl?.classList.remove("hidden");
      signedInEl?.classList.add("hidden");
      if (headerDot) headerDot.className = "absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white bg-stone-300";
      if (headerLabel) headerLabel.textContent = "Cloud";
      if (setupDot) setupDot.className = "w-2 h-2 rounded-full bg-stone-400 shrink-0";
      if (setupText) setupText.textContent = "Cloud Vault: Sign In / Save";
    }
  }

  // =========================================================================
  // 5. HOOK EXISTING PERSISTENCE FUNCTIONS & BOOTSTRAP
  // =========================================================================
  function hookPersistence() {
    ["persistConfig", "persistRecipes", "persistPlan", "persistTimers"].forEach((fnName) => {
      const orig = window[fnName];
      if (typeof orig === "function" && !orig._cloudWrapped) {
        const wrapped = function (...args) {
          const result = orig.apply(this, args);
          markCloudDirtyAndMaybeAutoSave();
          return result;
        };
        wrapped._cloudWrapped = true;
        window[fnName] = wrapped;
      }
    });

    const origClear = window.confirmClearAllCookies;
    if (typeof origClear === "function" && !origClear._cloudWrapped) {
      const wrappedClear = function (...args) {
        const result = origClear.apply(this, args);
        state.config.cloudSyncUrl = DEFAULT_CLOUD_SYNC_URL;
        state.config.cloudLastUsername = "";
        state.config.cloudAutoSave = true;
        cloudLockSignOut(true);
        return result;
      };
      wrappedClear._cloudWrapped = true;
      window.confirmClearAllCookies = wrappedClear;
    }
  }

  function initCloudSync() {
    if (!state.config.cloudSyncUrl) state.config.cloudSyncUrl = DEFAULT_CLOUD_SYNC_URL;
    if (typeof state.config.cloudLastUsername !== "string") state.config.cloudLastUsername = "";
    if (typeof state.config.cloudAutoSave !== "boolean") state.config.cloudAutoSave = true;

    injectCloudUI();
    hookPersistence();
    updateCloudStatusUI();

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeCloudModal();
    });
  }

  Object.assign(window, {
    openCloudModal,
    closeCloudModal,
    openCloudFromAiModal,
    handleCloudUrlInput,
    testCloudHealth,
    cloudCreateVault,
    cloudSignInAndLoad,
    cloudSaveNow,
    requestCloudReload,
    cancelCloudReload,
    confirmCloudReload,
    handleCloudAutoSaveToggle,
    cloudChangePin,
    requestCloudDelete,
    cancelCloudDelete,
    confirmCloudDelete,
    cloudLockSignOut
  });

  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", initCloudSync);
  } else {
    initCloudSync();
  }
})();
