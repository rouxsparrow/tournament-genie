/* eslint-disable @typescript-eslint/no-require-imports */
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {
  const matches = await prisma.knockoutMatch.findMany({
    where: { series: "A", round: 1 },
    select: { id: true, categoryCode: true, series: true, round: true },
  });

  if (matches.length === 0) {
    console.log("No Series A round=1 knockout matches found.");
    return;
  }

  const result = await prisma.knockoutMatch.deleteMany({
    where: { series: "A", round: 1 },
  });

  console.log(`Series A round=1 matches found: ${matches.length}`);
  console.log(`Series A round=1 matches deleted: ${result.count}`);
}

main()
  .catch((error) => {
    console.error("Cleanup failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
