/**
 * Stack of open overlays (booster stage, modals). Escape closes the top one;
 * navigating to another page closes them all.
 */
const layers = [];

export function pushLayer(close) {
  const layer = { close };
  layers.push(layer);
  return () => {
    const index = layers.indexOf(layer);
    if (index !== -1) layers.splice(index, 1);
  };
}

export function closeAllLayers() {
  for (const layer of [...layers].reverse()) layer.close();
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && layers.length) {
    event.preventDefault();
    layers.at(-1).close();
  }
});
