// 某软件信息探测（脚本版示例）
//
// `module.kind = "script"` 的 Agent 端模块：一个 Rhai 脚本，作者无需编译。
//
// 演示两个核心能力：
//   1. #if/#endif 条件编译 —— 非本平台的代码块在解析前就被裁剪掉。
//   2. 平台 API 门控 —— `cmd()` 只在 Windows 注册，`shell()` 只在 Linux
//      注册，所以下面两个分支各只在自己的平台上能编译通过。

fn main(args) {
    // 从服务端传入的参数（来自 meta.json 的 argsSchema）取值。
    let target = if args.contains("target") { args["target"] } else { "default" };

    // 平台特定的探测逻辑。
    let output;

    #if(WINDOWS)
        // Windows：用 cmd 探测“某软件”的安装版本（示例）。
        let ver = cmd("reg query \"HKLM\\Software\\ExampleSoft\" /v Version");
        output = "Windows probe of " + target + ": " + ver;
    #elif(LINUX)
        // Linux：用 shell 查进程。
        let procs = shell("ps aux | grep -i " + target);
        output = "Linux probe of " + target + ": " + procs;
    #else
        output = "Unknown platform probe of " + target;
    #endif

    // 返回一个 map，引擎会序列化为 JSON 回传。
    #{ "target": target, "output": output, "platform": __platform_name() }
}

fn __platform_name() {
    #if(WINDOWS)
        "windows"
    #elif(LINUX)
        "linux"
    #else
        "unknown"
    #endif
}
