using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using LibraNextgen.Service.Services;

namespace LibraNextgen.Service.Controllers;

/// <summary>
/// QQ 业务工具（服务端执行，规避浏览器 CORS）：
/// <c>POST /api/qqbiz/{action}</c>，body 为 QQBizRequest（uin+clientkey+参数），
/// 返回 <c>{ ok, data | error }</c>，data 为 QQ 接口原始响应文本。
/// </summary>
[ApiController]
[Route("api/qqbiz")]
[Authorize]
public class QQBizController : ControllerBase
{
    private readonly QQBizService _biz;

    public QQBizController(QQBizService biz)
    {
        _biz = biz;
    }

    [HttpPost("{action}")]
    public async Task<IActionResult> Run(string action, [FromBody] QQBizService.QQBizRequest request, CancellationToken ct)
    {
        try
        {
            var data = await _biz.RunAsync(action, request, ct);
            return Ok(new { ok = true, data });
        }
        catch (Exception ex)
        {
            return Ok(new { ok = false, error = ex.Message });
        }
    }
}