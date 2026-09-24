const OPENAI_URL = "https://api.openai.com/v1/responses";

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`缺少环境变量：${name}`);
  return value;
}

function beijingDateLabel() {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short"
  }).format(new Date());
}

function beijingTimeLabel() {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(new Date());
}

function extractOutputText(response) {
  const parts = [];
  for (const item of response?.output ?? []) {
    if (item?.type !== "message") continue;
    for (const part of item?.content ?? []) {
      if (part?.type === "output_text" && typeof part.text === "string") {
        parts.push(part.text);
      }
    }
  }
  return parts.join("\n").trim();
}

function extractUrlCitations(response) {
  const map = new Map();
  for (const item of response?.output ?? []) {
    if (item?.type !== "message") continue;
    for (const part of item?.content ?? []) {
      for (const ann of part?.annotations ?? []) {
        if (ann?.type === "url_citation" && ann?.url) {
          map.set(ann.url, {
            title: ann.title || ann.url,
            url: ann.url
          });
        }
      }
    }
  }
  return [...map.values()];
}

function splitText(text, maxChars = 5500) {
  if (text.length <= maxChars) return [text];

  const blocks = text.split(/\n\n+/);
  const chunks = [];
  let current = "";

  for (const block of blocks) {
    const candidate = current ? `${current}\n\n${block}` : block;

    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }

    if (current) chunks.push(current);

    if (block.length <= maxChars) {
      current = block;
    } else {
      for (let i = 0; i < block.length; i += maxChars) {
        chunks.push(block.slice(i, i + maxChars));
      }
      current = "";
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

async function sendFeishuCard(webhook, title, markdown) {
  const payload = {
    msg_type: "interactive",
    card: {
      config: { wide_screen_mode: true },
      header: {
        template: "blue",
        title: { tag: "plain_text", content: title }
      },
      elements: [
        { tag: "markdown", content: markdown }
      ]
    }
  };

  const resp = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const raw = await resp.text();
  let data;

  try {
    data = JSON.parse(raw);
  } catch {
    data = { raw };
  }

  if (!resp.ok || (typeof data?.code === "number" && data.code !== 0)) {
    throw new Error(`飞书推送失败：HTTP ${resp.status} ${raw.slice(0, 500)}`);
  }

  return data;
}

async function generateBrief() {
  const apiKey = requiredEnv("OPENAI_API_KEY");
  const model = process.env.OPENAI_MODEL || "gpt-5.6-sol";
  const reasoningEffort = process.env.OPENAI_REASONING_EFFORT || "high";
  const now = beijingTimeLabel();

  const prompt = `你是一名专业但非常实用的 AI 行业晨报编辑。现在是北京时间 ${now}。

请使用 Web Search 检索“过去 24 小时”真正发生的 AI 行业重要动态，然后输出一份中文晨报。不要用旧闻凑数，不要把传闻写成事实，不要重复同一件事。

重点关注：
- OpenAI、Anthropic、Google / DeepMind、Meta、Microsoft、xAI、NVIDIA
- 中国主要 AI 公司与模型的重要更新
- 新模型、新产品、Agent、API、开发者工具、AI 编程、图像/视频/语音生成
- 重大融资、并购、监管、版权、数据与算力变化
- 对企业自动化、电商、内容生产、软件开发有实际影响的变化

输出格式：
# AI 行业晨报
一句话总览：用 1-2 句告诉我今天最值得关注什么。

## 今日最重要的 5-8 条
每条使用：
### 1. 标题
**发生了什么：** 2-4 句，说明具体事实和时间。
**为什么重要：** 1-3 句。
**对实际工作的启示：** 1-3 句，优先写对 AI 自动化、电商、内容、研发效率的影响。

## 值得继续观察
列 2-4 个接下来几天值得跟踪的方向。

## 今日结论
用 3-5 句做非常具体的总结。

要求：
1. 只写有可靠来源支持的事实；有不确定性要明确说明。
2. 优先一手来源、公司官方公告和高质量媒体。
3. 如果过去 24 小时某类没有重大更新，直接写“无重大更新”，不要拿旧内容补位。
4. 不要写空泛鸡汤，不要为了凑数量降低标准。
5. 文字适合直接发到飞书群，清晰、紧凑、有信息密度。`;

  const resp = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      reasoning: { effort: reasoningEffort },
      tools: [
        {
          type: "web_search",
          search_context_size: "high"
        }
      ],
      input: prompt,
      max_output_tokens: 6500,
      store: false
    })
  });

  const raw = await resp.text();
  let data;

  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`OpenAI 返回非 JSON：${raw.slice(0, 500)}`);
  }

  if (!resp.ok) {
    throw new Error(`OpenAI API 失败：HTTP ${resp.status} ${raw.slice(0, 800)}`);
  }

  const text = extractOutputText(data);
  if (!text) throw new Error("OpenAI API 未返回晨报正文");

  const citations = extractUrlCitations(data);
  const sourceSection = citations.length
    ? `\n\n---\n**本次检索来源（去重）**\n${citations
        .slice(0, 15)
        .map((s, i) => `${i + 1}. [${s.title}](${s.url})`)
        .join("\n")}`
    : "";

  return {
    model,
    text: `${text}${sourceSection}`,
    citations: citations.length
  };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  const secret = process.env.CRON_SECRET;
  const auth = req.headers.authorization;

  if (!secret || auth !== `Bearer ${secret}`) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  let webhook;

  try {
    webhook = requiredEnv("FEISHU_WEBHOOK");

    const brief = await generateBrief();
    const chunks = splitText(brief.text);
    const date = beijingDateLabel();

    for (let i = 0; i < chunks.length; i++) {
      const suffix = chunks.length > 1 ? `（${i + 1}/${chunks.length}）` : "";
      const footer =
        i === chunks.length - 1
          ? `\n\n---\n生成时间：${beijingTimeLabel()}｜模型：${brief.model}｜引用来源：${brief.citations} 个`
          : "";

      await sendFeishuCard(
        webhook,
        `AI 行业晨报 · ${date}${suffix}`,
        `${chunks[i]}${footer}`
      );
    }

    return res.status(200).json({
      ok: true,
      pushed: true,
      chunks: chunks.length,
      citations: brief.citations,
      model: brief.model,
      generated_at_beijing: beijingTimeLabel()
    });
  } catch (err) {
    const message = String(err?.message || err).slice(0, 1200);
    console.error("[ai-daily]", err);

    if (webhook) {
      try {
        await sendFeishuCard(
          webhook,
          "AI 行业晨报 · 运行失败",
          `今天的自动晨报没有成功生成。\n\n**错误：** ${message}\n\n时间：${beijingTimeLabel()}`
        );
      } catch (pushErr) {
        console.error("[ai-daily] failed to send error card", pushErr);
      }
    }

    return res.status(500).json({ ok: false, error: message });
  }
}
