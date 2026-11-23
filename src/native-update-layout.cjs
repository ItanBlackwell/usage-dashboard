/*
 * Usage Dashboard
 * Copyright (c) 2026 ItanBlackwell.
 * SPDX-License-Identifier: MPL-2.0
 * Source: https://github.com/ItanBlackwell/usage-dashboard
 */
'use strict';

// The public OpenCode GUI SDK has no placement API for built-in TitlebarItem
// controls. This narrow DOM adapter positions ONLY the native update action
// beside our usage button without moving either DOM node. If OpenCode changes
// its markup, do nothing rather than relocating another plugin's control.
const FOOTER = '[data-slot="vertical-tabs-footer"]';
const PILL = '[data-slot="titlebar-update"]';
const UPDATE_GLYPH = 'path[d^="M7 11V3"]';
const UPDATE_SPINNER = '[data-slot="titlebar-update-loader"]';
const PROPERTIES = ['position', 'top', 'left', 'right', 'bottom', 'margin', 'zIndex'];

function nativeUpdater(root) {
  if (!root?.querySelector) return null;
  const footer = root.querySelector(FOOTER);
  const items = footer?.querySelectorAll?.(PILL);
  // Only take over the footer when it contains exactly one native item. Other
  // GUI extensions may contribute TitlebarItems with the same data-slot.
  if (!items || items.length !== 1) return null;
  const item = items[0];
  if (!item?.querySelector?.(UPDATE_GLYPH) && !item?.querySelector?.(UPDATE_SPINNER)) return null;
  return { footer, item };
}

function createNativeUpdateDock({ gap = 7 } = {}) {
  let previous = null;
  const restore = () => {
    if (!previous) return;
    const { portal, footer, item, portalPosition, footerMarginTop, styles } = previous;
    for (const key of PROPERTIES) item.style[key] = styles[key];
    footer.style.marginTop = footerMarginTop;
    portal.style.position = portalPosition;
    previous = null;
  };

  const sync = (usageWrapper) => {
    try {
      // This is the existing full-height sidebar Portal root, not the outer
      // clipped mount. Its layout remains unchanged for the usage button.
      const portal = usageWrapper?.parentElement || usageWrapper?.parentNode;
      const usageButton = usageWrapper?.querySelector?.('[data-pv-usage-trigger]') || usageWrapper?.children?.[0];
      const found = nativeUpdater(portal);
      if (!found || !usageButton?.getBoundingClientRect || !portal?.getBoundingClientRect) {
        restore();
        return false;
      }
      const { footer, item } = found;
      const frame = portal.getBoundingClientRect();
      const trigger = usageButton.getBoundingClientRect();
      const original = item.getBoundingClientRect?.();
      const width = original?.width > 0 ? original.width : 28;
      const height = original?.height > 0 ? original.height : 28;
      const left = trigger.right - frame.left + gap;
      const top = trigger.top - frame.top + (trigger.height - height) / 2;
      const maxWidth = frame.width || frame.right - frame.left;
      const maxHeight = frame.height || frame.bottom - frame.top;
      if (![left, top, width, height, maxWidth, maxHeight].every(Number.isFinite) ||
          top < 0 || left < 0 || left + width > maxWidth - 3 || top + height > maxHeight) {
        // Very narrow / clipped sidebar: retain native placement rather than
        // overlapping the usage indicator or drawing outside the sidebar.
        restore();
        return false;
      }
      if (previous && (previous.item !== item || previous.portal !== portal)) restore();
      if (!previous) {
        previous = {
          portal, footer, item,
          portalPosition: portal.style.position,
          footerMarginTop: footer.style.marginTop,
          styles: Object.fromEntries(PROPERTIES.map(key => [key, item.style[key]])),
        };
      }
      portal.style.position = 'relative';
      // With the single pill out of flow, the old 8px footer margin should no
      // longer leave an unexplained gap above the bottom row.
      footer.style.marginTop = '0px';
      Object.assign(item.style, {
        position: 'absolute', left: `${Math.round(left)}px`, top: `${Math.round(top)}px`,
        right: 'auto', bottom: 'auto', margin: '0px', zIndex: '35',
      });
      return true;
    } catch {
      // GUI SDK / host markup can change independently of the plugin.
      restore();
      return false;
    }
  };
  return { sync, restore, isDocked: () => !!previous, bounds: () => previous?.item?.getBoundingClientRect?.() };
}

module.exports = { nativeUpdater, createNativeUpdateDock };
