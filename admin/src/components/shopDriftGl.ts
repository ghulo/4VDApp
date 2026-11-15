/**
 * The sign-in page's dot field drawn on the graphics card. The page still works
 * out where everything is (a small picture with one pixel per dot); this turns
 * that picture into the full-size field of round dots, so a frame costs almost
 * nothing however big and sharp the screen is. Same maths as the CPU version in
 * ShopDrift.tsx, and the very same dots, copied from the sheet the CPU version uses.
 */

/** As many ripples as the field shows at once (a handful at most in practice). */
export const MAX_RIPPLES = 16;

export interface DotGrid {
  /** The canvas's size in device pixels, and device pixels per CSS pixel. */
  width: number;
  height: number;
  ratio: number;
  columns: number;
  rows: number;
}

export interface DotFrame {
  time: number;
  scanY: number;
  pointer: { x: number; y: number; glow: number };
  ripples: { x: number; y: number; age: number; strength: number }[];
}

export interface DotRenderer {
  /**
   * A new size: the map's brightness and twinkle per dot, and the sheet of dots, one
   * `size` × `size` square per brightness step side by side (straight RGBA bytes).
   */
  resize(grid: DotGrid, field: Float32Array, twinkle: Float32Array, sheet: { size: number; pixels: Uint8ClampedArray }): void;
  /** One frame: the scene as read from the small canvas (RGBA bytes) and the wake per dot. */
  draw(scene: Uint8ClampedArray, wake: Float32Array, frame: DotFrame): void;
}

const VERTEX = `#version 300 es
void main() {
  // One triangle that covers the whole canvas.
  vec2 corner = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  gl_Position = vec4(corner, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uScene;
uniform sampler2D uWake;
uniform sampler2D uField;
uniform ivec2 uGrid;
uniform float uHeight;
uniform float uRatio;
uniform float uTime;
uniform float uScanY;
uniform vec3 uPointer;
uniform vec4 uRipples[${MAX_RIPPLES}];
uniform int uRippleCount;
uniform sampler2D uStamps;
uniform int uSize;
out vec4 outColour;

const float GAP = 4.0;
const float STEPS = 23.0;

void main() {
  // Device pixel, counted from the top like the CPU version.
  vec2 pixel = vec2(gl_FragCoord.x, uHeight - gl_FragCoord.y);
  float pitch = GAP * uRatio;
  ivec2 cell = ivec2(floor(pixel / pitch));
  if (cell.x >= uGrid.x || cell.y >= uGrid.y) discard;

  vec4 scene = texelFetch(uScene, cell, 0);
  vec2 map = texelFetch(uField, cell, 0).rg;
  float wake = texelFetch(uWake, cell, 0).r;
  float light = scene.r;
  float cover = scene.a;
  vec2 spot = vec2(cell) * GAP + GAP * 0.5;

  float ground = map.x * (0.8 + 0.2 * sin(uTime * 0.9 + map.y));
  ground += wake * (0.12 + map.x) * (1.0 - cover);
  float beam = (spot.y - uScanY) / 5.0;
  ground += exp(-beam * beam) * 0.35 * (0.3 + map.x);
  if (uPointer.z > 0.01 && abs(spot.y - uPointer.y) < 110.0) {
    float reach = 1.0 - distance(spot, uPointer.xy) / 110.0;
    if (reach > 0.0) ground += reach * reach * uPointer.z * (0.12 + map.x * 0.9);
  }
  for (int i = 0; i < ${MAX_RIPPLES}; i++) {
    if (i >= uRippleCount) break;
    vec4 ripple = uRipples[i];
    float off = abs(distance(spot, ripple.xy) - ripple.z * 90.0);
    if (off < 6.0) ground += (1.0 - off / 6.0) * ripple.w * (1.0 - ripple.z / 2.4);
  }

  float value = ground * (1.0 - cover) + light * cover;
  float level = min(STEPS, floor(value * STEPS + 0.5));
  if (level < 1.0) discard;
  // This pixel of that brightness's dot, copied from the sheet; the dot sits in its
  // cell on whole device pixels, as on the CPU.
  ivec2 corner = ivec2(floor(vec2(cell) * pitch + 0.5));
  ivec2 local = ivec2(floor(pixel)) - corner;
  if (local.x < 0 || local.y < 0 || local.x >= uSize || local.y >= uSize) discard;
  vec4 ink = texelFetch(uStamps, ivec2(int(level) * uSize + local.x, local.y), 0);
  if (ink.a == 0.0) discard;
  outColour = vec4(ink.rgb * ink.a, ink.a);
}`;

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  console.warn('ShopDrift shader:', gl.getShaderInfoLog(shader));
  return null;
}

/** A WebGL2 renderer on this canvas, or null when the card can't (the page then draws on the CPU). */
export function createDotRenderer(canvas: HTMLCanvasElement): DotRenderer | null {
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    // Software drawing is slower than the CPU version: use that instead.
    failIfMajorPerformanceCaveat: true,
    powerPreference: 'low-power',
  });
  if (!gl) return null;
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
  const program = gl.createProgram();
  if (!vertex || !fragment || !program) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn('ShopDrift program:', gl.getProgramInfoLog(program));
    return null;
  }
  gl.useProgram(program);
  gl.bindVertexArray(gl.createVertexArray());
  gl.disable(gl.BLEND);
  gl.disable(gl.DEPTH_TEST);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.clearColor(0, 0, 0, 0);

  const at = (name: string) => gl.getUniformLocation(program, name);
  const uniforms = {
    grid: at('uGrid'),
    height: at('uHeight'),
    ratio: at('uRatio'),
    time: at('uTime'),
    scanY: at('uScanY'),
    pointer: at('uPointer'),
    ripples: at('uRipples'),
    rippleCount: at('uRippleCount'),
    size: at('uSize'),
  };
  // Each texture keeps its own unit: scene 0, wake 1, map 2, dot sheet 3.
  const textures = ['uScene', 'uWake', 'uField', 'uStamps'].map((name, unit) => {
    const texture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    for (const parameter of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, parameter, gl.NEAREST);
    for (const parameter of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, parameter, gl.CLAMP_TO_EDGE);
    gl.uniform1i(at(name), unit);
    return texture;
  });
  const rippleData = new Float32Array(MAX_RIPPLES * 4);
  let columns = 0;
  let rows = 0;

  return {
    resize(grid, field, twinkle, sheet) {
      ({ columns, rows } = grid);
      gl.viewport(0, 0, grid.width, grid.height);
      gl.uniform2i(uniforms.grid, columns, rows);
      gl.uniform1f(uniforms.height, grid.height);
      gl.uniform1f(uniforms.ratio, grid.ratio);
      gl.uniform1i(uniforms.size, sheet.size);
      const map = new Float32Array(columns * rows * 2);
      for (let index = 0; index < field.length; index++) {
        map[index * 2] = field[index]!;
        map[index * 2 + 1] = twinkle[index]!;
      }
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, textures[0]!);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, columns, rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, textures[1]!);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, columns, rows, 0, gl.RED, gl.FLOAT, null);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, textures[2]!);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, columns, rows, 0, gl.RG, gl.FLOAT, map);
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, textures[3]!);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, sheet.pixels.length / 4 / sheet.size, sheet.size, 0, gl.RGBA, gl.UNSIGNED_BYTE, sheet.pixels);
    },
    draw(scene, wake, frame) {
      if (gl.isContextLost() || columns === 0) return;
      gl.activeTexture(gl.TEXTURE0);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, columns, rows, gl.RGBA, gl.UNSIGNED_BYTE, scene);
      gl.activeTexture(gl.TEXTURE1);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, columns, rows, gl.RED, gl.FLOAT, wake);
      gl.uniform1f(uniforms.time, frame.time);
      gl.uniform1f(uniforms.scanY, frame.scanY);
      gl.uniform3f(uniforms.pointer, frame.pointer.x, frame.pointer.y, frame.pointer.glow);
      // The newest ripples, if ever there are more than fit.
      const ripples = frame.ripples.slice(-MAX_RIPPLES);
      ripples.forEach((ripple, i) => rippleData.set([ripple.x, ripple.y, ripple.age, ripple.strength], i * 4));
      gl.uniform4fv(uniforms.ripples, rippleData);
      gl.uniform1i(uniforms.rippleCount, ripples.length);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
  };
}
