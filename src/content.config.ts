import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const news = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/news' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    summary: z.string(),
    author: z.string().optional(),
  }),
});

const projects = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/projects' }),
  schema: z.object({
    title: z.string(),
    department: z.string(),
    supervisor: z.string(),
    type: z.enum([
      'audit',
      'qi',
      'case-report',
      'retrospective',
      'prospective',
      'systematic-review',
      'other',
    ]),
    commitment: z.string(),
    skills: z.array(z.string()).default([]),
    recruitingNow: z.boolean().default(false),
    contactEmail: z.string().email().optional(),
    expiryDate: z.coerce.date().optional(),
    example: z.boolean().default(false),
  }),
});

const people = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/people' }),
  schema: z.object({
    name: z.string(),
    role: z.string(),
    department: z.string(),
    themes: z.array(z.string()).default([]),
    orcid: z.string().optional(),
    consent: z.enum(['pending', 'granted']).default('pending'),
    example: z.boolean().default(false),
  }),
});

export const collections = { news, projects, people };
