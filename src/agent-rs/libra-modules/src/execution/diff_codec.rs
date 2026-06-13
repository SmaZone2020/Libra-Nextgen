//! Shared block-diff codec for screen and camera capture.
//! Computes changed 64×64 blocks, merges adjacent blocks, and encodes as JPEG.

use base64::Engine;

pub const BLOCK_SIZE: i32 = 64;

#[derive(Clone, Debug)]
pub struct BlockInfo {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

/// Compute which 64×64 blocks differ between two RGB frames.
pub fn compute_changed_blocks(
    current: &[u8],
    previous: &[u8],
    width: i32,
    height: i32,
) -> Vec<BlockInfo> {
    let blocks_x = (width + BLOCK_SIZE - 1) / BLOCK_SIZE;
    let blocks_y = (height + BLOCK_SIZE - 1) / BLOCK_SIZE;
    let mut blocks = Vec::new();

    for by in 0..blocks_y {
        for bx in 0..blocks_x {
            let x = bx * BLOCK_SIZE;
            let y = by * BLOCK_SIZE;
            let w = BLOCK_SIZE.min(width - x);
            let h = BLOCK_SIZE.min(height - y);

            if !block_equals(current, previous, x, y, w, h, width) {
                blocks.push(BlockInfo { x, y, w, h });
            }
        }
    }
    blocks
}

/// Check if a block region is identical between two frames.
pub fn block_equals(
    current: &[u8],
    previous: &[u8],
    x: i32,
    y: i32,
    w: i32,
    h: i32,
    full_width: i32,
) -> bool {
    for row in y..y + h {
        let off = (row * full_width + x) as usize * 3;
        let len = w as usize * 3;
        if current.get(off..off + len) != previous.get(off..off + len) {
            return false;
        }
    }
    true
}

/// Merge adjacent/touching blocks into larger rectangles to reduce JPEG header overhead.
pub fn merge_adjacent_blocks(blocks: &[BlockInfo]) -> Vec<BlockInfo> {
    if blocks.is_empty() {
        return vec![];
    }

    let mut merged: Vec<BlockInfo> = blocks.to_vec();
    let mut changed = true;

    while changed {
        changed = false;
        let mut new_merged: Vec<BlockInfo> = Vec::new();
        let mut used = vec![false; merged.len()];

        for i in 0..merged.len() {
            if used[i] {
                continue;
            }
            let mut cur = merged[i].clone();

            for j in i + 1..merged.len() {
                if used[j] {
                    continue;
                }

                // Horizontal merge: same y, same h, adjacent x
                if cur.y == merged[j].y && cur.h == merged[j].h {
                    if cur.x + cur.w == merged[j].x {
                        cur.w += merged[j].w;
                        used[j] = true;
                        changed = true;
                        continue;
                    }
                    if merged[j].x + merged[j].w == cur.x {
                        cur.x = merged[j].x;
                        cur.w += merged[j].w;
                        used[j] = true;
                        changed = true;
                        continue;
                    }
                }

                // Vertical merge: same x, same w, adjacent y
                if cur.x == merged[j].x && cur.w == merged[j].w {
                    if cur.y + cur.h == merged[j].y {
                        cur.h += merged[j].h;
                        used[j] = true;
                        changed = true;
                        continue;
                    }
                    if merged[j].y + merged[j].h == cur.y {
                        cur.y = merged[j].y;
                        cur.h += merged[j].h;
                        used[j] = true;
                        changed = true;
                    }
                }
            }
            new_merged.push(cur);
        }
        merged = new_merged;
    }

    merged
}

/// Encode a single changed block region as a JSON fragment with JPEG data.
pub fn encode_diff_block<F>(
    rgb: &[u8],
    full_width: i32,
    block: &BlockInfo,
    jpeg_encoder: F,
) -> String
where
    F: Fn(&[u8], i32, i32) -> Option<Vec<u8>>,
{
    let mut block_pixels = Vec::with_capacity((block.w * block.h * 3) as usize);
    for row in block.y..block.y + block.h {
        let off = (row * full_width + block.x) as usize * 3;
        let len = block.w as usize * 3;
        block_pixels.extend_from_slice(&rgb[off..off + len]);
    }

    let jpeg = jpeg_encoder(&block_pixels, block.w, block.h).unwrap_or_default();
    let b64 = base64::engine::general_purpose::STANDARD.encode(&jpeg);
    format!(
        r#"{{"x":{},"y":{},"w":{},"h":{},"data":"{}"}}"#,
        block.x, block.y, block.w, block.h, b64
    )
}
