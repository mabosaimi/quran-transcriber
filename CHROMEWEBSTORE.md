# Chrome Web Store Listing & Compliance Guide

Single source of truth for the Chrome Web Store submission, listing metadata, plain-English permission justifications, and privacy disclosures for **Quran Transcriber**.

---

## 1. Store Listing Metadata

| Field | Value | Constraints |
|---|---|---|
| **Name** | Quran Transcriber | Max 45 characters |
| **Short Description** | Follow along with Quran recitations in real time via tab audio recognition, with translations and transliteration. | Max 132 characters (currently 115 chars) |
| **Primary Category** | Productivity | Chrome Web Store standard category |
| **Secondary Category** | Accessibility | Optional secondary category |
| **Default Language** | English (en) | Supported: English (`en`), Arabic (`ar`) |

---

## 2. Detailed Store Description

```markdown
Follow along with Quran recitations effortlessly. Quran Transcriber listens to any Quran recitation playing in your browser tabs-whether on YouTube, Quran.com, or streaming audio-and synchronizes the recited verse in real time in your Chrome side panel.

KEY FEATURES:
• Real-Time Recitation Tracking: Captures audio from your active tab and matches recited verses instantly with sub-millisecond local search.
• Preserved Tab Audio: Tab audio remains completely audible through the Web Audio API without latency, feedback, or echo.
• Multilingual Translations: Choose from curated translations across 8 languages, displayed in their authentic native scripts:
  - Arabic (العربية)
  - English (Saheeh International)
  - French (Français - Muhammad Hamidullah)
  - Urdu (اردو - Fateh Muhammad Jalandhry)
  - Indonesian (Bahasa Indonesia - Kemenag)
  - Turkish (Türkçe - Diyanet İşleri)
  - German (Deutsch - Bubenheim & Elyas)
  - Spanish (Español - Julio Cortes)
  - Russian (Русский - Elmir Kuliev)
• English Transliteration: Display phonetic Latin transliteration to assist non-Arabic readers with pronunciation.
• Flexible Display Layouts: Easily customize your view to show Arabic only, translation only, or both together with transliteration.
• Offline-First Design: Download translations once for offline use. Once saved, verse matching and reading require zero internet connection.
• Authentic Mushaf Typography: Rendered using the bundled Uthmanic font with traditional ayah glyph markers and Sajdah prostration badges.

PRIVACY & LOCAL PROCESSING:
Quran Transcriber respects your privacy. All audio analysis and speech recognition run entirely on your local machine. No audio recordings, microphone feeds, or personal data are ever recorded, stored, or sent to external servers.
```

---

## 3. Single-Purpose Description

> **Single Purpose**: Real-time identification and synchronized display of Quranic verses and translations from tab audio playback.

The extension strictly confines its operation to capturing browser tab recitation audio upon user initiation, matching the recitation against a bundled Quran corpus, and rendering the matching verse in a side panel.

---

## 4. Permission Justifications

Chrome Web Store reviewers require specific, plain-English technical justifications for every declared permission:

| Permission / Host | Technical Need | User-Facing Justification |
|---|---|---|
| `tabCapture` | Required to obtain a stream ID via `browser.tabCapture.getMediaStreamId()` for the active tab playing Quran audio. | Used exclusively to capture the audio of the browser tab currently playing recitation, enabled only when you explicitly click "Start Listening". |
| `offscreen` | Required to create an offscreen document (`reasons: ['USER_MEDIA']`) for Web Audio playback and speech recognition. | Service workers cannot directly process audio or run SpeechRecognition in Manifest V3. The offscreen document runs the audio analysis bridge in the background. |
| `sidePanel` | Required to open the reading interface using `browser.sidePanel.open()`. | Displays the synchronized Quran verses, translations, and transliterations in a persistent side panel alongside the user's active browsing tab. |
| `storage` | Required for `wxt/storage` session state and local preferences. | Saves the user's display preferences (selected translation language, transliteration toggle) and maintains the listening session state across browser tab switches. |
| `host_permissions`<br/>`https://api.alquran.cloud/*` | Required to fetch public Quran translation editions from the AlQuran Cloud API. | Used strictly when the user chooses to download a specific translation edition (e.g. French, Urdu) for offline reading in the side panel. No other network requests are ever made. |

---

## 5. Privacy & Data Handling Disclosure

- **Audio Data**: Captured tab audio is processed in real time inside the browser's local sandbox memory. Audio is **never** uploaded, recorded to disk, or transmitted to any third-party server.
- **Personal Information**: Zero personal data, cookies, browser history, or analytics are collected or tracked.
- **External Network Requests**: Limited exclusively to downloading translation text files from `https://api.alquran.cloud/` on explicit user request.
- **Offline Operation**: Once translation packs are cached in local IndexedDB, the extension functions completely offline.
