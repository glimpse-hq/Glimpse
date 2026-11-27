// The toast: a black card with a tinted border, drawn per pixel. Content is laid out in its own points ("layout"), drawn at `place.xy` in the window,
// inside `shape`, which springs between the pill, other toasts and this card.
// Text comes prerasterized in `text`, one texel per pixel of the layout, laid out at scroll 0.

struct U {
  view: vec4f,       // window width pt, window height pt, pixels per pt, scroll pt
  card: vec4f,       // layout card x, y, width, height pt
  motion: vec4f,     // translate y pt, scale, scale origin y in window pt, opacity
  fx: vec4f,         // blur pt, seconds since shown, twinkle (0 none, 1 cloud, 2 accent), marker opacity
  border: vec4f,     // rgb, alpha
  marker: vec4f,     // x, y, width, height pt
  marker_color: vec4f, // rgb, kind (0 dot, 1 2x2 dot matrix)
  ring: vec4f,       // ask dot ring spread pt, ring alpha, scrollbar thumb y, thumb height (0 none)
  reveal: vec4f,     // opacity and y offset of the early reveal, then of the late reveal
  misc: vec4f,       // reveal split y pt, scrollbar x pt, text texture width px, height px
  close: vec4f,      // x, y pt, unused, hovered
  copy: vec4f,       // x, y pt, icon (0 none, 1 copy, 2 check), hovered
  secondary: vec4f,  // copy icon x, y pt, shown, hovered
  shape: vec4f,      // drawn card x, y, width, height in window pt
  place: vec4f,      // layout origin x, y in window pt, content alpha, card alpha
  shape2: vec4f,     // corner radius pt, bump scale, unused, unused
}
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var text: texture_2d<f32>;
@group(0) @binding(2) var text_sampler: sampler;

const BORDER = 1.0;
const GRAY_500 = vec3f(107.0, 114.0, 128.0) / 255.0;
const WHITE = vec3f(1.0);
const CLOUD = vec3f(251.0, 191.0, 36.0) / 255.0;
const ACCENT = vec3f(143.0, 111.0, 247.0) / 255.0;
const INFO_STRONG = vec3f(96.0, 165.0, 250.0) / 255.0;
const SCROLL_THUMB = 0.1;
const TWINKLE_COLS = 50.0;
const TWINKLE_ROWS = 12.0;
const TWINKLE_PITCH = 8.0;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}

fn sd_round_rect(p: vec2f, center: vec2f, half: vec2f, r: f32) -> f32 {
  let q = abs(p - center) - half + vec2f(r);
  return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

fn sd_box(p: vec2f, lo: vec2f, hi: vec2f, r: f32) -> f32 {
  return sd_round_rect(p, (lo + hi) * 0.5, (hi - lo) * 0.5, r);
}

fn sd_segment(p: vec2f, a: vec2f, b: vec2f) -> f32 {
  let pa = p - a;
  let ba = b - a;
  let h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

fn cover(d: f32, px: f32) -> f32 {
  return clamp(0.5 - d / px, 0.0, 1.0);
}

// `color` at alpha `a` over premultiplied `dst`.
fn over(dst: vec4f, color: vec3f, a: f32) -> vec4f {
  let k = clamp(a, 0.0, 1.0);
  return vec4f(color * k, k) + dst * (1.0 - k);
}

fn hash(c: vec2f, k: u32) -> f32 {
  var h = (u32(c.x) * 73856093u) ^ (u32(c.y) * 19349663u) ^ (k * 83492791u);
  h = (h ^ (h >> 16u)) * 0x45d9f3bu;
  h = (h ^ (h >> 16u)) * 0x45d9f3bu;
  h = h ^ (h >> 16u);
  return f32(h & 0xffffffu) / 16777216.0;
}

// Phosphor's Copy icon (regular), 256 units to 12 pt, with its top left at `at`.
fn sd_copy(p: vec2f, at: vec2f) -> f32 {
  let q = (p - at) * (256.0 / 12.0);
  let front_out = sd_box(q, vec2f(32.0, 80.0), vec2f(176.0, 224.0), 8.0);
  let front_in = sd_box(q, vec2f(48.0, 96.0), vec2f(160.0, 208.0), 0.0);
  let back_out = sd_box(q, vec2f(80.0, 32.0), vec2f(224.0, 176.0), 8.0);
  let back_in = sd_box(q, vec2f(96.0, 48.0), vec2f(208.0, 160.0), 0.0);
  let front = max(front_out, -front_in);
  let back = max(max(back_out, -back_in), -front_out);
  return min(front, back) * (12.0 / 256.0);
}

// Phosphor's Check icon (regular), 256 units to 12 pt, with its top left at `at`.
fn sd_check(p: vec2f, at: vec2f) -> f32 {
  let q = (p - at) * (256.0 / 12.0);
  let d = min(
    sd_segment(q, vec2f(40.0, 144.0), vec2f(96.0, 200.0)),
    sd_segment(q, vec2f(96.0, 200.0), vec2f(224.0, 72.0)),
  );
  return (d - 8.0) * (12.0 / 256.0);
}

// The ✕ glyph, centered in its 20 pt button.
fn sd_close(p: vec2f, at: vec2f) -> f32 {
  let c = at + vec2f(10.0, 10.5);
  let q = abs(p - c);
  let arm = 2.75;
  return sd_segment(q, vec2f(0.0), vec2f(arm)) - 0.33;
}

fn sample_text(at: vec2f, blur: f32) -> vec4f {
  let size = u.misc.zw;
  let uv = at * u.view.z / size;
  if (blur < 0.05) {
    return textureSampleLevel(text, text_sampler, uv, 0.0);
  }
  var sum = textureSampleLevel(text, text_sampler, uv, 0.0);
  for (var i = 0; i < 8; i++) {
    let a = f32(i) * 0.7853982;
    let o = vec2f(cos(a), sin(a)) * blur * u.view.z / size;
    sum += textureSampleLevel(text, text_sampler, uv + o, 0.0);
  }
  return sum / 9.0;
}

// Ask toasts reveal the question and the action row on their own clocks.
fn revealed_text(c: vec2f, blur: f32) -> vec4f {
  let split = u.misc.x;
  var t = vec4f(0.0);
  let early = c - vec2f(0.0, u.reveal.y);
  if (early.y < split) {
    t += sample_text(early, blur) * u.reveal.x;
  }
  let late = c - vec2f(0.0, u.reveal.w);
  if (late.y >= split) {
    t += sample_text(late, blur) * u.reveal.z;
  }
  return t;
}

fn twinkle(c: vec2f, px: f32) -> vec2f {
  let g = (c - u.card.xy - vec2f(BORDER)) / TWINKLE_PITCH;
  let cell = floor(g);
  if (u.fx.z < 0.5 || any(cell < vec2f(0.0)) || cell.x >= TWINKLE_COLS || cell.y >= TWINKLE_ROWS) {
    return vec2f(0.0);
  }
  if (hash(cell, 1u) > 0.4) {
    return vec2f(0.0);
  }
  let delay = hash(cell, 2u) * 5.0;
  let duration = 2.0 + hash(cell, 3u) * 4.0;
  let phase = fract((u.fx.y + delay) / duration);
  let k = smoothstep(0.0, 1.0, 1.0 - abs(phase * 2.0 - 1.0));
  let center = u.card.xy + vec2f(BORDER) + cell * TWINKLE_PITCH + vec2f(1.0);
  let d = length(c - center) - mix(0.8, 1.2, k);
  // box-shadow 0 0 2px fades in toward the midpoint, under the dot.
  let blur = max(2.0 * k, px);
  let glow = k * (1.0 - smoothstep(-blur * 0.5, blur, d));
  let a = 1.0 - (1.0 - cover(d, px)) * (1.0 - glow);
  return vec2f(a * mix(0.15, 0.7, k) * 0.6, 1.0);
}

@fragment
fn fs(@builtin(position) frag: vec4f) -> @location(0) vec4f {
  let p = frag.xy / u.view.z;
  let half = u.shape.zw * 0.5;
  let center = u.shape.xy + half;
  let s = u.motion.y * u.shape2.y;
  let origin = vec2f(center.x, u.motion.z);
  let q = (p - origin - vec2f(0.0, u.motion.x)) / s + origin;
  let px = 1.0 / (u.view.z * s);
  let blur = u.fx.x;

  let radius = min(u.shape2.x, min(half.x, half.y));
  let d = sd_round_rect(q, center, half, radius);
  var inside: f32;
  if (blur > 0.05) {
    inside = 1.0 - smoothstep(-1.5 * blur, 1.5 * blur, d);
  } else {
    inside = cover(d, px);
  }
  if (inside <= 0.0) {
    return vec4f(0.0);
  }
  let pad_d = sd_round_rect(q, center, half - vec2f(BORDER), max(radius - BORDER, 0.0));
  let pad = cover(pad_d, px);

  // Content scrolls; the border and scrollbar stay.
  let c0 = q - u.place.xy;
  let c = c0 + vec2f(0.0, u.view.w);
  var col = vec4f(0.0);

  let m = u.marker;
  let mc = u.marker_color.rgb;
  if (u.marker_color.w < 0.5) {
    let mcenter = m.xy + m.zw * 0.5;
    let md = length(c - mcenter) - m.z * 0.5;
    if (u.ring.y > 0.0) {
      col = over(col, CLOUD, cover(md - u.ring.x, px) * u.ring.y);
    }
    col = over(col, mc, cover(md, px) * u.fx.w);
  } else {
    let cell = clamp(floor((c - m.xy) / 6.0), vec2f(0.0), vec2f(1.0));
    let dd = length(c - (m.xy + cell * 6.0 + vec2f(2.0))) - 2.0;
    col = over(col, mc, cover(dd, px));
  }

  let t = revealed_text(c, blur);
  col = t + col * (1.0 - t.a);

  let tw = twinkle(c, px);
  if (tw.y > 0.0) {
    let tc = select(CLOUD, ACCENT, u.fx.z > 1.5);
    col = over(col, tc, tw.x);
  }

  let close_color = select(GRAY_500, WHITE, u.close.w > 0.5);
  col = over(col, close_color, cover(sd_close(c, u.close.xy), px));
  if (u.copy.z > 0.5) {
    let at = u.copy.xy + vec2f(4.0);
    let icon = select(sd_copy(c, at), sd_check(c, at), u.copy.z > 1.5);
    col = over(col, select(GRAY_500, WHITE, u.copy.w > 0.5), cover(icon, px));
  }
  if (u.secondary.z > 0.5) {
    let sc = select(INFO_STRONG, WHITE, u.secondary.w > 0.5);
    col = over(col, sc, cover(sd_copy(c, u.secondary.xy), px) * u.reveal.z);
  }

  if (u.ring.w > 0.0) {
    let lo = vec2f(u.misc.y, u.ring.z);
    let thumb = sd_box(c0, lo, lo + vec2f(6.0, u.ring.w), 3.0);
    col = over(col, WHITE, cover(thumb, px) * SCROLL_THUMB);
  }

  // The card under its content: black, with the tinted border showing outside the padding.
  let content = col * (pad * u.place.z);
  let card = vec4f(u.border.rgb * u.border.a * (1.0 - pad), 1.0) * u.place.w;
  return (content + card * (1.0 - content.a)) * inside * u.motion.w;
}
