# SocialHub Server

Node.js + Express 5 + TypeScript + Prisma + Neon PostgreSQL.
JWT auth (access + rotating refresh tokens), email verification codes with Nodemailer, Zod validation,
Cloudinary video uploads (signed direct-from-browser uploads).

## Quick start

```bash
npm install                 # also runs "prisma generate"
cp .env.example .env        # then fill in your secrets (see below)
npm run db:migrate          # creates the tables in Neon (name the migration e.g. "init")
npm run db:seed             # optional demo data (password for all demo users: Password123!)
npm run dev                 # http://localhost:5000/api/health
```

Production: `npm run build && npm run db:deploy && npm start`

## 🔑 Where to put your secrets

Everything goes in **`.env`** (never commit it). `.env.example` lists every variable with comments.

| What | .env variable | Used in |
| --- | --- | --- |
| Neon pooled URL (`-pooler` host) | `DATABASE_URL` | `prisma/schema.prisma`, `src/config/prisma.ts` |
| Neon direct URL (for migrations) | `DIRECT_URL` | `prisma/schema.prisma` |
| JWT access secret (32+ chars) | `JWT_ACCESS_SECRET` | `src/utils/jwt.ts` |
| JWT refresh secret (32+ chars, different) | `JWT_REFRESH_SECRET` | `src/utils/jwt.ts` |
| SMTP host / user / password | `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` | `src/lib/mailer.ts` |
| Sender address | `MAIL_FROM` | `src/lib/mailer.ts` |
| Cloudinary cloud name / API key / API secret | `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | `src/lib/cloudinary.ts` |
| Video limits (optional) | `MAX_VIDEO_MB` (100), `MAX_VIDEO_SECONDS` (180) | `src/lib/cloudinary.ts` |
| Frontend URL for CORS | `CLIENT_URL` | `src/app.ts` |

**Already have a `.env` with different variable names?** Open `src/config/env.ts` — it is the *only* file that reads
`process.env`. Rename the keys there (and in `prisma/schema.prisma` if your Neon variables are named differently).

If `SMTP_HOST` is empty in development, verification codes are printed in the terminal instead of emailed.

## Project structure

```
prisma/            schema.prisma, seed.ts
prisma.config.ts   Prisma CLI config (seed command, loads .env)
src/
  config/          env.ts (validated env), prisma.ts (shared client)
  lib/             mailer.ts (Nodemailer + HTML email template), cloudinary.ts (video signing / verify / delete)
  middleware/      auth, validate (Zod), error, rateLimit
  modules/         auth · users · posts (+comments) · notifications · messages · communities · events · uploads
                   each: routes -> (controller) -> service -> Prisma
  routes/          index.ts mounts every module under /api
  utils/           ApiError, response helpers, jwt, crypto
  app.ts           Express app (helmet, cors, rate limit, routes, error handler)
  server.ts        starts the server + graceful shutdown
```

## Auth flow

1. `POST /api/auth/register` → account created, 6-digit code emailed
2. `POST /api/auth/verify-email` → `{ accessToken, user }` + httpOnly `refreshToken` cookie (user is logged in)
3. Send `Authorization: Bearer <accessToken>` on protected requests
4. On `401` with `code: "TOKEN_EXPIRED"` call `POST /api/auth/refresh` (cookie is sent automatically) → new access token. The refresh token is **rotated**; re-using an old one revokes every session of that user.
5. `POST /api/auth/logout` clears the cookie and revokes the session

Security built in: bcrypt (12 rounds), hashed codes and refresh tokens in the DB, 5 wrong-code limit, resend cooldown, rate limiting, helmet, CORS allow-list, no user enumeration on forgot-password / resend.

## API reference (`/api`)

Auth column: 🔓 public · 👤 optional token (adds `liked`, `isFollowing`…) · 🔒 token required.
Lists accept `?cursor=<nextCursor>&limit=10` and return `{ success, data, nextCursor }`.

| Method & path | Auth | Description |
| --- | --- | --- |
| `GET /health` | 🔓 | Server + database check |
| `POST /auth/register` | 🔓 | `{ name, username, email, password }` |
| `POST /auth/verify-email` | 🔓 | `{ email, code }` |
| `POST /auth/resend-code` | 🔓 | `{ email }` |
| `POST /auth/login` | 🔓 | `{ email, password }` (403 `EMAIL_NOT_VERIFIED` if not verified) |
| `POST /auth/refresh` | cookie | New access token |
| `POST /auth/logout` | cookie | Revoke session |
| `POST /auth/forgot-password` | 🔓 | `{ email }` → emails a code |
| `POST /auth/reset-password` | 🔓 | `{ email, code, newPassword }` |
| `POST /auth/change-password` | 🔒 | `{ currentPassword, newPassword }` |
| `GET /auth/me` | 🔒 | Current user (includes email) |
| `GET /users/search?q=` | 🔓 | Find people |
| `GET /users/suggestions` | 🔒 | Who to follow |
| `PATCH /users/me` | 🔒 | `name, username, bio, location, website, avatar, cover` |
| `GET /users/:username` | 👤 | Profile + counts + `isFollowing` |
| `GET /users/:username/posts` | 👤 | Posts by user |
| `GET /users/:username/followers` · `/following` | 🔓 | Lists |
| `POST` · `DELETE /users/:username/follow` | 🔒 | Follow / unfollow |
| `GET /posts?scope=all\|following&q=` | 👤 | Feed + search |
| `GET /posts/trending` | 🔓 | Top hashtags |
| `GET /posts/bookmarks` | 🔒 | Saved posts |
| `POST /posts` | 🔒 | `{ text?, image?, videoPublicId? }` (image = URL; video = public_id from the upload flow below; image and video cannot be combined; `@username` mentions notify) |
| `GET /posts/:id` · `DELETE /posts/:id` | 👤 · 🔒 | Single post / delete own |
| `POST` · `DELETE /posts/:id/like` | 🔒 | Like / unlike |
| `POST` · `DELETE /posts/:id/bookmark` | 🔒 | Bookmark / remove |
| `POST /uploads/video-signature` | 🔒 | Signed parameters for a direct Cloudinary video upload |
| `DELETE /uploads/video` | 🔒 | `{ publicId }` discard an uploaded video that was never attached to a post |
| `POST /posts/:id/share` | 🔓 | Increment share count |
| `GET /posts/:id/comments` · `POST` | 🔓 · 🔒 | List / add `{ text }` |
| `DELETE /comments/:id` | 🔒 | Comment author or post author |
| `GET /notifications` · `/unread-count` | 🔒 | List / badge count |
| `PATCH /notifications/read-all` · `/:id/read` | 🔒 | Mark read |
| `DELETE /notifications` | 🔒 | Clear all |
| `GET /messages/conversations` | 🔒 | Inbox |
| `POST /messages/conversations` | 🔒 | `{ username }` → get or create chat |
| `GET` · `POST /messages/conversations/:id/messages` | 🔒 | History (newest first) / send `{ text }` |
| `GET /communities` · `POST` | 👤 · 🔒 | List / create |
| `POST` · `DELETE /communities/:id/join` | 🔒 | Join / leave |
| `GET /events` · `POST` | 👤 · 🔒 | Upcoming events / create |
| `POST` · `DELETE /events/:id/going` | 🔒 | RSVP |

Errors always look like `{ success: false, code, message, errors? }` (validation errors → HTTP 422 with `errors: [{ field, message }]`).

## Video uploads (Cloudinary)

Videos go **browser → Cloudinary directly**, so large files never pass through this server.

1. `POST /api/uploads/video-signature` (logged in) → `{ uploadUrl, fields, publicId, maxFileMB, maxDurationSeconds }`
2. Browser sends a `multipart/form-data` POST to `uploadUrl` containing the `file` plus **every entry of `fields`** unchanged.
   Cloudinary replies with JSON; keep nothing from it except that it succeeded (use `publicId` from step 1).
3. `POST /api/posts` with `{ text?, videoPublicId: publicId }`. The server asks Cloudinary what was really uploaded and checks
   that the video belongs to the user, is under `MAX_VIDEO_MB` and `MAX_VIDEO_SECONDS` (otherwise the file is deleted and the request fails).
4. Posts then return `video: { url, thumbnail, duration }` (or `video: null`). Deleting a post also deletes the video from Cloudinary.

Rules enforced by the server: allowed formats `mp4, mov, webm, m4v, 3gp`; each user can only upload into `socialhub/videos/<userId>/`;
a video can be attached to one post only; signatures expire after 1 hour; signature requests are limited to 30 per hour.
If the Cloudinary variables are empty, the upload endpoints answer `503 UPLOADS_DISABLED` and the rest of the API works as before.

Videos that are uploaded but never attached to a post stay in Cloudinary until `DELETE /uploads/video` is called for them
(call it when the user cancels the composer). To clean up abandoned ones automatically, add a Cloudinary lifecycle rule or a scheduled job.

After pulling this version run `npm install` (adds the `cloudinary` package) and `npm run db:migrate` (adds the video columns to `Post`).

## Connecting the React frontend

```ts
// api.ts
const API = "http://localhost:5000/api";
let accessToken: string | null = null; // keep in memory / Redux (not localStorage)

export async function api(path: string, init: RequestInit = {}, retry = true): Promise<any> {
  const res = await fetch(API + path, {
    ...init,
    credentials: "include", // sends the httpOnly refresh cookie
    headers: {
      "Content-Type": "application/json",
      ...(accessToken && { Authorization: `Bearer ${accessToken}` }),
      ...init.headers,
    },
  });
  const json = await res.json();

  if (res.status === 401 && json.code === "TOKEN_EXPIRED" && retry) {
    const r = await fetch(API + "/auth/refresh", { method: "POST", credentials: "include" });
    if (r.ok) {
      accessToken = (await r.json()).data.accessToken;
      return api(path, init, false);
    }
  }
  if (!res.ok) throw json;
  return json;
}
```

Set `CLIENT_URL` to your frontend origin (e.g. `http://localhost:5173`). Because the refresh cookie is `SameSite=None; Secure` in production, serve both frontend and API over HTTPS when you deploy.

## Notes

- Images are still accepted as URLs. Videos use the Cloudinary flow above.
- Real-time chat: messages are stored and fetched over REST. Add `socket.io` on top of `message.service.ts` when you want live delivery.
- Add new tables by editing `prisma/schema.prisma`, then `npm run db:migrate`.

## Comment replies (updated client compatibility)
The Comment model now supports one-level replies through the optional `parentId` field. After pulling these updated files, regenerate Prisma Client and apply the schema before running the client:

```bash
npx prisma generate
npx prisma db push
npm run dev
```

Use a Prisma migration for production deployments rather than `db push`.
