# naimul.net blog

A minimal personal blog built with Astro, TypeScript, MDX, Tailwind CSS, Pagefind, RSS, and sitemap generation.

## Run locally

```sh
npm install
npm run dev
```

Open `http://127.0.0.1:4321/`.

## Production build

```sh
npm run build
npm run preview
```

The build outputs static files to `dist/` and generates the Pagefind search index.

## Add a post

Create a new `.mdx` file in `src/content/blog/` with frontmatter like this:

```md
---
title: "My new post"
description: "A short summary for SEO and listing pages."
pubDate: "2026-06-27"
tags: ["Writing", "Personal"]
category: "Essay"
image: "https://images.unsplash.com/photo-example"
imageAlt: "Describe the image"
featured: false
---
```

The post automatically appears in the blog archive, tag pages, RSS feed, sitemap, and search index after a production build.

## Edit content with the local studio

Run this in a second terminal:

```sh
npm run studio
```

Open `http://127.0.0.1:5175/`.

The studio can create/edit/delete posts, upload images into `public/uploads/`, and update basic site details. Keep `npm run dev` or `npm run preview` running separately for the public blog.

## Customize

- Site name and navigation: `src/data/site.ts`
- Colors and typography: `src/styles/global.css`
- Reading shelf: `src/data/books.ts`
- Photography gallery: `src/data/photos.ts`
- Content schema: `src/content.config.ts`
