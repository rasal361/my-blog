import { createServer } from 'node:http';
import { exec } from 'node:child_process';
import { readFile, readdir, writeFile, mkdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const postsDir = path.join(root, 'src', 'content', 'blog');
const uploadsDir = path.join(root, 'public', 'uploads');
const siteFile = path.join(root, 'src', 'data', 'site.ts');
const photosFile = path.join(root, 'src', 'data', 'photos.ts');
const booksFile = path.join(root, 'src', 'data', 'books.ts');
const port = Number(process.env.STUDIO_PORT || 5175);
const run = promisify(exec);

await mkdir(postsDir, { recursive: true });
await mkdir(uploadsDir, { recursive: true });

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);

    if (req.method === 'GET' && url.pathname === '/') return sendHtml(res, renderStudio());
    if (req.method === 'GET' && url.pathname.startsWith('/uploads/')) return sendUpload(res, url.pathname);

    if (req.method === 'GET' && url.pathname === '/api/posts') return sendJson(res, await listPosts());
    if (req.method === 'GET' && url.pathname.startsWith('/api/posts/')) {
      const slug = cleanSlug(decodeURIComponent(url.pathname.replace('/api/posts/', '')));
      return sendJson(res, await readPost(slug));
    }
    if (req.method === 'POST' && url.pathname === '/api/posts') {
      const data = await readJson(req);
      await savePost(data);
      return sendJson(res, { ok: true, slug: cleanSlug(data.slug || data.title) });
    }
    if (req.method === 'DELETE' && url.pathname.startsWith('/api/posts/')) {
      const slug = cleanSlug(decodeURIComponent(url.pathname.replace('/api/posts/', '')));
      await unlink(path.join(postsDir, `${slug}.mdx`));
      return sendJson(res, { ok: true });
    }

    if (req.method === 'GET' && url.pathname === '/api/photos') return sendJson(res, await readPhotos());
    if (req.method === 'POST' && url.pathname === '/api/photos') {
      const data = await readJson(req);
      await savePhotos(Array.isArray(data.photos) ? data.photos : []);
      return sendJson(res, { ok: true });
    }

    if (req.method === 'GET' && url.pathname === '/api/books') return sendJson(res, await readBooks());
    if (req.method === 'POST' && url.pathname === '/api/books') {
      const data = await readJson(req);
      await saveBooks(Array.isArray(data.books) ? data.books : []);
      return sendJson(res, { ok: true });
    }

    if (req.method === 'POST' && url.pathname === '/api/upload') {
      const data = await readJson(req);
      return sendJson(res, await saveUpload(data));
    }

    if (req.method === 'GET' && url.pathname === '/api/site') return sendJson(res, await readSiteSettings());
    if (req.method === 'POST' && url.pathname === '/api/site') {
      const data = await readJson(req);
      await saveSiteSettings(data);
      return sendJson(res, { ok: true });
    }

    if (req.method === 'POST' && url.pathname === '/api/build') return sendJson(res, await buildSite());

    sendText(res, 'Not found', 404);
  } catch (error) {
    sendJson(res, { ok: false, error: error.message }, 500);
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Content Studio running at http://127.0.0.1:${port}`);
});

async function listPosts() {
  const files = (await readdir(postsDir)).filter((file) => file.endsWith('.mdx'));
  const posts = await Promise.all(files.map(async (file) => {
    const slug = file.replace(/\.mdx$/, '');
    const post = await readPost(slug);
    return {
      slug,
      title: post.title,
      pubDate: post.pubDate,
      category: post.category,
      featured: post.featured,
      draft: post.draft
    };
  }));

  return posts.sort((a, b) => String(b.pubDate).localeCompare(String(a.pubDate)));
}

async function readPost(slug) {
  const file = path.join(postsDir, `${cleanSlug(slug)}.mdx`);
  const text = await readFile(file, 'utf8');
  const { frontmatter, body } = parseMdx(text);
  return { slug: cleanSlug(slug), ...frontmatter, body };
}

async function savePost(data) {
  const slug = cleanSlug(data.slug || data.title);
  if (!slug) throw new Error('Post needs a title or slug.');

  const frontmatter = {
    title: data.title || 'Untitled post',
    description: data.description || '',
    pubDate: data.pubDate || new Date().toISOString().slice(0, 10),
    tags: splitTags(data.tags),
    category: data.category || 'Essay',
    image: data.image || '/uploads/placeholder.jpg',
    imageAlt: data.imageAlt || data.title || 'Post image',
    featured: Boolean(data.featured),
    draft: Boolean(data.draft)
  };

  const mdx = `${serializeFrontmatter(frontmatter)}\n\n${String(data.body || '').trim()}\n`;
  await writeFile(path.join(postsDir, `${slug}.mdx`), mdx, 'utf8');
}

async function readPhotos() {
  return readArrayFile(photosFile, 'photos');
}

async function savePhotos(photos) {
  const cleanPhotos = photos.map((photo) => ({
    title: String(photo.title || '').trim(),
    location: String(photo.location || '').trim(),
    image: String(photo.image || '').trim(),
    alt: String(photo.alt || '').trim()
  })).filter((photo) => photo.title || photo.image);

  await writeFile(photosFile, `export const photos = ${JSON.stringify(cleanPhotos, null, 2)};\n`, 'utf8');
}

async function readBooks() {
  return readArrayFile(booksFile, 'books');
}

async function saveBooks(books) {
  const cleanBooks = books.map((book) => ({
    title: String(book.title || '').trim(),
    author: String(book.author || '').trim(),
    status: String(book.status || '').trim(),
    note: String(book.note || '').trim()
  })).filter((book) => book.title || book.author);

  await writeFile(booksFile, `export const books = ${JSON.stringify(cleanBooks, null, 2)};\n`, 'utf8');
}

async function readArrayFile(file, exportName) {
  const source = await readFile(file, 'utf8');
  const arrayText = extractExportedArray(source, exportName);
  if (!arrayText) return [];
  return Function(`"use strict"; return (${arrayText});`)();
}

function extractExportedArray(source, exportName) {
  const startToken = `export const ${exportName} =`;
  const start = source.indexOf(startToken);
  if (start === -1) return null;

  const arrayStart = source.indexOf('[', start);
  if (arrayStart === -1) return null;

  let depth = 0;
  let quoteChar = '';
  let escaped = false;

  for (let index = arrayStart; index < source.length; index += 1) {
    const char = source[index];
    if (quoteChar) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quoteChar) {
        quoteChar = '';
      }
      continue;
    }

    if (char === '"' || char === "'") quoteChar = char;
    if (char === '[') depth += 1;
    if (char === ']') depth -= 1;
    if (depth === 0) return source.slice(arrayStart, index + 1);
  }

  return null;
}

async function saveUpload(data) {
  const match = String(data.dataUrl || '').match(/^data:(.+);base64,(.+)$/);
  if (!match) throw new Error('Upload data was not valid.');

  const ext = extensionFor(data.name, match[1]);
  const baseName = cleanSlug(path.basename(data.name || `image-${Date.now()}`, path.extname(data.name || '')));
  const filename = `${baseName || 'image'}-${Date.now()}${ext}`;
  const file = path.join(uploadsDir, filename);

  await writeFile(file, Buffer.from(match[2], 'base64'));
  return { ok: true, path: `/uploads/${filename}` };
}

async function readSiteSettings() {
  const text = await readFile(siteFile, 'utf8');
  return {
    name: matchValue(text, 'name') || 'naimul.net',
    title: matchValue(text, 'title') || '',
    description: matchValue(text, 'description') || '',
    author: matchValue(text, 'author') || '',
    url: matchValue(text, 'url') || 'https://example.com'
  };
}

async function saveSiteSettings(data) {
  const nav = [
    { label: 'Home', href: '/' },
    { label: 'About', href: '/about/' },
    { label: 'Reading', href: '/reading/' },
    { label: 'Photography', href: '/photography/' },
    { label: 'Hiking & Traveling', href: '/hiking-travel/' }
  ];

  const siteName = data.name || 'naimul.net';
  const title = normalizeSiteTitle(data.title, siteName);
  const source = `export const site = {
  name: ${quote(siteName)},
  title: ${quote(title)},
  description: ${quote(data.description || '')},
  author: ${quote(data.author || '')},
  url: ${quote(data.url || 'https://example.com')},
  nav: ${JSON.stringify(nav, null, 4).replace(/"([^"]+)":/g, '$1:')}
};
`;

  await writeFile(siteFile, source, 'utf8');
}

async function buildSite() {
  const command = process.platform === 'win32' ? 'npm.cmd run build' : 'npm run build';
  const { stdout, stderr } = await run(command, {
    cwd: root,
    env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1' },
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 12
  });
  return { ok: true, output: `${stdout}\n${stderr}`.trim() };
}

function parseMdx(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: text };

  const frontmatter = {};
  for (const line of match[1].split(/\r?\n/)) {
    const parts = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!parts) continue;
    const [, key, raw] = parts;
    frontmatter[key] = parseValue(raw);
  }

  return { frontmatter, body: match[2].trim() };
}

function parseValue(raw) {
  const value = raw.trim();
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value.startsWith('[') && value.endsWith(']')) {
    return value.slice(1, -1).split(',').map((item) => item.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  }
  return value.replace(/^["']|["']$/g, '');
}

function serializeFrontmatter(data) {
  const lines = Object.entries(data).map(([key, value]) => {
    if (Array.isArray(value)) return `${key}: [${value.map(quote).join(', ')}]`;
    if (typeof value === 'boolean') return `${key}: ${value}`;
    return `${key}: ${quote(value)}`;
  });
  return `---\n${lines.join('\n')}\n---`;
}

function splitTags(tags) {
  if (Array.isArray(tags)) return tags.map(String).map((tag) => tag.trim()).filter(Boolean);
  return String(tags || '').split(',').map((tag) => tag.trim()).filter(Boolean);
}

function cleanSlug(value = '') {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function quote(value) {
  return JSON.stringify(String(value ?? ''));
}

function matchValue(text, key) {
  const match = text.match(new RegExp(`${key}:\\s*['"]([^'"]*)['"]`));
  return match?.[1];
}

function normalizeSiteTitle(title, siteName) {
  const value = String(title || '').trim();
  if (!value || value.toLowerCase().startsWith('naimul.net -')) {
    return `${siteName} - Notes on books, places, photographs, and quiet progress`;
  }
  return value;
}

function extensionFor(name = '', mime = '') {
  const ext = path.extname(name).toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif'].includes(ext)) return ext;
  if (mime.includes('png')) return '.png';
  if (mime.includes('webp')) return '.webp';
  if (mime.includes('gif')) return '.gif';
  if (mime.includes('avif')) return '.avif';
  return '.jpg';
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function sendJson(res, value, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}

function sendText(res, value, status = 200) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(value);
}

function sendHtml(res, value) {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(value);
}

async function sendUpload(res, pathname) {
  const relative = pathname.replace(/^\/uploads\//, '');
  const file = path.resolve(uploadsDir, relative);
  if (!file.startsWith(uploadsDir) || !existsSync(file)) return sendText(res, 'Not found', 404);

  const ext = path.extname(file).toLowerCase();
  const contentType = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.avif': 'image/avif'
  }[ext] || 'application/octet-stream';

  res.writeHead(200, { 'content-type': contentType });
  res.end(await readFile(file));
}

function renderStudio() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Content Studio</title>
  <style>
    :root { color-scheme: light; font-family: Inter, system-ui, sans-serif; background: #f7f3ea; color: #172023; }
    * { box-sizing: border-box; }
    body { margin: 0; }
    header { position: sticky; top: 0; z-index: 2; display: flex; justify-content: space-between; gap: 16px; align-items: center; border-bottom: 1px solid #ddd2c0; padding: 18px 24px; background: #f7f3eaee; backdrop-filter: blur(14px); }
    h1, h2 { margin: 0; }
    main { display: grid; grid-template-columns: 320px minmax(0, 1fr); min-height: calc(100vh - 74px); }
    aside { border-right: 1px solid #ddd2c0; padding: 18px; background: #fffaf0; }
    section { padding: 24px; }
    button, input, textarea, select { font: inherit; }
    button { min-height: 40px; border: 1px solid #ddd2c0; border-radius: 999px; padding: 0 14px; background: #172023; color: #f7f3ea; font-weight: 800; cursor: pointer; }
    button.secondary { background: transparent; color: #172023; }
    button.danger { background: #8e3d2c; }
    label { display: grid; gap: 7px; color: #66705e; font-size: 0.86rem; font-weight: 800; }
    input, textarea, select { width: 100%; border: 1px solid #ddd2c0; border-radius: 8px; padding: 11px 12px; background: #fffdf7; color: #172023; }
    textarea { min-height: 220px; resize: vertical; line-height: 1.55; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
    .stack { display: grid; gap: 14px; }
    .row { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
    .items { display: grid; gap: 8px; margin-top: 14px; }
    .item { display: grid; gap: 4px; width: 100%; min-height: auto; border-radius: 8px; padding: 12px; background: transparent; color: #172023; text-align: left; }
    .item:hover, .item.active { background: #eee5d6; }
    .muted { color: #66705e; }
    .tabs { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 18px; }
    .tab { background: transparent; color: #172023; }
    .tab.active { background: #667247; color: #fffaf0; }
    .panel[hidden] { display: none; }
    .image-preview { max-width: 360px; border-radius: 8px; border: 1px solid #ddd2c0; }
    @media (max-width: 860px) { main { grid-template-columns: 1fr; } aside { border-right: 0; border-bottom: 1px solid #ddd2c0; } .grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>Content Studio</h1>
      <div class="muted">Local editor for posts, gallery, books, and site details</div>
    </div>
    <div class="row">
      <button id="buildSite" class="secondary">Build site</button>
      <a href="http://127.0.0.1:4321/" target="_blank"><button class="secondary">Open site</button></a>
    </div>
  </header>
  <main>
    <aside>
      <div class="row">
        <button id="newItem">New</button>
        <button class="secondary" id="refreshItems">Refresh</button>
      </div>
      <div class="items" id="items"></div>
    </aside>
    <section>
      <div class="tabs">
        <button class="tab active" data-tab="post">Posts</button>
        <button class="tab" data-tab="photo">Photography</button>
        <button class="tab" data-tab="book">Reading</button>
        <button class="tab" data-tab="site">Site details</button>
      </div>

      <form class="panel stack" id="postPanel">
        <div class="grid">
          <label>Title <input name="title" required /></label>
          <label>Slug <input name="slug" placeholder="my-post-url" /></label>
          <label>Description <input name="description" /></label>
          <label>Date <input name="pubDate" type="date" /></label>
          <label>Category <input name="category" placeholder="Essay" /></label>
          <label>Tags <input name="tags" placeholder="Writing, Personal" /></label>
          <label>Image path <input name="image" placeholder="/uploads/photo.jpg" /></label>
          <label>Image alt text <input name="imageAlt" /></label>
        </div>
        <div class="row">
          <label><input name="featured" type="checkbox" /> Featured</label>
          <label><input name="draft" type="checkbox" /> Draft</label>
        </div>
        <label>Upload image <input id="postImageUpload" type="file" accept="image/*" /></label>
        <img class="image-preview" id="postPreview" hidden alt="Uploaded preview" />
        <label>Body <textarea name="body" placeholder="Write your post here..."></textarea></label>
        <div class="row">
          <button type="submit">Save post</button>
          <button type="button" class="danger" id="deletePost">Delete post</button>
        </div>
      </form>

      <form class="panel stack" id="photoPanel" hidden>
        <div class="grid">
          <label>Title <input name="title" placeholder="Ridge Light" /></label>
          <label>Location <input name="location" placeholder="Mountain trail" /></label>
          <label>Image path <input name="image" placeholder="/uploads/photo.jpg" /></label>
          <label>Alt text <input name="alt" placeholder="Describe the image" /></label>
        </div>
        <label>Upload gallery image <input id="photoImageUpload" type="file" accept="image/*" /></label>
        <img class="image-preview" id="photoPreview" hidden alt="Gallery preview" />
        <div class="row">
          <button type="submit">Save photo</button>
          <button type="button" class="danger" id="deletePhoto">Delete photo</button>
        </div>
      </form>

      <form class="panel stack" id="bookPanel" hidden>
        <div class="grid">
          <label>Book title <input name="title" placeholder="Atomic Habits" /></label>
          <label>Author <input name="author" placeholder="James Clear" /></label>
          <label>Status
            <select name="status">
              <option>Reading</option>
              <option>Finished</option>
              <option>Notes</option>
              <option>Revisit</option>
              <option>Paused</option>
              <option>Want to read</option>
            </select>
          </label>
        </div>
        <label>Note <textarea name="note" placeholder="Short note about the book..."></textarea></label>
        <div class="row">
          <button type="submit">Save book</button>
          <button type="button" class="danger" id="deleteBook">Delete book</button>
        </div>
      </form>

      <form class="panel stack" id="sitePanel" hidden>
        <div class="grid">
          <label>Site name <input name="name" /></label>
          <label>Author <input name="author" /></label>
          <label>Site URL <input name="url" /></label>
          <label>Browser title <input name="title" /></label>
        </div>
        <label>Description <textarea name="description"></textarea></label>
        <button type="submit">Save site details</button>
      </form>
    </section>
  </main>

  <script>
    const panels = {
      post: document.querySelector('#postPanel'),
      photo: document.querySelector('#photoPanel'),
      book: document.querySelector('#bookPanel'),
      site: document.querySelector('#sitePanel')
    };
    const itemsEl = document.querySelector('#items');
    const state = { tab: 'post', postSlug: '', photoIndex: -1, bookIndex: -1, photos: [], books: [] };

    document.querySelectorAll('.tab').forEach((button) => button.addEventListener('click', () => switchTab(button.dataset.tab)));
    document.querySelector('#newItem').addEventListener('click', newItem);
    document.querySelector('#refreshItems').addEventListener('click', loadCurrentItems);

    document.querySelector('#buildSite').addEventListener('click', async () => {
      const button = document.querySelector('#buildSite');
      button.disabled = true;
      button.textContent = 'Building...';
      const result = await (await fetch('/api/build', { method: 'POST' })).json();
      button.disabled = false;
      button.textContent = 'Build site';
      alert(result.ok ? 'Build finished. Refresh the blog page.' : 'Build failed: ' + result.error);
    });

    document.querySelector('#postImageUpload').addEventListener('change', (event) => uploadInto(event, panels.post.image, document.querySelector('#postPreview')));
    document.querySelector('#photoImageUpload').addEventListener('change', (event) => uploadInto(event, panels.photo.image, document.querySelector('#photoPreview')));

    panels.post.addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(panels.post));
      data.featured = panels.post.featured.checked;
      data.draft = panels.post.draft.checked;
      await fetch('/api/posts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
      await loadPosts();
      alert('Post saved. Click Build site, then refresh your blog page.');
    });

    document.querySelector('#deletePost').addEventListener('click', async () => {
      if (!state.postSlug || !confirm('Delete this post?')) return;
      await fetch('/api/posts/' + encodeURIComponent(state.postSlug), { method: 'DELETE' });
      newPost();
      await loadPosts();
      alert('Post deleted. Click Build site, then refresh your blog page.');
    });

    panels.photo.addEventListener('submit', async (event) => {
      event.preventDefault();
      const photo = Object.fromEntries(new FormData(panels.photo));
      if (state.photoIndex === -1) state.photos.unshift(photo);
      else state.photos[state.photoIndex] = photo;
      await savePhotos();
      loadPhotosList();
      alert('Photo saved. Click Build site, then refresh the Photography page.');
    });

    document.querySelector('#deletePhoto').addEventListener('click', async () => {
      if (state.photoIndex === -1 || !confirm('Delete this photo?')) return;
      state.photos.splice(state.photoIndex, 1);
      newPhoto();
      await savePhotos();
      loadPhotosList();
      alert('Photo deleted. Click Build site, then refresh the Photography page.');
    });

    panels.book.addEventListener('submit', async (event) => {
      event.preventDefault();
      const book = Object.fromEntries(new FormData(panels.book));
      if (state.bookIndex === -1) state.books.unshift(book);
      else state.books[state.bookIndex] = book;
      await saveBooks();
      loadBooksList();
      alert('Book saved. Click Build site, then refresh the Reading page.');
    });

    document.querySelector('#deleteBook').addEventListener('click', async () => {
      if (state.bookIndex === -1 || !confirm('Delete this book?')) return;
      state.books.splice(state.bookIndex, 1);
      newBook();
      await saveBooks();
      loadBooksList();
      alert('Book deleted. Click Build site, then refresh the Reading page.');
    });

    panels.site.addEventListener('submit', async (event) => {
      event.preventDefault();
      await fetch('/api/site', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(panels.site))) });
      alert('Site details saved. Click Build site, then refresh your blog page.');
    });

    async function switchTab(tab) {
      state.tab = tab;
      document.querySelectorAll('.tab').forEach((item) => item.classList.toggle('active', item.dataset.tab === tab));
      Object.entries(panels).forEach(([key, panel]) => panel.hidden = key !== tab);
      document.querySelector('#newItem').hidden = tab === 'site';
      document.querySelector('#refreshItems').hidden = tab === 'site';
      await loadCurrentItems();
    }

    async function loadCurrentItems() {
      if (state.tab === 'post') return loadPosts();
      if (state.tab === 'photo') return loadPhotos();
      if (state.tab === 'book') return loadBooks();
      itemsEl.innerHTML = '<div class="muted">Site details do not use a list.</div>';
    }

    function newItem() {
      if (state.tab === 'post') newPost();
      if (state.tab === 'photo') newPhoto();
      if (state.tab === 'book') newBook();
    }

    function newPost() {
      state.postSlug = '';
      panels.post.reset();
      panels.post.pubDate.value = new Date().toISOString().slice(0, 10);
      document.querySelector('#postPreview').hidden = true;
    }

    async function loadPosts() {
      const posts = await (await fetch('/api/posts')).json();
      itemsEl.innerHTML = posts.map((post) => '<button class="item" data-slug="' + post.slug + '"><strong>' + escapeHtml(post.title || post.slug) + '</strong><span class="muted">' + escapeHtml(post.pubDate || '') + ' &middot; ' + escapeHtml(post.category || '') + '</span></button>').join('');
      itemsEl.querySelectorAll('.item').forEach((button) => button.addEventListener('click', () => loadPost(button.dataset.slug)));
    }

    async function loadPost(slug) {
      state.postSlug = slug;
      const post = await (await fetch('/api/posts/' + encodeURIComponent(slug))).json();
      panels.post.title.value = post.title || '';
      panels.post.slug.value = post.slug || '';
      panels.post.description.value = post.description || '';
      panels.post.pubDate.value = String(post.pubDate || '').slice(0, 10);
      panels.post.category.value = post.category || '';
      panels.post.tags.value = Array.isArray(post.tags) ? post.tags.join(', ') : '';
      panels.post.image.value = post.image || '';
      panels.post.imageAlt.value = post.imageAlt || '';
      panels.post.featured.checked = Boolean(post.featured);
      panels.post.draft.checked = Boolean(post.draft);
      panels.post.body.value = post.body || '';
      showPreview(document.querySelector('#postPreview'), post.image);
      markActive('slug', slug);
    }

    function newPhoto() {
      state.photoIndex = -1;
      panels.photo.reset();
      document.querySelector('#photoPreview').hidden = true;
      markActive('index', '-1');
    }

    async function loadPhotos() {
      state.photos = await (await fetch('/api/photos')).json();
      loadPhotosList();
    }

    function loadPhotosList() {
      itemsEl.innerHTML = state.photos.map((photo, index) => '<button class="item" data-index="' + index + '"><strong>' + escapeHtml(photo.title || 'Untitled photo') + '</strong><span class="muted">' + escapeHtml(photo.location || photo.image || '') + '</span></button>').join('');
      itemsEl.querySelectorAll('.item').forEach((button) => button.addEventListener('click', () => loadPhoto(Number(button.dataset.index))));
    }

    function loadPhoto(index) {
      state.photoIndex = index;
      const photo = state.photos[index] || {};
      panels.photo.title.value = photo.title || '';
      panels.photo.location.value = photo.location || '';
      panels.photo.image.value = photo.image || '';
      panels.photo.alt.value = photo.alt || '';
      showPreview(document.querySelector('#photoPreview'), photo.image);
      markActive('index', String(index));
    }

    async function savePhotos() {
      await fetch('/api/photos', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ photos: state.photos }) });
    }

    function newBook() {
      state.bookIndex = -1;
      panels.book.reset();
      markActive('index', '-1');
    }

    async function loadBooks() {
      state.books = await (await fetch('/api/books')).json();
      loadBooksList();
    }

    function loadBooksList() {
      itemsEl.innerHTML = state.books.map((book, index) => '<button class="item" data-index="' + index + '"><strong>' + escapeHtml(book.title || 'Untitled book') + '</strong><span class="muted">' + escapeHtml(book.author || '') + ' &middot; ' + escapeHtml(book.status || '') + '</span></button>').join('');
      itemsEl.querySelectorAll('.item').forEach((button) => button.addEventListener('click', () => loadBook(Number(button.dataset.index))));
    }

    function loadBook(index) {
      state.bookIndex = index;
      const book = state.books[index] || {};
      panels.book.title.value = book.title || '';
      panels.book.author.value = book.author || '';
      panels.book.status.value = book.status || 'Reading';
      panels.book.note.value = book.note || '';
      markActive('index', String(index));
    }

    async function saveBooks() {
      await fetch('/api/books', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ books: state.books }) });
    }

    async function loadSite() {
      const site = await (await fetch('/api/site')).json();
      Object.entries(site).forEach(([key, value]) => {
        if (panels.site.elements[key]) panels.site.elements[key].value = value || '';
      });
    }

    async function uploadInto(event, input, preview) {
      const file = event.target.files[0];
      if (!file) return;
      const dataUrl = await fileToDataUrl(file);
      const response = await fetch('/api/upload', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: file.name, dataUrl }) });
      const result = await response.json();
      input.value = result.path;
      showPreview(preview, result.path);
    }

    function showPreview(preview, image) {
      preview.src = image || '';
      preview.hidden = !image || !(image.startsWith('/uploads/') || image.startsWith('http'));
    }

    function markActive(attribute, value) {
      itemsEl.querySelectorAll('.item').forEach((item) => item.classList.toggle('active', item.dataset[attribute] === value));
    }

    function fileToDataUrl(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    }

    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
    }

    loadPosts();
    loadSite();
  </script>
</body>
</html>`;
}
