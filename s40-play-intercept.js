/*
 * File:     s40-play-intercept.js
 * Purpose:  S40-IBE Jellyfin play intercept — redirects play events to the
 *           S40 Shaka Player page instead of the native Jellyfin video player.
 *           Intercepts /Items/{id}/PlaybackInfo requests via fetch and
 *           XMLHttpRequest wrappers installed before Jellyfin initialises.
 * Author:   MCAI
 * Created:  12-Mar-2026
 * Modified: 12-Mar-2026
 *
 * Repository: SouthForty-IBE-JellyfinPlugin (public)
 *
 * Copyright 2026 South Forty Transportation Ltd.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * ============================================================================
 * INSTALL
 * ============================================================================
 *
 *  1. Copy this file to the Jellyfin web root:
 *       Linux apt/dnf: /usr/share/jellyfin/web/s40-play-intercept.js
 *       Windows:       C:\Program Files\Jellyfin\Server\jellyfin-web\s40-play-intercept.js
 *       Docker:        mount into /jellyfin/jellyfin-web/ (or wherever your
 *                      web root is mapped)
 *
 *  2. Add the following <script> tag to Jellyfin's index.html, as early as
 *     possible — place it at the end of <head> or immediately before
 *     Jellyfin's first <script> tag. It MUST load before any Jellyfin
 *     script, because the intercept wraps window.fetch before Jellyfin
 *     initialises. Placing it after Jellyfin's scripts creates a race
 *     condition where a PlaybackInfo request can fire before the intercept
 *     is installed:
 *
 *       <script src="s40-play-intercept.js"></script>
 *
 * UNINSTALL
 *   Remove the <script> tag from index.html and delete this file.
 *   No other changes are required.
 *
 * JELLYFIN VERSION COMPATIBILITY
 *   The /Items/{id}/PlaybackInfo URL pattern is stable across Jellyfin
 *   10.8, 10.9, and 10.10. The intercept does not depend on any internal
 *   Jellyfin API, module, or global variable.
 *
 * ============================================================================
 * HOW IT WORKS
 * ============================================================================
 *
 *  When a passenger taps Play on a Jellyfin title, the Jellyfin web client
 *  sends a POST to /Items/{itemId}/PlaybackInfo to ask the server which
 *  stream format to use. This script intercepts that request before it
 *  reaches the server:
 *
 *    1. window.fetch is wrapped. Any call whose URL matches
 *       /Items/{id}/PlaybackInfo is captured; all other calls pass through
 *       to the original fetch unchanged.
 *
 *    2. XMLHttpRequest.prototype.open is also wrapped as a belt-and-suspenders
 *       measure for older Jellyfin code paths that use XHR instead of fetch.
 *       Matching XHR calls are redirected to GET /player/ (a harmless 200
 *       response) so the XHR completes cleanly without triggering errors.
 *
 *    3. On intercept, s40HandlePlayIntent() extracts the item ID, attempts to
 *       read the item title from the Jellyfin detail page DOM, and redirects
 *       the browser to the S40 Shaka Player page:
 *         /player/?id={itemId}&title={encodedTitle}
 *
 *    4. The Shaka Player page handles the ?id= param. On playback end or
 *       back-button press, the passenger is returned to the Jellyfin catalogue
 *       at /movies/.
 *
 *  The intercept has zero effect on every other Jellyfin function: browsing,
 *  search, user management, audio playback, photo viewer, and all other
 *  features pass through completely unmodified.
 */

'use strict';

// =============================================================================
// Operator constants — update to match operator.conf when deploying
// =============================================================================

/** Base URL of the S40 Shaka Player page. Trailing slash required. */
var S40_PLAYER_BASE_URL = '/player/';

/**
 * Regex that matches the Jellyfin PlaybackInfo endpoint URL.
 * Capture group 1 is the item ID (hex string).
 * The pattern is stable across Jellyfin 10.8–10.10.
 */
var S40_PLAYBACK_INFO_RE = /\/Items\/([0-9a-f]+)\/PlaybackInfo/i;

// =============================================================================
// Play intent handler
// =============================================================================

/**
 * Called when a PlaybackInfo request is intercepted. Extracts the item title
 * from the current Jellyfin detail page DOM (best-effort), then redirects the
 * browser to the S40 Shaka Player page with the item ID and title as query
 * parameters.
 *
 * The Shaka Player page receives:
 *   ?id={itemId}        — Jellyfin item ID (hex string)
 *   &title={title}      — URL-encoded display name (empty string if not found)
 *
 * @param {string} ItemId       - Jellyfin item ID extracted from the intercepted URL
 * @param {string} OriginalUrl  - The full intercepted URL (used for debug logging only)
 */
function s40HandlePlayIntent(ItemId, OriginalUrl) {
    // --- Extract item title from the Jellyfin detail page DOM ----------------
    //
    // Jellyfin sets the page <title> to the item name when the user is on
    // the item detail page. Several CSS selectors are tried in order of
    // reliability; if none match we fall back to an empty string.
    // The Shaka Player page handles an empty title gracefully.

    var Title = '';

    // Strategy 1: primary heading on the item detail page (Jellyfin 10.8–10.10)
    var HeadingEl = document.querySelector(
        '.itemName, ' +
        '.detailPagePrimaryContainer h1, ' +
        '.nameContainer h1, ' +
        'h1.itemName'
    );
    if (HeadingEl && HeadingEl.textContent.trim()) {
        Title = HeadingEl.textContent.trim();
    }

    // Strategy 2: fall back to document.title, stripping the " - Jellyfin" suffix
    if (!Title && document.title) {
        Title = document.title.replace(/\s*[-–|]\s*Jellyfin\s*$/i, '').trim();
    }

    // Strategy 3: look for a data attribute containing the item ID
    if (!Title) {
        var DataEl = document.querySelector('[data-id="' + ItemId + '"]');
        if (DataEl && DataEl.textContent.trim()) {
            Title = DataEl.textContent.trim();
        }
    }

    // --- Build the player URL and redirect -----------------------------------

    var PlayerUrl = S40_PLAYER_BASE_URL +
        '?id=' + encodeURIComponent(ItemId) +
        '&title=' + encodeURIComponent(Title);

    console.log('[S40-INTERCEPT] Play intercepted — itemId=' + ItemId +
        ' title="' + Title + '" → ' + PlayerUrl);

    window.location.href = PlayerUrl;
}

// =============================================================================
// window.fetch intercept
// =============================================================================

(function () {
    // Capture the original fetch before any other script can see our wrapper.
    // This IIFE runs synchronously at script load time.
    var OriginalFetch = window.fetch;

    window.fetch = function S40FetchIntercept(Input, Init) {
        // Resolve the URL string from either a string argument or a Request object.
        var Url = (typeof Input === 'string')
            ? Input
            : (Input && typeof Input.url === 'string' ? Input.url : '');

        var Match = Url.match(S40_PLAYBACK_INFO_RE);
        if (Match) {
            // Intercept: redirect to Shaka Player.
            // Return a Promise that never resolves — this prevents the Jellyfin
            // playback pipeline from receiving a response and proceeding to load
            // the native player. The browser navigates away before the Promise
            // would ever settle.
            s40HandlePlayIntent(Match[1], Url);
            return new Promise(function () {});
        }

        // Pass all non-PlaybackInfo requests through unchanged.
        return OriginalFetch.apply(this, arguments);
    };

    console.log('[S40-INTERCEPT] fetch intercept installed');
}());

// =============================================================================
// XMLHttpRequest intercept (belt-and-suspenders for XHR code paths)
// =============================================================================

(function () {
    // Capture the original XHR open method before any other script runs.
    var OriginalOpen = XMLHttpRequest.prototype.open;

    XMLHttpRequest.prototype.open = function S40XhrIntercept(Method, Url) {
        var Match = (typeof Url === 'string') ? Url.match(S40_PLAYBACK_INFO_RE) : null;
        if (Match) {
            // Intercept: redirect to Shaka Player.
            // Redirect this XHR to GET /player/ so it completes with a clean
            // 200 response instead of hanging or erroring. The browser navigates
            // away immediately after s40HandlePlayIntent, so this XHR result is
            // never observed by Jellyfin.
            s40HandlePlayIntent(Match[1], Url);
            // Replace the URL with a harmless GET to /player/ so the XHR
            // does not generate a network error in the browser console.
            var NewArguments = Array.prototype.slice.call(arguments);
            NewArguments[0] = 'GET';
            NewArguments[1] = S40_PLAYER_BASE_URL;
            return OriginalOpen.apply(this, NewArguments);
        }

        // Pass all non-PlaybackInfo XHR calls through unchanged.
        return OriginalOpen.apply(this, arguments);
    };

    console.log('[S40-INTERCEPT] XMLHttpRequest intercept installed');
}());
