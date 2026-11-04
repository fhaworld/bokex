// Decorative 2.5D atmosphere over the authored sky, with perspective-projected 3D motes.
// The photograph owns the moon; both atmospheric scattering and glass highlights follow it.
interface Atmosphere {
  resize(width: number, height: number, compact: boolean): void;
  draw(time: number, x: number, y: number): void;
  dispose(): void;
}

const screenVertex = `
  attribute vec2 aPosition;
  varying vec2 vUv;
  void main() {
    vUv = aPosition * 0.5 + 0.5;
    gl_Position = vec4(aPosition, 0.0, 1.0);
  }
`;

const hazeFragment = `
  precision mediump float;
  varying vec2 vUv;
  uniform float uTime;
  uniform float uAspect;
  uniform vec2 uPointer;
  uniform vec2 uMoon;

  float hash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float noise(vec2 p) {
    vec2 cell = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(cell), hash(cell + vec2(1.0, 0.0)), f.x),
      mix(hash(cell + vec2(0.0, 1.0)), hash(cell + 1.0), f.x), f.y);
  }
  float fbm(vec2 p) {
    float value = 0.0;
    float weight = 0.5;
    for (int i = 0; i < 4; i++) {
      value += noise(p) * weight;
      p = mat2(0.8, -0.6, 0.6, 0.8) * p * 2.02 + vec2(7.8, 2.1);
      weight *= 0.5;
    }
    return value;
  }
  void main() {
    vec2 uv = vUv;
    vec2 p = vec2(uv.x * uAspect, uv.y) * vec2(2.6, 3.5);
    vec2 drift = vec2(uTime * 0.011, uTime * -0.003);
    float farLayer = fbm(p + drift + uPointer * 0.05);
    float nearLayer = fbm(p * 1.65 - drift * 0.7 + vec2(12.0, 4.0) + uPointer * 0.15);
    float filaments = smoothstep(0.37, 0.77, farLayer * 0.7 + nearLayer * 0.3);
    vec2 moonDistance = (uv - uMoon) * vec2(uAspect, 1.0);
    float moonlight = exp(-dot(moonDistance, moonDistance) * 3.8);
    float lowerSky = 1.0 - smoothstep(0.12, 0.82, uv.y);
    float veil = exp(-pow((uv.y - 0.2 - farLayer * 0.22) * 4.2, 2.0));
    float alpha = filaments * (lowerSky * 0.19 + moonlight * 0.095) * (0.45 + veil * 0.55);
    vec3 light = mix(vec3(0.18, 0.36, 0.57), vec3(0.42, 0.66, 0.8), moonlight);
    gl_FragColor = vec4(light * alpha, alpha);
  }
`;

const moteVertex = `
  attribute vec3 aPosition;
  attribute float aSize;
  attribute float aPhase;
  uniform float uTime;
  uniform float uAspect;
  uniform float uScale;
  uniform vec2 uPointer;
  varying float vGlow;
  void main() {
    vec3 p = aPosition;
    p.x += sin(uTime * 0.075 + aPhase) * 0.16;
    p.y += sin(uTime * 0.055 + aPhase * 1.7) * 0.12;
    p.xy -= uPointer * 0.33;
    gl_Position = vec4(p.x * 1.7 / uAspect, p.y * 1.7, 0.0, p.z);
    gl_PointSize = max(1.5, aSize * uScale / p.z);
    vGlow = (0.4 + 0.6 / p.z) * (0.7 + 0.3 * sin(uTime * 0.3 + aPhase));
  }
`;

const moteFragment = `
  precision mediump float;
  varying float vGlow;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float halo = exp(-dot(p, p) * 18.0);
    float core = exp(-dot(p * vec2(1.0, 1.35), p * vec2(1.0, 1.35)) * 80.0);
    float alpha = (halo * 0.22 + core * 0.65) * vGlow;
    gl_FragColor = vec4(0.65, 0.87, 1.0, alpha);
  }
`;

function createAtmosphere(canvas: HTMLCanvasElement): Atmosphere | null {
  const gl = canvas.getContext("webgl", {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: "low-power",
  });
  if (!gl) return null;
  const shaders: WebGLShader[] = [];
  const programs: WebGLProgram[] = [];
  const buffers: WebGLBuffer[] = [];
  const dispose = () => {
    buffers.forEach((buffer) => gl.deleteBuffer(buffer));
    programs.forEach((program) => gl.deleteProgram(program));
    shaders.forEach((shader) => gl.deleteShader(shader));
  };
  try {
    const compile = (source: string, type: number) => {
      const shader = gl.createShader(type);
      if (!shader) throw new Error("Could not allocate atmosphere shader");
      shaders.push(shader);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
        throw new Error(
          gl.getShaderInfoLog(shader) ?? "Atmosphere shader failed",
        );
      return shader;
    };
    const program = (vertex: string, fragment: string) => {
      const result = gl.createProgram();
      if (!result) throw new Error("Could not allocate atmosphere program");
      programs.push(result);
      gl.attachShader(result, compile(vertex, gl.VERTEX_SHADER));
      gl.attachShader(result, compile(fragment, gl.FRAGMENT_SHADER));
      gl.linkProgram(result);
      if (!gl.getProgramParameter(result, gl.LINK_STATUS))
        throw new Error(
          gl.getProgramInfoLog(result) ?? "Atmosphere link failed",
        );
      return result;
    };
    const buffer = (values: Float32Array) => {
      const result = gl.createBuffer();
      if (!result) throw new Error("Could not allocate atmosphere geometry");
      buffers.push(result);
      gl.bindBuffer(gl.ARRAY_BUFFER, result);
      gl.bufferData(gl.ARRAY_BUFFER, values, gl.STATIC_DRAW);
      return result;
    };
    const haze = program(screenVertex, hazeFragment);
    const motes = program(moteVertex, moteFragment);
    const quad = buffer(new Float32Array([-1, -1, 3, -1, -1, 3]));
    // Fixed seeds keep the composition stable across visits, resizing and pauses.
    let seed = 8127;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const points = new Float32Array(80 * 5);
    for (let index = 0; index < 80; index++) {
      const offset = index * 5;
      points[offset] = (random() - 0.5) * 16;
      points[offset + 1] = (random() - 0.5) * 9;
      points[offset + 2] = 3 + random() * 5;
      points[offset + 3] = 13 + random() * 13;
      points[offset + 4] = random() * Math.PI * 2;
    }
    const pointBuffer = buffer(points);
    const locations = (target: WebGLProgram) => ({
      time: gl.getUniformLocation(target, "uTime"),
      aspect: gl.getUniformLocation(target, "uAspect"),
      pointer: gl.getUniformLocation(target, "uPointer"),
    });
    const fogUniforms = locations(haze);
    const pointUniforms = locations(motes);
    const moonUniform = gl.getUniformLocation(haze, "uMoon");
    const scaleUniform = gl.getUniformLocation(motes, "uScale");
    const fogPosition = gl.getAttribLocation(haze, "aPosition");
    const pointPosition = gl.getAttribLocation(motes, "aPosition");
    const pointSize = gl.getAttribLocation(motes, "aSize");
    const pointPhase = gl.getAttribLocation(motes, "aPhase");
    let aspect = 1;
    let compact = false;
    let moonX = 0.805;
    let moonY = 0.787;

    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    const setUniforms = (
      uniforms: ReturnType<typeof locations>,
      time: number,
      x: number,
      y: number,
    ) => {
      gl.uniform1f(uniforms.time, time);
      gl.uniform1f(uniforms.aspect, aspect);
      gl.uniform2f(uniforms.pointer, x, -y);
    };
    return {
      resize(width, height, isCompact) {
        compact = isCompact;
        aspect = width / Math.max(1, height);
        const scale = Math.min(
          compact ? 0.5 : 0.75,
          Math.sqrt(650000 / Math.max(1, width * height)),
        );
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        gl.viewport(0, 0, canvas.width, canvas.height);
        // Match the cover crop and object-position of the user's 1672 × 941 sky.
        const cover = Math.max(width / 1672, height / 941);
        const imageWidth = 1672 * cover;
        moonX =
          (imageWidth * 0.805 - (imageWidth - width) * (compact ? 0.85 : 0.5)) /
          width;
        moonY = 1 - (941 * cover * 0.213) / height;
      },
      draw(time, x, y) {
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(haze);
        gl.bindBuffer(gl.ARRAY_BUFFER, quad);
        gl.enableVertexAttribArray(fogPosition);
        gl.vertexAttribPointer(fogPosition, 2, gl.FLOAT, false, 0, 0);
        setUniforms(fogUniforms, time, x, y);
        gl.uniform2f(moonUniform, moonX, moonY);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.disableVertexAttribArray(fogPosition);

        gl.useProgram(motes);
        gl.bindBuffer(gl.ARRAY_BUFFER, pointBuffer);
        gl.enableVertexAttribArray(pointPosition);
        gl.enableVertexAttribArray(pointSize);
        gl.enableVertexAttribArray(pointPhase);
        gl.vertexAttribPointer(pointPosition, 3, gl.FLOAT, false, 20, 0);
        gl.vertexAttribPointer(pointSize, 1, gl.FLOAT, false, 20, 12);
        gl.vertexAttribPointer(pointPhase, 1, gl.FLOAT, false, 20, 16);
        setUniforms(pointUniforms, time, x, y);
        gl.uniform1f(scaleUniform, canvas.height / 600);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
        gl.drawArrays(gl.POINTS, 0, compact ? 32 : 80);
        gl.disableVertexAttribArray(pointPosition);
        gl.disableVertexAttribArray(pointSize);
        gl.disableVertexAttribArray(pointPhase);
      },
      dispose,
    };
  } catch (error) {
    dispose();
    console.warn("Moonlit atmosphere uses the static sky fallback.", error);
    return null;
  }
}

const sky = document.querySelector<HTMLElement>("[data-night-scene]")!;
const canvas = sky.querySelector<HTMLCanvasElement>("[data-atmosphere]")!;
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const finePointer = matchMedia("(hover: hover) and (pointer: fine)");
let renderer: Atmosphere | null = null;
let attempted = false;
let home = false;
let heroVisible = false;
let heroObserver: IntersectionObserver | undefined;
let frame = 0;
let previousTime = 0;
let previousDraw = 0;
let sceneTime = 0;
let dirty = true;
const pointer = { x: 0, y: 0, targetX: 0, targetY: 0 };
const permitsMotion = () =>
  !reducedMotion.matches && document.documentElement.dataset.motion !== "off";
const sceneVisible = () => home && heroVisible;
const viewWidth = () => document.documentElement.clientWidth;
const viewHeight = () => document.documentElement.clientHeight;
const compact = () => viewWidth() <= 700;

function resize() {
  renderer?.resize(viewWidth(), viewHeight(), compact());
  dirty = true;
}

function wake() {
  if (!frame && !document.hidden && permitsMotion()) {
    previousTime = performance.now();
    frame = requestAnimationFrame(tick);
  }
}

function tick(now: number) {
  frame = 0;
  if (document.hidden || !permitsMotion()) return;
  const delta = Math.min(0.08, (now - previousTime) / 1000);
  previousTime = now;
  sceneTime += delta;
  const ease = 1 - Math.exp(-delta * 4.5);
  pointer.x += (pointer.targetX - pointer.x) * ease;
  pointer.y += (pointer.targetY - pointer.y) * ease;
  const moving =
    Math.abs(pointer.targetX - pointer.x) +
      Math.abs(pointer.targetY - pointer.y) >
    0.003;
  if (
    sceneVisible() &&
    renderer &&
    (dirty || now - previousDraw >= (compact() ? 50 : 1000 / 30))
  ) {
    renderer.draw(sceneTime, pointer.x, pointer.y);
    sky.style.setProperty(
      "--sky-pan-x",
      `${pointer.x * -Math.min(18, viewWidth() * 0.025)}px`,
    );
    sky.style.setProperty("--sky-pan-y", `${pointer.y * -12}px`);
    previousDraw = now;
  }
  dirty = false;
  if ((sceneVisible() && renderer) || moving)
    frame = requestAnimationFrame(tick);
}

function synchronize() {
  const visible = sceneVisible();
  if (visible && !attempted) {
    attempted = true;
    renderer = createAtmosphere(canvas);
    sky.dataset.renderer = renderer ? "webgl" : "fallback";
    resize();
  }
  sky.dataset.sceneActive = String(visible && Boolean(renderer));
  canvas.dataset.state =
    visible && renderer
      ? document.hidden
        ? "suspended"
        : permitsMotion()
          ? "playing"
          : "paused"
      : "idle";
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
  // A paused/reduced-motion visit still gets a complete, readable first frame.
  if (visible && renderer && dirty && !document.hidden)
    renderer.draw(sceneTime, pointer.x, pointer.y);
  wake();
}

function bindPage() {
  const hero = document.querySelector<HTMLElement>(".hero");
  home = Boolean(hero);
  heroVisible = Boolean(hero);
  pointer.targetX = pointer.targetY = 0;
  dirty = true;
  heroObserver?.disconnect();
  if (hero) {
    heroObserver = new IntersectionObserver(
      ([entry]) => {
        heroVisible = entry.isIntersecting;
        synchronize();
      },
      { rootMargin: "80px" },
    );
    heroObserver.observe(hero);
  }
  synchronize();
}

addEventListener(
  "pointermove",
  (event: PointerEvent) => {
    if (
      !finePointer.matches ||
      event.pointerType === "touch" ||
      !permitsMotion() ||
      !sceneVisible()
    )
      return;
    if (sceneVisible()) {
      pointer.targetX = (event.clientX / viewWidth()) * 2 - 1;
      pointer.targetY = (event.clientY / viewHeight()) * 2 - 1;
    }
    wake();
  },
  { passive: true },
);
document.documentElement.addEventListener("pointerleave", () => {
  pointer.targetX = pointer.targetY = 0;
  wake();
});
addEventListener(
  "resize",
  () => {
    resize();
    synchronize();
  },
  { passive: true },
);
document.addEventListener("visibilitychange", synchronize);
reducedMotion.addEventListener("change", synchronize);
new MutationObserver(synchronize).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ["data-motion"],
});
document.addEventListener("astro:page-load", bindPage);
canvas.addEventListener("webglcontextlost", (event) => {
  event.preventDefault();
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
  renderer = null;
  sky.dataset.renderer = "fallback";
  sky.dataset.sceneActive = "false";
  canvas.dataset.state = "fallback";
});
canvas.addEventListener("webglcontextrestored", () => {
  attempted = false;
  dirty = true;
  synchronize();
});
addEventListener("pagehide", () => {
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
});
addEventListener("pageshow", synchronize);
