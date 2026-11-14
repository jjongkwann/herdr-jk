// Tab widths for the strip, in px at zoom 1: full width when there is room, down to about a pinned-tab size.
// Below TAB_ICONS a tab drops its icons; the active tab keeps up to TAB_ACTIVE for its close button.
export const TAB_MAX = 190, TAB_MIN = 84, TAB_ICONS = 120, TAB_ACTIVE = 150;
// The "+" cell right after the last tab.
export const NEW_TAB = 36;

// Flex shrink does not reach tabs inside the scroll strip, so the tabs share what the measured strip
// leaves after the panel buttons and "+": they shrink toward TAB_MIN before the strip scrolls.
// Measured sizes include the UI zoom; widths set in style don't. Returns { tab, active } (the active tab's width).
export function tabWidths(count, strip, panels, zoom) {
  const room = (strip - panels) / (zoom || 1) - NEW_TAB;
  if (!(count > 0 && room > 0)) return { tab: TAB_MAX, active: TAB_MAX };
  const clamp = w => Math.max(TAB_MIN, Math.min(TAB_MAX, Math.floor(w)));
  const tab = clamp(room / count);
  if (count === 1 || tab >= TAB_ACTIVE) return { tab, active: tab };
  // The active tab also holds its close button, so it gets a little more when the others can spare it.
  const active = Math.floor(Math.min(TAB_ACTIVE, room - (count - 1) * TAB_MIN));
  const rest = clamp((room - active) / (count - 1));
  return { tab: rest, active: Math.max(active, rest) };
}
