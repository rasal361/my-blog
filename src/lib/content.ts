import { getCollection } from 'astro:content';

export type BlogPost = Awaited<ReturnType<typeof getAllPosts>>[number];

export async function getAllPosts() {
  const posts = await getCollection('blog', ({ data }) => !data.draft);

  return posts.sort(
    (a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf()
  );
}

export async function getFeaturedPosts() {
  const posts = await getAllPosts();
  return posts.filter((post) => post.data.featured);
}

export async function getAllTags() {
  const posts = await getAllPosts();
  const tags = new Map<string, number>();

  for (const post of posts) {
    for (const tag of post.data.tags) {
      const key = normalizeTag(tag);
      tags.set(key, (tags.get(key) ?? 0) + 1);
    }
  }

  return [...tags.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => a.tag.localeCompare(b.tag));
}

export function normalizeTag(tag: string) {
  return tag.trim().toLowerCase().replace(/\s+/g, '-');
}

export function formatDate(date: Date) {
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(date);
}

export function readingTime(body = '') {
  const words = body.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}
