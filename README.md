# WorldFinder - Next-Gen Branch

This repository holds the completely rewritten, non-compromised frontend build for WorldFinder. 

## Architectural Refactoring Summary

1. **Unidirectional Data Flow:** Removed all UI-to-UI bindings. The user interface elements (Map Layers and Proximity Text Blocks) are fully decoupled passive listeners that render output data exclusively sourced out of a master mapping data structure tracking runtime engine records (`appState.pins`).
2. **Eliminated Scraped Elements:** Wiped out all hidden DOM container sandboxes and regex parsing logic loops.
3. **Native Live Subscriptions:** Configured direct state pipeline syncing inside `.subscribe('*')` blocks to process incoming real-time record creations, soft-deletes (`DELETED_BY_OWNER`), and hard deletions instantly at millisecond speeds.

## Local Infrastructure Testing Notice

* This code completely discards background polling fallback intervals (`setInterval`).
* **Hugging Face Testing Limitation:** If you run this file directly against your archived Hugging Face backend server instance, you will notice your actions update your *local* screen instantly via client triggers, but remote browsers will not refresh automatically because the server-side socket channel handshake remains buffered by the provider proxy.
* This branch is fully optimized and structurally ready out-of-the-box for unbuffered, raw TCP container environments.
