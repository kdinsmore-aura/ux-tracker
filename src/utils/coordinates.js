/**
 * @module coordinates
 * @description
 * Coordinate math for click tracking.
 *
 * Two concerns are handled here:
 *   1. Capturing rich coordinate data from a live click event.
 *   2. Projecting stored click coordinates onto a reference screenshot for
 *      heatmap rendering in the dashboard.
 */

/**
 * Extract a complete coordinate snapshot from a native MouseEvent.
 *
 * normalizedX / normalizedY express the click position as a fraction (0–1)
 * of the clicked element's own bounding box — useful for heatmaps that must
 * survive layout reflows between recording and playback.
 *
 * @param {MouseEvent} mouseEvent
 * @returns {{
 *   viewportX: number,
 *   viewportY: number,
 *   pageX: number,
 *   pageY: number,
 *   scrollX: number,
 *   scrollY: number,
 *   normalizedX: number,
 *   normalizedY: number
 * }}
 */
export function captureClickCoordinates(mouseEvent) {
  const rect = mouseEvent.target.getBoundingClientRect();

  let normalizedX, normalizedY;
  if (rect.width === 0 || rect.height === 0) {
    normalizedX = 0.5;
    normalizedY = 0.5;
  } else {
    normalizedX = Math.max(0, Math.min(1, (mouseEvent.clientX - rect.left) / rect.width));
    normalizedY = Math.max(0, Math.min(1, (mouseEvent.clientY - rect.top) / rect.height));
  }

  return {
    viewportX: mouseEvent.clientX,
    viewportY: mouseEvent.clientY,
    pageX: mouseEvent.pageX,
    pageY: mouseEvent.pageY,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    normalizedX,
    normalizedY,
  };
}

/**
 * Map a stored click event's viewport coordinates onto the pixel space of a
 * reference screenshot.
 *
 * The screenshot is a 1:1 pixel capture of the browser viewport taken at
 * `screenshotViewportWidth × screenshotViewportHeight`, so click coordinates
 * recorded in that same viewport map directly without scaling.
 *
 * @param {{ viewportX: number, viewportY: number }} event
 *   A stored event object as produced by captureClickCoordinates.
 * @param {number} screenshotViewportWidth
 *   Viewport width (px) at the time the screenshot was captured.
 * @param {number} screenshotViewportHeight
 *   Viewport height (px) at the time the screenshot was captured.
 * @returns {{ x: number, y: number }}
 *   Pixel coordinates on the screenshot canvas.
 */
export function projectToScreenshot(event, screenshotViewportWidth, screenshotViewportHeight) {
  return {
    x: event.viewportX,
    y: event.viewportY,
  };
}
