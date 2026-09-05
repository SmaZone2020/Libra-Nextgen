# Workspace Mesh（服务器节点）

> 状态:切面 A(后端 mesh 基础)与切面 B(节点页/常驻本地节点)已完成;切面 C
> (Agents 跨节点聚合分段)与 D(Justitia 节点视野)规划中,见文末路线。

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

被连接端(节点)新增:auth 控制器 `POST /api/auth/key-exchange {key}`。

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

## 路线

- C:Agents 列表按节点聚合分段展示、复合身份 `{nodeId, agentId}`、交互路由到节点;
- D:Justitia 节点获取 MCP 工具 + 全已连接节点 Agent 事件桥入现有 AI 事件订阅。

(English summary: Workspace Mesh lets the home console register and connect
multiple initialized Libra services (password login or lnk_* access-key
exchange); after connect the hub probes the node's storage type and badges it
SQLite/MongoDB. The Nodes page is always available with the local service as
a permanent card. Roadmap: cross-node aggregated agents and Justitia node
visibility.)
