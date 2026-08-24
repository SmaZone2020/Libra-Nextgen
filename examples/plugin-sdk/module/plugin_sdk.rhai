// 插件 SDK 标准示例 — Agent 端模块
//
// 本文件完整演示脚本插件能调用的【所有功能】，并展示【多平台写法】：
//   - 跨平台能力：fs.*、proc.*、env.*、whoami()（所有平台通用）
//   - Windows 专属：cmd/powershell/reg_*/ipconfig/wmic/tasklist
//   - Linux 专属：shell/bash/uname/ip_route/ss/hostname/dns
//   - #if(WINDOWS)/#elif(LINUX)/#else/#endif 条件编译（解析前裁剪）

fn main(args) {
    // 从 argsSchema 读入能力名，缺省 showcase 全部。
    let cap = if args.contains("capability") { args["capability"] } else { "all" };

    let result;

    if cap == "whoami" {
        // 跨平台：当前用户
        result = #{ "whoami": whoami() };

    } else if cap == "fs" {
        // 跨平台：文件系统（写 → 读 → 列目录 → 存在性）
        let ok = fs.write("/tmp/libra_sdk_probe.txt", "hello from plugin-sdk");
        result = #{
            "write_ok": ok,
            "read": fs.read("/tmp/libra_sdk_probe.txt"),
            "list_home": fs.list("."),
            "exists": fs.exists("/tmp/libra_sdk_probe.txt"),
        };

    } else if cap == "proc" {
        // 跨平台：进程枚举 + 环境变量（多平台底层实现不同，见 platform_common）
        result = #{
            "processes": proc.list(),
            "path_env": env.get("PATH"),
        };

    } else if cap == "network" {
        // 多平台写法：同一个“网络信息”，Windows/Linux 用不同命令。
        let net;
        #if(WINDOWS)
            net = ipconfig();
        #elif(LINUX)
            net = ip_route() + "\n" + dns();
        #else
            net = "unsupported platform";
        #endif
        result = #{ "network": net };

    } else if cap == "system" {
        // 多平台写法：系统信息。
        let sys;
        #if(WINDOWS)
            sys = wmic("os get Caption,Version,OSArchitecture /value");
        #elif(LINUX)
            sys = uname();
        #else
            sys = "unsupported platform";
        #endif
        result = #{ "system": sys };

    } else {
        // 全量展示：把每个能力都跑一遍。
        let platform = __platform();
        let sys_info;
        #if(WINDOWS)
            sys_info = cmd("ver");
        #elif(LINUX)
            sys_info = uname();
        #else
            sys_info = "unknown";
        #endif

        result = #{
            "platform": platform,
            "whoami": whoami(),
            "sys_info": sys_info,
            "proc_count": proc.list().len,
            "path": env.get("PATH"),
        };
    }

    result
}

// 运行时平台探测（配合解析期 #if，二者互补）。
fn __platform() {
    #if(WINDOWS)
        "windows"
    #elif(LINUX)
        "linux"
    #else
        "unknown"
    #endif
}
