use std::hash::Hash;
use sysinfo::{Pid, System};

pub struct ProcessInfo;

impl ProcessInfo {
    pub fn collect(last_hash: Option<&str>) -> String {
        let mut sys = System::new_all();
        sys.refresh_all();

        let mut procs: Vec<_> = sys.processes().iter().collect();
        procs.sort_by_key(|(pid, _)| pid.as_u32());

        let mut hash_input = String::new();
        let mut items = Vec::new();

        for (pid, p) in &procs {
            let name = p.name().to_string_lossy();
            hash_input.push_str(&format!("{}:{};", pid.as_u32(), name));

            let start_time = format_unix_timestamp(p.start_time());
            let cpu_ms = (p.cpu_usage() as u64) * 1000;
            let mem_bytes = p.memory();
            let thread_count = 0u64; // sysinfo 0.33 doesn't expose thread count

            items.push(format!(
                r#"{{"pid":{},"name":"{}","startTime":"{}","cpuMs":{},"memoryBytes":{},"threadCount":{}}}"#,
                pid.as_u32(),
                escape(&name),
                escape(&start_time),
                cpu_ms,
                mem_bytes,
                thread_count,
            ));
        }

        let hash = compute_hash(&hash_input);

        if let Some(last) = last_hash {
            if hash == last {
                return r#"{"changed":false}"#.to_string();
            }
        }

        format!(
            r#"{{"changed":true,"hash":"{}","processes":[{}]}}"#,
            escape(&hash),
            items.join(",")
        )
    }

    pub fn kill(pid: u32) -> bool {
        let sys = System::new_all();
        if let Some(proc) = sys.process(Pid::from_u32(pid)) {
            proc.kill()
        } else {
            false
        }
    }
}

fn compute_hash(input: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::Hasher;
    let mut hasher = DefaultHasher::new();
    input.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn format_unix_timestamp(ts: u64) -> String {
    if ts == 0 {
        return String::new();
    }
    // Convert unix timestamp to ISO 8601
    let secs = ts;
    // Simple UTC formatting
    let days_since_epoch = secs / 86400;
    let time_of_day = secs % 86400;
    let hours = time_of_day / 3600;
    let minutes = (time_of_day % 3600) / 60;
    let seconds = time_of_day % 60;

    // Calculate year/month/day from days since epoch (1970-01-01)
    let mut year = 1970i64;
    let mut remaining_days = days_since_epoch as i64;

    loop {
        let days_in_year = if is_leap(year) { 366 } else { 365 };
        if remaining_days < days_in_year {
            break;
        }
        remaining_days -= days_in_year;
        year += 1;
    }

    let days_in_months = if is_leap(year) {
        [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    } else {
        [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    };

    let mut month = 1;
    for &dim in &days_in_months {
        if remaining_days < dim as i64 {
            break;
        }
        remaining_days -= dim as i64;
        month += 1;
    }
    let day = remaining_days + 1;

    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.0000000Z",
        year, month, day, hours, minutes, seconds
    )
}

fn is_leap(y: i64) -> bool {
    y % 4 == 0 && (y % 100 != 0 || y % 400 == 0)
}

fn escape(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}
