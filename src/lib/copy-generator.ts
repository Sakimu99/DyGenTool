export type RewriteMode = 'keep' | 'rewrite' | 'imitate' | 'marketing';
export type CopyTone = '自然' | '小红书风' | '口播风' | '情绪化' | '专业';
export type CopyLength = 'short' | 'medium' | 'long';

const modeLabel: Record<RewriteMode, string> = {
  keep: '保留原文',
  rewrite: '轻度改写',
  imitate: '同风格仿写',
  marketing: '营销增强',
};

const lengthHint: Record<CopyLength, string> = {
  short: '保持短促有力，适合 15 秒视频。',
  medium: '节奏完整，适合 30 秒视频。',
  long: '信息更充分，适合 60 秒视频。',
};

export function generateCopyVariants(source: string, mode: RewriteMode, tone: CopyTone, length: CopyLength): string[] {
  const normalized = source.trim() || '把你的故事讲清楚，让用户一眼看到重点。';
  const prefix = mode === 'marketing' ? '开头先抓住注意力：' : mode === 'imitate' ? '保留这种节奏再讲一遍：' : '换个更顺的说法：';

  return [
    `${prefix}${normalized}\n\n${tone}表达，${lengthHint[length]}`,
    `如果你也遇到同样的问题，可以先记住这句话：${normalized}\n\n用${modeLabel[mode]}方式处理，语气偏${tone}。`,
    `${normalized}\n\n这版更适合做成图片轮播口播，结尾加一句：想要同款效果，现在就可以试试看。`,
  ];
}
