# AI 行业晨报 → 飞书（Vercel 版）

每天自动执行：

1. 调用 OpenAI Responses API；
2. 使用 Web Search 检索过去 24 小时 AI 行业动态；
3. 生成中文 AI 行业晨报；
4. 通过飞书群自定义机器人 Webhook 推送卡片。

## 定时

`vercel.json` 已配置：

```json
{
  "path": "/api/cron",
  "schedule": "0 1 * * *"
}
```

Vercel Cron 使用 UTC，因此 `01:00 UTC = 北京时间 09:00`。

## 环境变量

必须在 Vercel 项目中配置：

- `OPENAI_API_KEY`：OpenAI API Key。ChatGPT Plus 订阅与 API 计费分开，不能直接把 Plus 订阅当 API Key 使用。
- `FEISHU_WEBHOOK`：飞书群自定义机器人的 Webhook。
- `CRON_SECRET`：随机长字符串，用来保护 `/api/cron`。

可选：

- `OPENAI_MODEL`：默认 `gpt-5.6-sol`
- `OPENAI_REASONING_EFFORT`：默认 `high`

## 接口

- `/api/health`：检查服务是否部署成功。
- `/api/cron`：正式晨报任务，只接受带正确 `Authorization: Bearer <CRON_SECRET>` 的 GET 请求。

## 部署后测试

1. 打开 `https://你的域名.vercel.app/api/health`，应返回 `ok: true`。
2. 在 Vercel 的 Cron Jobs 页面手动运行 `/api/cron`。
3. 飞书群应收到“AI 行业晨报”卡片。

## 安全

不要把 `.env`、API Key、Webhook 或 `CRON_SECRET` 提交到 GitHub。
