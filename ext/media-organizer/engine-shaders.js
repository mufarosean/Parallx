// engine-shaders.js — the Image Engine's GLSL (moImageEngine in main.js): the vertex
// shaders, the blur used for its blurred copies, and the one fragment program that
// draws a whole recipe. A mask's pass draws the recipe with that mask's settings and
// lays it over the picture so far (u_prev) through the mask (u_mask); Show Mask is a
// pass that tints the picture so far where the selected mask is.

import { MO_OKLAB_GLSL } from './colour.js';

export const MO_PLAN_VS = `
attribute vec2 a_pos; varying vec2 v_uv;
void main() { v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5); gl_Position = vec4(a_pos, 0.0, 1.0); }`;
// Texture space in, texture space out: for passes that write a texture.
export const MO_ENGINE_COPY_VS = `
attribute vec2 a_pos; varying vec2 v_uv;
void main() { v_uv = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }`;
// Nine taps of a gaussian along u_step; u_step of zero is a plain copy.
export const MO_ENGINE_BLUR_FS = `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_img;
uniform vec2 u_step;
void main() {
  vec4 c = texture2D(u_img, v_uv) * 0.227027;
  c += (texture2D(u_img, v_uv + u_step * 1.384615) + texture2D(u_img, v_uv - u_step * 1.384615)) * 0.316216;
  c += (texture2D(u_img, v_uv + u_step * 3.230769) + texture2D(u_img, v_uv - u_step * 3.230769)) * 0.070270;
  gl_FragColor = c;
}`;
export const MO_ENGINE_FS = `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_img;
uniform sampler2D u_blurS;
uniform sampler2D u_blurL;
uniform sampler2D u_curve;
uniform sampler2D u_squint;    // a painting plan's squint: the source blurred as asked (squintCopy)
uniform float u_squintOn;
uniform vec3 u_v0, u_v1, u_m0, u_m1;
uniform vec2 u_texel, u_outSize;
uniform float u_exposure, u_contrast, u_highlights, u_shadows, u_whites, u_blacks;
uniform float u_warmth, u_tint, u_hue, u_sat, u_vibrance;
uniform float u_grey, u_levels, u_notan, u_split, u_paletteN, u_opaque, u_outside;
uniform float u_curveOn, u_mixOn, u_gradeOn, u_clipSrc, u_valueMode, u_underOn;
uniform sampler2D u_mask;      // a mask pass: where this mask's edit shows (the photo's own pixel space)
uniform sampler2D u_prev;      // the picture so far, which the mask's edit is laid over
uniform float u_maskOn, u_tintOnly, u_blurAmt;
uniform vec3 u_mk0, u_mk1;     // the source picture's uv to the mask's uv (a save's tile, an enhanced crop)
uniform vec2 u_passSize;
uniform vec3 u_under;
uniform vec3 u_mix[8];
uniform vec3 u_gShadow, u_gMid, u_gHigh, u_gLum;
uniform float u_gBlend, u_gBalance;
uniform float u_texture, u_clarity, u_dehaze;
uniform float u_vignette, u_vigMid, u_vigFeather, u_grain, u_grainSize;
uniform float u_sharpen, u_sharpRadius, u_noise, u_noiseColour;
uniform vec3 u_palette[16];
const vec3 LUMA = vec3(0.299, 0.587, 0.114);${MO_OKLAB_GLSL}vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y); float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}
vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}
// Noise reduction: neighbours that look like this pixel are averaged in.
vec3 denoise(vec2 s, vec3 c0) {
  vec3 sum = vec3(0.0); float wsum = 0.0;
  for (int j = -2; j <= 2; j++) {
    for (int i = -2; i <= 2; i++) {
      vec2 d = vec2(float(i), float(j));
      vec3 c = texture2D(u_img, s + d * u_texel * 1.5).rgb;
      vec3 df = c - c0;
      float w = exp(-dot(d, d) * 0.18 - dot(df, df) * 60.0);
      sum += c * w; wsum += w;
    }
  }
  vec3 avg = sum / wsum;
  float l0 = dot(c0, LUMA); float la = dot(avg, LUMA);
  float l = mix(l0, la, u_noise);
  vec3 ch = mix(c0 - l0, avg - la, u_noiseColour);
  return clamp(vec3(l) + ch, 0.0, 1.0);
}
// A colour's share of one band of the mixer: 1 at the band's hue, 0 at its neighbours'. Hues in turns.
float band(float h, float c, float lo, float hi) {
  float d = h - c; d -= floor(d + 0.5);
  float wl = c - lo; wl -= floor(wl);
  float wr = hi - c; wr -= floor(wr);
  return d < 0.0 ? max(0.0, 1.0 + d / wl) : max(0.0, 1.0 - d / wr);
}
vec3 mixer(vec3 c) {
  vec3 h = rgb2hsv(c);
  vec3 m = band(h.x, 0.0, 300.0 / 360.0, 30.0 / 360.0) * u_mix[0]
    + band(h.x, 30.0 / 360.0, 0.0, 60.0 / 360.0) * u_mix[1]
    + band(h.x, 60.0 / 360.0, 30.0 / 360.0, 120.0 / 360.0) * u_mix[2]
    + band(h.x, 120.0 / 360.0, 60.0 / 360.0, 180.0 / 360.0) * u_mix[3]
    + band(h.x, 180.0 / 360.0, 120.0 / 360.0, 240.0 / 360.0) * u_mix[4]
    + band(h.x, 240.0 / 360.0, 180.0 / 360.0, 270.0 / 360.0) * u_mix[5]
    + band(h.x, 270.0 / 360.0, 240.0 / 360.0, 300.0 / 360.0) * u_mix[6]
    + band(h.x, 300.0 / 360.0, 270.0 / 360.0, 0.0) * u_mix[7];
  float k = smoothstep(0.02, 0.2, h.y);                       // greys are left alone
  h.x = fract(h.x + m.x * (30.0 / 360.0) * k + 1.0);
  h.y = clamp(h.y * (1.0 + m.y * k), 0.0, 1.0);
  h.z = clamp(h.z * (1.0 + m.z * 0.5 * k), 0.0, 1.0);
  return hsv2rgb(h);
}
vec3 grade(vec3 c) {
  float l = dot(c, LUMA);
  float b = u_gBalance * 0.25;
  float ws = 1.0 - smoothstep(0.0, mix(0.35, 0.75, u_gBlend) + b, l);
  float wh = smoothstep(mix(0.65, 0.25, u_gBlend) + b, 1.0, l);
  float wm = clamp(1.0 - ws - wh, 0.0, 1.0);
  c += ws * u_gShadow + wm * u_gMid + wh * u_gHigh;
  c += (ws * u_gLum.x + wm * u_gLum.y + wh * u_gLum.z) * 0.25;
  return clamp(c, 0.0, 1.0);
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float maskAt(vec2 s) { vec3 q = vec3(s, 1.0); return texture2D(u_mask, vec2(dot(u_mk0, q), dot(u_mk1, q))).r; }
void main() {
  vec3 q = vec3(v_uv, 1.0);
  vec2 o = vec2(dot(u_v0, q), dot(u_v1, q));
  bool outside = o.x < 0.0 || o.x > 1.0 || o.y < 0.0 || o.y > 1.0;
  if (outside && u_outside < 0.5) { gl_FragColor = vec4(0.0); return; }
  vec3 oq = vec3(o, 1.0);
  vec2 s = vec2(dot(u_m0, oq), dot(u_m1, oq));
  if ((outside || u_clipSrc > 0.5) && (s.x < 0.0 || s.x > 1.0 || s.y < 0.0 || s.y > 1.0)) { gl_FragColor = vec4(0.0); return; }
  if (u_tintOnly > 0.5) { // Show Mask: the picture so far, the mask over it in red
    vec4 pv = texture2D(u_prev, gl_FragCoord.xy / u_passSize);
    gl_FragColor = vec4(mix(pv.rgb, vec3(0.92, 0.16, 0.22), maskAt(s) * 0.5), pv.a);
    return;
  }
  vec4 t = texture2D(u_img, s);
  vec3 c = u_squintOn > 0.5 ? texture2D(u_squint, s).rgb : t.rgb;
  vec3 orig = c;
  if (u_blurAmt > 0.0005) { // a mask's Blur: toward the fine blurred copy, then the broad one
    vec3 b1 = texture2D(u_blurS, s).rgb, b2 = texture2D(u_blurL, s).rgb;
    c = u_blurAmt < 0.5 ? mix(c, b1, u_blurAmt * 2.0) : mix(b1, b2, u_blurAmt * 2.0 - 1.0);
  }
  if (u_noise > 0.0005 || u_noiseColour > 0.0005) c = denoise(s, c);
  vec3 src = c;
  c *= pow(2.0, u_exposure);
  float l = dot(c, LUMA);
  float sw = 1.0 - smoothstep(0.0, 0.6, l);
  float hw = smoothstep(0.4, 1.0, l);
  c += u_shadows * sw * 0.5 * (1.0 - c);
  c += u_highlights * hw * 0.5 * c;
  if (abs(u_whites) > 0.0005) c += u_whites * 0.25 * smoothstep(0.55, 1.0, l);
  if (abs(u_blacks) > 0.0005) c += u_blacks * 0.25 * (1.0 - smoothstep(0.0, 0.45, l));
  c = (c - 0.5) * (1.0 + u_contrast) + 0.5;
  c.r += u_warmth * 0.12; c.b -= u_warmth * 0.12; c.g -= u_tint * 0.1;
  c = clamp(c, 0.0, 1.0);
  if (u_curveOn > 0.5) {
    c = vec3(texture2D(u_curve, vec2((c.r * 1023.0 + 0.5) / 1024.0, 0.5)).r,
      texture2D(u_curve, vec2((c.g * 1023.0 + 0.5) / 1024.0, 0.5)).g,
      texture2D(u_curve, vec2((c.b * 1023.0 + 0.5) / 1024.0, 0.5)).b);
  }
  if (abs(u_texture) > 0.0005 || abs(u_clarity) > 0.0005 || abs(u_dehaze) > 0.0005) {
    vec3 bs = texture2D(u_blurS, s).rgb;
    vec3 bl = texture2D(u_blurL, s).rgb;
    if (u_dehaze > 0.0005) {
      float dark = min(bl.r, min(bl.g, bl.b));
      float tr = max(0.15, 1.0 - u_dehaze * 0.85 * dark);
      c = (c - 1.0) / tr + 1.0;
      c = mix(vec3(dot(c, LUMA)), c, 1.0 + u_dehaze * 0.25);
    } else if (u_dehaze < -0.0005) {
      float dark = min(bl.r, min(bl.g, bl.b));
      c = mix(c, vec3(1.0), -u_dehaze * 0.5 * (0.35 + 0.65 * dark));
    }
    float lm = clamp(dot(c, LUMA), 0.0, 1.0);
    c += u_texture * 1.2 * (src - bs);
    c += u_clarity * 0.9 * (src - bl) * (1.0 - pow(abs(2.0 * lm - 1.0), 2.0));
    c = clamp(c, 0.0, 1.0);
  }
  if (u_sharpen > 0.0005) {
    vec2 d = u_texel * u_sharpRadius;
    vec3 n = (texture2D(u_img, s + vec2(d.x, 0.0)).rgb + texture2D(u_img, s - vec2(d.x, 0.0)).rgb
      + texture2D(u_img, s + vec2(0.0, d.y)).rgb + texture2D(u_img, s - vec2(0.0, d.y)).rgb) * 0.25;
    c = clamp(c + u_sharpen * 1.5 * (src - n), 0.0, 1.0);
  }
  if (abs(u_hue) > 0.0005 || abs(u_sat) > 0.0005) {
    vec3 h = rgb2hsv(c); h.x = fract(h.x + u_hue); h.y = clamp(h.y * (1.0 + u_sat), 0.0, 1.0); c = hsv2rgb(h);
  }
  if (abs(u_vibrance) > 0.0005) {
    float mx = max(c.r, max(c.g, c.b)); float mn = min(c.r, min(c.g, c.b));
    float g = dot(c, LUMA);
    c = clamp(mix(vec3(g), c, 1.0 + u_vibrance * (1.0 - (mx - mn))), 0.0, 1.0);
  }
  if (u_mixOn > 0.5) c = mixer(c);
  if (u_gradeOn > 0.5) c = grade(c);
  float lum = dot(c, LUMA);
  if (u_valueMode > 0.5) {
    // A painting plan's values: lightness as the eye sees it, banded, or light and shadow only, laid in
    // one paint (u_under, OKLab) from its darks to its tints, or in grey.
    float L = toOklab(c).x;
    if (u_notan > 0.0) L = L >= u_notan ? 0.86 : 0.24;
    else if (u_levels >= 2.0) L = (min(floor(L * u_levels), u_levels - 1.0) + 0.5) / u_levels;
    vec2 ab = vec2(0.0);
    if (u_underOn > 0.5) { float k = clamp(1.0 - abs(L - u_under.x) / max(u_under.x, 1.0 - u_under.x), 0.0, 1.0); ab = u_under.yz * (0.35 + 0.65 * k); }
    vec3 lin = oklabToLinear(vec3(L, ab));
    for (int i = 0; i < 8; i++) { if (min(lin.r, min(lin.g, lin.b)) >= -0.001 && max(lin.r, max(lin.g, lin.b)) <= 1.001) break; ab *= 0.8; lin = oklabToLinear(vec3(L, ab)); }
    c = linearToSrgb(clamp(lin, 0.0, 1.0));
  } else {
  if (u_grey > 0.5) c = vec3(lum);
  if (u_notan > 0.0) c = vec3(step(u_notan, lum));
  else if (u_levels >= 2.0) { float bi = min(floor(lum * u_levels), u_levels - 1.0); c = u_grey > 0.5 ? vec3(bi / (u_levels - 1.0)) : valueBand(c, (bi + 0.5) / u_levels); } // colour keeps its hue at its band's middle value
  }
  if (u_paletteN > 0.5) {
    vec3 best = u_palette[0]; float bd = 1.0e9; vec3 cl = toOklab(c); // nearest as the eye judges it
    for (int i = 0; i < 16; i++) {
      if (float(i) >= u_paletteN) break;
      vec3 d = cl - toOklab(u_palette[i]); float dd = dot(d, d);
      if (dd < bd) { bd = dd; best = u_palette[i]; }
    }
    c = best;
  }
  if (!outside && abs(u_vignette) > 0.0005) {
    float d = length((o - 0.5) * 2.0) / 1.41421356;            // 0 at the centre, 1 in a corner
    float inner = 0.9 * u_vigMid;
    float v = smoothstep(inner, inner + mix(0.1, 1.0, u_vigFeather), d);
    c = u_vignette < 0.0 ? c * (1.0 + u_vignette * v) : c + u_vignette * v * (1.0 - c);
  }
  if (!outside && u_grain > 0.0005) {
    vec2 g = floor(o * u_outSize / mix(1.0, 4.0, u_grainSize));
    float n = hash(g) + hash(g + 17.0) - 1.0;
    float gm = dot(c, LUMA);
    c = clamp(c + u_grain * 0.18 * n * (1.0 - 0.6 * abs(2.0 * gm - 1.0)), 0.0, 1.0);
  }
  if (outside) c *= 0.3;
  if (u_maskOn > 0.5) c = mix(texture2D(u_prev, gl_FragCoord.xy / u_passSize).rgb, c, outside ? 0.0 : maskAt(s));
  if (u_split >= 0.0 && v_uv.x < u_split) c = orig * (outside ? 0.3 : 1.0);
  gl_FragColor = vec4(c, (u_opaque > 0.5 || outside) ? 1.0 : t.a);
}`;
