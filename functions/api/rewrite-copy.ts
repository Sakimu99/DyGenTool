type Env = {
  DEEPSEEK_API_KEY?: string;
  COPY_MODEL?: string;
  COPY_EXTRACT_MODEL?: string;
};

type RewriteMode = 'keep' | 'rewrite' | 'imitate' | 'marketing';
type CopyTone = '自然' | '小红书风' | '口播风' | '情绪化' | '专业';
type CopyLength = 'short' | 'medium' | 'long';

type RewriteRequest = {
  sourceText?: string;
  mode?: RewriteMode;
  tone?: CopyTone;
  length?: CopyLength;
  model?: string;
};

type DeepSeekResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
};

type PagesContext = {
  request: Request;
  env: Env;
};

const DEFAULT_COPY_MODEL = 'deepseek-v4-flash';

export async function onRequestPost(context: PagesContext) {
  try {
    const body = (await context.request.json()) as RewriteRequest;
    const sourceText = body.sourceText?.trim() ?? '';
    const mode = body.mode ?? 'rewrite';
    const tone = body.tone ?? '自然';
    const length = body.length ?? 'medium';
    const model = body.model || context.env.COPY_MODEL || DEFAULT_COPY_MODEL;
    const cleanText = extractCoreCopy(sourceText);

    if (!cleanText) {
      return json({ success: false, error: '原始文案为空，无法生成候选文案。', cleanText: '', variants: [] }, 400);
    }

    if (mode === 'keep') {
      return json({ success: true, cleanText, variants: [cleanText], model: 'local-keep' });
    }

    if (!context.env.DEEPSEEK_API_KEY) {
      return json({
        success: true,
        cleanText,
        variants: generateFallbackVariants(cleanText, mode, tone, length),
        model: 'local-fallback',
        error: '未配置 DEEPSEEK_API_KEY，已使用本地规则生成候选文案。',
      });
    }

    const variants = await generateWithDeepSeek(cleanText, mode, tone, length, model, context.env.DEEPSEEK_API_KEY);

    return json({ success: true, cleanText, variants: variants.length > 0 ? variants : generateFallbackVariants(cleanText, mode, tone, length), model });
  } catch (error) {
    return json({ success: false, error: error instanceof Error ? error.message : '文案生成失败。', cleanText: '', variants: [] }, 502);
  }
}

function extractCoreCopy(source: string): string {
  return source
    .replace(/https?:\/\/[^\s，。]+/gi, '')
    .replace(/^[\s\S]*?以下是(?:提取|识别|转写).*?[:：]/i, '')
    .replace(/^(?:语音文本|转写结果|原始文案|视频文案|文案)\s*[:：]/i, '')
    .replace(/[-—–]\s*[^\n]*?于\d{8}发布在抖音[，,].*$/g, '')
    .replace(/来抖音，记录美好生活！?/g, '')
    .replace(/\b\d+\.\d+\b\s*复制打开抖音，?看看/g, '')
    .replace(/[A-Za-z]@[A-Za-z.]+|\d{2}\/\d{2}|:\d+pm|cAT:\/?/gi, '')
    .replace(/[\t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function generateWithDeepSeek(cleanText: string, mode: RewriteMode, tone: CopyTone, length: CopyLength, model: string, apiKey: string): Promise<string[]> {
  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content: '你是短视频爆款文案改写助手。你必须只输出 JSON，不要输出 Markdown。JSON 格式为 {"variants":["文案1","文案2"]}。',
        },
        {
          role: 'user',
          content: buildPrompt(cleanText, mode, tone, length),
        },
      ],
      temperature: mode === 'imitate' || mode === 'marketing' ? 0.8 : 0.55,
      max_tokens: 1200,
      response_format: { type: 'json_object' },
      thinking: { type: 'disabled' },
    }),
  });
  const data = (await response.json()) as DeepSeekResponse;

  if (!response.ok) {
    throw new Error(data.error?.message || `DeepSeek 文案接口调用失败：HTTP ${response.status}`);
  }

  return parseVariants(data.choices?.[0]?.message?.content ?? '', mode === 'imitate' || mode === 'marketing' ? 3 : 2);
}

function buildPrompt(cleanText: string, mode: RewriteMode, tone: CopyTone, length: CopyLength): string {
  const count = mode === 'imitate' || mode === 'marketing' ? 3 : 2;
  const lengthText: Record<CopyLength, string> = {
    short: '短文案，适合 15 秒短视频，每段 40-80 字。',
    medium: '中等长度，适合 30 秒短视频，每段 80-150 字。',
    long: '较完整口播，适合 60 秒短视频，每段 150-260 字。',
  };
  const modeText: Record<Exclude<RewriteMode, 'keep'>, string> = {
    rewrite: '轻度改写：保留原意，去掉杂质信息，表达更顺、更像真人口播。',
    imitate: '同风格仿写：不要逐字复刻原文，要借鉴节奏和情绪，写成更有吸引力、更适合做短视频的新文案。开头必须有钩子，内容要有冲突感或利益点。',
    marketing: '营销增强：强化开头钩子、利益点、行动号召，但不要夸大承诺。',
  };

  return [
    `任务：${modeText[mode === 'keep' ? 'rewrite' : mode]}`,
    `数量：生成 ${count} 段候选文案。`,
    `语气：${tone}。`,
    `长度：${lengthText[length]}。`,
    '要求：只保留可用于视频口播/字幕的正文；不要输出标题、解释、编号、标签说明；不要包含“来抖音，记录美好生活”等平台元信息。',
    `原始内容：${cleanText}`,
  ].join('\n');
}

function parseVariants(content: string, expectedCount: number): string[] {
  try {
    const parsed = JSON.parse(content) as { variants?: unknown };
    if (Array.isArray(parsed.variants)) {
      return parsed.variants.map((item) => String(item).trim()).filter(Boolean).slice(0, expectedCount);
    }
  } catch {
    return content.split(/\n{2,}|\n\d+[.、]/).map((item) => item.trim()).filter(Boolean).slice(0, expectedCount);
  }

  return [];
}

function generateFallbackVariants(cleanText: string, mode: RewriteMode, tone: CopyTone, length: CopyLength): string[] {
  const base = cleanText.replace(/\s+/g, ' ').trim();
  const suffix = length === 'short' ? '先抓重点，再给结论。' : length === 'medium' ? '把问题、原因和解决思路讲清楚。' : '把背景、冲突、转折和行动建议讲完整。';

  if (mode === 'rewrite') {
    return [`换个更顺的说法：${base}\n\n用${tone}的方式表达，${suffix}`, `这件事真正值得关注的是：${base}\n\n少一点堆砌，多一点直接表达。`];
  }

  if (mode === 'marketing') {
    return [`很多人忽略了这一点：${base}\n\n如果你也遇到类似情况，先别急着硬扛，关键是找到更合适的解决办法。`, `别再一个人硬撑了。${base}\n\n真正聪明的做法，是先看清问题，再用更低成本的方式解决它。`, `如果这段话说中了你，说明你现在最需要的不是继续扛，而是换一种思路。${base}`];
  }

  return [`很多人都在硬扛，但真正的问题可能不是你不努力。${base}\n\n换个角度看，也许答案会更清楚。`, `你以为只能继续撑下去，其实很多时候是方法没选对。${base}\n\n这才是更值得关注的地方。`, `如果你也有类似经历，先别急着下结论。${base}\n\n看懂背后的逻辑，才知道下一步怎么走。`];
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
