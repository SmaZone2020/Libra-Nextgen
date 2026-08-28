/**
 * 厂商/模型 → 图标映射（public/icon 静态资源）。
 * 模糊匹配：名称规范化（小写去特殊字符）后，
 *   1) 精确命中 key；
 *   2) 否则取「key 是名称子串」中最长的一个（如 deepseek-ai → deepseek.svg，
 *      anthropic/claude-3-5 → anthropic.svg）；
 *   3) 2 字符短 key（yi/pi/rc 等）仅精确匹配，避免误配。
 */

const MODEL_ICONS: Record<string, string> = {
  // 主流模型厂商
  deepseek: '/icon/deepseek.svg',
  openai: '/icon/openai.svg',
  anthropic: '/icon/anthropic.svg',
  claude: '/icon/claude.svg',
  gemini: '/icon/gemini.svg',
  google: '/icon/google.svg',
  googlecloud: '/icon/googlecloud.svg',
  palm: '/icon/palm.svg',
  gemma: '/icon/gemma.svg',
  qwen: '/icon/qwen.svg',
  alibaba: '/icon/alibaba.svg',
  kimi: '/icon/kimi.svg',
  moonshot: '/icon/kimi.svg',
  chatglm: '/icon/chatglm.svg',
  zhipu: '/icon/zhipu.svg',
  zai: '/icon/zhipu.svg',
  grok: '/icon/grok.svg',
  xai: '/icon/xai.svg',
  mistral: '/icon/mistral.svg',
  cohere: '/icon/cohere.svg',
  meta: '/icon/meta.svg',
  llama: '/icon/meta.svg',
  ollama: '/icon/ollama.svg',
  huggingface: '/icon/huggingface.svg',
  azure: '/icon/azure.svg',
  aws: '/icon/aws.svg',
  amazon: '/icon/aws.svg',
  baidu: '/icon/baidu.svg',
  wenxin: '/icon/wenxin.svg',
  ernie: '/icon/wenxin.svg',
  bytedance: '/icon/bytedance.svg',
  doubao: '/icon/doubao.svg',
  tencent: '/icon/tencent.svg',
  hunyuan: '/icon/hunyuan.svg',
  minimax: '/icon/minimax.svg',
  zeroone: '/icon/zeroone.svg',
  '01ai': '/icon/zeroone.svg',
  nvidia: '/icon/nvidia.svg',
  stability: '/icon/stability.svg',
  github: '/icon/github.svg',
  githubcopilot: '/icon/githubcopilot.svg',
  copilot: '/icon/githubcopilot.svg',
  perplexity: '/icon/perplexity.svg',
  midjourney: '/icon/midjourney.svg',
  notion: '/icon/notion.svg',
  vercel: '/icon/vercel.svg',
  huawei: '/icon/huawei.svg',
  cloudflare: '/icon/cloudflare.svg',
  xiaomi: '/icon/xiaomimimo.svg',
  xiaomimimo: '/icon/xiaomimimo.svg',
  aionlabs: '/icon/aionlabs.png',
  allenai: '/icon/allenai.png',
  arceeai: '/icon/arceeai.jpg',
  dotsstudio: '/icon/dotsstudio.png',
  meituan: '/icon/meituan.png',
  microsoft: '/icon/microsoft.png',
  anthracite: '/icon/anthracite.png',

  // 聚合/代理平台
  openrouter: '/icon/openrouter.svg',
  siliconflow: '/icon/siliconflow.svg',
  modelscope: '/icon/modelscope-color.svg',
  novita: '/icon/novita.svg',
  newapi: '/icon/newapi.svg',
  aihubmix: '/icon/aihubmix-color.svg',
  crazyrouter: '/icon/crazyrouter.svg',
  subrouter: '/icon/subrouter.svg',
  teamorouter: '/icon/TeamoRouter-icon-dark.png',
  shengsuanyun: '/icon/shengsuanyun.svg',
  micu: '/icon/micu.svg',
  ucloud: '/icon/ucloud.svg',
  sssaicode: '/icon/sssaicode.svg',
  stepfun: '/icon/stepfun.svg',
  catcoder: '/icon/catcoder.svg',
  bailian: '/icon/bailian.svg',
  ppio: '/icon/ppio.svg',
  mcp: '/icon/mcp.svg',
  rc: '/icon/rc.svg',
  lioncc: '/icon/lioncc.svg',
  longcat: '/icon/longcat-color.svg',
  opencode: '/icon/opencode-logo-light.svg',
  amux: '/icon/amuxapi-icon.svg',
  claw: '/icon/claw.svg',
  openclaw: '/icon/claw.svg',
  cubence: '/icon/cubence.svg',
  packycode: '/icon/packycode.svg',
  zenmux: '/icon/amuxapi-icon.svg',

  // 图片/URL 图标平台
  a6api: '/icon/a6-icon.png',
  apikeyfun: '/icon/apikeyfun.png',
  apinebula: '/icon/apinebula_icon.png',
  atlascloud: '/icon/atlascloud_icon.png',
  byteplus: '/icon/byteplus.png',
  ccsub: '/icon/ccsub.svg',
  claudeapi: '/icon/ClaudeApi.png',
  claudecn: '/icon/claudecn.png',
  cherryin: '/icon/cherryin.png',
  code0: '/icon/code0.png',
  eflowcode: '/icon/eflowcode.png',
  etok: '/icon/etok.png',
  fenno: '/icon/fenno-icon.webp',
  hermes: '/icon/hermes.png',
  nousresearch: '/icon/hermes.png',
  huoshan: '/icon/huoshan.png',
  nekocode: '/icon/nekocode-icon.png',
  pateway: '/icon/pateway.jpg',
  pipellm: '/icon/pipellm.png',
  qiniu: '/icon/qiniu.png',
  relaxcode: '/icon/relaxcode.png',
  runapi: '/icon/runapi.jpg',
  sudocode: '/icon/sudocode.png',
  sudocus: '/icon/sudocode-us.png',
  unity2: '/icon/unity2.png',
  xycai: '/icon/xycai-icon.png',
  zetaapi: '/icon/zetaapi-icon.png',
};

/** 图标 key 按长度降序，模糊匹配时优先取更精确（更长）的 key。 */
const ICON_KEYS = Object.keys(MODEL_ICONS).sort((a, b) => b.length - a.length);

/** 规范化：小写 + 去 非字母数字。 */
function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** 模糊匹配图标：精确 → 子串（最长 key 优先）→ null。 */
export function resolveModelIcon(name: string): string | null {
  if (!name) return null;
  const norm = normalize(name);
  if (!norm) return null;

  const direct = MODEL_ICONS[norm];
  if (direct) return direct;

  for (const key of ICON_KEYS) {
    if (key.length < 3) continue; // 2 字符短 key（yi/pi/rc）仅精确匹配
    const icon = MODEL_ICONS[key];
    if (icon && norm.includes(key)) return icon;
  }
  return null;
}
