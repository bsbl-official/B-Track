// Tags on tasks. A task's tags arrive by name: an existing tag (matched ignoring case) or a new plain one,
// which is created with the task. Tags that ask for details (tables, form files, screens…) need at least
// one, tidied and checked against the tag's rules.
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { HttpError } from "./http.js";
import { PO_COLORS } from "./poColors.js";
import { prisma } from "./prisma.js";

export const tagSelect = {
  id: true,
  name: true,
  color: true,
  detailLabel: true,
  detailHint: true,
  detailExtensions: true,
  detailUppercase: true,
  isActive: true,
} as const;

export type TagRow = Prisma.TagGetPayload<{ select: typeof tagSelect }>;

export const tagInputSchema = z
  .array(
    z.object({
      name: z.string().trim().min(1, "A tag needs a name").max(60, "Tag names can be up to 60 characters"),
      details: z.array(z.string().max(200, "Details can be up to 200 characters each")).max(100).default([]),
    }),
  )
  .max(20, "A task can have up to 20 tags");

export type TagInput = z.infer<typeof tagInputSchema>;

export const cleanTagName = (name: string) => name.replace(/\s+/g, " ").trim();

const listText = (items: string[]) => (items.length > 1 ? `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}` : items[0]);

/** A tag's details as saved: tidied, in capitals where the tag says so, each listed once. */
export function cleanDetails(tag: Pick<TagRow, "name" | "detailLabel" | "detailExtensions" | "detailUppercase">, details: string[]): string[] {
  if (!tag.detailLabel) return [];
  const result: string[] = [];
  for (const raw of details) {
    let detail = raw.replace(/\s+/g, " ").trim();
    if (!detail) continue;
    if (tag.detailUppercase) detail = detail.toUpperCase();
    if (tag.detailExtensions.length > 0) {
      const ending = detail.split(".").pop()?.toLowerCase();
      if (!detail.includes(".") || !ending || !tag.detailExtensions.includes(ending)) {
        throw new HttpError(400, `“${detail}” (${tag.name}) must end in ${listText(tag.detailExtensions.map((extension) => `.${extension}`))}`);
      }
    }
    if (!result.some((item) => item.toLowerCase() === detail.toLowerCase())) result.push(detail);
  }
  if (result.length === 0) throw new HttpError(400, `List the ${tag.detailLabel.toLowerCase()} for the “${tag.name}” tag`);
  return result;
}

// tag is null for a new tag, created when the task is saved.
export type ResolvedTag = { tag: TagRow | null; name: string; details: string[] };

/**
 * Matches the requested tags to existing ones and checks their details. Archived tags can stay on a task
 * that already has them, but can't be added.
 */
export async function resolveTags(inputs: TagInput, alreadyLinked: string[] = []): Promise<ResolvedTag[]> {
  const merged = new Map<string, { name: string; details: string[] }>();
  for (const input of inputs) {
    const name = cleanTagName(input.name);
    const key = name.toLowerCase();
    const entry = merged.get(key);
    if (entry) entry.details.push(...input.details);
    else merged.set(key, { name, details: [...input.details] });
  }
  if (merged.size === 0) return [];

  const existing = await prisma.tag.findMany({
    where: { OR: [...merged.values()].map(({ name }) => ({ name: { equals: name, mode: "insensitive" as const } })) },
    select: tagSelect,
  });
  return [...merged.entries()]
    .map(([key, { name, details }]) => {
      const tag = existing.find((item) => item.name.toLowerCase() === key) ?? null;
      if (tag && !tag.isActive && !alreadyLinked.includes(tag.id)) throw new HttpError(400, `The “${tag.name}” tag is archived`);
      return tag ? { tag, name: tag.name, details: cleanDetails(tag, details) } : { tag: null, name, details: [] };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Creates the new tags (plain ones, coloured in turn) and returns every tag's id with its details. */
export async function saveNewTags(transaction: Prisma.TransactionClient, resolved: ResolvedTag[]) {
  let count = resolved.some((item) => !item.tag) ? await transaction.tag.count() : 0;
  const links: Array<{ tagId: string; details: string[] }> = [];
  for (const item of resolved) {
    if (item.tag) {
      links.push({ tagId: item.tag.id, details: item.details });
      continue;
    }
    const created = await transaction.tag.upsert({
      where: { name: item.name },
      create: { name: item.name, color: PO_COLORS[count++ % PO_COLORS.length] },
      update: {},
    });
    links.push({ tagId: created.id, details: [] });
  }
  return links;
}

/** How tags read in a task's history: "Database/DB: CR_INFO, LOAN_INFO; Forms: PAYROLL.fmb; Urgent". */
export function tagsText(tags: Array<{ name: string; details: string[] }>): string | null {
  return (
    [...tags]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((tag) => (tag.details.length > 0 ? `${tag.name}: ${tag.details.join(", ")}` : tag.name))
      .join("; ") || null
  );
}
