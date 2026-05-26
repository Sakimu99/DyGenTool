type Env = {
  MIMO_API_KEY?: string;
  COPY_EXTRACT_MODEL?: string;
};

type ExtractRequest = {
  shareText?: string;
};

type MimoChoice = {
  message?: {
    content?: string;
    reasoning_content?: string;
  };
};

type MimoResponse = {
  choices?: MimoChoice[];
  error?: { message?: string };
};

const DEFAULT_EXTRACT_MODEL = 'mimo-v2.5';

const REQUEST_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};

type PagesContext = {
  request: Request;
  env: Env;
};

export async function onRequestPost(context: PagesContext) {
  try {
    const body = (await context.request.json()) as ExtractRequest;
    const shareText = body.shareText?.trim() ?? '';
    const shareUrl = extractFirstUrl(shareText);

    if (!shareUrl) {
      return json({ success: false, error: '没有识别到抖音分享链接。' }, 400);
    }

    const pageResponse = await fetch(shareUrl, {
      headers: REQUEST_HEADERS,
      redirect: 'follow',
    });
    const pageUrl = pageResponse.url || shareUrl;
    const html = await pageResponse.text();
    const description = extractDescription(html) || extractShareDescription(shareText);
    const videoUrl = findPublicVideoUrl(html);

    if (!videoUrl) {
      return json({
        success: false,
        url: shareUrl,
        pageUrl,
        description,
        error: '未在页面中找到可公开访问的视频地址。当前只提取到了页面描述，不是视频语音文本。',
      });
    }

    if (!context.env.MIMO_API_KEY) {
      return json({
        success: false,
        url: shareUrl,
        pageUrl,
        videoUrl,
        description,
        error: '未配置 MIMO_API_KEY，无法调用 MiMo 提取视频语音文本。',
      });
    }

    const transcript = await transcribeVideoWithMimo(videoUrl, context.env.MIMO_API_KEY, context.env.COPY_EXTRACT_MODEL || DEFAULT_EXTRACT_MODEL);

    return json({
      success: true,
      url: shareUrl,
      pageUrl,
      videoUrl,
      description,
      transcript,
    });
  } catch (error) {
    return json({ success: false, error: error instanceof Error ? error.message : '自动提取失败。' }, 502);
  }
}

function extractFirstUrl(input: string): string {
  return input.match(/https?:\/\/[^\s，。]+/i)?.[0] ?? '';
}

function extractShareDescription(input: string): string {
  return input
    .replace(/https?:\/\/[^\s，。]+/gi, '')
    .replace(/复制打开抖音，?看看/g, '')
    .replace(/[A-Za-z]@[A-Za-z.]+|\d{2}\/\d{2}|:\d+pm|cAT:\/?/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractDescription(html: string): string {
  const candidates = [
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<title[^>]*>([^<]+)<\/title>/i,
  ];

  for (const pattern of candidates) {
    const value = html.match(pattern)?.[1];
    if (value) return decodeHtml(value).trim();
  }

  return '';
}

function findPublicVideoUrl(html: string): string {
  const decoded = safeDecodeURIComponent(html.replace(/\\u002F/g, '/').replace(/\\/g, ''));
  const playAddrUrl = decoded.match(/"play_addr"\s*:\s*\{.*?"url_list"\s*:\s*\[\s*"([^"]+)"/s)?.[1];

  if (playAddrUrl) {
    return decodeHtml(safeDecodeURIComponent(playAddrUrl));
  }

  const genericVideoUrl = decoded.match(/https?:\/\/[^"'<>\\\s]+(?:\.(?:mp4|mov)|\/aweme\/v1\/playwm\/|\/aweme\/v1\/play\/)[^"'<>\\\s]*/i)?.[0];
  return genericVideoUrl ? decodeHtml(safeDecodeURIComponent(genericVideoUrl)) : '';
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

async function transcribeVideoWithMimo(videoUrl: string, apiKey: string, model: string): Promise<string> {
  const response = await fetch('https://api.xiaomimimo.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content: '你是一个短视频语音转写助手，只输出视频中人物说话或旁白的中文文本。不要描述画面，不要添加解释。',
        },
        {
          role: 'user',
          content: [
            {
              type: 'video_url',
              video_url: { url: videoUrl },
              fps: 0.1,
              media_resolution: 'default',
            },
            {
              type: 'text',
              text: '请提取这个视频里的语音文本。只返回听到的口播/旁白内容；如果没有人声，返回空字符串。',
            },
          ],
        },
      ],
      max_completion_tokens: 2048,
    }),
  });

  const data = (await response.json()) as MimoResponse;
  if (!response.ok) {
    throw new Error(data.error?.message || `小米 MiMo 视频理解接口调用失败：HTTP ${response.status}`);
  }

  const message = data.choices?.[0]?.message;
  return (message?.content || message?.reasoning_content || '').trim();
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
