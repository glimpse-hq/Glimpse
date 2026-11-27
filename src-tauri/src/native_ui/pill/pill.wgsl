// The pill: a black rounded shell with a 3 pt dot grid, or text once it grows, drawn per pixel.

struct U {
  view: vec4f,    // window width pt, window height pt, pixels per pt, unused
  motion: vec4f,  // scale x, scale y, offset x pt, offset y pt
  look: vec4f,    // opacity, base dot level, wave fade, mode (0 dots, 1 error flash, 2 error icon)
  pops: vec4f,    // pop time, pop gain, cleanup gain, seed
  misc: vec4f,    // error flash level, shell rgb
  shell: vec4f,   // width, height, corner radius pt, dot alpha
  anchor: vec4f,  // bottom center x, y in window pt, text alpha, fresh text alpha
  text: vec4f,    // text image x, y in shell pt, width, height pt
  text2: vec4f,   // fresh text y offset, unused
  lines: array<vec4f, 6>,  // per text line: top, bottom in text image pt, slide x, y
  heights: array<vec4f, 8>,
}
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var settled_text: texture_2d<f32>;
@group(0) @binding(2) var fresh_text: texture_2d<f32>;
@group(0) @binding(3) var text_sampler: sampler;

const GRID = vec2f(92.0, 26.0);
const SPACING = 3.0;
const COLS = 30;
const ROWS = 8;
const GRID_OFFSET = vec2f(1.0, 1.0);
const BASE = vec3f(34.0, 34.0, 38.0) / 255.0;
const WHITE = vec3f(1.0);
const AMBER = vec3f(251.0, 191.0, 36.0) / 255.0;
const ERROR = vec3f(239.0, 68.0, 68.0) / 255.0;
const TEXT_ALPHA = 0.85;
// Processing dots go this far from round toward square.
const SQUARE = 0.55;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}

fn height_at(c: i32) -> f32 {
  return u.heights[c / 4][c % 4];
}

fn sd_shell(p: vec2f) -> f32 {
  let size = u.shell.xy;
  let r = min(u.shell.z, min(size.x, size.y) * 0.5);
  let q = abs(p - size * 0.5) - (size * 0.5 - vec2f(r));
  return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

fn edge_mask(c: vec2f) -> f32 {
  let r = GRID.y * 0.5;
  var d: f32;
  if (c.x < r) {
    d = r - length(c - vec2f(r, r));
  } else if (c.x > GRID.x - r) {
    d = r - length(c - vec2f(GRID.x - r, r));
  } else {
    d = min(c.y, GRID.y - c.y);
  }
  return clamp(d / 15.0, 0.0, 1.0);
}

fn dot_noise(c: f32, r: f32, seed: f32) -> f32 {
  return fract(sin(c * 12.9898 + r * 78.233 + seed) * 43758.5453);
}

fn pop_at(c: f32, r: f32, seed: f32, t: f32) -> f32 {
  let cluster = dot_noise(floor(c / 3.0), floor(r / 2.0), seed);
  let phase = (cluster * 0.75 + dot_noise(c, r, seed) * 0.25) * 6.2831853;
  let tempo = 0.5 + cluster * 0.7;
  return pow(max(sin(t * tempo + phase), 0.0), 14.0);
}

// The warning glyph: one column, rows 0-2 and 4 of a 5x5 icon centered on the grid.
fn is_icon(c: i32, r: i32) -> bool {
  return c == COLS / 2 && (r == 2 || r == 3 || r == 4 || r == 6);
}

// Box-shadow falloff for a shape distance d with blur sigma.
fn shadow(d: f32, sigma: f32) -> f32 {
  return 1.0 - smoothstep(-sigma, sigma * 2.0, d);
}

// Distance from a dot's center, round at k 0 and squarer toward 1, at about the same visual weight.
fn dot_dist(v: vec2f, k: f32) -> f32 {
  let a = abs(v);
  return mix(length(v), max(a.x, a.y) * 1.12, k);
}

// The fade over the text's top: shell color at 96%, 82%, 38%, then clear by 30 pt.
fn top_fade(y: f32) -> f32 {
  let t = clamp(y / 30.0, 0.0, 1.0);
  var cover: f32;
  if (t < 0.38) {
    cover = mix(0.96, 0.82, t / 0.38);
  } else if (t < 0.74) {
    cover = mix(0.82, 0.38, (t - 0.38) / 0.36);
  } else {
    cover = mix(0.38, 0.0, (t - 0.74) / 0.26);
  }
  return 1.0 - cover;
}

fn sample_layer(tex: texture_2d<f32>, at: vec2f) -> vec4f {
  let uv = (at - u.text.xy) / u.text.zw;
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0))) {
    return vec4f(0.0);
  }
  return textureSampleLevel(tex, text_sampler, uv, 0.0);
}

@fragment
fn fs(@builtin(position) frag: vec4f) -> @location(0) vec4f {
  let p = frag.xy / u.view.z;
  let s = u.motion.xy;
  let size = u.shell.xy;
  let anchor = u.anchor.xy + u.motion.zw;
  let lp = (p - anchor) / s + vec2f(size.x * 0.5, size.y);
  let px = 1.0 / (u.view.z * min(s.x, s.y));

  let d = sd_shell(lp);
  let inside = clamp(0.5 - d / px, 0.0, 1.0);
  let near = 1.0 - (1.0 - 0.28 * shadow(sd_shell(lp - vec2f(0.0, 1.0)), 1.5))
    * (1.0 - 0.3 * shadow(sd_shell(lp - vec2f(0.0, 8.0)), 10.0));

  var col = u.misc.yzw;
  let grid_at = (size - GRID) * 0.5;
  let gp = lp - grid_at;
  let g = (gp - GRID_OFFSET) / SPACING;
  let ci = i32(floor(g.x));
  let ri = i32(floor(g.y));
  if (inside > 0.0 && u.shell.w > 0.004 && ci >= 0 && ci < COLS && ri >= 0 && ri < ROWS) {
    let center = GRID_OFFSET + (vec2f(f32(ci), f32(ri)) + 0.5) * SPACING;
    let k = SQUARE * u.pops.y;
    let dd = dot_dist(gp - center, k);
    let mask = edge_mask(center) * u.shell.w;
    if (mask > 0.05 * u.shell.w) {
      let mode = u.look.w;
      if (mode < 0.5) {
        let wave_h = height_at(ci) * u.look.z * GRID.y * 0.45;
        let dy = abs(center.y - GRID.y * 0.5);
        if (wave_h > 0.5 && dy < wave_h) {
          let edge = 1.0 - dy / (wave_h + 0.1);
          let cov = clamp((1.0 + 0.2 * edge - dd) / px + 0.5, 0.0, 1.0);
          col = mix(col, WHITE, (0.5 + 0.5 * edge) * mask * cov);
        } else {
          col = mix(col, BASE, mask * u.look.y * clamp((0.9 - dd) / px + 0.5, 0.0, 1.0));
          let cf = f32(ci);
          let rf = f32(ri);
          let pop = pop_at(cf, rf, u.pops.w, u.pops.x) * u.pops.y;
          if (pop >= 0.02) {
            let cov = clamp((0.9 + 0.5 * pop - dd) / px + 0.5, 0.0, 1.0);
            col = mix(col, WHITE, min(1.0, pop * 2.5) * 0.7 * mask * cov);
          }
          let warm = pop_at(cf, rf, u.pops.w + 37.3, u.pops.x) * u.pops.y * u.pops.z;
          if (warm >= 0.02) {
            let cov = clamp((0.9 + 0.5 * warm - dd) / px + 0.5, 0.0, 1.0);
            col = mix(col, AMBER, min(1.0, warm * 2.5) * 0.7 * mask * cov);
          }
        }
      } else if (is_icon(ci, ri)) {
        col = mix(col, ERROR, mask * clamp((1.2 - dd) / px + 0.5, 0.0, 1.0));
      } else {
        let level = select(mask, u.misc.x * mask * 0.6, mode < 1.5);
        let tone = select(BASE, ERROR, mode < 1.5);
        col = mix(col, tone, level * clamp((0.9 - dd) / px + 0.5, 0.0, 1.0));
      }
    }
  }

  if (inside > 0.0 && u.anchor.z > 0.004) {
    let fade = top_fade(lp.y) * u.anchor.z * TEXT_ALPHA;
    // New words ride with their line as it slides, rising into place as they fade in.
    var settled = vec4f(0.0);
    var fresh = vec4f(0.0);
    for (var i = 0; i < 6; i++) {
      let line = u.lines[i];
      let at = lp - line.zw;
      if (line.y > line.x && at.y - u.text.y >= line.x && at.y - u.text.y < line.y) {
        settled += sample_layer(settled_text, at);
      }
      let rising = at - vec2f(0.0, u.text2.x);
      if (line.y > line.x && rising.y - u.text.y >= line.x && rising.y - u.text.y < line.y) {
        fresh += sample_layer(fresh_text, rising);
      }
    }
    fresh *= u.anchor.w;
    let t = (settled + fresh * (1.0 - settled.a)) * fade;
    col = col * (1.0 - t.a) + t.rgb;
  }

  let opacity = u.look.x;
  let alpha = (inside + near * (1.0 - inside)) * opacity;
  return vec4f(col * inside * opacity, alpha);
}
