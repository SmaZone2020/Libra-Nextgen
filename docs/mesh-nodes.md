# Workspace Mesh（服务器节点）

> 状态:切面 A(后端 mesh 基础)、B(节点页/常驻本地节点)、C(通用 relay 跨节点
> 操作)、D(Justitia 节点工具 + 全节点事件桥接)均已完成。见文末路线。

## 概念

- **本机服务(Local)**:控制台当前连接的这台 Libra 服务,天然就是第一个"节点",
  在节点页作为常驻卡片,存储类型(SQLite/MongoDB)来自 `GET /api/system/storage`。
- **Hub / 节点**:hub = 运行本控制台的服务;节点 = 另一台已完成初始化(已设置
  用户)的 Libra 服务。hub 在本地库 `mesh_nodes` 登记节点(名称必填、hub 分配
  唯一 nodeId、origin 白名单校验),凭据经 DPAPI 保护后落库,会话 JWT 只存内存。
- **连接后标识**:连接(connect)成功即用会话 token 探测节点
  `GET /api/system/storage` 取 `dbType`(sqlite/mongo),节点卡片据此显示
  "存储: SQLite/MongoDB";探测失败不阻塞连接(存储类型显示未知)。

## 认证两种方式

| 方式 | 连接动作 |
|---|---|
| 用户名/密码 | hub → 节点 `POST /api/auth/login`,持 JWT 走全量 REST/WS |
| 访问密钥 `lnk_*` | hub → 节点 `POST /api/auth/key-exchange`(新端点),密钥兑换短时 console JWT,无 refresh token——密钥本身仍是凭证本体,到期由 hub 重新兑换 |

`key-exchange` 与 login 共用 `auth` 限流策略;审计面:mesh 生命周期操作以
console 事件(`node` 类目)推送,节点侧对实际业务操作按各自审计规则记录。

## API（hub 侧,Admin）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/mesh/nodes` | 节点列表,含 `connected`/`storageType`(仅连接后已知) |
| POST | `/api/mesh/nodes` | 登记 `{name, origin, auth:{kind: password\|accessKey, username?, secret}}`;重名 409、非法 origin 400 |
| PATCH | `/api/mesh/nodes/{id}` | 改名/改地址/换凭据(换后丢弃旧会话) |
| DELETE | `/api/mesh/nodes/{id}` | 删除登记并断开 |
| POST | `/api/mesh/nodes/{id}/connect` | 连接;返回 `{connected, expiresAt, storageType}`;失败返回错误并记 `lastError` |
| POST | `/api/mesh/nodes/{id}/disconnect` | 断开(仅清内存会话) |
| GET | `/api/mesh/nodes/{id}/agents` | 经节点会话代理拉取远端 Agent 列表(只读透传) |
| GET/POST/PUT/DELETE | `/api/mesh/nodes/{id}/relay/{**path}` | **通用中继**:console 对远端设备的功能调用(agents/tasks/files/othersoft/proxy/token/`system/{agentId}`)经此透传;管理面(mesh/plugins/ai/auth/account/access-keys/audit/settings/events/builder 等)与 `/system/storage`、`/system/listener` 一律不中继——插件动作跨节点在 v1 禁用(产品决策) |

被连接端(节点)新增:auth 控制器 `POST /api/auth/key-exchange {key}`。

## Console 设备工作区(跨节点操作)

- Agents 页:本机列表下方按节点渲染远端设备分段;点击远端设备 = **选中该节点
  agent**(复合上下文 `{nodeId, agentId}`,会话级,不落 localStorage);
- 选中远端设备后,终端/文件/系统信息/软数据/代理/Token 页面零改动即通过
  relay 在远端执行(Shell 本身是 REST 轮询任务,无 WS 依赖);
- 中继只作用于白名单功能路径;AgentContext 的本机轮询与 Dashboard 概览
  (任务/流量)用 `apiHome` 固定打本机,永不误中继;插件页/管理页始终打本机;
- 打开本机设备会退出远端上下文;远端节点断开时选中态自动清除(409 提示由
  各页面错误通道呈现)。

## Justitia 节点视野(D)

- **事件桥**:`MeshSyncService`(后台,10s)轮询所有已连接节点的在线设备,
  上下线变化复用 `AiEventNotifier`(agent.online/agent.offline)→ 现有 AI 事件
  订阅(会话/频道)对远端节点与本地一视同仁,提示文案带 `节点名 · 主机名`;
  节点(重)连接后的首轮轮询作为基线不产生事件,避免上线风暴;状态仅存内存;
- **节点获取 MCP 工具**(只读,随 MCP 鉴权与审计):
  - `mesh_list_nodes`:注册节点 + 存储类型 + 连接状态 + 在线设备数;
  - `mesh_node_agents`:指定节点的在线设备明细。
- 连/断节点仍是 Admin console 动作;工具不触达节点凭据。

## Console 节点页(/nodes)

- 侧边栏概览之下常驻入口(所有端可见),主分组顺序:概览/节点/设备/Justitia;
- 顶部为**本机服务**常驻卡(存储徽标),下方为**服务器节点**区:插件列表同款
  auto-fill 网格卡片,右下角 连接/断开 + 删除;添加节点弹窗内 Tabs 选择
  用户名密码或访问密钥,保存后自动尝试连接;
- 非 Admin 仅见本机卡;Admin 专属操作入口通过既有页面权限体系(`allowedPages`
  的 `nodes` key,账户弹窗可选);
- 页面 15s 自刷新,失败静默降级并保留本机卡可用。

## 边界与安全

- mesh 会话不持久化:服务重启后节点回到"已登记未连接",需手动/后续自动重连;
- 凭据只在本机服务库内加密存储(DPAPI/CurrentUser,非 Windows 退化为 base64);
  hub 是凭据汇聚点,建议仅绑定内网/受信环境;
- 跨节点**插件动作在 v1 禁用**(目标节点自行安装插件后从它自己的控制台操作)。

## 路线(后续候选)

- 会话持久化/开机自动重连:节点会话存 home(加密)+ 启动恢复,事件桥自动续跑;
- 远端设备操作增加 UI 级节点/设备上下文指示(顶栏显式工作区标签);
- MCP 侧增加节点写工具(连/断、任务下发),需先落权限分级与审批。

(English summary: Workspace Mesh lets the home console register and connect
multiple initialized Libra services (password login or lnk_* access-key
exchange); after connect the hub probes the node's storage type and badges it
SQLite/MongoDB. The Nodes page is always available with the local service as
a permanent card. Remote agents aggregate under the device list per node and
are fully operable through a whitelisted hub relay (terminal/files/data…);
plugins stay node-local by decision. A background sync bridges every connected
node's agent online/offline transitions into the existing Justitia event
subscriptions, and read-only MCP tools (mesh_list_nodes / mesh_node_agents)
give her node visibility.)
