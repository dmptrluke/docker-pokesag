import React from 'react';

/**
 * Hash a string to a consistent HSL color using FNV-1a.
 * FNV-1a has good avalanche properties — even very similar strings
 * (e.g. "1140792" vs "1140587") produce wildly different hashes.
 * Saturation and lightness are also varied using different hash bits.
 */
export function recipientColor(str) {
    let h = 0x811c9dc5; // FNV-1a offset basis
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193); // FNV-1a prime
    }
    h = h >>> 0; // unsigned 32-bit

    const hue = h % 360;
    const sat = 55 + ((h >>> 16) % 4) * 10; // 55, 65, 75, or 85%
    const lit = 55 + ((h >>> 24) % 3) * 8; // 55, 63, or 71%

    return `hsl(${hue}, ${sat}%, ${lit}%)`;
}
/**
 * Hover tooltip system.
 *
 * Load a mapping of tokens -> tooltip text from `public/hoverCodes.json`.
 * The JSON file should be either a mapping object or contain a top-level
 * `codes` object. Example:
 *   { "codes": { "HAPPY": "The User is Happy", "LOLX": "Lots of Love for my Ex" } }
 *
 * Any token in the mapping will be matched as a whole word and wrapped with
 * a <span> carrying the tooltip in `data-tooltip`.
 */
let TOOLTIP_REGEX = null;
let TOOLTIP_MAP = {};
fetch('/hoverCodes.json')
    .then(res => (res.ok ? res.json() : null))
    .then(data => {
        if (!data) return;
        const map = data.codes || data;
        TOOLTIP_MAP = map || {};
        const keys = Object.keys(TOOLTIP_MAP || {}).filter(Boolean);
        if (keys.length) {
            const escaped = keys.map(k => k.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&'));
            // match keys (with optional trailing alphabetic suffix (e.g. 21D05M)
            TOOLTIP_REGEX = new RegExp(`\\b(${escaped.join('|')})(?:[A-Z]+)?\\b`, 'g');
        }
    })
    .catch(() => {
        // If fetch fails, TOOLTIP_REGEX remains empty and no annotations occur
    });
/**
 * Annotate message text by replacing recognised tokens with tooltip spans.
 *
 * - Uses the pre-built `TOOLTIP_REGEX` to find tokens (with optional trailing
 *   alphabetic suffixes, e.g. `21D05M`).
 * - Looks up the tooltip in `TOOLTIP_MAP` by exact token, falling back to the
 *   base token with trailing letters removed.
 * - Returns either the original `text` or an array of strings and React
 *   elements (<span className="code-badge" data-tooltip=...>) suitable for
 *   rendering inside JSX.
 */
export function annotateMessage(text) {
    if (!text || !TOOLTIP_REGEX) return text;
    const out = [], re = TOOLTIP_REGEX;
    re.lastIndex = 0; let m, i = 0, last = 0;
    while ((m = re.exec(text)) !== null) {
        if (m.index > last) out.push(text.slice(last, m.index));
        const token = m[0];
        const tip = TOOLTIP_MAP[token] || TOOLTIP_MAP[token.replace(/[A-Z]+$/, '')];
        out.push(tip ? <span key={`hc${i++}`} className="code-badge" data-tooltip={tip}>{token}</span> : token);
        last = re.lastIndex;
    }
    if (last < text.length) out.push(text.slice(last));
    return out.length ? out : text;
}
