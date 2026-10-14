/**
 * Utilities for formatting and cleaning emails before sending to clients.
 * Ensures consistent rendering across Gmail, Outlook, Apple Mail, and mobile clients.
 */

/**
 * Strips badge formatting that may have been injected by visual editors / sequence builders
 * (e.g. purple background tags, monospace fonts around {{variable}} tokens).
 */
export function cleanVariableBadges(html: string): string {
  if (!html) return '';

  // 1. Match spans with editor variable badge styling (both double and single quotes)
  let cleaned = html.replace(
    /<span[^>]*style=['"][^'"]*(?:rgba\(\s*99\s*,\s*102\s*,\s*241|font-family:\s*monospace|#818cf8|#6366f1)[^'"]*['"][^>]*>([\s\S]*?)<\/span>/gi,
    '$1'
  );

  // 2. Also strip any span whose sole content is a {{variable}} token
  cleaned = cleaned.replace(
    /<span[^>]*>(\s*\{\{\s*[\w.-]+(?:\s*\|[^{}]*)?\s*\}\}\s*)<\/span>/gi,
    '$1'
  );

  return cleaned;
}

/**
 * Strips unsupported CSS custom properties (var(--...)) which external mail clients cannot resolve.
 * Maps them directly to webmail-safe inline hex colors.
 */
export function cleanUnsupportedCss(html: string): string {
  if (!html) return '';
  return html
    .replace(/var\(--text-primary[^)]*\)/gi, '#0f172a')
    .replace(/var\(--text-secondary[^)]*\)/gi, '#475569')
    .replace(/var\(--text-muted[^)]*\)/gi, '#64748b')
    .replace(/var\(--accent-primary[^)]*\)/gi, '#4f46e5')
    .replace(/var\(--accent-hover[^)]*\)/gi, '#4338ca')
    .replace(/var\(--border-color[^)]*\)/gi, '#e2e8f0')
    .replace(/var\(--bg-primary[^)]*\)/gi, '#ffffff')
    .replace(/var\(--bg-secondary[^)]*\)/gi, '#f8fafc')
    .replace(/var\(--overlay-[^)]+\)/gi, '#f1f5f9')
    .replace(/var\(--[^)]+\)/gi, '#1e293b');
}

/**
 * Wraps content in a responsive, modern HTML email structure with inline-safe defaults.
 */
export function formatEmailHtml(rawHtml: string): string {
  if (!rawHtml || !rawHtml.trim()) return '';

  const cleaned = cleanUnsupportedCss(cleanVariableBadges(rawHtml.trim()));

  // If the user already provided a full DOCTYPE or <html> wrapper, return it cleaned
  if (/^\s*<!DOCTYPE/i.test(cleaned) || /^\s*<html/i.test(cleaned)) {
    return cleaned;
  }

  // Ensure content has reasonable paragraph breaks if plain text or raw divs
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <!--[if mso]>
  <style type="text/css">
    body, table, td, p, a { font-family: Arial, sans-serif !important; }
  </style>
  <![endif]-->
  <style type="text/css">
    body {
      margin: 0;
      padding: 16px 20px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      font-size: 15px;
      line-height: 1.6;
      color: #1e293b;
      background-color: #ffffff;
      -webkit-font-smoothing: antialiased;
      -webkit-text-size-adjust: 100%;
      -ms-text-size-adjust: 100%;
    }
    p {
      margin: 0 0 1em 0;
      line-height: 1.6;
    }
    p:last-child {
      margin-bottom: 0;
    }
    ul, ol {
      margin: 0 0 1em 0;
      padding-left: 24px;
    }
    li {
      margin-bottom: 0.35em;
    }
    a {
      color: #4f46e5;
      text-decoration: underline;
    }
    img {
      max-width: 100%;
      height: auto;
      border: 0;
      display: inline-block;
      outline: none;
    }
    blockquote {
      margin: 0 0 1em 0;
      padding-left: 12px;
      border-left: 3px solid #cbd5e1;
      color: #64748b;
    }
    .email-wrapper {
      max-width: 650px;
      margin: 0 auto;
      background-color: #ffffff;
    }
  </style>
</head>
<body>
  <div class="email-wrapper">
    ${cleaned}
  </div>
</body>
</html>`;
}
