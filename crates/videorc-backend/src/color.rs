/// Full-range BT.601 RGB to YUV conversion used by the CPU compositor and by the
/// Metal readback bridge. Keep both paths on this function until the final OBS/HD
/// colorimetry decision is made.
pub fn rgb_to_yuv_full_range_bt601(r: u8, g: u8, b: u8) -> (u8, u8, u8) {
    let r = i32::from(r);
    let g = i32::from(g);
    let b = i32::from(b);
    let y = ((77 * r + 150 * g + 29 * b) >> 8).clamp(0, 255) as u8;
    let u = (128 + ((-43 * r - 85 * g + 128 * b) >> 8)).clamp(0, 255) as u8;
    let v = (128 + ((128 * r - 107 * g - 21 * b) >> 8)).clamp(0, 255) as u8;
    (y, u, v)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rgb_to_yuv_full_range_bt601_matches_existing_primary_references() {
        assert_eq!(rgb_to_yuv_full_range_bt601(255, 0, 0), (76, 85, 255));
        assert_eq!(rgb_to_yuv_full_range_bt601(0, 255, 0), (149, 43, 21));
        assert_eq!(rgb_to_yuv_full_range_bt601(0, 0, 255), (28, 255, 107));
    }

    #[test]
    fn rgb_to_yuv_full_range_bt601_maps_black_and_white_to_full_range_luma() {
        assert_eq!(rgb_to_yuv_full_range_bt601(0, 0, 0), (0, 128, 128));
        assert_eq!(rgb_to_yuv_full_range_bt601(255, 255, 255), (255, 128, 128));
    }
}
