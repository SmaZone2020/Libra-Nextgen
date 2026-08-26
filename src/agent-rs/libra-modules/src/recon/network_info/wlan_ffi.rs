//! Win32 Wlan API via raw FFI for nearby AP scanning.

use std::collections::HashMap;

#[derive(Clone)]
pub(super) struct WifiApInfo {
    pub ssid: String,
    pub auth: String,
    pub encryption: String,
    pub bssid: String,
    pub signal: u32,
    pub band: String,
}

#[cfg(target_os = "windows")]
#[allow(non_camel_case_types, non_snake_case)]
mod wlan_ffi {
    pub type HANDLE = *mut std::ffi::c_void;
    pub type DWORD = u32;
    pub type BOOL = i32;
    pub type ULONG = u32;
    pub type ULONGLONG = u64;
    pub type LONG = i32;
    pub type USHORT = u16;
    pub type UCHAR = u8;

    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct GUID {
        pub Data1: u32,
        pub Data2: u16,
        pub Data3: u16,
        pub Data4: [u8; 8],
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct DOT11_SSID {
        pub uSSIDLength: ULONG,
        pub ucSSID: [UCHAR; 32],
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct WLAN_INTERFACE_INFO {
        pub InterfaceGuid: GUID,
        pub strInterfaceDescription: [u16; 256],
        pub isState: u32,
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct WLAN_INTERFACE_INFO_LIST {
        pub dwNumberOfItems: DWORD,
        pub dwIndex: DWORD,
        pub InterfaceInfo: [WLAN_INTERFACE_INFO; 1],
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct WLAN_AVAILABLE_NETWORK {
        pub strProfileName: [u16; 256],
        pub dot11Ssid: DOT11_SSID,
        pub dot11BssType: DWORD,
        pub uNumberOfBssids: DWORD,
        pub bNetworkConnectable: BOOL,
        pub wlanNotConnectableReason: DWORD,
        pub uNumberOfPhyTypes: DWORD,
        pub dot11PhyTypes: [DWORD; 8],
        pub bMorePhyTypes: BOOL,
        pub wlanSignalQuality: DWORD,
        pub bSecurityEnabled: BOOL,
        pub dot11DefaultAuthAlgorithm: DWORD,
        pub dot11DefaultCipherAlgorithm: DWORD,
        pub dwFlags: DWORD,
        pub dwReserved: DWORD,
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct WLAN_AVAILABLE_NETWORK_LIST {
        pub dwNumberOfItems: DWORD,
        pub dwIndex: DWORD,
        pub Network: [WLAN_AVAILABLE_NETWORK; 1],
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct WLAN_RATE_SET {
        pub uRateSetLength: ULONG,
        pub usRateSet: [USHORT; 126],
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct WLAN_BSS_ENTRY {
        pub dot11Ssid: DOT11_SSID,
        pub uPhyId: DWORD,
        pub dot11Bssid: [UCHAR; 6],
        _pad1: u16,
        pub dot11BssType: DWORD,
        pub dot11BssPhyType: DWORD,
        pub lRssi: LONG,
        pub uLinkQuality: DWORD,
        pub bInRegDomain: UCHAR,
        _pad2: UCHAR,
        pub usBeaconPeriod: USHORT,
        _pad3: DWORD,
        pub ullTimestamp: ULONGLONG,
        pub ullHostTimestamp: ULONGLONG,
        pub usCapabilityInformation: USHORT,
        _pad4: USHORT,
        pub ulChCenterFrequency: DWORD,
        pub wlanRateSet: WLAN_RATE_SET,
        pub ulIeOffset: ULONG,
        pub ulIeSize: ULONG,
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct WLAN_BSS_LIST {
        pub dwTotalSize: DWORD,
        pub dwNumberOfItems: DWORD,
        pub wlanBssEntries: [WLAN_BSS_ENTRY; 1],
    }

    extern "system" {
        pub fn WlanOpenHandle(
            dwClientVersion: DWORD,
            pReserved: *const std::ffi::c_void,
            pdwNegotiatedVersion: *mut DWORD,
            phClientHandle: *mut HANDLE,
        ) -> DWORD;

        pub fn WlanCloseHandle(hClientHandle: HANDLE, pReserved: *const std::ffi::c_void) -> DWORD;

        pub fn WlanEnumInterfaces(
            hClientHandle: HANDLE,
            pReserved: *const std::ffi::c_void,
            ppInterfaceList: *mut *mut WLAN_INTERFACE_INFO_LIST,
        ) -> DWORD;

        pub fn WlanGetAvailableNetworkList(
            hClientHandle: HANDLE,
            pInterfaceGuid: *const GUID,
            dwFlags: DWORD,
            pReserved: *const std::ffi::c_void,
            ppAvailableNetworkList: *mut *mut WLAN_AVAILABLE_NETWORK_LIST,
        ) -> DWORD;

        pub fn WlanGetNetworkBssList(
            hClientHandle: HANDLE,
            pInterfaceGuid: *const GUID,
            pDot11Ssid: *const DOT11_SSID,
            dot11BssType: DWORD,
            bSecurityEnabled: BOOL,
            pReserved: *const std::ffi::c_void,
            ppWlanBssList: *mut *mut WLAN_BSS_LIST,
        ) -> DWORD;

        pub fn WlanFreeMemory(pMemory: *const std::ffi::c_void);
    }
}

#[cfg(target_os = "windows")]
fn freq_to_band_internal(freq_khz: u32) -> &'static str {
    if freq_khz == 0 {
        "未知"
    } else if freq_khz < 3_000_000 {
        "2.4GHz"
    } else if freq_khz < 6_000_000 {
        "5GHz"
    } else {
        "6GHz"
    }
}

#[cfg(target_os = "windows")]
pub(super) fn scan_wifi_wlanapi() -> Result<Vec<WifiApInfo>, String> {
    use wlan_ffi::*;

    const FLAG_ADHOC: DWORD = 1;
    const FLAG_HIDDEN: DWORD = 2;

    unsafe {
        let mut handle: HANDLE = std::ptr::null_mut();
        let mut version = 0u32;

        if WlanOpenHandle(2, std::ptr::null(), &mut version, &mut handle) != 0 {
            return Err("WlanOpenHandle failed".into());
        }

        let mut if_list_ptr: *mut WLAN_INTERFACE_INFO_LIST = std::ptr::null_mut();
        if WlanEnumInterfaces(handle, std::ptr::null(), &mut if_list_ptr) != 0 {
            WlanCloseHandle(handle, std::ptr::null());
            return Err("WlanEnumInterfaces failed".into());
        }

        let mut result_map: HashMap<String, WifiApInfo> = HashMap::new();
        let if_count = (*if_list_ptr).dwNumberOfItems as usize;

        for i in 0..if_count {
            let if_info = &*((*if_list_ptr).InterfaceInfo.as_ptr().add(i));
            let guid_ptr = &if_info.InterfaceGuid as *const GUID;

            // First pass: collect auth + encryption per SSID from available network list
            let mut sec_map: HashMap<String, (String, String)> = HashMap::new();
            let mut net_list_ptr: *mut WLAN_AVAILABLE_NETWORK_LIST = std::ptr::null_mut();
            let flags = FLAG_ADHOC | FLAG_HIDDEN;
            if WlanGetAvailableNetworkList(
                handle,
                guid_ptr,
                flags,
                std::ptr::null(),
                &mut net_list_ptr,
            ) == 0
                && !net_list_ptr.is_null()
            {
                let net_count = (*net_list_ptr).dwNumberOfItems as usize;
                for j in 0..net_count {
                    let net = &*((*net_list_ptr).Network.as_ptr().add(j));
                    let ssid_len = net.dot11Ssid.uSSIDLength as usize;
                    if ssid_len == 0 {
                        continue;
                    }
                    let ssid_bytes = &net.dot11Ssid.ucSSID[..ssid_len];
                    let ssid = String::from_utf8_lossy(ssid_bytes).to_string();
                    if ssid.is_empty() {
                        continue;
                    }
                    let auth = auth_algo_label(net.dot11DefaultAuthAlgorithm);
                    let enc = cipher_algo_label(net.dot11DefaultCipherAlgorithm);
                    sec_map.entry(ssid).or_insert((auth, enc));
                }
                WlanFreeMemory(net_list_ptr as *const _);
            }

            // Second pass: collect BSS entries with BSSID, signal, band
            let mut bss_list_ptr: *mut WLAN_BSS_LIST = std::ptr::null_mut();
            if WlanGetNetworkBssList(
                handle,
                guid_ptr,
                std::ptr::null(),
                1,
                0,
                std::ptr::null(),
                &mut bss_list_ptr,
            ) == 0
                && !bss_list_ptr.is_null()
            {
                let bss_count = (*bss_list_ptr).dwNumberOfItems as usize;
                for j in 0..bss_count {
                    let bss = &*((*bss_list_ptr).wlanBssEntries.as_ptr().add(j));
                    let ssid_bytes = &bss.dot11Ssid.ucSSID[..bss.dot11Ssid.uSSIDLength as usize];
                    let ssid = String::from_utf8_lossy(ssid_bytes).to_string();
                    if ssid.is_empty() {
                        continue;
                    }

                    let bssid = format!(
                        "{:02X}:{:02X}:{:02X}:{:02X}:{:02X}:{:02X}",
                        bss.dot11Bssid[0],
                        bss.dot11Bssid[1],
                        bss.dot11Bssid[2],
                        bss.dot11Bssid[3],
                        bss.dot11Bssid[4],
                        bss.dot11Bssid[5],
                    );
                    let band = freq_to_band_internal(bss.ulChCenterFrequency).to_string();
                    let signal = bss.uLinkQuality;

                    let (auth, encryption) = sec_map
                        .get(&ssid)
                        .map(|(a, e)| (a.clone(), e.clone()))
                        .unwrap_or_default();

                    // Key by BSSID (unique per AP radio)
                    result_map.entry(bssid.clone()).or_insert(WifiApInfo {
                        ssid,
                        auth,
                        encryption,
                        bssid,
                        signal,
                        band,
                    });
                }
                WlanFreeMemory(bss_list_ptr as *const _);
            }
        }

        WlanFreeMemory(if_list_ptr as *const _);
        WlanCloseHandle(handle, std::ptr::null());

        let mut result: Vec<WifiApInfo> = result_map.into_values().collect();
        result.sort_by(|a, b| a.ssid.to_lowercase().cmp(&b.ssid.to_lowercase()));
        Ok(result)
    }
}

#[cfg(target_os = "windows")]
fn auth_algo_label(algo: u32) -> String {
    match algo {
        1 => "开放".into(),
        2 => "共享密钥".into(),
        3 => "WPA".into(),
        4 => "WPA-PSK".into(),
        5 => "WPA2".into(),
        6 => "WPA2-PSK".into(),
        7 => "WPA3".into(),
        8 => "WPA3-SAE".into(),
        9 => "OWE".into(),
        v => format!("未知({})", v),
    }
}

#[cfg(target_os = "windows")]
fn cipher_algo_label(algo: u32) -> String {
    match algo {
        0 => "无".into(),
        1 => "WEP40".into(),
        2 => "TKIP".into(),
        3 => "AES".into(),
        4 => "WEP104".into(),
        7 => "WEP".into(),
        8 => "GCMP".into(),
        9 => "GCMP-256".into(),
        10 => "CCMP-256".into(),
        v => format!("未知({})", v),
    }
}
