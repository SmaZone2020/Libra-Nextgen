import { api } from './client';

/**
 * 服务端插件脚本统一入口：POST /api/plugin/{插件id}/{函数名}
 * （驱动插件包内 service/main.cs，由 ServerScriptService 用 Roslyn Scripting 执行）。
 */
export interface QQBizParams {
  uin: string;
  clientkey: string;
  text?: string;
  nickname?: string;
  company?: string;
  qunn?: string;
  busId?: string;
  fileId?: string;
  targetUin?: string;
  careAction?: number;
  geqian?: boolean;
}

export interface QQBizResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

/** 调用 com.libra.qqkey 插件 service/main.cs 的某个函数（发说说/改资料/好友/群/文件/亲密/特别关心/手机号）。 */
export function qqBiz(action: string, params: QQBizParams): Promise<QQBizResult> {
  return api.post<QQBizResult>(`/plugin/com.libra.qqkey/${action}`, params);
}