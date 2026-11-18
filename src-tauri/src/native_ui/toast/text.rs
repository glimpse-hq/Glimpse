//! Text shaping and rasterizing for the native toast, with the type scale of ToastOverlay.tsx.

use cosmic_text::{
    Attrs, Buffer, CacheKeyFlags, Family, Font, FontSystem, LayoutRun, Metrics, Shaping,
    SwashCache, SwashContent, Weight, Wrap, fontdb,
};
use std::sync::Arc;

// The CSS stack is "Inter", "SF Pro Display", system-ui: system-ui is SF on macOS and Segoe UI on Windows.
const FAMILIES: &[&str] = &["Inter", "SF Pro Display", SYSTEM_MAC, "Segoe UI"];
const SYSTEM_MAC: &str = ".SF NS";

/// The `ui-text-*` classes the toast uses, in points.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Style {
    Body,
    BodySm,
    BodySmMedium,
    LabelMedium,
}

impl Style {
    fn metrics(self) -> Metrics {
        match self {
            Style::Body => Metrics::new(13.0, 19.0),
            Style::BodySm | Style::BodySmMedium => Metrics::new(12.0, 18.0),
            Style::LabelMedium => Metrics::new(11.0, 16.0),
        }
    }

    // WebKit draws SF below 17 pt at its 17 pt optical size, plus the font's `trak` tracking.
    // cosmic-text only varies weight, so its default 28 pt design is spaced out to the same width.
    fn sf_spacing(self) -> f32 {
        match self {
            Style::Body => 0.0535,
            Style::BodySm => 0.0594,
            Style::BodySmMedium => 0.0574,
            Style::LabelMedium => 0.0633,
        }
    }

    fn weight(self) -> Weight {
        match self {
            Style::Body | Style::BodySm => Weight::NORMAL,
            Style::BodySmMedium | Style::LabelMedium => Weight::MEDIUM,
        }
    }
}

/// Shaped text with its size in points.
#[derive(Clone)]
pub struct Text {
    pub(super) buffer: Buffer,
    pub width: f32,
    pub height: f32,
}

struct Fonts {
    system: FontSystem,
    family: Option<&'static str>,
    // SF's cmap: only its own glyphs get its tracking, not Japanese or Arabic fallbacks.
    sf: Option<Arc<Font>>,
}

pub struct TextEngine {
    locale: String,
    fonts: Option<Fonts>,
    cache: SwashCache,
}

impl TextEngine {
    /// `locale` is the app's language, which picks Japanese or Chinese glyphs for shared characters.
    pub fn new(locale: &str) -> Self {
        Self {
            locale: locale.to_string(),
            fonts: None,
            cache: SwashCache::new(),
        }
    }

    fn fonts(&mut self) -> &mut Fonts {
        self.fonts.get_or_insert_with(|| {
            let mut db = fontdb::Database::new();
            db.load_system_fonts();
            let mut system = FontSystem::new_with_locale_and_db(self.locale.clone(), db);
            let face = |name: &str| {
                system
                    .db()
                    .faces()
                    .find(|f| {
                        f.style == fontdb::Style::Normal
                            && f.families.iter().any(|(n, _)| n == name)
                    })
                    .map(|f| f.id)
            };
            let family = FAMILIES.iter().copied().find(|name| face(name).is_some());
            let sf = (family == Some(SYSTEM_MAC))
                .then(|| face(SYSTEM_MAC))
                .flatten()
                .and_then(|id| system.get_font(id, Weight::NORMAL));
            Fonts { system, family, sf }
        })
    }

    /// Shapes `text`, wrapping at `max_width` points like `overflow-wrap: break-word`.
    pub fn shape(&mut self, text: &str, style: Style, max_width: Option<f32>) -> Text {
        let Fonts { system, family, sf } = self.fonts();
        let attrs = Attrs::new()
            .family(family.map_or(Family::SansSerif, Family::Name))
            .weight(style.weight())
            .cache_key_flags(CacheKeyFlags::DISABLE_HINTING);
        // The page is dir="ltr" in every language, so an Arabic line still starts on the left.
        let mut spans: Vec<(&str, Attrs)> = vec![("\u{200E}", attrs.clone())];
        match sf {
            Some(sf) => {
                let charmap = sf.as_swash().charmap();
                let tracked = attrs.clone().letter_spacing(style.sf_spacing());
                let mut start = 0;
                let mut covered = None;
                for (i, ch) in text.char_indices() {
                    let here = ch.is_whitespace() || charmap.map(ch) != 0;
                    if covered.is_some_and(|c| c != here) {
                        let span = if here { attrs.clone() } else { tracked.clone() };
                        spans.push((&text[start..i], span));
                        start = i;
                    }
                    covered = Some(here);
                }
                let span = if covered == Some(true) {
                    tracked
                } else {
                    attrs.clone()
                };
                spans.push((&text[start..], span));
            }
            None => spans.push((text, attrs.clone())),
        }
        let mut buffer = Buffer::new(system, style.metrics());
        let mut buffer_ref = buffer.borrow_with(system);
        buffer_ref.set_wrap(Wrap::WordOrGlyph);
        buffer_ref.set_size(max_width, None);
        buffer_ref.set_rich_text(spans, &attrs, Shaping::Advanced, None);
        buffer_ref.shape_until_scroll(false);
        let (width, height) = buffer
            .layout_runs()
            .fold((0.0f32, 0.0f32), |(w, h), run: LayoutRun| {
                (w.max(run.line_w), h + run.line_height)
            });
        Text {
            buffer,
            width,
            height,
        }
    }

    /// Draws `text` with its top left at `origin` points into a premultiplied RGBA image.
    pub(super) fn draw(
        &mut self,
        text: &Text,
        origin: (f32, f32),
        color: [u8; 3],
        scale: f32,
        image: &mut Image,
    ) {
        let Some(Fonts { system: fonts, .. }) = self.fonts.as_mut() else {
            return;
        };
        for run in text.buffer.layout_runs() {
            for glyph in run.glyphs {
                let baseline = ((origin.1 + run.line_y) * scale).round();
                let physical = glyph.physical((origin.0 * scale, baseline), scale);
                let Some(raster) = self.cache.get_image(fonts, physical.cache_key) else {
                    continue;
                };
                // cosmic-text doesn't re-export swash's `Source`, so its variant is read by name.
                let premultiplied = format!("{:?}", raster.source).starts_with("ColorOutline");
                let left = physical.x + raster.placement.left;
                let top = physical.y - raster.placement.top;
                let (w, h) = (
                    raster.placement.width as i32,
                    raster.placement.height as i32,
                );
                for y in 0..h {
                    for x in 0..w {
                        let i = (y * w + x) as usize;
                        let src = match raster.content {
                            SwashContent::Mask => {
                                let a = raster.data[i] as u32;
                                [
                                    color[0] as u32 * a / 255,
                                    color[1] as u32 * a / 255,
                                    color[2] as u32 * a / 255,
                                    a,
                                ]
                            }
                            SwashContent::Color => {
                                let p = &raster.data[i * 4..i * 4 + 4];
                                let a = p[3] as u32;
                                // Color outlines (Segoe UI Emoji) come premultiplied, bitmaps (Apple Color Emoji) don't.
                                let k = if premultiplied { 255 } else { a };
                                [
                                    p[0] as u32 * k / 255,
                                    p[1] as u32 * k / 255,
                                    p[2] as u32 * k / 255,
                                    a,
                                ]
                            }
                            SwashContent::SubpixelMask => continue,
                        };
                        image.blend(left + x, top + y, src);
                    }
                }
            }
        }
    }
}

/// A premultiplied RGBA8 image.
pub(super) struct Image {
    pub width: u32,
    pub height: u32,
    pub pixels: Vec<u8>,
}

impl Image {
    pub fn new(width: u32, height: u32) -> Self {
        Self {
            width,
            height,
            pixels: vec![0; (width * height * 4) as usize],
        }
    }

    fn blend(&mut self, x: i32, y: i32, src: [u32; 4]) {
        if x < 0 || y < 0 || x >= self.width as i32 || y >= self.height as i32 || src[3] == 0 {
            return;
        }
        let i = ((y as u32 * self.width + x as u32) * 4) as usize;
        let inv = 255 - src[3];
        for (c, s) in src.iter().enumerate() {
            let d = self.pixels[i + c] as u32;
            self.pixels[i + c] = (s + (d * inv + 127) / 255).min(255) as u8;
        }
    }
}
