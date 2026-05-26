export type ExtractCopyResponse = {
  success: boolean;
  url?: string;
  pageUrl?: string;
  videoUrl?: string;
  description?: string;
  transcript?: string;
  error?: string;
};

export async function extractDouyinCopy(shareText: string): Promise<ExtractCopyResponse> {
  const response = await fetch('/api/extract-douyin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shareText }),
  });
  const data = (await response.json()) as ExtractCopyResponse;

  if (!response.ok || !data.success) {
    throw new Error(data.error || '自动提取失败，请手动粘贴文案。');
  }

  return data;
}
