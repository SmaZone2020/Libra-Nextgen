pub struct WindowInfo;

impl WindowInfo {
    pub fn collect() -> String {
        #[cfg(target_os = "windows")]
        {
            return Self::collect_windows();
        }
        #[cfg(not(target_os = "windows"))]
        {
            r#"{"windows":[],"supported":false}"#.to_string()
        }
    }

    #[cfg(target_os = "windows")]
    fn collect_windows() -> String {
        let mut items = Vec::new();

        unsafe {
            let cb: Box<dyn FnMut(isize) -> bool> = Box::new(|hwnd: isize| -> bool {
                if IsWindowVisible(hwnd) == 0 {
                    return true;
                }

                let mut title_buf = [0u16; 256];
                let title_len = GetWindowTextW(hwnd, title_buf.as_mut_ptr(), 256);
                let title = String::from_utf16_lossy(&title_buf[..title_len as usize]);
                if title.trim().is_empty() {
                    return true;
                }

                let mut process_id: u32 = 0;
                GetWindowThreadProcessId(hwnd, &mut process_id);

                let process_name = get_process_name(process_id);

                let mut class_buf = [0u16; 256];
                let class_len = GetClassNameW(hwnd, class_buf.as_mut_ptr(), 256);
                let class_name = String::from_utf16_lossy(&class_buf[..class_len as usize]);

                items.push(format!(
                    r#"{{"hwnd":{},"title":"{}","processId":{},"processName":"{}","className":"{}"}}"#,
                    hwnd,
                    escape(&title),
                    process_id,
                    escape(&process_name),
                    escape(&class_name),
                ));

                true
            });

            let cb_ptr: *mut Box<dyn FnMut(isize) -> bool> = Box::into_raw(Box::new(cb));
            EnumWindows(Some(enum_windows_callback), cb_ptr as isize);
            let _ = Box::from_raw(cb_ptr);
        }

        format!(
            r#"{{"windows":[{}],"supported":true}}"#,
            items.join(",")
        )
    }

    pub fn close_window(hwnd: i64) -> String {
        #[cfg(target_os = "windows")]
        unsafe {
            PostMessageW(hwnd as isize, WM_CLOSE, 0, 0);
        }
        format!(r#"{{"hwnd":{},"status":"closed"}}"#, hwnd)
    }

    pub fn minimize_window(hwnd: i64) -> String {
        #[cfg(target_os = "windows")]
        unsafe {
            ShowWindow(hwnd as isize, SW_MINIMIZE);
        }
        format!(r#"{{"hwnd":{},"status":"minimized"}}"#, hwnd)
    }

    pub fn maximize_window(hwnd: i64) -> String {
        #[cfg(target_os = "windows")]
        unsafe {
            ShowWindow(hwnd as isize, SW_MAXIMIZE);
        }
        format!(r#"{{"hwnd":{},"status":"maximized"}}"#, hwnd)
    }

    pub fn set_topmost(hwnd: i64) -> String {
        #[cfg(target_os = "windows")]
        unsafe {
            SetWindowPos(hwnd as isize, -1, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE);
        }
        format!(r#"{{"hwnd":{},"status":"topmost"}}"#, hwnd)
    }

    pub fn set_bottom(hwnd: i64) -> String {
        #[cfg(target_os = "windows")]
        unsafe {
            SetWindowPos(hwnd as isize, 1, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE);
        }
        format!(r#"{{"hwnd":{},"status":"bottom"}}"#, hwnd)
    }

    pub fn set_title(hwnd: i64, title: &str) -> String {
        #[cfg(target_os = "windows")]
        unsafe {
            let wide: Vec<u16> = title.encode_utf16().chain(std::iter::once(0)).collect();
            SetWindowTextW(hwnd as isize, wide.as_ptr());
        }
        format!(
            r#"{{"hwnd":{},"title":"{}","status":"title_changed"}}"#,
            hwnd,
            escape(title)
        )
    }
}

#[cfg(target_os = "windows")]
const WM_CLOSE: u32 = 0x0010;
#[cfg(target_os = "windows")]
const SW_MINIMIZE: i32 = 6;
#[cfg(target_os = "windows")]
const SW_MAXIMIZE: i32 = 3;
#[cfg(target_os = "windows")]
const SWP_NOMOVE: u32 = 0x0002;
#[cfg(target_os = "windows")]
const SWP_NOSIZE: u32 = 0x0001;

#[cfg(target_os = "windows")]
extern "system" {
    fn EnumWindows(
        lpEnumFunc: Option<unsafe extern "system" fn(isize, isize) -> i32>,
        lParam: isize,
    ) -> i32;
    fn IsWindowVisible(hWnd: isize) -> i32;
    fn GetWindowTextW(hWnd: isize, lpString: *mut u16, nMaxCount: i32) -> i32;
    fn SetWindowTextW(hWnd: isize, lpString: *const u16) -> i32;
    fn GetWindowThreadProcessId(hWnd: isize, lpdwProcessId: *mut u32) -> u32;
    fn GetClassNameW(hWnd: isize, lpClassName: *mut u16, nMaxCount: i32) -> i32;
    fn PostMessageW(hWnd: isize, Msg: u32, wParam: isize, lParam: isize) -> i32;
    fn ShowWindow(hWnd: isize, nCmdShow: i32) -> i32;
    fn SetWindowPos(
        hWnd: isize,
        hWndInsertAfter: isize,
        X: i32,
        Y: i32,
        cx: i32,
        cy: i32,
        uFlags: u32,
    ) -> i32;
}

#[cfg(target_os = "windows")]
unsafe extern "system" fn enum_windows_callback(hwnd: isize, lparam: isize) -> i32 {
    let cb = &mut *(lparam as *mut Box<dyn FnMut(isize) -> bool>);
    if cb(hwnd) { 1 } else { 0 }
}

#[cfg(target_os = "windows")]
fn get_process_name(pid: u32) -> String {
    // sysinfo 原生进程枚举——无子进程（进程面收敛二期，原 wmic 已移除）
    use sysinfo::{Pid, System};
    let sys = System::new_all();
    if let Some(proc) = sys.process(Pid::from_u32(pid)) {
        return proc.name().to_string_lossy().to_string();
    }
    String::new()
}

fn escape(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}
