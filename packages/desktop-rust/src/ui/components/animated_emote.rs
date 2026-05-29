use futures::AsyncReadExt as _;
use gpui::{
    AnyElement, App, Context, Entity, ImageSource, ObjectFit, Render, RenderImage, SharedString,
    Task, Window, div, img, prelude::*,
};
use image::{
    AnimationDecoder, DynamicImage, Frame, Rgba, codecs::gif::GifDecoder, codecs::webp::WebPDecoder,
};
use std::{
    collections::HashMap,
    io::Cursor,
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, Instant},
};

#[derive(Clone)]
enum CachedAnimatedEmote {
    Loading,
    Ready(Arc<AnimatedEmoteFrames>),
    Failed,
}

struct AnimatedEmoteFrames {
    frames: Vec<Arc<RenderImage>>,
    delays: Vec<Duration>,
}

pub fn animated_emote(
    id: impl Into<String>,
    image_url: impl Into<String>,
    fallback_text: impl Into<SharedString>,
    window: &mut Window,
    cx: &mut App,
) -> Entity<AnimatedEmote> {
    let element_id = id.into();
    let image_url = image_url.into();
    let fallback_text = fallback_text.into();
    let state_key = format!("animated-emote-{element_id}");

    let emote = window.use_keyed_state(state_key, cx, {
        let element_id = element_id.clone();
        let image_url = image_url.clone();
        let fallback_text = fallback_text.clone();
        move |_, cx| {
            AnimatedEmote::new(
                element_id.clone(),
                image_url.clone(),
                fallback_text.clone(),
                cx,
            )
        }
    });

    emote.update(cx, |emote, cx| {
        emote.set_content(
            element_id.clone(),
            image_url.clone(),
            fallback_text.clone(),
            cx,
        )
    });

    emote
}

pub struct AnimatedEmote {
    element_id: String,
    image_url: String,
    fallback_text: SharedString,
    current_frame: usize,
    last_frame_time: Option<Instant>,
    pending_refresh_task: Option<Task<()>>,
}

impl AnimatedEmote {
    fn new(
        element_id: String,
        image_url: String,
        fallback_text: SharedString,
        cx: &mut Context<Self>,
    ) -> Self {
        let this = Self {
            element_id,
            image_url,
            fallback_text,
            current_frame: 0,
            last_frame_time: None,
            pending_refresh_task: None,
        };

        this.ensure_cached(cx);
        this
    }

    fn set_content(
        &mut self,
        element_id: String,
        image_url: String,
        fallback_text: SharedString,
        cx: &mut Context<Self>,
    ) {
        let url_changed = self.image_url != image_url;

        self.element_id = element_id;
        self.image_url = image_url;
        self.fallback_text = fallback_text;

        if url_changed {
            self.current_frame = 0;
            self.last_frame_time = None;
            self.pending_refresh_task = None;
        }

        self.ensure_cached(cx);
    }

    fn ensure_cached(&self, cx: &mut Context<Self>) {
        let should_load = {
            let mut cache = animated_emote_cache().lock().unwrap();
            if cache.contains_key(&self.image_url) {
                false
            } else {
                cache.insert(self.image_url.clone(), CachedAnimatedEmote::Loading);
                true
            }
        };

        if !should_load {
            return;
        }

        let image_url = self.image_url.clone();
        let http_client = cx.http_client();

        cx.spawn(async move |this, cx| {
            let load_url = image_url.clone();
            let entry = cx
                .background_executor()
                .spawn(async move { load_animated_emote_frames(&load_url, http_client).await })
                .await
                .map(CachedAnimatedEmote::Ready)
                .unwrap_or_else(|error| {
                    eprintln!("failed to load animated emote {image_url}: {error}");
                    CachedAnimatedEmote::Failed
                });

            animated_emote_cache()
                .lock()
                .unwrap()
                .insert(image_url, entry);

            let _ = this.update(cx, |this, cx| {
                this.pending_refresh_task = None;
                cx.notify();
            });
        })
        .detach();
    }

    fn cached_frames(&self) -> Option<CachedAnimatedEmote> {
        animated_emote_cache()
            .lock()
            .unwrap()
            .get(&self.image_url)
            .cloned()
    }

    fn schedule_refresh_poll(&mut self, cx: &mut Context<Self>) {
        if self.pending_refresh_task.is_some() {
            return;
        }

        self.pending_refresh_task = Some(cx.spawn(async move |this, cx| {
            cx.background_executor()
                .timer(Duration::from_millis(100))
                .await;

            let _ = this.update(cx, |this, cx| {
                this.pending_refresh_task = None;
                cx.notify();
            });
        }));
    }

    fn render_loaded_frame(&mut self, frames: &AnimatedEmoteFrames, window: &Window) -> AnyElement {
        if frames.frames.len() > 1 {
            advance_frame(
                &mut self.current_frame,
                &mut self.last_frame_time,
                &frames.delays,
                Instant::now(),
            );
            window.request_animation_frame();
        } else {
            self.current_frame = 0;
            self.last_frame_time = None;
        }

        let frame = frames.frames[self.current_frame.min(frames.frames.len() - 1)].clone();

        img(ImageSource::Render(frame))
            .id(self.element_id.clone())
            .h_full()
            .w_full()
            .object_fit(ObjectFit::Contain)
            .into_any_element()
    }

    fn render_remote_fallback(&self) -> AnyElement {
        img(ImageSource::from(self.image_url.clone()))
            .id(self.element_id.clone())
            .h_full()
            .w_full()
            .object_fit(ObjectFit::Contain)
            .with_loading({
                let fallback_text = self.fallback_text.clone();
                move || fallback_text.clone().into_any_element()
            })
            .with_fallback({
                let fallback_text = self.fallback_text.clone();
                move || fallback_text.clone().into_any_element()
            })
            .into_any_element()
    }

    fn render_loading(&mut self, cx: &mut Context<Self>) -> AnyElement {
        self.schedule_refresh_poll(cx);
        div().child(self.fallback_text.clone()).into_any_element()
    }
}

impl Render for AnimatedEmote {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl gpui::IntoElement {
        match self.cached_frames() {
            Some(CachedAnimatedEmote::Ready(frames)) => self.render_loaded_frame(&frames, window),
            Some(CachedAnimatedEmote::Failed) => self.render_remote_fallback(),
            Some(CachedAnimatedEmote::Loading) | None => self.render_loading(cx),
        }
    }
}

fn animated_emote_cache() -> &'static Mutex<HashMap<String, CachedAnimatedEmote>> {
    static CACHE: OnceLock<Mutex<HashMap<String, CachedAnimatedEmote>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

async fn load_animated_emote_frames(
    image_url: &str,
    http_client: Arc<dyn gpui::http_client::HttpClient>,
) -> Result<Arc<AnimatedEmoteFrames>, String> {
    let mut response = http_client
        .get(image_url, ().into(), true)
        .await
        .map_err(|error| error.to_string())?;
    let mut bytes = Vec::new();

    response
        .body_mut()
        .read_to_end(&mut bytes)
        .await
        .map_err(|error| error.to_string())?;

    if !response.status().is_success() {
        return Err(format!("unexpected http status {}", response.status()));
    }

    decode_animated_emote_frames(&bytes)
}

fn decode_animated_emote_frames(bytes: &[u8]) -> Result<Arc<AnimatedEmoteFrames>, String> {
    let format = image::guess_format(bytes).map_err(|error| error.to_string())?;

    let frames = match format {
        image::ImageFormat::Gif => {
            let decoder = GifDecoder::new(Cursor::new(bytes)).map_err(|error| error.to_string())?;
            let mut frames = Vec::new();

            for frame in decoder.into_frames() {
                let mut frame = frame.map_err(|error| error.to_string())?;
                swap_rgba_to_bgra(frame.buffer_mut());
                frames.push(frame);
            }

            frames
        }
        image::ImageFormat::WebP => {
            let mut decoder =
                WebPDecoder::new(Cursor::new(bytes)).map_err(|error| error.to_string())?;

            if decoder.has_animation() {
                let _ = decoder.set_background_color(Rgba([0, 0, 0, 0]));
                let mut frames = Vec::new();

                for frame in decoder.into_frames() {
                    let mut frame = frame.map_err(|error| error.to_string())?;
                    swap_rgba_to_bgra(frame.buffer_mut());
                    frames.push(frame);
                }

                frames
            } else {
                let mut data = DynamicImage::from_decoder(decoder)
                    .map_err(|error| error.to_string())?
                    .into_rgba8();
                swap_rgba_to_bgra(&mut data);
                vec![Frame::new(data)]
            }
        }
        _ => {
            let mut data = image::load_from_memory_with_format(bytes, format)
                .map_err(|error| error.to_string())?
                .into_rgba8();
            swap_rgba_to_bgra(&mut data);
            vec![Frame::new(data)]
        }
    };

    if frames.is_empty() {
        return Err(String::from("decoded emote contained no frames"));
    }

    split_render_image(Arc::new(RenderImage::new(frames)))
}

fn split_render_image(render_image: Arc<RenderImage>) -> Result<Arc<AnimatedEmoteFrames>, String> {
    let frame_count = render_image.frame_count();

    if frame_count == 0 {
        return Err(String::from("render image contained no frames"));
    }

    let mut frames = Vec::with_capacity(frame_count);
    let mut delays = Vec::with_capacity(frame_count);

    for frame_index in 0..frame_count {
        let raw = render_image
            .as_bytes(frame_index)
            .ok_or_else(|| format!("missing frame bytes at index {frame_index}"))?
            .to_vec();
        let size = render_image.size(frame_index);
        let width = u32::try_from(size.width.0)
            .map_err(|_| format!("invalid frame width {}", size.width.0))?;
        let height = u32::try_from(size.height.0)
            .map_err(|_| format!("invalid frame height {}", size.height.0))?;
        let delay = render_image.delay(frame_index);
        let buffer = image::RgbaImage::from_raw(width, height, raw)
            .ok_or_else(|| format!("failed to rebuild frame buffer at index {frame_index}"))?;

        frames.push(Arc::new(RenderImage::new(vec![Frame::from_parts(
            buffer, 0, 0, delay,
        )])));
        delays.push(Duration::from(delay));
    }

    Ok(Arc::new(AnimatedEmoteFrames { frames, delays }))
}

fn swap_rgba_to_bgra(data: &mut image::RgbaImage) {
    for pixel in data.chunks_exact_mut(4) {
        pixel.swap(0, 2);
    }
}

fn advance_frame(
    current_frame: &mut usize,
    last_frame_time: &mut Option<Instant>,
    delays: &[Duration],
    now: Instant,
) {
    if delays.is_empty() {
        *current_frame = 0;
        *last_frame_time = None;
        return;
    }

    *current_frame = (*current_frame).min(delays.len() - 1);

    if let Some(last_frame_at) = last_frame_time {
        let elapsed = now - *last_frame_at;
        let frame_duration = delays[*current_frame];

        if elapsed >= frame_duration {
            *current_frame = (*current_frame + 1) % delays.len();
            *last_frame_time = Some(now - (elapsed - frame_duration));
        }
    } else {
        *last_frame_time = Some(now);
    }
}

#[cfg(test)]
mod tests {
    use super::{advance_frame, split_render_image};
    use gpui::RenderImage;
    use image::{Delay, Frame, Rgba, RgbaImage};
    use std::sync::Arc;
    use std::time::{Duration, Instant};

    #[test]
    fn split_render_image_preserves_frame_count_and_delay() {
        let first = Frame::from_parts(
            RgbaImage::from_pixel(2, 1, Rgba([0, 0, 0, 255])),
            0,
            0,
            Delay::from_numer_denom_ms(80, 1),
        );
        let second = Frame::from_parts(
            RgbaImage::from_pixel(2, 1, Rgba([255, 255, 255, 255])),
            0,
            0,
            Delay::from_numer_denom_ms(120, 1),
        );
        let render_image = Arc::new(RenderImage::new(vec![first, second]));

        let frames = split_render_image(render_image).expect("should split render image");

        assert_eq!(frames.frames.len(), 2);
        assert_eq!(frames.frames[0].frame_count(), 1);
        assert_eq!(frames.frames[1].frame_count(), 1);
        assert_eq!(frames.delays[0], Duration::from_millis(80));
        assert_eq!(frames.delays[1], Duration::from_millis(120));
    }

    #[test]
    fn advance_frame_rolls_forward_after_delay() {
        let delays = [Duration::from_millis(50), Duration::from_millis(75)];
        let start = Instant::now();
        let mut current_frame = 0;
        let mut last_frame_time = Some(start);

        advance_frame(
            &mut current_frame,
            &mut last_frame_time,
            &delays,
            start + Duration::from_millis(60),
        );

        assert_eq!(current_frame, 1);
        assert!(last_frame_time.is_some());
    }

    #[test]
    fn animated_emote_loading_is_offloaded_to_background_executor() {
        let source = include_str!("animated_emote.rs");

        assert!(
            source.contains("cx\n                .background_executor()\n                .spawn(async move { load_animated_emote_frames"),
            "animated emote fetch/decode must run on GPUI background executor, not the foreground UI task"
        );
    }
}
