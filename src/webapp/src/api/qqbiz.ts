import { api } from './client';

/** QQ 业务（服务端执行，规避浏览器 CORS）。 */
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
  data?: string;
  error?: string;
}

/** 执行一个 QQ 业务动作（发说说 / 改资料 / 好友 / 群 / 文件 / 亲密 / 特别关心 / 手机号）。 */
export function qqBiz(action: string, params: QQBizParams): Promise<QQBizResult> {
  return api.post<QQBizResult>(`/qqbiz/${action}`, params);
}