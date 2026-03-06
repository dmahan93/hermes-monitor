import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MarkdownContent, parseMarkdownImages } from '../../src/components/MarkdownContent';

describe('parseMarkdownImages', () => {
  it('returns single text part for plain text with no images', () => {
    const result = parseMarkdownImages('hello world');
    expect(result).toEqual([{ type: 'text', content: 'hello world' }]);
  });

  it('returns empty array for empty string', () => {
    const result = parseMarkdownImages('');
    expect(result).toEqual([]);
  });

  it('parses a single image', () => {
    const result = parseMarkdownImages('![alt text](https://example.com/img.png)');
    expect(result).toEqual([
      { type: 'image', alt: 'alt text', content: 'https://example.com/img.png' },
    ]);
  });

  it('parses multiple images with text between them', () => {
    const result = parseMarkdownImages(
      'before ![img1](https://a.com/1.png) middle ![img2](https://b.com/2.png) after'
    );
    expect(result).toEqual([
      { type: 'text', content: 'before ' },
      { type: 'image', alt: 'img1', content: 'https://a.com/1.png' },
      { type: 'text', content: ' middle ' },
      { type: 'image', alt: 'img2', content: 'https://b.com/2.png' },
      { type: 'text', content: ' after' },
    ]);
  });

  it('parses consecutive images with no text between them', () => {
    const result = parseMarkdownImages(
      '![a](https://a.com/a.png)![b](https://b.com/b.png)'
    );
    expect(result).toEqual([
      { type: 'image', alt: 'a', content: 'https://a.com/a.png' },
      { type: 'image', alt: 'b', content: 'https://b.com/b.png' },
    ]);
  });

  it('parses image with empty alt text', () => {
    const result = parseMarkdownImages('![](https://example.com/img.png)');
    expect(result).toEqual([
      { type: 'image', alt: '', content: 'https://example.com/img.png' },
    ]);
  });

  it('does not match malformed syntax: missing closing bracket', () => {
    const result = parseMarkdownImages('![broken(https://example.com/img.png)');
    expect(result).toEqual([
      { type: 'text', content: '![broken(https://example.com/img.png)' },
    ]);
  });

  it('does not match malformed syntax: empty URL', () => {
    const result = parseMarkdownImages('![alt]()');
    expect(result).toEqual([
      { type: 'text', content: '![alt]()' },
    ]);
  });

  it('parses image at start of text', () => {
    const result = parseMarkdownImages('![start](https://a.com/s.png) after');
    expect(result).toEqual([
      { type: 'image', alt: 'start', content: 'https://a.com/s.png' },
      { type: 'text', content: ' after' },
    ]);
  });

  it('parses image at end of text', () => {
    const result = parseMarkdownImages('before ![end](https://a.com/e.png)');
    expect(result).toEqual([
      { type: 'text', content: 'before ' },
      { type: 'image', alt: 'end', content: 'https://a.com/e.png' },
    ]);
  });

  it('strips leading/trailing newlines from text parts', () => {
    const result = parseMarkdownImages(
      '\nbefore\n![img](https://a.com/i.png)\nafter\n'
    );
    expect(result).toEqual([
      { type: 'text', content: 'before' },
      { type: 'image', alt: 'img', content: 'https://a.com/i.png' },
      { type: 'text', content: 'after' },
    ]);
  });

  it('filters out images with disallowed URL protocols', () => {
    const result = parseMarkdownImages('![xss](javascript:alert(1))');
    // The regex won't match because ) in alert(1) ends the match early,
    // but even if it did, the URL validation would filter it
    expect(result.every((p) => p.type === 'text')).toBe(true);
  });

  it('allows http:// URLs', () => {
    const result = parseMarkdownImages('![img](http://example.com/img.png)');
    expect(result).toEqual([
      { type: 'image', alt: 'img', content: 'http://example.com/img.png' },
    ]);
  });

  it('allows https:// URLs', () => {
    const result = parseMarkdownImages('![img](https://example.com/img.png)');
    expect(result).toEqual([
      { type: 'image', alt: 'img', content: 'https://example.com/img.png' },
    ]);
  });

  it('allows data:image/ URLs', () => {
    const result = parseMarkdownImages('![img](data:image/png;base64,abc123)');
    expect(result).toEqual([
      { type: 'image', alt: 'img', content: 'data:image/png;base64,abc123' },
    ]);
  });

  it('filters images with ftp:// URLs', () => {
    const result = parseMarkdownImages('![img](ftp://example.com/img.png)');
    expect(result).toEqual([]);
  });

  it('drops text parts that are only whitespace/newlines', () => {
    const result = parseMarkdownImages(
      '\n\n![a](https://a.com/a.png)\n\n![b](https://b.com/b.png)\n\n'
    );
    expect(result).toEqual([
      { type: 'image', alt: 'a', content: 'https://a.com/a.png' },
      { type: 'image', alt: 'b', content: 'https://b.com/b.png' },
    ]);
  });

  it('handles URL with special characters (query strings, hashes)', () => {
    const result = parseMarkdownImages(
      '![img](https://example.com/img.png?size=large&format=webp#section)'
    );
    expect(result).toEqual([
      { type: 'image', alt: 'img', content: 'https://example.com/img.png?size=large&format=webp#section' },
    ]);
  });
});

describe('MarkdownContent', () => {
  it('renders plain text in a div when no images', () => {
    const { container } = render(<MarkdownContent text="hello world" />);
    const div = container.querySelector('div');
    expect(div).toBeInTheDocument();
    expect(div?.textContent).toBe('hello world');
    // Should NOT be a <pre>
    expect(container.querySelector('pre')).not.toBeInTheDocument();
  });

  it('passes className to the plain text div', () => {
    const { container } = render(
      <MarkdownContent text="hello" className="pr-detail-desc" />
    );
    const div = container.querySelector('div.pr-detail-desc');
    expect(div).toBeInTheDocument();
  });

  it('renders images when markdown image syntax is present', () => {
    render(
      <MarkdownContent text="before ![screenshot](https://example.com/img.png) after" />
    );
    const img = screen.getByAltText('screenshot');
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute('src', 'https://example.com/img.png');
  });

  it('renders figcaption for images with alt text', () => {
    render(
      <MarkdownContent text="![my caption](https://example.com/img.png)" />
    );
    expect(screen.getByText('my caption')).toBeInTheDocument();
  });

  it('does not render figcaption for empty alt text', () => {
    render(
      <MarkdownContent text="![](https://example.com/img.png)" />
    );
    expect(screen.queryByText('figcaption')).not.toBeInTheDocument();
  });

  it('opens zoom overlay on image click', () => {
    render(
      <MarkdownContent text="![test](https://example.com/img.png)" />
    );
    const img = screen.getByAltText('test');
    fireEvent.click(img);

    const overlay = screen.getByRole('dialog');
    expect(overlay).toBeInTheDocument();
    expect(overlay).toHaveAttribute('aria-label', 'Zoomed screenshot: test');
  });

  it('zoom overlay has a proper button for close', () => {
    render(
      <MarkdownContent text="![test](https://example.com/img.png)" />
    );
    fireEvent.click(screen.getByAltText('test'));

    const closeBtn = screen.getByRole('button', { name: 'Close zoomed view' });
    expect(closeBtn).toBeInTheDocument();
    expect(closeBtn.tagName).toBe('BUTTON');
  });

  it('closes zoom overlay on close button click', () => {
    render(
      <MarkdownContent text="![test](https://example.com/img.png)" />
    );
    fireEvent.click(screen.getByAltText('test'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close zoomed view' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes zoom overlay on Escape key', () => {
    render(
      <MarkdownContent text="![test](https://example.com/img.png)" />
    );
    fireEvent.click(screen.getByAltText('test'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes zoom overlay on backdrop click', () => {
    render(
      <MarkdownContent text="![test](https://example.com/img.png)" />
    );
    fireEvent.click(screen.getByAltText('test'));
    const overlay = screen.getByRole('dialog');
    expect(overlay).toBeInTheDocument();

    fireEvent.click(overlay);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('thumbnail image has correct keyboard accessibility', () => {
    render(
      <MarkdownContent text="![test](https://example.com/img.png)" />
    );
    const img = screen.getByAltText('test');
    expect(img).toHaveAttribute('role', 'button');
    expect(img).toHaveAttribute('tabIndex', '0');
    expect(img).toHaveAttribute('aria-label', 'View test full size');
  });

  it('opens zoom on Enter key on thumbnail', () => {
    render(
      <MarkdownContent text="![test](https://example.com/img.png)" />
    );
    const img = screen.getByAltText('test');
    fireEvent.keyDown(img, { key: 'Enter' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('opens zoom on Space key on thumbnail', () => {
    render(
      <MarkdownContent text="![test](https://example.com/img.png)" />
    );
    const img = screen.getByAltText('test');
    fireEvent.keyDown(img, { key: ' ' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('renders mixed content with text blocks in pre and images inline', () => {
    const { container } = render(
      <MarkdownContent text="before\n![img](https://a.com/1.png)\nafter" />
    );
    expect(container.querySelector('.markdown-content')).toBeInTheDocument();
    expect(container.querySelectorAll('pre.markdown-text-block')).toHaveLength(2);
    expect(screen.getByAltText('img')).toBeInTheDocument();
  });

  it('uses lazy loading on images', () => {
    render(
      <MarkdownContent text="![test](https://example.com/img.png)" />
    );
    const img = screen.getByAltText('test');
    expect(img).toHaveAttribute('loading', 'lazy');
  });
});
