/**
 * Single source of truth for the app version — shown in the footer and used
 * to name the service worker cache, so a deploy only ever needs one number
 * bumped and the footer always agrees with what's actually cached. Loaded
 * as a classic script in both the page (where `self` === `window`) and the
 * service worker (via importScripts, where `self` is the worker's global
 * scope) — same file, same assignment, both contexts.
 */
self.APP_VERSION = 'v20';
