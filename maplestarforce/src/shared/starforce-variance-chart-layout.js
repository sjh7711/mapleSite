// Keep the canvas and baseline stable when changing graph modes. Annotation
// rows may use more space inside the canvas, but must not resize the dialog.
export function varianceChartFrame(width, { externalControls = false } = {}) {
  const viewWidth = Math.max(240, width);
  const top = externalControls ? 28 : viewWidth < 340 ? 104 : 56;
  const bottom = top + 336;
  return { width: viewWidth, top, bottom, height: bottom + 48 };
}

// Use screen pixels so guide lines are equally easy to select at every width.
export function nearbyVarianceMarker(markers, position, scale = 1, positionOf = (marker) => marker.x) {
  let closest = null, distance = Infinity;
  for (const marker of markers) {
    const nextDistance = Math.abs(positionOf(marker) - position) * scale;
    if (nextDistance <= 3 && nextDistance < distance) {
      closest = marker; distance = nextDistance;
    }
  }
  return closest;
}
