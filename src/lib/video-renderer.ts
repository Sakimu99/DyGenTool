export type VideoRatio = '9:16' | '1:1' | '16:9';

export type RenderOptions = {
  ratio: VideoRatio;
  duration: number;
  subtitlePosition: 'top' | 'middle' | 'bottom';
  backgroundColor: string;
};

const ratioSize: Record<VideoRatio, { width: number; height: number }> = {
  '9:16': { width: 720, height: 1280 },
  '1:1': { width: 1080, height: 1080 },
  '16:9': { width: 1280, height: 720 },
};

export function getCanvasSize(ratio: VideoRatio) {
  return ratioSize[ratio];
}

export async function loadImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.src = url;
  await image.decode();
  URL.revokeObjectURL(url);
  return image;
}

export function drawVideoFrame(
  canvas: HTMLCanvasElement,
  images: HTMLImageElement[],
  copyText: string,
  options: RenderOptions,
  progress = 0,
) {
  const size = getCanvasSize(options.ratio);
  const context = canvas.getContext('2d');

  canvas.width = size.width;
  canvas.height = size.height;

  if (!context) return;

  context.fillStyle = options.backgroundColor;
  context.fillRect(0, 0, size.width, size.height);

  const image = images.length > 0 ? images[Math.min(Math.floor(progress * images.length), images.length - 1)] : null;
  if (image) {
    drawCoverImage(context, image, size.width, size.height);
  } else {
    context.fillStyle = 'rgba(255,255,255,0.12)';
    context.fillRect(size.width * 0.12, size.height * 0.2, size.width * 0.76, size.height * 0.46);
    context.fillStyle = '#e5e7eb';
    context.font = '36px sans-serif';
    context.textAlign = 'center';
    context.fillText('上传图片后显示预览', size.width / 2, size.height * 0.43);
  }

  drawSubtitle(context, copyText, size.width, size.height, options.subtitlePosition);
}

export async function recordCanvasVideo(
  canvas: HTMLCanvasElement,
  images: HTMLImageElement[],
  copyText: string,
  options: RenderOptions,
): Promise<Blob> {
  const stream = canvas.captureStream(30);
  const recorder = new MediaRecorder(stream, { mimeType: getSupportedMimeType() });
  const chunks: BlobPart[] = [];

  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };

  const started = new Promise<void>((resolve) => {
    recorder.onstart = () => resolve();
  });
  const stopped = new Promise<Blob>((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType }));
  });

  recorder.start();
  await started;

  const startedAt = performance.now();
  const durationMs = Math.max(1, options.duration) * 1000;

  await new Promise<void>((resolve) => {
    const render = (now: number) => {
      const elapsed = now - startedAt;
      const progress = Math.min(elapsed / durationMs, 1);
      drawVideoFrame(canvas, images, copyText, options, progress);

      if (progress < 1) {
        requestAnimationFrame(render);
      } else {
        recorder.stop();
        resolve();
      }
    };

    requestAnimationFrame(render);
  });

  return stopped;
}

function drawCoverImage(context: CanvasRenderingContext2D, image: HTMLImageElement, width: number, height: number) {
  const scale = Math.max(width / image.width, height / image.height);
  const scaledWidth = image.width * scale;
  const scaledHeight = image.height * scale;
  const x = (width - scaledWidth) / 2;
  const y = (height - scaledHeight) / 2;
  context.drawImage(image, x, y, scaledWidth, scaledHeight);
}

function drawSubtitle(
  context: CanvasRenderingContext2D,
  text: string,
  width: number,
  height: number,
  position: RenderOptions['subtitlePosition'],
) {
  const lines = wrapText(context, text || '请先选择最终文案', Math.floor(width * 0.78), 34);
  const lineHeight = 48;
  const blockHeight = lines.length * lineHeight + 48;
  const y = position === 'top' ? height * 0.12 : position === 'middle' ? height * 0.5 - blockHeight / 2 : height * 0.78 - blockHeight / 2;

  context.fillStyle = 'rgba(17, 24, 39, 0.72)';
  roundRect(context, width * 0.09, y, width * 0.82, blockHeight, 24);
  context.fill();

  context.fillStyle = '#ffffff';
  context.font = '34px sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  lines.slice(0, 5).forEach((line, index) => {
    context.fillText(line, width / 2, y + 32 + index * lineHeight);
  });
}

function wrapText(context: CanvasRenderingContext2D, text: string, maxWidth: number, fontSize: number): string[] {
  context.font = `${fontSize}px sans-serif`;
  const chars = text.replace(/\s+/g, ' ').split('');
  const lines: string[] = [];
  let line = '';

  chars.forEach((char) => {
    const testLine = line + char;
    if (context.measureText(testLine).width > maxWidth && line) {
      lines.push(line);
      line = char;
    } else {
      line = testLine;
    }
  });

  if (line) lines.push(line);
  return lines;
}

function roundRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}

function getSupportedMimeType() {
  const candidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? 'video/webm';
}
