import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const avatar = (n: number) => `https://i.pravatar.cc/200?img=${n}`;
const photo = (seed: string, w = 900, h = 600) => `https://picsum.photos/seed/${seed}/${w}/${h}`;

const PASSWORD = "Password123!"; // every demo account uses this password

const demoUsers = [
  { name: "Alex Morgan", username: "alexmorgan", img: 12, bio: "Builder • Designer • Coffee lover ☕", location: "Chattogram, BD" },
  { name: "Sara Khan", username: "sarakhan", img: 47, bio: "Photographer 📸 chasing light." },
  { name: "Liam Chen", username: "liamchen", img: 33, bio: "Frontend engineer. React, motion & coffee." },
  { name: "Mina Rahman", username: "minarahman", img: 45, bio: "Travel • Food • Stories 🌍" },
  { name: "Noah Williams", username: "noahw", img: 15, bio: "Indie hacker shipping every week 🚀" },
  { name: "Aisha Ali", username: "aishaali", img: 32, bio: "UX designer & illustrator ✏️" },
];

async function main() {
  const passwordHash = await bcrypt.hash(PASSWORD, 12);

  const users = [];
  for (const u of demoUsers) {
    users.push(
      await prisma.user.upsert({
        where: { username: u.username },
        update: {},
        create: {
          name: u.name,
          username: u.username,
          email: `${u.username}@example.com`,
          passwordHash,
          emailVerified: true,
          avatar: avatar(u.img),
          cover: photo(`cover-${u.username}`, 1200, 400),
          bio: u.bio,
          location: u.location,
        },
      }),
    );
  }
  const [alex, sara, liam, mina, noah, aisha] = users as [typeof users[0], ...typeof users];

  if ((await prisma.post.count()) === 0) {
    const ago = (mins: number) => new Date(Date.now() - mins * 60_000);
    await prisma.post.createMany({
      data: [
        { authorId: sara.id, text: "Golden hour over the hills this morning 🌄 #photography #nature", image: photo("hills", 1000, 700), createdAt: ago(12) },
        { authorId: liam.id, text: "Migrated our app to React 19 + Tailwind v4. Build times dropped 60%! #react #webdev", createdAt: ago(55) },
        { authorId: mina.id, text: "Street food tour in Chattogram was incredible ❤️ #foodie #travel", image: photo("streetfood", 1000, 650), createdAt: ago(180) },
        { authorId: noah.id, text: "Week 14 of building in public: 1,000 users 🎉 #indiehackers #buildinpublic", createdAt: ago(360) },
        { authorId: aisha.id, text: "New illustration series: 'Cities at night'. Favorite? #illustration #design", image: photo("citynight", 1000, 700), createdAt: ago(540) },
        { authorId: alex.id, text: "Welcome to SocialHub! 🎉 Try dark mode — light, dark or system. #react", createdAt: ago(780) },
      ],
    });
  }

  const follows = users.flatMap((a) => users.filter((b) => b.id !== a.id && (a.username.length + b.username.length) % 2 === 0).map((b) => ({ followerId: a.id, followingId: b.id })));
  await prisma.follow.createMany({ data: follows, skipDuplicates: true });

  for (const c of [
    { name: "React Developers", about: "Hooks, patterns, performance and everything React.", cover: photo("g1", 600, 300) },
    { name: "Photography Hub", about: "Share your shots, get feedback, learn techniques.", cover: photo("g2", 600, 300) },
    { name: "Indie Hackers BD", about: "Bangladeshi makers building products.", cover: photo("g3", 600, 300) },
    { name: "UI/UX Designers", about: "Design systems, critiques and inspiration.", cover: photo("g4", 600, 300) },
  ]) {
    await prisma.community.upsert({ where: { name: c.name }, update: {}, create: c });
  }

  if ((await prisma.event.count()) === 0) {
    const inDays = (d: number) => new Date(Date.now() + d * 86_400_000);
    await prisma.event.createMany({
      data: [
        { title: "React Conf Dhaka", location: "Dhaka, Bangladesh", startsAt: inDays(30), cover: photo("e1", 700, 350), description: "A full day of React talks and workshops." },
        { title: "Photo Walk: Patenga Beach", location: "Chattogram", startsAt: inDays(12), cover: photo("e2", 700, 350), description: "Sunrise photography walk." },
        { title: "Startup Pitch Night", location: "Online", startsAt: inDays(50), cover: photo("e3", 700, 350), description: "Pitch your idea to real investors." },
      ],
    });
  }

  console.log(`🌱 Seed complete. Log in with e.g. alexmorgan@example.com / ${PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
