import { z } from "zod";

const optionalText = (max: number) =>
  z.string().trim().max(max).transform((v) => (v === "" ? null : v)).nullable().optional();

const optionalUrl = z.union([z.literal(""), z.url("Must be a valid URL")]).transform((v) => (v === "" ? null : v)).nullable().optional();

export const updateProfileSchema = z
  .object({
    name: z.string().trim().min(2).max(50).optional(),
    username: z.string().trim().toLowerCase().regex(/^[a-z0-9_]{3,20}$/, "Username: 3-20 letters, numbers or underscores").optional(),
    bio: optionalText(160),
    location: optionalText(60),
    website: optionalText(100),
    avatar: optionalUrl,
    cover: optionalUrl,
    passion: optionalText(120),
    relationshipStatus: z.enum(["Single", "Married", "In a relationship", "Prefer not to say"]).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Send at least one field to update");

export const searchUsersQuery = z.object({
  q: z.string().trim().min(1).max(50),
});
