import type { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { ApiError } from "../../utils/ApiError";
import { cursorArgs, toPage } from "../../utils/response";
import { notify } from "../notifications/notification.service";
import { privateUser } from "../auth/auth.service";

const publicSelect = { id: true, name: true, username: true, avatar: true, bio: true } as const;

/** Profile card shape used by the frontend. `viewerId` adds the isFollowing flag. */
const profileInclude = (viewerId?: string) =>
  ({
    _count: { select: { followers: true, following: true, posts: true } },
    followers: { where: { followerId: viewerId ?? "" }, select: { followerId: true }, take: 1 },
  }) satisfies Prisma.UserInclude;

type ProfileRow = Prisma.UserGetPayload<{ include: ReturnType<typeof profileInclude> }>;

const toProfile = (u: ProfileRow) => ({
  id: u.id,
  name: u.name,
  username: u.username,
  avatar: u.avatar,
  cover: u.cover,
  bio: u.bio,
  location: u.location,
  website: u.website,
  passion: u.passion,
  relationshipStatus: u.relationshipStatus,
  createdAt: u.createdAt,
  followersCount: u._count.followers,
  followingCount: u._count.following,
  postsCount: u._count.posts,
  isFollowing: u.followers.length > 0,
});

async function findOrFail(username: string) {
  const user = await prisma.user.findUnique({ where: { username: username.toLowerCase() }, select: { id: true } });
  if (!user) throw ApiError.notFound("User not found");
  return user;
}

export const userService = {
  async getProfile(username: string, viewerId?: string) {
    const user = await prisma.user.findUnique({
      where: { username: username.toLowerCase() },
      include: profileInclude(viewerId),
    });
    if (!user) throw ApiError.notFound("User not found");
    return toProfile(user);
  },

  async updateMe(userId: string, data: Prisma.UserUpdateInput) {
    // Unique-constraint errors (username taken) are turned into HTTP 409 by the error handler
    const user = await prisma.user.update({ where: { id: userId }, data });
    return privateUser(user);
  },

  search: (q: string) =>
    prisma.user.findMany({
      where: { emailVerified: true, OR: [{ username: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }] },
      select: publicSelect,
      take: 10,
    }),

  suggestions: (viewerId: string) =>
    prisma.user.findMany({
      where: { id: { not: viewerId }, emailVerified: true, followers: { none: { followerId: viewerId } } },
      orderBy: { followers: { _count: "desc" } },
      select: publicSelect,
      take: 5,
    }),

  async follow(viewerId: string, username: string) {
    const target = await findOrFail(username);
    if (target.id === viewerId) throw ApiError.badRequest("You cannot follow yourself");

    const { count } = await prisma.follow.createMany({
      data: [{ followerId: viewerId, followingId: target.id }],
      skipDuplicates: true,
    });
    if (count > 0) await notify({ recipientId: target.id, actorId: viewerId, type: "FOLLOW" });
  },

  async unfollow(viewerId: string, username: string) {
    const target = await findOrFail(username);
    await prisma.follow.deleteMany({ where: { followerId: viewerId, followingId: target.id } });
  },

  async followers(username: string, cursor: string | undefined, limit: number) {
    const target = await findOrFail(username);
    const rows = await prisma.user.findMany({
      where: { following: { some: { followingId: target.id } } },
      select: publicSelect,
      orderBy: { id: "asc" },
      ...cursorArgs(cursor, limit),
    });
    return toPage(rows, limit);
  },

  async following(username: string, cursor: string | undefined, limit: number) {
    const target = await findOrFail(username);
    const rows = await prisma.user.findMany({
      where: { followers: { some: { followerId: target.id } } },
      select: publicSelect,
      orderBy: { id: "asc" },
      ...cursorArgs(cursor, limit),
    });
    return toPage(rows, limit);
  },
};
