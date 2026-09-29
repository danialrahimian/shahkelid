"use strict";

/**
 * Fills the feed with the ten sample articles.
 *
 * Re-runnable: each article is matched by slug and updated rather than
 * duplicated, so running it twice leaves ten posts and not twenty. Existing
 * likes and comments are left alone.
 *
 *   npm run seed:posts
 */

const fs = require("node:fs/promises");
const path = require("node:path");
const mongoose = require("mongoose");

const config = require("../src/config");
const { Post } = require("../src/components/posts/post.model");
const { User } = require("../src/components/users/user.model");
const { POSTS } = require("./seed-posts.data");

/**
 * Draws a cover image rather than downloading one.
 *
 * A generated SVG needs no network, carries no licence, and weighs a couple of
 * kilobytes. Each article gets its own gradient and a soft keyhole watermark,
 * so the grid reads as a set without ten identical placeholders.
 */
const coverSvg = ({ title, palette, index }) => {
  const [from, to] = palette;
  const escape = (value) =>
    value.replace(/[<>&]/g, (character) =>
      character === "<" ? "&lt;" : character === ">" ? "&gt;" : "&amp;",
    );

  // Wrap the title onto at most three lines of roughly 22 characters.
  const words = title.split(" ");
  const lines = [];
  let current = "";
  for (const word of words) {
    if ((current + " " + word).trim().length > 22 && current) {
      lines.push(current.trim());
      current = word;
    } else {
      current = `${current} ${word}`.trim();
    }
  }
  if (current) lines.push(current);
  const shown = lines.slice(0, 3);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 1200" width="1200" height="1200" role="img" aria-label="${escape(title)}">
  <defs>
    <linearGradient id="g${index}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${from}"/>
      <stop offset="100%" stop-color="${to}"/>
    </linearGradient>
    <radialGradient id="v${index}" cx="50%" cy="35%" r="75%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0.35"/>
    </radialGradient>
  </defs>

  <rect width="1200" height="1200" fill="url(#g${index})"/>
  <rect width="1200" height="1200" fill="url(#v${index})"/>

  <g opacity="0.10" fill="#ffffff" transform="translate(880 210) scale(2.6)">
    <circle cx="60" cy="42" r="26"/>
    <path d="M 48 64 L 72 64 L 84 128 A 24 24 0 0 1 36 128 Z"/>
  </g>

  <g fill="#ffffff" font-family="Georgia, 'Times New Roman', serif" font-size="86" font-weight="700">
    ${shown
      .map(
        (line, lineIndex) =>
          `<text x="90" y="${820 + lineIndex * 104}">${escape(line)}</text>`,
      )
      .join("\n    ")}
  </g>

  <text x="90" y="${820 + shown.length * 104 + 46}" fill="#ffffff" fill-opacity="0.72" font-family="Helvetica, Arial, sans-serif" font-size="38" letter-spacing="4">SHAH KELID</text>
</svg>`;
};

const main = async () => {
  await fs.mkdir(config.uploads.directory, { recursive: true });
  await mongoose.connect(config.database.uri);

  // Attribute the articles to a real staff account when one exists, so the
  // author line is not invented.
  const staff = await User.findOne({
    role: { $in: ["owner", "admin", "moderator"] },
  }).sort({ createdAt: 1 });

  const author = {
    userId: staff?._id,
    name: staff?.displayName || staff?.username || "Shah Kelid",
    avatar: staff?.avatar ?? null,
  };

  let created = 0;
  let updated = 0;

  for (const [index, article] of POSTS.entries()) {
    const fileName = `post-${article.slug}.svg`;
    await fs.writeFile(
      path.join(config.uploads.directory, fileName),
      coverSvg({ title: article.title, palette: article.palette, index }),
      "utf8",
    );

    const existing = await Post.findOne({ slug: article.slug });

    const document = {
      slug: article.slug,
      title: article.title,
      excerpt: article.excerpt,
      content: article.content,
      coverImage: `${config.uploads.publicPath}/${fileName}`,
      tags: article.tags,
      readingMinutes: article.readingMinutes,
      author,
      // Spread the publication dates so the feed is not ten identical
      // timestamps, and so "newest first" produces the intended order.
      createdAt: new Date(Date.now() - (POSTS.length - index) * 86_400_000),
    };

    if (existing) {
      // Likes and comments belong to readers, so they are never overwritten.
      await Post.updateOne({ _id: existing._id }, { $set: document });
      updated += 1;
    } else {
      await Post.create(document);
      created += 1;
    }
  }

  console.log(`Seeded articles: ${created} created, ${updated} updated.`);
  await mongoose.disconnect();
};

main().catch(async (error) => {
  console.error(error.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
