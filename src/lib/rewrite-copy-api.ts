import { CopyLength, CopyTone, RewriteMode } from './copy-generator';

export type RewriteCopyResponse = {
  success: boolean;
  cleanText: string;
  variants: string[];
  model?: string;
  error?: string;
};

export async function rewriteCopy(sourceText: string, mode: RewriteMode, tone: CopyTone, length: CopyLength): Promise<RewriteCopyResponse> {
  const response = await fetch('/api/rewrite-copy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sourceText, mode, tone, length }),
  });
  const data = (await response.json()) as RewriteCopyResponse;

  if (!response.ok || !data.success) {
    throw new Error(data.error || '文案生成失败，请稍后重试。');
  }

  return data;
}
