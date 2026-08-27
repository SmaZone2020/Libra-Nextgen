// ═══════════════════════════════════════════════════════════════════════
//  Agent 端脚本（module/main.js）— QuickJS 沙箱执行，无需编译
// ═══════════════════════════════════════════════════════════════════════
//  入口：meta.json actions[].module = { kind:"script", name:"main",
//                                      op:"hello", entry:"main" }
//  输入：args = { op:"hello", name:"..." , ...}
//  输出：main(args) 的返回值 → JSON 序列化 → WS 推送 plugin.result
//
//  可用 API（详见 SDK 示例插件 assets/docs/03-agent-js-api.md）：
//    fs.read/write/list/exists · proc.list/kill · env.get/set · whoami()
//    log() · __platform()
//    Windows: cmd / powershell / reg_query / reg_set / reg_delete /
//             ipconfig / wmic / tasklist
//    Linux:   shell / bash / uname / ip_route / ss / hostname / dns
// ═══════════════════════════════════════════════════════════════════════

function main(args) {
    var op = args.op || "hello";
    var name = args.name || "world";

    if (op === "hello") {
        return {
            "message": "hello, " + name + "!",
            "platform": __platform(),
            "user": whoami()
        };
    }

    if (op === "system") {
        // 多平台写法：__platform() 运行时分支
        var info;
        if (__platform() === "windows") {
            info = cmd("ver");
        } else if (__platform() === "linux") {
            info = uname();
        } else {
            info = "unsupported platform";
        }
        return { "system": info };
    }

    return { "ok": true, "op": op };
}
