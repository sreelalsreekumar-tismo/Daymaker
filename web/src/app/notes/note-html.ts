/** Strips editor markup for previews and converts checklist items to plain-text boxes for read-only rendering. */
export function noteToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('li[data-type="taskItem"]').forEach((li) => li.prepend(li.getAttribute('data-checked') === 'true' ? '☑ ' : '☐ '));
  doc.querySelectorAll('p, li, h1, h2, h3, blockquote, br').forEach((n) => n.append(' '));
  return (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * HTML for read-only display ([innerHTML] also runs Angular's sanitizer, which removes scripts and event handlers).
 * Checklist inputs are replaced by ☑/☐ so state stays visible.
 */
export function noteToReadonlyHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('li[data-type="taskItem"]').forEach((li) => {
    const done = li.getAttribute('data-checked') === 'true';
    li.querySelector('label')?.remove();
    li.prepend(done ? '☑ ' : '☐ ');
  });
  return doc.body.innerHTML;
}

/** Downscales an image file to at most maxSize px and returns a data URL (notes keep images inline in SQLite). */
export function imageToDataUrl(file: File, maxSize = 1400, quality = 0.85): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Not a readable image')); };
    img.src = url;
  });
}
