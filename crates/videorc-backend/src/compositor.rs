use std::time::Instant;

use chrono::Utc;
use tokio::sync::watch;
use tokio::task::JoinHandle;
use tokio::time::{Duration, MissedTickBehavior};
use uuid::Uuid;

use crate::compositor_synthetic::SyntheticMovingSource;
use crate::diagnostics::{apply_compositor_stats, apply_runtime_diagnostics_snapshot};
use crate::preview_camera::{preview_camera_latest_frame_info, preview_camera_status};
use crate::preview_screen::{preview_screen_latest_frame_info, preview_screen_status};
use crate::protocol::{
    CompositorSourceKind, CompositorSourceStatus, CompositorState, CompositorStatus,
    PreviewCameraState, PreviewScreenSourceKind, PreviewScreenState, PreviewSurfaceState,
};
use crate::state::AppState;

pub type CompositorSlot = std::sync::Arc<tokio::sync::Mutex<CompositorRuntime>>;

#[derive(Debug)]
pub struct CompositorRuntime {
    pub status: CompositorStatus,
    run_id: Option<String>,
    stop_tx: Option<watch::Sender<bool>>,
    render_task: Option<JoinHandle<()>>,
}

#[derive(Debug, Clone, Copy)]
pub struct CompositorStartParams {
    pub target_fps: u32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone)]
struct CompositorMetrics {
    render_fps: f64,
    frames_rendered: u64,
    repeated_frames: u64,
    dropped_frames: u64,
    frame_age_ms: u64,
    frame_time_p95_ms: f64,
    sources: Vec<CompositorSourceStatus>,
}

pub fn initial_compositor_state() -> CompositorRuntime {
    CompositorRuntime {
        status: stopped_status(Some("Compositor is not running.".to_string())),
        run_id: None,
        stop_tx: None,
        render_task: None,
    }
}

pub async fn start_synthetic_compositor(
    state: AppState,
    params: CompositorStartParams,
) -> CompositorStatus {
    stop_current_compositor(&state).await;

    let run_id = Uuid::new_v4().to_string();
    let target_fps = params.target_fps.clamp(30, 120);
    let status = CompositorStatus {
        state: CompositorState::Live,
        target_fps,
        width: params.width.max(1),
        height: params.height.max(1),
        sources: Vec::new(),
        render_fps: None,
        frames_rendered: 0,
        repeated_frames: 0,
        dropped_frames: 0,
        frame_age_ms: None,
        frame_time_p95_ms: None,
        updated_at: Utc::now().to_rfc3339(),
        message: Some("Synthetic compositor running.".to_string()),
    };
    let (stop_tx, stop_rx) = watch::channel(false);
    let render_task = tokio::spawn(run_synthetic_compositor_loop(
        state.clone(),
        run_id.clone(),
        target_fps,
        stop_rx,
    ));

    {
        let mut compositor = state.compositor.lock().await;
        compositor.status = status.clone();
        compositor.run_id = Some(run_id);
        compositor.stop_tx = Some(stop_tx);
        compositor.render_task = Some(render_task);
    }

    state.emit_event("compositor.status", status.clone());
    status
}

pub async fn update_compositor_surface_size(
    state: &AppState,
    width: u32,
    height: u32,
) -> CompositorStatus {
    let status = {
        let mut compositor = state.compositor.lock().await;
        compositor.status.width = width.max(1);
        compositor.status.height = height.max(1);
        compositor.status.updated_at = Utc::now().to_rfc3339();
        compositor.status.clone()
    };
    state.emit_event("compositor.status", status.clone());
    status
}

pub async fn stop_compositor(state: &AppState) -> CompositorStatus {
    stop_current_compositor(state).await;
    let status = stopped_status(Some("Compositor stopped.".to_string()));
    {
        let mut compositor = state.compositor.lock().await;
        compositor.status = status.clone();
    }
    state.emit_event("compositor.status", status.clone());
    status
}

pub async fn compositor_status(state: &AppState) -> CompositorStatus {
    state.compositor.lock().await.status.clone()
}

async fn stop_current_compositor(state: &AppState) {
    let previous_task = {
        let mut compositor = state.compositor.lock().await;
        if let Some(stop_tx) = compositor.stop_tx.take() {
            let _ = stop_tx.send(true);
        }
        compositor.run_id = None;
        compositor.render_task.take()
    };

    if let Some(task) = previous_task {
        task.abort();
    }
}

async fn run_synthetic_compositor_loop(
    state: AppState,
    run_id: String,
    target_fps: u32,
    mut stop_rx: watch::Receiver<bool>,
) {
    let source = SyntheticMovingSource;
    let frame_interval = Duration::from_secs_f64(1.0 / f64::from(target_fps.max(1)));
    let mut ticker = tokio::time::interval(frame_interval);
    ticker.set_missed_tick_behavior(MissedTickBehavior::Skip);

    let mut frames_rendered = 0_u64;
    let mut frames_in_window = 0_u64;
    let mut repeated_frames = 0_u64;
    let mut dropped_frames = 0_u64;
    let mut window_started_at = Instant::now();
    let mut previous_tick_at: Option<Instant> = None;
    let mut frame_times_ms = Vec::with_capacity(128);

    loop {
        tokio::select! {
            changed = stop_rx.changed() => {
                if changed.is_err() || *stop_rx.borrow() {
                    break;
                }
            }
            _ = ticker.tick() => {
                let ticked_at = Instant::now();
                if let Some(previous_tick_at) = previous_tick_at {
                    let expected_frames =
                        (ticked_at.duration_since(previous_tick_at).as_secs_f64() / frame_interval.as_secs_f64())
                            .floor() as u64;
                    if expected_frames > 1 {
                        dropped_frames = dropped_frames.saturating_add(expected_frames - 1);
                    }
                }
                previous_tick_at = Some(ticked_at);

                let render_started_at = Instant::now();
                frames_rendered = frames_rendered.saturating_add(1);
                frames_in_window = frames_in_window.saturating_add(1);
                let (width, height) = compositor_dimensions(&state).await;
                let frame = source.render(frames_rendered, width, height);
                let sources = compositor_source_statuses(&state).await;
                let frame_age_ms = compositor_frame_age_ms(
                    &sources,
                    frame.captured_at.elapsed().as_millis() as u64,
                );
                frame_times_ms.push(render_started_at.elapsed().as_secs_f64() * 1000.0);

                let surface_status = update_preview_surface_frames(&state, frames_rendered).await;

                if window_started_at.elapsed() >= Duration::from_millis(500) {
                    let elapsed = window_started_at.elapsed().as_secs_f64().max(0.001);
                    let measured_fps = frames_in_window as f64 / elapsed;
                    let (p50, p95, p99) = frame_time_percentiles(&frame_times_ms);
                    let status = update_compositor_status(
                        &state,
                        &run_id,
                        CompositorMetrics {
                            render_fps: measured_fps,
                            frames_rendered,
                            repeated_frames,
                            dropped_frames,
                            frame_age_ms,
                            frame_time_p95_ms: p95,
                            sources,
                        },
                    )
                    .await;
                    let Some(status) = status else {
                        break;
                    };
                    let diagnostic_stats = {
                        let mut diagnostics = state.diagnostics.lock().await;
                        let next = apply_compositor_stats(
                            diagnostics.clone(),
                            target_fps,
                            measured_fps,
                            frame_age_ms,
                            repeated_frames,
                            dropped_frames,
                            p50,
                            p95,
                            p99,
                        );
                        *diagnostics = next.clone();
                        next
                    };
                    if let Some(surface_status) = surface_status {
                        state.emit_event("preview.surface.status", surface_status);
                    }
                    state.emit_event("compositor.status", status);
                    state.emit_event(
                        "diagnostics.stats",
                        apply_runtime_diagnostics_snapshot(
                            diagnostic_stats,
                            state.ffmpeg_work.snapshot(),
                        ),
                    );
                    window_started_at = Instant::now();
                    frames_in_window = 0;
                    repeated_frames = 0;
                    frame_times_ms.clear();
                }
            }
        }
    }
}

async fn compositor_dimensions(state: &AppState) -> (u32, u32) {
    let compositor = state.compositor.lock().await;
    (
        compositor.status.width.max(1),
        compositor.status.height.max(1),
    )
}

async fn update_preview_surface_frames(
    state: &AppState,
    frames_rendered: u64,
) -> Option<crate::protocol::PreviewSurfaceStatus> {
    let mut surface = state.preview_surface.lock().await;
    if surface.status.state != PreviewSurfaceState::Live {
        return None;
    }
    surface.status.frames_rendered = frames_rendered;
    surface.status.updated_at = Utc::now().to_rfc3339();
    Some(surface.status.clone())
}

async fn update_compositor_status(
    state: &AppState,
    run_id: &str,
    metrics: CompositorMetrics,
) -> Option<CompositorStatus> {
    let mut compositor = state.compositor.lock().await;
    if compositor.run_id.as_deref() != Some(run_id) {
        return None;
    }
    compositor.status.state = CompositorState::Live;
    compositor.status.render_fps = Some(metrics.render_fps);
    compositor.status.frames_rendered = metrics.frames_rendered;
    compositor.status.repeated_frames = metrics.repeated_frames;
    compositor.status.dropped_frames = metrics.dropped_frames;
    compositor.status.frame_age_ms = Some(metrics.frame_age_ms);
    compositor.status.frame_time_p95_ms = Some(metrics.frame_time_p95_ms);
    compositor.status.sources = metrics.sources;
    compositor.status.updated_at = Utc::now().to_rfc3339();
    Some(compositor.status.clone())
}

async fn compositor_source_statuses(state: &AppState) -> Vec<CompositorSourceStatus> {
    let camera = preview_camera_status(state).await;
    let camera_frame = preview_camera_latest_frame_info(state).await;
    let screen = preview_screen_status(state).await;
    let screen_frame = preview_screen_latest_frame_info(state).await;

    let mut sources = Vec::with_capacity(2);
    if camera.camera_id.is_some() || camera.state == PreviewCameraState::Live {
        sources.push(CompositorSourceStatus {
            kind: CompositorSourceKind::Camera,
            state: camera_state_name(&camera.state).to_string(),
            source_id: camera.camera_id,
            sequence: camera_frame.map(|frame| frame.sequence).or(camera.sequence),
            width: camera_frame.map(|frame| frame.width).or(camera.width),
            height: camera_frame.map(|frame| frame.height).or(camera.height),
            source_fps: camera.source_fps,
            frame_age_ms: camera_frame
                .map(|frame| frame.frame_age_ms)
                .or(camera.frame_age_ms),
            message: camera.message,
        });
    }
    if screen.source_id.is_some() || screen.state == PreviewScreenState::Live {
        let kind = match screen.source_kind {
            Some(PreviewScreenSourceKind::Window) => CompositorSourceKind::Window,
            Some(PreviewScreenSourceKind::Screen) | None => CompositorSourceKind::Screen,
        };
        sources.push(CompositorSourceStatus {
            kind,
            state: screen_state_name(&screen.state).to_string(),
            source_id: screen.source_id,
            sequence: screen_frame.map(|frame| frame.sequence).or(screen.sequence),
            width: screen_frame.map(|frame| frame.width).or(screen.width),
            height: screen_frame.map(|frame| frame.height).or(screen.height),
            source_fps: screen.source_fps,
            frame_age_ms: screen_frame
                .map(|frame| frame.frame_age_ms)
                .or(screen.frame_age_ms),
            message: screen.message,
        });
    }
    sources
}

fn compositor_frame_age_ms(sources: &[CompositorSourceStatus], fallback: u64) -> u64 {
    sources
        .iter()
        .filter_map(|source| source.frame_age_ms)
        .max()
        .unwrap_or(fallback)
}

fn camera_state_name(state: &PreviewCameraState) -> &'static str {
    match state {
        PreviewCameraState::DeviceMissing => "device-missing",
        PreviewCameraState::PermissionNeeded => "permission-needed",
        PreviewCameraState::Starting => "starting",
        PreviewCameraState::Live => "live",
        PreviewCameraState::Failed => "failed",
    }
}

fn screen_state_name(state: &PreviewScreenState) -> &'static str {
    match state {
        PreviewScreenState::SourceMissing => "source-missing",
        PreviewScreenState::PermissionNeeded => "permission-needed",
        PreviewScreenState::Starting => "starting",
        PreviewScreenState::Live => "live",
        PreviewScreenState::Failed => "failed",
    }
}

fn stopped_status(message: Option<String>) -> CompositorStatus {
    CompositorStatus {
        state: CompositorState::Stopped,
        target_fps: 0,
        width: 0,
        height: 0,
        sources: Vec::new(),
        render_fps: None,
        frames_rendered: 0,
        repeated_frames: 0,
        dropped_frames: 0,
        frame_age_ms: None,
        frame_time_p95_ms: None,
        updated_at: Utc::now().to_rfc3339(),
        message,
    }
}

fn frame_time_percentiles(values: &[f64]) -> (f64, f64, f64) {
    if values.is_empty() {
        return (0.0, 0.0, 0.0);
    }
    let mut sorted = values.to_vec();
    sorted.sort_by(|left, right| left.total_cmp(right));
    (
        percentile(&sorted, 50),
        percentile(&sorted, 95),
        percentile(&sorted, 99),
    )
}

fn percentile(sorted: &[f64], p: u32) -> f64 {
    let index = (((p as f64 / 100.0) * sorted.len() as f64).ceil() as usize)
        .saturating_sub(1)
        .min(sorted.len() - 1);
    sorted[index]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::Database;
    use tokio::sync::broadcast;

    fn test_state() -> AppState {
        let (events, _) = broadcast::channel(16);
        AppState::new(
            "test-token".to_string(),
            1234,
            events,
            Database::open_in_memory_for_tests(),
        )
    }

    #[tokio::test]
    async fn synthetic_compositor_reports_render_cadence() {
        let state = test_state();
        start_synthetic_compositor(
            state.clone(),
            CompositorStartParams {
                target_fps: 60,
                width: 640,
                height: 360,
            },
        )
        .await;

        tokio::time::sleep(Duration::from_millis(650)).await;
        let status = compositor_status(&state).await;
        stop_compositor(&state).await;

        assert_eq!(status.state, CompositorState::Live);
        assert!(status.frames_rendered >= 30);
        assert!(status.render_fps.unwrap_or_default() >= 30.0);
        assert_eq!(status.width, 640);
        assert_eq!(status.height, 360);
    }

    #[test]
    fn compositor_frame_age_uses_latest_real_source_age() {
        let sources = vec![
            CompositorSourceStatus {
                kind: CompositorSourceKind::Camera,
                state: "live".to_string(),
                source_id: Some("camera:1".to_string()),
                sequence: Some(12),
                width: Some(640),
                height: Some(360),
                source_fps: Some(60.0),
                frame_age_ms: Some(42),
                message: None,
            },
            CompositorSourceStatus {
                kind: CompositorSourceKind::Screen,
                state: "source-missing".to_string(),
                source_id: Some("screen:1".to_string()),
                sequence: None,
                width: None,
                height: None,
                source_fps: None,
                frame_age_ms: Some(130),
                message: Some("Screen missing".to_string()),
            },
        ];

        assert_eq!(compositor_frame_age_ms(&sources, 0), 130);
    }
}
