const selection = document.getElementById("selection");
const cancel = document.getElementById("cancel");
let startX = 0;
let startY = 0;
let dragging = false;

function rectFrom(a, b, c, d) {
  return { x: Math.min(a, c), y: Math.min(b, d), width: Math.abs(c - a), height: Math.abs(d - b) };
}

function render(rect) {
  selection.style.display = "block";
  selection.style.left = `${rect.x}px`;
  selection.style.top = `${rect.y}px`;
  selection.style.width = `${rect.width}px`;
  selection.style.height = `${rect.height}px`;
}

function finish(rect) {
  dragging = false;
  if (!rect || rect.width < 3 || rect.height < 3) {
    window.radimoSnip.cancel();
    return;
  }
  window.radimoSnip.finish(rect);
}

window.addEventListener("mousedown", (event) => {
  if (event.button !== 0 || event.target === cancel) return;
  dragging = true;
  startX = event.clientX;
  startY = event.clientY;
  render({ x: startX, y: startY, width: 0, height: 0 });
});
window.addEventListener("mousemove", (event) => {
  if (dragging) render(rectFrom(startX, startY, event.clientX, event.clientY));
});
window.addEventListener("mouseup", (event) => {
  if (dragging) finish(rectFrom(startX, startY, event.clientX, event.clientY));
});
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") window.radimoSnip.cancel();
});
cancel.addEventListener("mousedown", (event) => { event.preventDefault(); event.stopPropagation(); window.radimoSnip.cancel(); });
