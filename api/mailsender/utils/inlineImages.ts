/**
 * Most mail clients (notably Gmail) strip or refuse to render <img src="data:...">
 * base64 images embedded directly in HTML for anti-spam reasons. The reliable,
 * universally-supported way to embed an uploaded/pasted image in an email is as
 * a proper inline attachment referenced via a Content-ID (cid:) — the same
 * mechanism already used to display inbound inline images in the Unified Inbox.
 *
 * This rewrites every base64 data: URI <img> in the HTML into a cid: reference
 * and returns the matching nodemailer `attachments` entries.
 */
export function extractInlineImages(html: string): { html: string; attachments: any[] } {
  if (!html || !html.includes('data:image/')) return { html, attachments: [] };

  const attachments: any[] = [];
  let counter = 0;

  const rewritten = html.replace(
    /src="data:(image\/[a-zA-Z0-9.+-]+);base64,([^"]+)"/g,
    (match, contentType, base64Data) => {
      counter += 1;
      const cid = `inline-img-${Date.now()}-${counter}@mailsender`;
      attachments.push({
        cid,
        content: base64Data,
        encoding: 'base64',
        contentType,
      });
      return `src="cid:${cid}"`;
    }
  );

  return { html: rewritten, attachments };
}
