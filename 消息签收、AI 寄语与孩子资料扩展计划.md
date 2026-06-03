# 消息签收、AI 寄语与孩子资料扩展计划

## Summary
实现家长处理待办后自动签收对应消息、修复消息中心操作导致全局刷新的问题，并新增 AI 寄语能力。管理员配置 OpenAI 兼容服务；家长可为每个孩子启用 AI 寄语，并维护性别、出生日期；儿童面板在原“今天也很棒”条幅中展示基于上一周周报、年龄和性别生成的 120 字内建议与寄语。AI 寄语按每个孩子每周缓存一次。

## Key Changes
- 消息签收：
  - 任务审核、奖励核销/取消成功后，后端自动把对应家长通知设为已读，匹配 `recipient_type='user'`、`recipient_id=parentId`、`related_type`、`related_id`。
  - `/notifications` 继续只返回未签收消息，因此已处理待办会从消息中心移除。
- 消息中心刷新：
  - `Shell.quickAction` 不再调用 App 级 `refresh()`，改为刷新消息列表，并通过可选回调刷新当前面板数据。
  - 家长面板普通审核/核销成功后，也通知 `Shell` 重新拉取消息，保持消息中心同步。
- AI 服务配置：
  - 管理员面板新增“AI服务”区域：`baseUrl`、API key、模型列表获取、模型选择、提示词编辑保存。
  - 新增接口：`GET/PATCH /api/admin/ai-service`、`POST /api/admin/ai-service/models`。
  - 模型列表请求 `GET {baseUrl}/models`，解析 OpenAI 兼容响应 `data[].id`。
  - API key 不在 GET 中明文返回；PATCH 时空值表示保留旧 key。
- 孩子资料：
  - `children` 新增 `ai_enabled INTEGER NOT NULL DEFAULT 0`、`gender TEXT NOT NULL DEFAULT ''`、`birth_date TEXT`。
  - 性别取值为：`male`、`female`、空值未设置；前端显示为“男 / 女 / 未设置”。
  - 出生日期使用 `YYYY-MM-DD`，后端校验不能晚于当前日期。
  - 孩子创建、列表、更新接口支持 `aiEnabled`、`gender`、`birthDate`。
  - 家长“孩子管理”入口可编辑姓名、密码、AI 启用状态、性别、出生日期。
- 儿童条幅：
  - `/dashboard/child` 返回 `aiGreeting`。
  - 儿童面板保留原条幅标题、布局和积分卡，只在标题下方增加短寄语文本。
  - 未启用 AI、配置不完整、资料未填或 AI 请求失败时，`aiGreeting` 为空，原条幅照常显示。

## AI Generation
- 新增 `ai_child_greetings` 缓存表，按 `child_id + previous_week_key + config_hash` 缓存。
- 周报数据复用现有周报统计逻辑抽成 helper，输入包括：上一完整周任务、奖励、积分、表扬/批评、成就摘要。
- 模型输入额外包含孩子显示名、性别标签、出生日期和按当前系统时区计算出的年龄。
- 调用 `POST {baseUrl}/chat/completions`，使用管理员选择的模型。
- 服务端将输出清理并截断到 120 个汉字以内。

## Preset Prompt
默认提示词：
“你是一位温暖、具体、不过度夸张的家庭成长教练。请根据孩子上一周的周报数据，并结合孩子的年龄与性别信息，写一段给孩子看的中文寄语：先肯定一个具体进步，再给一个可执行的小建议。语气亲切、有鼓励感，不说教，不提数据库或系统。总长度控制在120个汉字以内。”

## Test Plan
- `npm run build`
- `npm test`
- `npm run db:migrate:local`
- 手动验证：
  - 家长面板审核/核销后，对应未签收消息立即从消息中心消失。
  - 消息中心快捷操作只刷新消息和当前面板数据，不触发全局 `/auth/me` 刷新。
  - 管理员可保存 AI 配置、拉取模型、选择模型、编辑提示词。
  - 家长可设置孩子性别、出生日期、AI 启用状态。
  - 儿童面板启用后展示 120 字内 AI 寄语；AI 不可用时原条幅不受影响。

## Assumptions
- “/MODEL 路径”按 OpenAI 兼容标准实现为 `GET /models`。
- 性别采用“男 / 女 / 未设置”，未设置时不向 AI 强行推断。
- AI key 存储在 D1 `system_settings` 中，管理员页面不回显明文 key。
- AI 寄语按周缓存，避免儿童面板 12 秒轮询反复调用 AI。
