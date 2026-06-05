//! Metal/GPU compositor core (plan Phase 3).
//!
//! The shipping compositor composes frames with a CPU YUV420P loop. OBS composes on the
//! GPU. This module is the GPU foundation: it creates a Metal device and renders an
//! offscreen render target, proving the GPU compositing path works on this hardware
//! before it is wired into the live preview/recording hot path (the remaining
//! integration, which needs on-device visual validation).
//!
//! macOS-only. Everything here renders to an offscreen `MTLTexture` and reads the pixels
//! back, so it is testable headlessly (no window) wherever a Metal device is available.

#![cfg(target_os = "macos")]
#![allow(dead_code)]

use std::ffi::c_void;
use std::ptr::NonNull;

use objc2_metal::{
    MTLClearColor, MTLCommandBuffer, MTLCommandEncoder, MTLCommandQueue,
    MTLCreateSystemDefaultDevice, MTLDevice, MTLLoadAction, MTLOrigin, MTLPixelFormat, MTLRegion,
    MTLRenderPassDescriptor, MTLSize, MTLStoreAction, MTLTexture, MTLTextureDescriptor,
    MTLTextureUsage,
};

/// One solid-colour pixel read back from a Metal render target, as BGRA8 bytes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Bgra8(pub [u8; 4]);

/// Render a solid clear colour into an offscreen BGRA8 texture and read the pixels back.
/// `rgba` components are 0.0..=1.0. Returns the full BGRA8 buffer (`width*height*4` bytes)
/// or `None` when no Metal device is available (e.g. a sandbox without GPU access), so
/// callers/tests degrade gracefully rather than panic.
pub fn metal_clear_probe(width: usize, height: usize, rgba: [f64; 4]) -> Option<Vec<u8>> {
    let device = MTLCreateSystemDefaultDevice()?;
    let queue = device.newCommandQueue()?;

    let descriptor = unsafe {
        MTLTextureDescriptor::texture2DDescriptorWithPixelFormat_width_height_mipmapped(
            MTLPixelFormat::BGRA8Unorm,
            width,
            height,
            false,
        )
    };
    descriptor.setUsage(MTLTextureUsage::RenderTarget | MTLTextureUsage::ShaderRead);
    let texture = device.newTextureWithDescriptor(&descriptor)?;

    let pass = MTLRenderPassDescriptor::new();
    let attachment = unsafe { pass.colorAttachments().objectAtIndexedSubscript(0) };
    attachment.setTexture(Some(&texture));
    attachment.setLoadAction(MTLLoadAction::Clear);
    attachment.setClearColor(MTLClearColor {
        red: rgba[0],
        green: rgba[1],
        blue: rgba[2],
        alpha: rgba[3],
    });
    attachment.setStoreAction(MTLStoreAction::Store);

    let command_buffer = queue.commandBuffer()?;
    let encoder = command_buffer.renderCommandEncoderWithDescriptor(&pass)?;
    encoder.endEncoding();
    command_buffer.commit();
    command_buffer.waitUntilCompleted();

    let bytes_per_row = width * 4;
    let mut out = vec![0u8; bytes_per_row * height];
    let region = MTLRegion {
        origin: MTLOrigin { x: 0, y: 0, z: 0 },
        size: MTLSize {
            width,
            height,
            depth: 1,
        },
    };
    unsafe {
        let ptr = NonNull::new(out.as_mut_ptr() as *mut c_void)?;
        texture.getBytes_bytesPerRow_fromRegion_mipmapLevel(ptr, bytes_per_row, region, 0);
    }
    Some(out)
}

/// True when a Metal device is available on this machine.
pub fn metal_available() -> bool {
    MTLCreateSystemDefaultDevice().is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn metal_clear_renders_the_requested_colour_or_skips_without_a_gpu() {
        // Clear to opaque red. In BGRA8 that is [B=0, G=0, R=255, A=255].
        let Some(pixels) = metal_clear_probe(4, 4, [1.0, 0.0, 0.0, 1.0]) else {
            eprintln!("skipping: no Metal device available in this environment");
            return;
        };
        assert_eq!(pixels.len(), 4 * 4 * 4);
        // Every pixel is the clear colour.
        for chunk in pixels.chunks_exact(4) {
            assert_eq!(chunk[0], 0, "blue");
            assert_eq!(chunk[1], 0, "green");
            assert_eq!(chunk[2], 255, "red");
            assert_eq!(chunk[3], 255, "alpha");
        }
    }
}
