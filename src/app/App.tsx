import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import { CopyLength, CopyTone, RewriteMode } from '../lib/copy-generator';
import { extractDouyinCopy } from '../lib/extract-copy-api';
import { rewriteCopy } from '../lib/rewrite-copy-api';
import { extractFirstUrl } from '../lib/extract-url';
import { RenderOptions, VideoRatio, drawVideoFrame, loadImage, recordCanvasVideo } from '../lib/video-renderer';

type Status = 'idle' | 'success' | 'error' | 'rendering' | 'extracting' | 'rewriting';

type UploadedAsset = {
  file: File;
  previewUrl: string;
};

const modeOptions: Array<{ value: RewriteMode; label: string }> = [
  { value: 'keep', label: '保留原文' },
  { value: 'rewrite', label: '轻度改写' },
  { value: 'imitate', label: '同风格仿写' },
  { value: 'marketing', label: '营销增强' },
];

const toneOptions: CopyTone[] = ['自然', '小红书风', '口播风', '情绪化', '专业'];
const lengthOptions: Array<{ value: CopyLength; label: string }> = [
  { value: 'short', label: '短' },
  { value: 'medium', label: '中' },
  { value: 'long', label: '长' },
];

export function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [shareText, setShareText] = useState('');
  const [extractedUrl, setExtractedUrl] = useState('');
  const [extractedVideoUrl, setExtractedVideoUrl] = useState('');
  const [sourceText, setSourceText] = useState('');
  const [mode, setMode] = useState<RewriteMode>('rewrite');
  const [tone, setTone] = useState<CopyTone>('自然');
  const [copyLength, setCopyLength] = useState<CopyLength>('medium');
  const [variants, setVariants] = useState<string[]>([]);
  const [finalCopy, setFinalCopy] = useState('');
  const [assets, setAssets] = useState<UploadedAsset[]>([]);
  const [images, setImages] = useState<HTMLImageElement[]>([]);
  const [downloadUrl, setDownloadUrl] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('等待输入分享文本');
  const [renderOptions, setRenderOptions] = useState<RenderOptions>({
    ratio: '9:16',
    duration: 8,
    subtitlePosition: 'bottom',
    backgroundColor: '#111827',
  });

  const canGenerateCopy = sourceText.trim().length > 0;
  const canRender = finalCopy.trim().length > 0;
  const statusLabel = useMemo(() => {
    if (status === 'success') return '已就绪';
    if (status === 'error') return '需要处理';
    if (status === 'rendering') return '生成中';
    if (status === 'extracting') return '提取中';
    if (status === 'rewriting') return '改写中';
    return '草稿';
  }, [status]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    drawVideoFrame(canvas, images, finalCopy, renderOptions, 0);
  }, [images, finalCopy, renderOptions]);

  useEffect(() => {
    return () => {
      assets.forEach((asset) => URL.revokeObjectURL(asset.previewUrl));
      if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    };
  }, [assets, downloadUrl]);

  async function handleExtractUrl() {
    const url = extractFirstUrl(shareText);
    setExtractedUrl(url);
    setExtractedVideoUrl('');

    if (!url) {
      setStatus('error');
      setMessage('没有识别到链接，请检查粘贴内容或直接填写文案。');
      return;
    }

    setStatus('extracting');
    setMessage('正在请求后端抓取公开视频并提取语音文本。');

    try {
      const result = await extractDouyinCopy(shareText);
      setExtractedUrl(result.pageUrl || result.url || url);
      setExtractedVideoUrl(result.videoUrl || '');
      const nextText = result.transcript || result.description || '';

      if (nextText) {
        setSourceText(nextText);
        setStatus(result.error ? 'error' : 'success');
        setMessage(result.error || '已自动提取视频语音文本，请检查原始文案。');
      } else {
        setStatus('error');
        setMessage('没有提取到语音文本，请手动粘贴文案。');
      }
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : '自动提取失败，请手动粘贴文案。');
    }
  }

  async function handleGenerateVariants() {
    if (!canGenerateCopy) {
      setStatus('error');
      setMessage('请先填写原始文案。');
      return;
    }

    setStatus('rewriting');
    setMessage(mode === 'keep' ? '正在提取纯文案并保留原文。' : '正在调用 DeepSeek 生成候选文案。');

    try {
      const result = await rewriteCopy(sourceText, mode, tone, copyLength);
      setSourceText(result.cleanText);
      setVariants(result.variants);
      setFinalCopy(result.variants[0] || result.cleanText);
      setStatus(result.error ? 'error' : 'success');
      setMessage(result.error || `已生成 ${result.variants.length} 段候选文案。`);
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : '文案生成失败，请稍后重试。');
    }
  }

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []).filter((file) => file.type.startsWith('image/'));
    if (files.length === 0) return;

    const limitedFiles = files.slice(0, 10);
    const nextAssets = limitedFiles.map((file) => ({ file, previewUrl: URL.createObjectURL(file) }));
    setAssets((current) => {
      current.forEach((asset) => URL.revokeObjectURL(asset.previewUrl));
      return nextAssets;
    });
    setImages(await Promise.all(limitedFiles.map(loadImage)));
    setStatus('success');
    setMessage(`已载入 ${limitedFiles.length} 张图片。`);
  }

  async function handleRender() {
    const canvas = canvasRef.current;
    if (!canvas || !canRender) {
      setStatus('error');
      setMessage('请先选择最终文案，再生成视频。');
      return;
    }

    setStatus('rendering');
    setMessage('正在用 Canvas + MediaRecorder 生成 WebM 视频。');

    try {
      const blob = await recordCanvasVideo(canvas, images, finalCopy, renderOptions);
      if (downloadUrl) URL.revokeObjectURL(downloadUrl);
      setDownloadUrl(URL.createObjectURL(blob));
      setStatus('success');
      setMessage('视频已生成，可以下载 WebM 文件。');
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : '浏览器不支持当前视频生成能力。');
    }
  }

  async function copyText(value: string, label: string) {
    if (!value.trim()) {
      setStatus('error');
      setMessage(`${label} 为空，无法复制。`);
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
      setStatus('success');
      setMessage(`已复制${label}。`);
    } catch {
      setStatus('error');
      setMessage('复制失败，请手动选中文本复制。');
    }
  }

  function updateRenderOption<K extends keyof RenderOptions>(key: K, value: RenderOptions[K]) {
    setRenderOptions((current) => ({ ...current, [key]: value }));
  }

  return (
    <main className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">MVP 试水版</p>
          <h1>抖音文案提取与图片生成视频工具</h1>
          <p className="hero-copy">先跑通分享文本、文案候选、图片预览和浏览器端 WebM 导出流程。</p>
        </div>
        <div className={`status-pill status-${status}`}>{statusLabel}</div>
      </header>

      <section className="workspace">
        <article className="card">
          <div className="card-header">
            <span>1</span>
            <div>
              <h2>输入分享文本</h2>
              <p>自动抓取公开视频并调用 MiMo 提取语音文本，失败时可手动编辑。</p>
            </div>
          </div>

          <label className="field">
            <span>抖音分享文本</span>
            <textarea value={shareText} onChange={(event) => setShareText(event.target.value)} placeholder="粘贴：复制打开抖音，看看... https://v.douyin.com/..." rows={7} />
          </label>
          <button className="primary" type="button" disabled={status === 'extracting'} onClick={handleExtractUrl}>{status === 'extracting' ? '提取中...' : '提取语音文本'}</button>

          <label className="field">
            <span>识别到的页面 URL</span>
            <div className="copy-row">
              <input value={extractedUrl} onChange={(event) => setExtractedUrl(event.target.value)} placeholder="等待提取" />
              <button className="copy-button" type="button" onClick={() => copyText(extractedUrl, '页面 URL')}>复制</button>
            </div>
          </label>

          <label className="field">
            <span>识别到的视频地址</span>
            <div className="copy-row">
              <input value={extractedVideoUrl} onChange={(event) => setExtractedVideoUrl(event.target.value)} placeholder="等待提取真实播放地址" />
              <button className="copy-button" type="button" onClick={() => copyText(extractedVideoUrl, '视频地址')}>复制</button>
            </div>
          </label>

          <label className="field grow">
            <span>原始文案 / 语音文本</span>
            <div className="field-action">
              <button className="copy-button" type="button" onClick={() => copyText(sourceText, '原始文案')}>复制</button>
            </div>
            <textarea value={sourceText} onChange={(event) => setSourceText(event.target.value)} placeholder="自动提取失败时，直接在这里粘贴或编辑文案。" rows={8} />
          </label>
        </article>

        <article className="card">
          <div className="card-header">
            <span>2</span>
            <div>
              <h2>生成候选文案</h2>
              <p>先清洗纯文案，再按模式生成适合视频的候选。</p>
            </div>
          </div>

          <div className="controls-grid">
            <label className="field">
              <span>改写模式</span>
              <select value={mode} onChange={(event) => setMode(event.target.value as RewriteMode)}>
                {modeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label className="field">
              <span>语气</span>
              <select value={tone} onChange={(event) => setTone(event.target.value as CopyTone)}>
                {toneOptions.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            <label className="field">
              <span>长度</span>
              <select value={copyLength} onChange={(event) => setCopyLength(event.target.value as CopyLength)}>
                {lengthOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
          </div>

          <button className="primary" type="button" disabled={!canGenerateCopy || status === 'rewriting'} onClick={handleGenerateVariants}>{status === 'rewriting' ? '生成中...' : '生成候选文案'}</button>

          <div className="variant-list">
            {variants.length === 0 ? <p className="empty">还没有候选文案。</p> : variants.map((variant, index) => (
              <div className={variant === finalCopy ? 'variant selected' : 'variant'} key={variant}>
                <button className="variant-content" type="button" onClick={() => setFinalCopy(variant)}>
                  <strong>候选 {index + 1}</strong>
                  <span>{variant}</span>
                </button>
                <button className="copy-button" type="button" onClick={() => copyText(variant, `候选 ${index + 1}`)}>复制</button>
              </div>
            ))}
          </div>

          <label className="field grow">
            <span>最终文案</span>
            <div className="field-action">
              <button className="copy-button" type="button" onClick={() => copyText(finalCopy, '最终文案')}>复制</button>
            </div>
            <textarea value={finalCopy} onChange={(event) => setFinalCopy(event.target.value)} placeholder="选择候选后仍可继续手动编辑。" rows={8} />
          </label>
        </article>

        <article className="card preview-card">
          <div className="card-header">
            <span>3</span>
            <div>
              <h2>素材与导出</h2>
              <p>上传图片，配置比例与字幕位置，导出 WebM。</p>
            </div>
          </div>

          <label className="upload-box">
            <input type="file" accept="image/*" multiple onChange={handleUpload} />
            <span>上传 1-10 张图片</span>
            <small>首版仅本地处理，不上传服务器。</small>
          </label>

          <div className="thumb-grid">
            {assets.map((asset) => <img key={asset.previewUrl} src={asset.previewUrl} alt={asset.file.name} />)}
          </div>

          <div className="controls-grid">
            <label className="field">
              <span>比例</span>
              <select value={renderOptions.ratio} onChange={(event) => updateRenderOption('ratio', event.target.value as VideoRatio)}>
                <option value="9:16">9:16</option>
                <option value="1:1">1:1</option>
                <option value="16:9">16:9</option>
              </select>
            </label>
            <label className="field">
              <span>时长</span>
              <input type="number" min={3} max={60} value={renderOptions.duration} onChange={(event) => updateRenderOption('duration', Number(event.target.value))} />
            </label>
            <label className="field">
              <span>字幕</span>
              <select value={renderOptions.subtitlePosition} onChange={(event) => updateRenderOption('subtitlePosition', event.target.value as RenderOptions['subtitlePosition'])}>
                <option value="top">顶部</option>
                <option value="middle">中部</option>
                <option value="bottom">底部</option>
              </select>
            </label>
          </div>

          <canvas ref={canvasRef} className="video-canvas" aria-label="视频画布预览" />

          <div className="actions">
            <button className="primary" type="button" disabled={!canRender || status === 'rendering'} onClick={handleRender}>生成 WebM</button>
            <a className={!downloadUrl ? 'download disabled' : 'download'} href={downloadUrl} download="dygen-video.webm">下载视频</a>
          </div>
        </article>
      </section>

      <footer className={`message message-${status}`}>{message}</footer>
    </main>
  );
}
