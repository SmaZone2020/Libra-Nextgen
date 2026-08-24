// 插件 SDK 标准示例 — Agent 端模块
//
// 本文件完整演示脚本插件能调用的【所有功能】，并展示【多平台写法】：
//   - 跨平台能力：fs.*、proc.*、env.*、whoami()（所有平台通用）
//   - Windows 专属：cmd/powershell/reg_*/ipconfig/wmic/tasklist
//   - Linux 专属：shell/bash/uname/ip_route/ss/hostname/dns
//   - #if(WINDOWS)/#elif(LINUX)/#else/#endif 条件编译（解析前裁剪）

fn main(args) {
    // 服务端把 action 的 op 放进 input["op"]（shell action 的 op="shell"）。
    // shell 直接走命令执行；showcase 用 capability 子选择，缺省展示全部。
    let op = if args.contains("op") { args["op"] } else { "showcase" };
    let cap = if op == "shell" { "shell" }
              else if args.contains("capability") { args["capability"] }
              else { "all" };

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

    } else if cap == "shell" {
        // Shell 执行演示：执行传入的命令，返回 stdout。
        let command = if args.contains("command") { args["command"] } else { "echo hello" };
        let out;
        #if(WINDOWS)
            out = cmd(command);
        #elif(LINUX)
            out = shell(command);
        #else
            out = "unsupported platform";
        #endif
        result = #{ "command": command, "output": out };

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
