import { useState } from 'react';

interface MarkdownContentProps {
  text: string;
  className?: string;
}

interface ContentPart {
  type: 'text' | 'image';
  content: string;
  alt?: string;
}

/**
 * Lightweight markdown renderer that handles image syntax: ![alt](url)
 * Text is rendered in <pre> blocks, images are rendered as <img> elements.
 * Used in PR descriptions and comments to display screenshots inline.
 */
function parseMarkdownImages(text: string): ContentPart[] {
  const parts: ContentPart[] = [];
  // Match markdown images: ![alt text](url)
  const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = imageRegex.exec(text)) !== null) {
    // Add text before the image
    if (match.index > lastIndex) {
      parts.push({ type: 'text', content: text.slice(lastIndex, match.index) });
    }
    // Add the image
    parts.push({ type: 'image', alt: match[1], content: match[2] });
    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push({ type: 'text', content: text.slice(lastIndex) });
  }

  return parts;
}

function ImageWithZoom({ src, alt }: { src: string; alt: string }) {
  const [zoomed, setZoomed] = useState(false);

  return (
    <>
      <figure className="pr-screenshot">
        <img
          src={src}
          alt={alt}
          className="pr-screenshot-img"
          onClick={() => setZoomed(true)}
          loading="lazy"
        />
        {alt && <figcaption className="pr-screenshot-caption">{alt}</figcaption>}
      </figure>
      {zoomed && (
        <div className="pr-screenshot-overlay" onClick={() => setZoomed(false)}>
          <img src={src} alt={alt} className="pr-screenshot-zoomed" />
          <span className="pr-screenshot-close">[✕ CLOSE]</span>
        </div>
      )}
    </>
  );
}

export function MarkdownContent({ text, className }: MarkdownContentProps) {
  const parts = parseMarkdownImages(text);

  // No images found — render as plain pre (backwards compatible)
  if (parts.length === 1 && parts[0].type === 'text') {
    return <pre className={className}>{text}</pre>;
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
