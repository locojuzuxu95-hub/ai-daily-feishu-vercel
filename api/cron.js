function normalizeOpenAIBaseUrl(raw) {
  let base = (raw || "https://api.openai.com/v1").trim().replace(/\/+$/, "");
  // 兼容误把完整 Responses 地址填进 OPENAI_BASE_URL 的情况
  base = base.replace(/\/responses$/i, "");
  // UniAPI 的 OpenAI 兼容入口需要 /v1
  if (base === "https://api.uniapi.io") base += "/v1";
  return base;
}

const OPENAI_BASE_URL = normalizeOpenAIBaseUrl(process.env.OPENAI_BASE_URL);
const OPENAI_URL = `${OPENAI_BASE_URL}/responses`;
const IS_UNIAPI = /(^|\.)uniapi\.io$/i.test(new URL(OPENAI_BASE_URL).hostname);

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

function cleanFeishuMarkdown(text) {
  return String(text || "")
    .replace(/\\([#*\-])/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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

  const prompt = `现在是北京时间 ${now}。\n\n整理一份最新的 AI 行业消息和趋势晨报。优先覆盖过去 24 小时内真正重要的进展，包括大模型与产品发布、OpenAI/Google/Anthropic/Meta/xAI 等主要公司的动态、AI Agent 与自动化、模型能力与价格变化、开源模型、算力与芯片、企业应用、监管与政策、融资并购，以及对电商和业务自动化有实际影响的变化。按“发生了什么、为什么重要、值得关注的趋势、对实际工作的潜在影响”进行精炼总结，并区分重大变化与一般新闻。\n\n要求：\n- 以最近 24 小时为优先，不要为了凑数量写低价值旧闻。\n- 优先官方公告、开发者文档、公司博客及高质量媒体；重要消息尽量交叉验证。\n- 不要把传闻写成事实；明确区分已确认事实、试点、媒体报道和推测。\n- 输出中文，信息密度高，直接给晨报内容，不要写“我检索了哪些来源”“为什么只有几条”之类过程说明。\n- 结构自然，不强制固定 5-8 条；重大变化少时就少写，一般新闻可放到“其他值得关注”。\n- 对电商、AI 自动化、内容生产、软件开发有明确影响时，单独点出。\n- 适合直接发到飞书群，标题和小标题简洁。`;

  const resp = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      reasoning: { effort: reasoningEffort },
      tools: IS_UNIAPI
        ? [{ type: "web_search_preview" }]
        : [
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
    throw new Error(
      `AI API 返回非 JSON：${raw.slice(0, 500)}｜请求地址：${OPENAI_URL}`
    );
  }

  if (!resp.ok) {
    throw new Error(
      `AI API 失败：HTTP ${resp.status} ${raw.slice(0, 800)}｜请求地址：${OPENAI_URL}`
    );
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
    text: cleanFeishuMarkdown(`${text}${sourceSection}`),
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
