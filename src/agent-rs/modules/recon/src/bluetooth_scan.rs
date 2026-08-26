pub struct BluetoothScanner;

impl BluetoothScanner {
    pub async fn scan() -> String {
        #[cfg(target_os = "windows")]
        {
            tokio::task::spawn_blocking(Self::scan_windows_blocking)
                .await
                .unwrap_or_else(|_| r#"{"bluetooth":[],"error":"task_failed"}"#.to_string())
        }
        #[cfg(not(target_os = "windows"))]
        {
            Self::scan_linux()
        }
    }

    #[cfg(target_os = "windows")]
    fn scan_windows_blocking() -> String {
        use windows::Devices::Bluetooth::BluetoothDevice;
        use windows::Devices::Enumeration::DeviceInformation;

        let selector = match BluetoothDevice::GetDeviceSelector() {
            Ok(s) => s,
            Err(_) => return r#"{"bluetooth":[],"error":"no_adapter"}"#.to_string(),
        };

        let devices = match DeviceInformation::FindAllAsyncAqsFilter(&selector) {
            Ok(op) => match op.get() {
                Ok(collection) => collection,
                Err(_) => return r#"{"bluetooth":[],"error":"enumeration_failed"}"#.to_string(),
            },
            Err(_) => return r#"{"bluetooth":[],"error":"enumeration_failed"}"#.to_string(),
        };

        let mut results = Vec::new();
        let count = devices.Size().unwrap_or(0);

        for i in 0..count {
            if let Ok(dev_info) = devices.GetAt(i) {
                let name = dev_info.Name().map(|s| s.to_string()).unwrap_or_default();
                let id = dev_info.Id().map(|s| s.to_string()).unwrap_or_default();
                let paired = dev_info
                    .Pairing()
                    .and_then(|p| p.IsPaired())
                    .unwrap_or(false);

                let mut address = String::new();
                let mut class_of_device = String::new();

                if let Ok(id_hstring) = dev_info.Id() {
                    if let Ok(op) = BluetoothDevice::FromIdAsync(&id_hstring) {
                        if let Ok(bt) = op.get() {
                            let addr = bt.BluetoothAddress().unwrap_or(0);
                            if addr != 0 {
                                address = format!(
                                    "{:02X}:{:02X}:{:02X}:{:02X}:{:02X}:{:02X}",
                                    (addr >> 40) & 0xFF,
                                    (addr >> 32) & 0xFF,
                                    (addr >> 24) & 0xFF,
                                    (addr >> 16) & 0xFF,
                                    (addr >> 8) & 0xFF,
                                    addr & 0xFF
                                );
                            }
                            if let Ok(cod) = bt.ClassOfDevice() {
                                if let Ok(raw) = cod.RawValue() {
                                    class_of_device = format!("0x{:06X}", raw);
                                }
                            }
                        }
                    }
                }

                results.push(format!(
                    r#"{{"name":"{}","address":"{}","id":"{}","paired":{},"classOfDevice":"{}"}}"#,
                    escape(&name),
                    escape(&address),
                    escape(&id),
                    paired,
                    escape(&class_of_device)
                ));
            }
        }

        // Also try BLE devices via a separate selector
        Self::scan_ble_blocking(&mut results);

        format!(r#"{{"bluetooth":[{}]}}"#, results.join(","))
    }

    #[cfg(target_os = "windows")]
    fn scan_ble_blocking(results: &mut Vec<String>) {
        use windows::Devices::Bluetooth::BluetoothLEDevice;
        use windows::Devices::Enumeration::DeviceInformation;

        let selector = match BluetoothLEDevice::GetDeviceSelector() {
            Ok(s) => s,
            Err(_) => return,
        };

        let devices = match DeviceInformation::FindAllAsyncAqsFilter(&selector) {
            Ok(op) => match op.get() {
                Ok(c) => c,
                Err(_) => return,
            },
            Err(_) => return,
        };

        let count = devices.Size().unwrap_or(0);
        for i in 0..count {
            if let Ok(dev_info) = devices.GetAt(i) {
                let name = dev_info.Name().map(|s| s.to_string()).unwrap_or_default();
                let id = dev_info.Id().map(|s| s.to_string()).unwrap_or_default();
                let paired = dev_info
                    .Pairing()
                    .and_then(|p| p.IsPaired())
                    .unwrap_or(false);

                let already_exists = results
                    .iter()
                    .any(|r| r.contains(&escape(&name)) && !name.is_empty());
                if already_exists {
                    continue;
                }

                let mut address = String::new();
                if let Ok(id_hstring) = dev_info.Id() {
                    if let Ok(op) = BluetoothLEDevice::FromIdAsync(&id_hstring) {
                        if let Ok(ble) = op.get() {
                            let addr = ble.BluetoothAddress().unwrap_or(0);
                            if addr != 0 {
                                address = format!(
                                    "{:02X}:{:02X}:{:02X}:{:02X}:{:02X}:{:02X}",
                                    (addr >> 40) & 0xFF,
                                    (addr >> 32) & 0xFF,
                                    (addr >> 24) & 0xFF,
                                    (addr >> 16) & 0xFF,
                                    (addr >> 8) & 0xFF,
                                    addr & 0xFF
                                );
                            }
                        }
                    }
                }

                results.push(format!(
                    r#"{{"name":"{}","address":"{}","id":"{}","paired":{},"classOfDevice":"BLE","type":"ble"}}"#,
                    escape(&name),
                    escape(&address),
                    escape(&id),
                    paired
                ));
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    fn scan_linux() -> String {
        use std::process::Command;

        let output = Command::new("bluetoothctl")
            .args(["devices"])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .output();

        let mut results = Vec::new();

        match output {
            Ok(o) if o.status.success() => {
                let text = String::from_utf8_lossy(&o.stdout);
                for line in text.lines() {
                    let parts: Vec<&str> = line.splitn(3, ' ').collect();
                    if parts.len() >= 3 && parts[0] == "Device" {
                        let address = parts[1];
                        let name = parts[2];
                        results.push(format!(
                            r#"{{"name":"{}","address":"{}","id":"","paired":false,"classOfDevice":""}}"#,
                            escape(name),
                            escape(address)
                        ));
                    }
                }
            }
            _ => {
                if let Ok(o) = Command::new("hcitool")
                    .args(["scan", "--flush"])
                    .stdout(std::process::Stdio::piped())
                    .stderr(std::process::Stdio::null())
                    .output()
                {
                    let text = String::from_utf8_lossy(&o.stdout);
                    for line in text.lines().skip(1) {
                        let trimmed = line.trim();
                        if let Some(space_idx) = trimmed.find('\t').or_else(|| trimmed.find(' ')) {
                            let address = trimmed[..space_idx].trim();
                            let name = trimmed[space_idx..].trim();
                            results.push(format!(
                                r#"{{"name":"{}","address":"{}","id":"","paired":false,"classOfDevice":""}}"#,
                                escape(name),
                                escape(address)
                            ));
                        }
                    }
                }
            }
        }

        if results.is_empty() {
            return r#"{"bluetooth":[],"error":"no_adapter_or_no_devices"}"#.to_string();
        }

        format!(r#"{{"bluetooth":[{}]}}"#, results.join(","))
    }
}

fn escape(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
}
