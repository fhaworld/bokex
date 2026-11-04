// One delegated interaction layer for panels, cards and controls, including new page DOM.
const surfaceSelector = [
  ".glass",
  ".moon-button",
  ".article-header",
  ".search-label",
  ".date-field",
  ".sort-fields",
  ".prose pre",
  ".music-track",
  ".background-message",
].join(",");

interface GlassSurface {
  element: HTMLElement;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  energy: number;
  targetEnergy: number;
  tiltX: number;
  tiltY: number;
}

const surfaces = new Map<HTMLElement, GlassSurface>();
const movingSurfaces = new Set<GlassSurface>();
const reduce = matchMedia("(prefers-reduced-motion: reduce)");
const fine = matchMedia("(hover: hover) and (pointer: fine)");
let active: GlassSurface | null = null;
let frame = 0;
let previousTime = 0;
let lastPointer: { x: number; y: number } | null = null;
const permitsSurfaceMotion = () =>
  !reduce.matches &&
  fine.matches &&
  document.documentElement.dataset.motion !== "off" &&
  document.documentElement.clientWidth > 700;

function ensureSurface(element: HTMLElement): GlassSurface {
  const existing = surfaces.get(element);
  // Status messages can replace their text content after the surface was registered.
  if (existing && element.querySelector(":scope > .surface-light"))
    return existing;
  const reader = element.matches(
    ".article-body, .about-panel, .journal-results",
  );
  element.dataset.glassSurface = reader
    ? "reader"
    : element.matches("button, summary, .moon-button")
      ? "control"
      : "panel";
  if (getComputedStyle(element).position === "static")
    element.classList.add("surface-positioned");
  if (!element.querySelector(":scope > .surface-light")) {
    const light = document.createElement("span");
    light.className = "surface-light";
    light.setAttribute("aria-hidden", "true");
    element.prepend(light);
  }
  if (existing) return existing;
  const surface: GlassSurface = {
    element,
    x: 0.55,
    y: -1,
    targetX: 0.55,
    targetY: -1,
    energy: 0,
    targetEnergy: 0,
    tiltX: 0,
    tiltY: 0,
  };
  surfaces.set(element, surface);
  return surface;
}

function measure(surface: GlassSurface) {
  const { element } = surface;
  const width = Math.max(1, element.offsetWidth);
  const height = Math.max(1, element.offsetHeight);
  const readingWeight = element.dataset.glassSurface === "reader" ? 0.25 : 1;
  // Bound displacement on large panels; small controls can have a little more depth.
  surface.tiltX = Math.min(0.65, 220 / height) * readingWeight;
  surface.tiltY = Math.min(0.75, 280 / width) * readingWeight;
  element.style.setProperty(
    "--surface-wash-x",
    `${Math.min(420, Math.max(110, width * 0.7))}px`,
  );
  element.style.setProperty(
    "--surface-wash-y",
    `${Math.min(240, Math.max(70, height * 0.7))}px`,
  );
}

function deactivate() {
  if (!active) return;
  active.targetX = 0.55;
  active.targetY = -1;
  active.targetEnergy = 0;
  movingSurfaces.add(active);
  active = null;
}

function pickSurface(target: Element | null, x: number, y: number) {
  const element = target?.closest<HTMLElement>(surfaceSelector);
  const surface = element ? ensureSurface(element) : null;
  if (surface !== active) {
    deactivate();
    active = surface;
    if (active) measure(active);
  }
  if (surface) {
    const rect = surface.element.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    surface.targetX = Math.min(
      1,
      Math.max(-1, ((x - rect.left) / rect.width) * 2 - 1),
    );
    surface.targetY = Math.min(
      1,
      Math.max(-1, ((y - rect.top) / rect.height) * 2 - 1),
    );
    surface.targetEnergy = 1;
    movingSurfaces.add(surface);
  }
  wakeSurfaces();
}

function wakeSurfaces() {
  if (
    !frame &&
    movingSurfaces.size &&
    permitsSurfaceMotion() &&
    !document.hidden
  ) {
    previousTime = performance.now();
    frame = requestAnimationFrame(tickSurfaces);
  }
}

function tickSurfaces(now: number) {
  frame = 0;
  if (!permitsSurfaceMotion() || document.hidden) return;
  const delta = Math.min(0.08, (now - previousTime) / 1000);
  previousTime = now;
  const ease = 1 - Math.exp(-delta * 7);
  movingSurfaces.forEach((surface) => {
    if (!surface.element.isConnected) {
      movingSurfaces.delete(surface);
      surfaces.delete(surface.element);
      return;
    }
    surface.x += (surface.targetX - surface.x) * ease;
    surface.y += (surface.targetY - surface.y) * ease;
    surface.energy += (surface.targetEnergy - surface.energy) * ease;
    const style = surface.element.style;
    style.setProperty("--surface-light-x", `${50 + surface.x * 44}%`);
    style.setProperty("--surface-light-y", `${50 + surface.y * 62}%`);
    style.setProperty("--surface-energy", String(surface.energy));
    style.setProperty(
      "--surface-rotate-x",
      `${-surface.y * surface.tiltX * surface.energy}deg`,
    );
    style.setProperty(
      "--surface-rotate-y",
      `${surface.x * surface.tiltY * surface.energy}deg`,
    );
    const unsettled =
      Math.abs(surface.targetX - surface.x) +
      Math.abs(surface.targetY - surface.y) +
      Math.abs(surface.targetEnergy - surface.energy);
    if (unsettled < 0.002) movingSurfaces.delete(surface);
  });
  wakeSurfaces();
}

function bindSurfaces() {
  deactivate();
  surfaces.forEach((surface, element) => {
    if (!element.isConnected) {
      movingSurfaces.delete(surface);
      surfaces.delete(element);
    }
  });
  document
    .querySelectorAll<HTMLElement>(surfaceSelector)
    .forEach(ensureSurface);
  wakeSurfaces();
}

document.addEventListener(
  "pointermove",
  (event) => {
    if (
      !permitsSurfaceMotion() ||
      event.pointerType === "touch" ||
      event.buttons
    )
      return;
    lastPointer = { x: event.clientX, y: event.clientY };
    pickSurface(
      event.target instanceof Element ? event.target : null,
      event.clientX,
      event.clientY,
    );
  },
  { passive: true },
);
document.documentElement.addEventListener("pointerleave", () => {
  lastPointer = null;
  deactivate();
  wakeSurfaces();
});
document.addEventListener(
  "scroll",
  () => {
    if (!lastPointer || !permitsSurfaceMotion()) return;
    pickSurface(
      document.elementFromPoint(lastPointer.x, lastPointer.y),
      lastPointer.x,
      lastPointer.y,
    );
  },
  { capture: true, passive: true },
);
addEventListener(
  "resize",
  () => {
    if (active) measure(active);
    if (!permitsSurfaceMotion()) deactivate();
    wakeSurfaces();
  },
  { passive: true },
);

function syncSurfaceMotion() {
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
  wakeSurfaces();
}
new MutationObserver(syncSurfaceMotion).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ["data-motion"],
});
document.addEventListener("visibilitychange", syncSurfaceMotion);
reduce.addEventListener("change", syncSurfaceMotion);
fine.addEventListener("change", syncSurfaceMotion);
document.addEventListener("astro:before-swap", deactivate);
// Other page-load handlers can first create playlist rows and code-copy buttons.
document.addEventListener("astro:page-load", () =>
  queueMicrotask(bindSurfaces),
);
