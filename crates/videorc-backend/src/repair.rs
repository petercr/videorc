//! Recording quality analyzer — slice 1 of the recording lag cleanup & repair plan.
//!
//! Parses FFprobe JSON (`-show_format -show_streams -of json`) into a normalized
//! [`MediaProbe`], then classifies a recording against the plan's objective gates:
//! constant frame rate, no dropped-frame evidence, A/V skew under threshold, and the
//! presence of the streams a recording is expected to have. This is the pure,
//! deterministic core — repair-strategy selection, the backup/replace primitive, the
//! post-recording gate, and the UI are later slices. Introduced ahead of its wiring,
//! hence `allow(dead_code)`.
#![allow(dead_code)]

use std::process::Command;

use serde::{Deserialize, Serialize};

// --- Raw FFprobe JSON ---

#[derive(Debug, Deserialize)]
struct FfprobeOutput {
    #[serde(default)]
    streams: Vec<FfprobeStream>,
    format: Option<FfprobeFormat>,
}

#[derive(Debug, Deserialize)]
struct FfprobeStream {
    codec_type: Option<String>,
    codec_name: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
    r_frame_rate: Option<String>,
    avg_frame_rate: Option<String>,
    duration: Option<String>,
    nb_frames: Option<String>,
    start_time: Option<String>,
    channels: Option<u32>,
    channel_layout: Option<String>,
    sample_rate: Option<String>,
}

#[derive(Debug, Deserialize)]
struct FfprobeFormat {
    duration: Option<String>,
}

// --- Normalized probe ---

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VideoStreamInfo {
    pub codec: String,
    pub width: u32,
    pub height: u32,
    /// Average frame rate over the file (FFprobe `avg_frame_rate`).
    pub avg_fps: Option<f64>,
    /// Nominal/base frame rate (FFprobe `r_frame_rate`).
    pub nominal_fps: Option<f64>,
    pub nb_frames: Option<u64>,
    pub duration: Option<f64>,
    pub start_time: Option<f64>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AudioStreamInfo {
    pub codec: String,
    pub channels: u32,
    pub channel_layout: Option<String>,
    pub sample_rate: Option<u32>,
    pub duration: Option<f64>,
    pub start_time: Option<f64>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MediaProbe {
    pub format_duration: Option<f64>,
    pub video: Option<VideoStreamInfo>,
    pub audio: Vec<AudioStreamInfo>,
}

/// Parses FFprobe `-show_format -show_streams -of json` output into a [`MediaProbe`],
/// taking the first video stream and every audio stream and converting fraction
/// frame-rates / string durations into numbers. Malformed numeric fields become
/// `None` rather than failing the whole parse.
pub fn parse_ffprobe_json(json: &str) -> Result<MediaProbe, String> {
    let raw: FfprobeOutput =
        serde_json::from_str(json).map_err(|error| format!("invalid ffprobe json: {error}"))?;

    let video = raw
        .streams
        .iter()
        .find(|stream| stream.codec_type.as_deref() == Some("video"))
        .map(|stream| VideoStreamInfo {
            codec: stream.codec_name.clone().unwrap_or_default(),
            width: stream.width.unwrap_or(0),
            height: stream.height.unwrap_or(0),
            avg_fps: stream.avg_frame_rate.as_deref().and_then(parse_fraction),
            nominal_fps: stream.r_frame_rate.as_deref().and_then(parse_fraction),
            nb_frames: stream.nb_frames.as_deref().and_then(parse_u64),
            duration: stream.duration.as_deref().and_then(parse_f64),
            start_time: stream.start_time.as_deref().and_then(parse_f64),
        });

    let audio = raw
        .streams
        .iter()
        .filter(|stream| stream.codec_type.as_deref() == Some("audio"))
        .map(|stream| AudioStreamInfo {
            codec: stream.codec_name.clone().unwrap_or_default(),
            channels: stream.channels.unwrap_or(0),
            channel_layout: stream.channel_layout.clone(),
            sample_rate: stream
                .sample_rate
                .as_deref()
                .and_then(parse_u64)
                .map(|v| v as u32),
            duration: stream.duration.as_deref().and_then(parse_f64),
            start_time: stream.start_time.as_deref().and_then(parse_f64),
        })
        .collect();

    Ok(MediaProbe {
        format_duration: raw
            .format
            .and_then(|format| format.duration)
            .as_deref()
            .and_then(parse_f64),
        video,
        audio,
    })
}

/// Runs FFprobe on a file and parses the result.
pub fn probe_media(ffprobe_path: &str, file_path: &str) -> Result<MediaProbe, String> {
    let output = Command::new(ffprobe_path)
        .args([
            "-v",
            "error",
            "-show_format",
            "-show_streams",
            "-of",
            "json",
            file_path,
        ])
        .output()
        .map_err(|error| format!("could not run ffprobe: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "ffprobe failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    parse_ffprobe_json(&String::from_utf8_lossy(&output.stdout))
}

fn parse_fraction(value: &str) -> Option<f64> {
    let (num, den) = value.split_once('/')?;
    let num: f64 = num.trim().parse().ok()?;
    let den: f64 = den.trim().parse().ok()?;
    if den == 0.0 {
        return None;
    }
    let fps = num / den;
    if fps.is_finite() && fps > 0.0 {
        Some(fps)
    } else {
        None
    }
}

fn parse_f64(value: &str) -> Option<f64> {
    let parsed: f64 = value.trim().parse().ok()?;
    parsed.is_finite().then_some(parsed)
}

fn parse_u64(value: &str) -> Option<u64> {
    value.trim().parse().ok()
}

// --- Quality classification ---

/// Tunable thresholds for the objective quality gates.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QualityThresholds {
    /// Maximum tolerable A/V skew before flagging a resync (ms).
    pub av_skew_ms: f64,
    /// Relative difference between average and nominal fps that counts as variable
    /// frame rate (e.g. 0.01 = 1%).
    pub vfr_tolerance: f64,
    /// Relative difference between observed and expected frame counts that counts as
    /// dropped-frame evidence (e.g. 0.02 = 2%).
    pub frame_count_tolerance: f64,
}

impl Default for QualityThresholds {
    fn default() -> Self {
        Self {
            av_skew_ms: 250.0,
            vfr_tolerance: 0.01,
            frame_count_tolerance: 0.02,
        }
    }
}

/// What a recording is expected to contain, so the analyzer doesn't penalise a
/// legitimately screen-only (no-mic) capture for "missing audio".
#[derive(Debug, Clone, Copy)]
pub struct QualityExpectations {
    /// The session's intended fps (from metadata) used to judge frame pacing; falls
    /// back to the file's nominal fps when `None`.
    pub intended_fps: Option<f64>,
    /// Whether a microphone/audio source was selected for this recording.
    pub expect_audio: bool,
}

impl Default for QualityExpectations {
    fn default() -> Self {
        Self {
            intended_fps: None,
            expect_audio: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum QualityIssue {
    MissingVideo,
    MissingAudio,
    VariableFrameRate { avg_fps: f64, nominal_fps: f64 },
    DroppedFrames { observed: u64, expected: u64 },
    AvSkew { ms: f64 },
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum QualityVerdict {
    /// Passes every objective gate — deliverable as-is.
    Clean,
    /// Has only issues an FFmpeg-only repair can fix.
    Repairable,
    /// Best-effort only; surface as "not 100%" with reasons (e.g. missing streams).
    NeedsReview,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QualityReport {
    pub verdict: QualityVerdict,
    pub issues: Vec<QualityIssue>,
}

/// Classifies a probed recording against the objective gates. Frame pacing (VFR) and
/// A/V skew are repairable; missing streams need review. Frozen-segment and one-sided
/// audio detection (which need frame/signal analysis, not just metadata) are added in
/// later slices.
pub fn classify_quality(
    probe: &MediaProbe,
    thresholds: &QualityThresholds,
    expectations: &QualityExpectations,
) -> QualityReport {
    let mut issues = Vec::new();
    let mut repairable = false;
    let mut needs_review = false;

    let Some(video) = &probe.video else {
        return QualityReport {
            verdict: QualityVerdict::NeedsReview,
            issues: vec![QualityIssue::MissingVideo],
        };
    };

    // Variable frame rate: average diverges from the nominal/base rate.
    if let (Some(avg), Some(nominal)) = (video.avg_fps, video.nominal_fps)
        && nominal > 0.0
        && (avg - nominal).abs() / nominal > thresholds.vfr_tolerance
    {
        issues.push(QualityIssue::VariableFrameRate {
            avg_fps: avg,
            nominal_fps: nominal,
        });
        repairable = true;
    }

    // Dropped-frame evidence: observed frame count vs duration × fps.
    let pacing_fps = expectations
        .intended_fps
        .or(video.avg_fps)
        .or(video.nominal_fps);
    if let (Some(nb), Some(duration), Some(fps)) = (video.nb_frames, video.duration, pacing_fps) {
        let expected = (duration * fps).round() as u64;
        if expected > 0 {
            let diff = nb.abs_diff(expected);
            if (diff as f64) / (expected as f64) > thresholds.frame_count_tolerance {
                issues.push(QualityIssue::DroppedFrames {
                    observed: nb,
                    expected,
                });
                repairable = true;
            }
        }
    }

    // Audio presence + A/V skew.
    if probe.audio.is_empty() {
        if expectations.expect_audio {
            issues.push(QualityIssue::MissingAudio);
            needs_review = true;
        }
    } else if let Some(ms) = av_skew_ms(video, &probe.audio[0])
        && ms > thresholds.av_skew_ms
    {
        issues.push(QualityIssue::AvSkew { ms });
        repairable = true;
    }

    let verdict = if needs_review {
        QualityVerdict::NeedsReview
    } else if repairable {
        QualityVerdict::Repairable
    } else {
        QualityVerdict::Clean
    };
    QualityReport { verdict, issues }
}

/// A/V skew in milliseconds, preferring stream start-time offset, falling back to a
/// duration mismatch.
fn av_skew_ms(video: &VideoStreamInfo, audio: &AudioStreamInfo) -> Option<f64> {
    if let (Some(video_start), Some(audio_start)) = (video.start_time, audio.start_time) {
        return Some((video_start - audio_start).abs() * 1000.0);
    }
    if let (Some(video_duration), Some(audio_duration)) = (video.duration, audio.duration) {
        return Some((video_duration - audio_duration).abs() * 1000.0);
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    const CLEAN_JSON: &str = r#"{
        "streams": [
            {"codec_type":"video","codec_name":"h264","width":1920,"height":1080,
             "r_frame_rate":"30/1","avg_frame_rate":"30/1","duration":"10.000000",
             "nb_frames":"300","start_time":"0.000000"},
            {"codec_type":"audio","codec_name":"aac","channels":2,"channel_layout":"stereo",
             "sample_rate":"48000","duration":"10.000000","start_time":"0.000000"}
        ],
        "format": {"duration":"10.000000"}
    }"#;

    fn thresholds() -> QualityThresholds {
        QualityThresholds::default()
    }

    #[test]
    fn parses_clean_probe() {
        let probe = parse_ffprobe_json(CLEAN_JSON).unwrap();
        assert_eq!(probe.format_duration, Some(10.0));
        let video = probe.video.unwrap();
        assert_eq!(video.codec, "h264");
        assert_eq!((video.width, video.height), (1920, 1080));
        assert_eq!(video.avg_fps, Some(30.0));
        assert_eq!(video.nominal_fps, Some(30.0));
        assert_eq!(video.nb_frames, Some(300));
        assert_eq!(probe.audio.len(), 1);
        assert_eq!(probe.audio[0].channels, 2);
        assert_eq!(probe.audio[0].sample_rate, Some(48000));
    }

    #[test]
    fn parses_ntsc_and_invalid_fractions() {
        assert_eq!(parse_fraction("30/1"), Some(30.0));
        assert!((parse_fraction("30000/1001").unwrap() - 29.97).abs() < 0.01);
        assert_eq!(parse_fraction("0/0"), None);
        assert_eq!(parse_fraction("0/1"), None);
        assert_eq!(parse_fraction("notafraction"), None);
    }

    #[test]
    fn clean_recording_passes_every_gate() {
        let probe = parse_ffprobe_json(CLEAN_JSON).unwrap();
        let report = classify_quality(&probe, &thresholds(), &QualityExpectations::default());
        assert_eq!(report.verdict, QualityVerdict::Clean);
        assert!(report.issues.is_empty());
    }

    #[test]
    fn variable_frame_rate_is_repairable() {
        let json = r#"{"streams":[
            {"codec_type":"video","codec_name":"h264","width":1280,"height":720,
             "r_frame_rate":"30/1","avg_frame_rate":"24/1","duration":"10.0","nb_frames":"240","start_time":"0.0"},
            {"codec_type":"audio","codec_name":"aac","channels":2,"duration":"10.0","start_time":"0.0"}
        ]}"#;
        let probe = parse_ffprobe_json(json).unwrap();
        let report = classify_quality(&probe, &thresholds(), &QualityExpectations::default());
        assert_eq!(report.verdict, QualityVerdict::Repairable);
        assert!(matches!(
            report.issues[0],
            QualityIssue::VariableFrameRate { .. }
        ));
    }

    #[test]
    fn dropped_frames_detected_from_count_vs_duration() {
        // 30fps × 10s should be ~300 frames; 250 is well short.
        let json = r#"{"streams":[
            {"codec_type":"video","codec_name":"h264","width":1280,"height":720,
             "r_frame_rate":"30/1","avg_frame_rate":"30/1","duration":"10.0","nb_frames":"250","start_time":"0.0"},
            {"codec_type":"audio","codec_name":"aac","channels":2,"duration":"10.0","start_time":"0.0"}
        ]}"#;
        let probe = parse_ffprobe_json(json).unwrap();
        let report = classify_quality(&probe, &thresholds(), &QualityExpectations::default());
        assert_eq!(report.verdict, QualityVerdict::Repairable);
        assert!(report.issues.iter().any(|issue| matches!(
            issue,
            QualityIssue::DroppedFrames {
                observed: 250,
                expected: 300
            }
        )));
    }

    #[test]
    fn av_skew_above_threshold_is_repairable() {
        // Audio starts 500 ms after video → 500 ms skew > 250 ms.
        let json = r#"{"streams":[
            {"codec_type":"video","codec_name":"h264","width":1280,"height":720,
             "r_frame_rate":"30/1","avg_frame_rate":"30/1","duration":"10.0","nb_frames":"300","start_time":"0.0"},
            {"codec_type":"audio","codec_name":"aac","channels":2,"duration":"10.0","start_time":"0.5"}
        ]}"#;
        let probe = parse_ffprobe_json(json).unwrap();
        let report = classify_quality(&probe, &thresholds(), &QualityExpectations::default());
        assert_eq!(report.verdict, QualityVerdict::Repairable);
        assert!(report.issues.iter().any(|issue| matches!(
            issue,
            QualityIssue::AvSkew { ms } if (*ms - 500.0).abs() < 1.0
        )));
    }

    #[test]
    fn small_av_skew_passes() {
        // 100 ms skew is under the 250 ms gate.
        let json = r#"{"streams":[
            {"codec_type":"video","codec_name":"h264","width":1280,"height":720,
             "r_frame_rate":"30/1","avg_frame_rate":"30/1","duration":"10.0","nb_frames":"300","start_time":"0.0"},
            {"codec_type":"audio","codec_name":"aac","channels":2,"duration":"10.0","start_time":"0.1"}
        ]}"#;
        let probe = parse_ffprobe_json(json).unwrap();
        let report = classify_quality(&probe, &thresholds(), &QualityExpectations::default());
        assert_eq!(report.verdict, QualityVerdict::Clean);
    }

    #[test]
    fn missing_video_needs_review() {
        let json = r#"{"streams":[
            {"codec_type":"audio","codec_name":"aac","channels":2,"duration":"10.0","start_time":"0.0"}
        ]}"#;
        let probe = parse_ffprobe_json(json).unwrap();
        let report = classify_quality(&probe, &thresholds(), &QualityExpectations::default());
        assert_eq!(report.verdict, QualityVerdict::NeedsReview);
        assert_eq!(report.issues, vec![QualityIssue::MissingVideo]);
    }

    #[test]
    fn missing_audio_only_flagged_when_expected() {
        let json = r#"{"streams":[
            {"codec_type":"video","codec_name":"h264","width":1280,"height":720,
             "r_frame_rate":"30/1","avg_frame_rate":"30/1","duration":"10.0","nb_frames":"300","start_time":"0.0"}
        ]}"#;
        let probe = parse_ffprobe_json(json).unwrap();

        // A screen-only capture (no mic expected) is clean without audio.
        let lenient = QualityExpectations {
            expect_audio: false,
            ..QualityExpectations::default()
        };
        assert_eq!(
            classify_quality(&probe, &thresholds(), &lenient).verdict,
            QualityVerdict::Clean
        );

        // When audio was expected, its absence needs review.
        let report = classify_quality(&probe, &thresholds(), &QualityExpectations::default());
        assert_eq!(report.verdict, QualityVerdict::NeedsReview);
        assert_eq!(report.issues, vec![QualityIssue::MissingAudio]);
    }

    #[test]
    fn report_serializes_to_tagged_json() {
        let report = QualityReport {
            verdict: QualityVerdict::Repairable,
            issues: vec![QualityIssue::AvSkew { ms: 500.0 }],
        };
        let json = serde_json::to_string(&report).unwrap();
        assert!(json.contains("\"verdict\":\"repairable\""));
        assert!(json.contains("\"kind\":\"av-skew\""));
    }
}
