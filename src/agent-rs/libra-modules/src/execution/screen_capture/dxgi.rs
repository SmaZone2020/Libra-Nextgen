//! DXGI Desktop Duplication implementation (Windows 8+).

use windows::core::Interface;
use windows::Win32::Graphics::Direct3D11::*;
use windows::Win32::Graphics::Direct3D::*;
use windows::Win32::Graphics::Dxgi::*;
use windows::Win32::Graphics::Dxgi::Common::*;
use windows::Win32::System::Com::*;
use windows::Win32::Foundation::*;

pub struct DxgiDuplicator {
    device: ID3D11Device,
    context: ID3D11DeviceContext,
    duplication: IDXGIOutputDuplication,
    staging: Option<ID3D11Texture2D>,
    width: u32,
    height: u32,
    output_idx: u32,
}

impl DxgiDuplicator {
    /// Create a DXGI duplicator for the given monitor index.
    pub fn new(screen_index: u32) -> Result<Self, String> {
        unsafe {
            // COM must be initialized for this thread
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);

            let mut device: Option<ID3D11Device> = None;
            let mut context: Option<ID3D11DeviceContext> = None;
            let null_adapter: Option<&IDXGIAdapter> = None;

            let res = D3D11CreateDevice(
                null_adapter,
                D3D_DRIVER_TYPE_HARDWARE,
                HMODULE::default(),
                D3D11_CREATE_DEVICE_BGRA_SUPPORT,
                None,
                D3D11_SDK_VERSION,
                Some(&mut device as *mut Option<ID3D11Device>),
                None,
                Some(&mut context as *mut Option<ID3D11DeviceContext>),
            );

            if res.is_err() {
                // Try WARP (software) as fallback
                let res2 = D3D11CreateDevice(
                    null_adapter,
                    D3D_DRIVER_TYPE_WARP,
                    HMODULE::default(),
                    D3D11_CREATE_DEVICE_BGRA_SUPPORT,
                    None,
                    D3D11_SDK_VERSION,
                    Some(&mut device as *mut Option<ID3D11Device>),
                    None,
                    Some(&mut context as *mut Option<ID3D11DeviceContext>),
                );
                if res2.is_err() {
                    return Err(format!(
                        "D3D11CreateDevice failed: {:?} / {:?}",
                        res.unwrap_err(),
                        res2.unwrap_err()
                    ));
                }
            }

            let device = device.ok_or("No D3D11 device")?;
            let context = context.ok_or("No D3D11 context")?;

            let (duplication, width, height, output_idx) =
                setup_duplicator(&device, screen_index)?;

            let staging = create_staging_texture(&device, width, height)?;

            Ok(Self {
                device,
                context,
                duplication,
                staging: Some(staging),
                width,
                height,
                output_idx,
            })
        }
    }

    /// Recreate the duplicator after access loss (resolution change, UAC, etc.)
    fn reinit(&mut self) -> Result<(), String> {
        unsafe {
            let (dup, w, h, _idx) = setup_duplicator(&self.device, self.output_idx)?;
            self.duplication = dup;
            if w != self.width || h != self.height {
                self.staging = Some(create_staging_texture(&self.device, w, h)?);
                self.width = w;
                self.height = h;
            }
        }
        Ok(())
    }

    /// Capture one frame. Returns (rgb_pixels, width, height).
    /// Returns `Err("timeout")` if no new frame available.
    pub fn capture(&mut self) -> Result<(Vec<u8>, i32, i32), String> {
        unsafe {
            let mut frame_info = DXGI_OUTDUPL_FRAME_INFO::default();
            let mut desktop_resource: Option<IDXGIResource> = None;

            loop {
                let res = self.duplication.AcquireNextFrame(
                    100,
                    &mut frame_info,
                    &mut desktop_resource as *mut Option<IDXGIResource>,
                );

                match res {
                    Ok(()) => break,
                    Err(e) => {
                        if e.code() == DXGI_ERROR_WAIT_TIMEOUT {
                            return Err("timeout".into());
                        }
                        if e.code() == DXGI_ERROR_ACCESS_LOST {
                            self.reinit()?;
                            continue;
                        }
                        return Err(format!("AcquireNextFrame failed: {e:?}"));
                    }
                }
            }

            let resource = match desktop_resource {
                Some(r) => r,
                None => return Err("No desktop resource".into()),
            };

            // Get the desktop texture
            let desktop_tex: ID3D11Texture2D = match resource.cast() {
                Ok(t) => t,
                Err(e) => {
                    let _ = self.duplication.ReleaseFrame();
                    return Err(format!("QueryInterface ID3D11Texture2D failed: {e:?}"));
                }
            };

            // Copy to staging texture
            let staging = self.staging.as_ref().ok_or("No staging texture")?;
            self.context.CopyResource(staging, &desktop_tex);

            // Release frame before mapping (allows GPU to start next frame)
            let _ = self.duplication.ReleaseFrame();
            drop(desktop_tex);
            drop(resource);

            // Map staging texture
            let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
            self.context
                .Map(staging, 0, D3D11_MAP_READ, 0, Some(&mut mapped as *mut _))
                .map_err(|e| format!("Map failed: {e:?}"))?;

            let stride = mapped.RowPitch as usize;
            let src = std::slice::from_raw_parts(
                mapped.pData as *const u8,
                stride * self.height as usize,
            );

            // BGRA → RGB with stride
            let rgb = bgra_to_rgb_strided(src, self.width as i32, self.height as i32, stride);

            self.context.Unmap(staging, 0);

            Ok((rgb, self.width as i32, self.height as i32))
        }
    }
}

/// Set up IDXGIOutputDuplication for the given screen index.
unsafe fn setup_duplicator(
    device: &ID3D11Device,
    screen_index: u32,
) -> Result<(IDXGIOutputDuplication, u32, u32, u32), String> {
    let dxgi_device: IDXGIDevice =
        device.cast().map_err(|e| format!("cast IDXGIDevice: {e:?}"))?;
    let adapter: IDXGIAdapter =
        dxgi_device.GetAdapter().map_err(|e| format!("GetAdapter: {e:?}"))?;

    // Try the requested output index; fall back to 0
    let output = match adapter.EnumOutputs(screen_index) {
        Ok(o) => o,
        Err(_) => adapter.EnumOutputs(0).map_err(|e| format!("EnumOutputs(0): {e:?}"))?,
    };
    let actual_idx = if adapter.EnumOutputs(screen_index).is_ok() {
        screen_index
    } else {
        0
    };

    let output1: IDXGIOutput1 =
        output.cast().map_err(|e| format!("cast IDXGIOutput1: {e:?}"))?;
    let desc = output1.GetDesc().map_err(|e| format!("GetDesc: {e:?}"))?;
    let width = (desc.DesktopCoordinates.right - desc.DesktopCoordinates.left) as u32;
    let height = (desc.DesktopCoordinates.bottom - desc.DesktopCoordinates.top) as u32;

    let duplication = output1
        .DuplicateOutput(device)
        .map_err(|e| format!("DuplicateOutput: {e:?}"))?;

    Ok((duplication, width, height, actual_idx))
}

/// Create a CPU-readable staging texture.
unsafe fn create_staging_texture(
    device: &ID3D11Device,
    width: u32,
    height: u32,
) -> Result<ID3D11Texture2D, String> {
    let desc = D3D11_TEXTURE2D_DESC {
        Width: width,
        Height: height,
        MipLevels: 1,
        ArraySize: 1,
        Format: DXGI_FORMAT_B8G8R8A8_UNORM,
        SampleDesc: DXGI_SAMPLE_DESC {
            Count: 1,
            Quality: 0,
        },
        Usage: D3D11_USAGE_STAGING,
        BindFlags: 0,
        CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
        MiscFlags: 0,
    };

    let mut tex: Option<ID3D11Texture2D> = None;
    device
        .CreateTexture2D(&desc, None, Some(&mut tex as *mut _))
        .map_err(|e| format!("CreateTexture2D staging: {e:?}"))?;

    tex.ok_or("CreateTexture2D returned null".into())
}

/// Convert BGRA pixels with row stride to tightly packed RGB.
fn bgra_to_rgb_strided(src: &[u8], width: i32, height: i32, stride: usize) -> Vec<u8> {
    let w = width as usize;
    let h = height as usize;
    let mut rgb = Vec::with_capacity(w * h * 3);
    for row in 0..h {
        let row_start = row * stride;
        for col in 0..w {
            let p = row_start + col * 4;
            rgb.push(src[p + 2]); // R
            rgb.push(src[p + 1]); // G
            rgb.push(src[p]);     // B
        }
    }
    rgb
}
