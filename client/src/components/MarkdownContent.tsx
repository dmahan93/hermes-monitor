import { useState, useEffect, useRef, useCallback } from 'react';

interface MarkdownContentProps {
  text: string;
  className?: string;
}

interface ContentPart {
  type: 'text' | 'image';
  content: string;
  alt?: string;
}

const ALLOWED_PROTOCOLS = ['http://', 'https://', 'data:image/'];

/**
 * Validates that a URL starts with an allowed protocol.
 */
function isAllowedUrl(url: string): boolean {
  return ALLOWED_PROTOCOLS.some((proto) => url.startsWith(proto));
}

/**
 * Lightweight markdown image parser: extracts ![alt](url) patterns from text.
 * Returns an array of ContentPart objects (text or image).
 *
 * Known limitations:
 * - Brackets in alt text: ![alt [with] brackets](url) stops at the first ]
 * - Parentheses in URLs: ![img](https://example.com/foo_(bar).png) stops at the first )
 * These are inherent to simple regex-based parsing; a full markdown parser would be needed for those edge cases.
 */
export function parseMarkdownImages(text: string): ContentPart[] {
  const parts: ContentPart[] = [];
  // Match markdown images: ![alt text](url)
  const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = imageRegex.exec(text)) !== null) {
    // Add text before the image
    if (match.index > lastIndex) {
      const textContent = text.slice(lastIndex, match.index);
      const trimmed = textContent.replace(/^\n+/, '').replace(/\n+$/, '');
      if (trimmed) {
        parts.push({ type: 'text', content: trimmed });
      }
    }
    // Only add image if URL passes validation
    const url = match[2];
    if (isAllowedUrl(url)) {
      parts.push({ type: 'image', alt: match[1], content: url });
    }
    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    const textContent = text.slice(lastIndex);
    const trimmed = textContent.replace(/^\n+/, '').replace(/\n+$/, '');
    if (trimmed) {
      parts.push({ type: 'text', content: trimmed });
    }
  }

  return parts;
}

function ImageWithZoom({ src, alt }: { src: string; alt: string }) {
  const [zoomed, setZoomed] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLImageElement>(null);

  const closeZoom = useCallback(() => {
    setZoomed(false);
    // Return focus to the triggering image
    triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!zoomed) return;

    // Focus the overlay when it opens
    overlayRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeZoom();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [zoomed, closeZoom]);

  return (
    <>
      <figure className="pr-screenshot">
        <img
          ref={triggerRef}
          src={src}
          alt={alt}
          className="pr-screenshot-img"
          onClick={() => setZoomed(true)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setZoomed(true); } }}
          tabIndex={0}
          role="button"
          aria-label={`View ${alt || 'screenshot'} full size`}
          loading="lazy"
        />
        {alt && <figcaption className="pr-screenshot-caption">{alt}</figcaption>}
      </figure>
      {zoomed && (
        <div
          ref={overlayRef}
          className="pr-screenshot-overlay"
          onClick={closeZoom}
          role="dialog"
          aria-label={`Zoomed screenshot: ${alt || 'screenshot'}`}
          tabIndex={-1}
        >
          <img src={src} alt={alt} className="pr-screenshot-zoomed" onClick={(e) => e.stopPropagation()} />
          <button
            className="pr-screenshot-close"
            onClick={(e) => { e.stopPropagation(); closeZoom(); }}
            aria-label="Close zoomed view"
          >
            [✕ CLOSE]
          </button>
        </div>
      )}
    </>
  );
}

export function MarkdownContent({ text, className }: MarkdownContentProps) {
  const parts = parseMarkdownImages(text);

  // No images found — render as plain div (backwards compatible with pr-detail-desc styling)
  if (parts.length <= 1 && parts.every((p) => p.type === 'text')) {
    return <div className={className}>{text}</div>;
  }

  return (
    <div className={`markdown-content ${className || ''}`}>
      {parts.map((part, i) =>
        part.type === 'image' ? (
          <ImageWithZoom key={i} src={part.content} alt={part.alt || 'screenshot'} />
        ) : (
          <pre key={i} className="markdown-text-block">{part.content}</pre>
        )
      )}
    </div>
  );
}
