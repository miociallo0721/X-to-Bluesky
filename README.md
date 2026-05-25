# X to Bluesky 同步工具

把你在 X（Twitter）上的推文整理后迁移到 Bluesky，并提供一个本地可视化控制台来管理导入、测试和同步过程。

## 当前能力

- 支持两种数据来源
  - 使用 X API 拉取最近推文
  - 导入 X 官方数据归档 `.zip` / `.json`
- 提供本地控制面板
  - 查看统计、推文列表、运行日志和同步状态
  - 支持开始、暂停、继续、停止同步
- 支持同步策略配置
  - 跳过转推
  - 跳过回复
  - 试运行模式
  - 发帖间隔控制
  - 可选来源标记
- 使用 SQLite 持久化状态
  - 记录每条推文的同步结果
  - 支持失败重试

## 使用前准备

### 1. Bluesky App Password

在 [Bluesky 设置](https://bsky.app/settings/app-passwords) 中创建一个 App Password。

### 2. X API 凭证（可选）

如果你想直接从 API 拉取最近推文，需要准备：

- X Bearer Token
- X User ID

可以在 [X Developer Portal](https://developer.x.com/) 申请相关凭证。免费额度通常只能覆盖最近一部分推文历史。

### 3. X 官方归档（推荐）

如果你想迁移更完整的历史，建议使用 X 官方归档：

- X 设置
- 你的账户
- 下载数据归档

拿到 `.zip` 后直接在面板上传即可。

## 快速开始

```bash
cd x-to-bsky
npm install
npm run dev
```

开发环境默认地址：

- 前端面板：`http://localhost:5173`
- 后端服务：`http://localhost:3847`

## 生产构建

```bash
npm run build
npm start
```

启动后访问：

- `http://localhost:3847`

## 使用流程

1. 填写 Bluesky `Handle` 和 `App Password`
2. 点击“测试登录”确认 Bluesky 凭证可用
3. 导入推文数据
   - 推荐上传 X 官方归档
   - 或填写 X API 信息后从 API 拉取
4. 调整同步策略
5. 保存配置并开始同步

## 环境变量

你可以在 `server/.env` 中预填默认配置：

```env
PORT=3847
X_BEARER_TOKEN=
X_USER_ID=
BSKY_HANDLE=yourname.bsky.social
BSKY_APP_PASSWORD=
```

## 项目结构

```text
x-to-bsky/
├─ client/          # React 控制台
├─ server/          # Express API + 同步引擎
│  ├─ src/
│  └─ data/         # SQLite 数据文件（运行后生成）
└─ package.json
```

## 当前限制

- 目前仅同步文本内容，不上传图片或视频
- 不会自动重建 X 的回复链为 Bluesky 线程
- 长文会按 Bluesky 文本长度限制截断
- 默认发帖间隔为 3 秒，用于降低限流风险

## 安全提示

- 凭证保存在本地 SQLite 中，不要提交 `server/data/`
- 建议使用 Bluesky App Password，不要使用主密码
- 本工具默认在本地运行，不会额外把你的凭证发送到第三方服务
