# AGENTS.md - Development Guidelines & Invariants

> Operational directives and architecture invariants for AI agents working in `quran-transcriber`. Keep this file aligned with the codebase.

---

## 1. Non-Negotiable Principles

| Principle | Invariant & Enforced Rule |
|---|---|
| `pnpm-only` | Use `pnpm` exclusively. Never run `npm`, `npx`, or bare `node`. |
| `blink-audio-track` | `recognition.start(currentTrack)` is mandatory in `offscreen/main.ts`. Bare `recognition.start()` routes audio to the hardware mic and breaks verse matching. |
| `webaudio-loopback` | Forward tab `mediaStream` to `AudioContext.destination` via `createMediaStreamSource()`. Do not use `<audio>` tags for loopback. |
| `offscreen-handshake` | Background must establish offscreen via `MSG.OFFSCREEN_READY` (5s timeout). Do not rely solely on `getContexts()`. |
| `offline-first` | `loadActiveEditions()` reads strictly from IndexedDB (`idb-keyval`). Zero network requests during state hydration. |
| `sync-render-loop` | `renderAyah()` accesses translations synchronously from memory (`activeEditions`). No async I/O or IDB reads during active recitation rendering. |
| `memoized-dom` | Check `renderedAyahKey` before DOM manipulation to prevent redundant redraws during high-frequency ASR firing. |
| `blank-card-safeguard` | Arabic cannot be toggled off if no translation or transliteration is active. Auto-restore Arabic if all other layers are removed. |
| `w3c-bidi-isolated` | Dynamic text and numeric badges (`2:255 (1/7)`) must use `<bdi>` or `dir="ltr"` to prevent Unicode UBA neutral character flipping. |
| `least-privilege` | `host_permissions` scoped strictly to `['https://api.alquran.cloud/*']`. Never use `<all_urls>`. |
| `no-inline-code` | Chrome CSP strictly forbids inline `<script>` tags and inline event handlers (`onclick="..."`). Attach all listeners via `addEventListener`. |

---

## 2. Tooling & Verification

Pre-commit verification gate (all must pass with zero errors):
```bash
pnpm test                  # Vitest suite (46 unit tests)
pnpm exec tsc --noEmit     # TypeScript typecheck
pnpm exec biome check      # Linter and formatting check
pnpm run build             # WXT MV3 production bundle build
```
- Commands requiring network or full filesystem access must specify `BypassSandbox: true`.

---

## 3. Audio & High-Frequency Event Invariants

```typescript
// entrypoints/offscreen/main.ts
recognition.start(currentTrack); // Blink-specific API (speech_recognition.cc:L140)

// Web Audio loopback: preserves tab sound for the user without latency
audioContext = new AudioContext();
audioSource = audioContext.createMediaStreamSource(mediaStream);
audioSource.connect(audioContext.destination);
if (audioContext.state === 'suspended') void audioContext.resume();
```

- **Loopback Mechanism**: Uses the Web Audio API (`AudioContext` + `createMediaStreamSource`). Resumes suspended audio contexts automatically.
- **Bounded NLP Scanner**: The sliding context buffer in `recognition.onresult` must stay strictly bounded (inspecting only the latest 2-3 segments) so `matcher.match()` completes in <10ms on the Blink renderer thread, preventing audio buffer underruns.
- **IPC Minimization**: Do not broadcast high-frequency interim speech transcripts across IPC if no UI consumer displays them. Emit only matched verses (`MSG.AYAH_MATCH`) and error states.

---

## 4. UI/UX, Typography & W3C BiDi Rules

- **Bundled Mushaf Font**: Arabic Quranic text requires the bundled Uthmanic font (`/fonts/UthmanTN_v2-0.ttf`) declared via `@font-face` and `--font-mushaf`:
  ```css
  font-family: var(--font-mushaf); /* "Uthmanic", "Amiri", "Traditional Arabic", serif */
  text-rendering: optimizeLegibility;
  font-feature-settings: "liga" 1, "calt" 1;
  -webkit-font-smoothing: antialiased;
  ```
- **Language Endonyms**: Always render language options in their native script (`العربية`, `English`, `Français`, `اردو`, `Bahasa Indonesia`, `Türkçe`, `Deutsch`, `Español`, `Русский`) via `getLanguageEndonym()`.
- **Subtle Attribution**: Keep the language endonym as the primary label on translation cards. Avoid bulky author names in the main viewport.
- **HTML `dir` Priority**: Declare directional context via HTML attribute (`dir="rtl"` or `dir="ltr"`), never solely via CSS `direction: rtl` (W3C Recommendation: *Specifying the direction of text and tables*).
- **CSS Logical Properties**: Author all layouts with logical properties (`text-align: start`, `margin-inline-start`, `padding-inline-end`, `inset-inline-start`). Never introduce physical `left` or `right` layout constraints.
- **Neutral Character Transposition (Unicode UBA §3.3.4)**: Colons, slashes, and parentheses are weakly directional/neutral. In RTL document contexts (e.g. Arabic UI locale), compound identifiers like `ayahBadgeEl` (`2:255 (1/7)`) risk transposing to `(7/1) 255:2`. Explicitly wrap or isolate numeric badges with `<bdi dir="ltr">`.

---

## 5. Data Lifecycle & Test Environment

- **Strict Validation**: All edition payloads must pass `validateAndFlattenEdition()` checking: HTTP 200, 114 Surahs, exact Surah ayah counts, and exact total of 6,236 Ayahs.
- **Storage Prefixes**: Use `wxt/storage`:
  - `session:captureState`, `session:activeTabId`, `session:transcript`, `session:matchedAyah`
  - `local:userEditionPreferences`
- **SW Ephemerality**: The MV3 background service worker terminates after ~30s of inactivity. Never store state in module-level variables.
- **Test Isolation**: Centralize `fake-indexeddb/auto` and global IDB state cleanup hooks (`setupFiles` in `vitest.config.ts`) rather than relying on manual per-test deletion.

---

## 6. Subsystems Map

| Directory / File | Role | Key APIs / Patterns |
|---|---|---|
| `entrypoints/background/` | MV3 Service worker | State machine (`idle → starting → capturing → stopping → idle`), tabCapture orchestration, message routing |
| `entrypoints/offscreen/` | Audio processing | Web Audio loopback, continuous Blink SpeechRecognition, exponential backoff reconnection |
| `entrypoints/sidepanel/` | User interface | Display bar (`[عربي]`, `[Aa]`, native select), ayah card, settings modal download manager |
| `lib/matcher.ts` | Retrieval engine | In-memory token-based verse matching (sub-millisecond across 6,236 Ayahs) |
| `lib/normalize.ts` | Arabic NLP | Tashkeel removal, alef normalization, character collapsing |
| `lib/quran-meta.ts` | Corpus metadata | 114 Surahs catalog, ayah counts, Sajdah verses |
| `lib/editions.ts` | Multilingual layer | Curated editions catalog, AlQuran Cloud API client, IndexedDB caching |
| `lib/state.ts` | Shared state | WXT reactive storage definitions |
| `lib/messages.ts` | Messaging | Inter-context message types |
| `public/fonts/` | Typography | Bundled `UthmanTN_v2-0.ttf` font asset |
| `public/_locales/` | Localization | Chrome i18n bundles (`en`, `ar`) |
