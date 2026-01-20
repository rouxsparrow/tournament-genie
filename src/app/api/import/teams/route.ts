import { prisma } from "@/lib/prisma";
import {
  getMappedValue,
  mapHeaders,
  parseCsv,
  parseXlsx,
} from "@/lib/import-utils";

export const runtime = "nodejs";

const HEADER_ALIASES: Record<string, string> = {
  player1: "player1",
  playerone: "player1",
  player1name: "player1",
  player2: "player2",
  playertwo: "player2",
  player2name: "player2",
  category: "category",
  categorycode: "category",
  event: "category",
};

const REQUIRED_HEADERS = ["player1", "player2", "category"];

const CATEGORY_NAMES: Record<"MD" | "WD" | "XD", string> = {
  MD: "Men's Doubles",
  WD: "Women's Doubles",
  XD: "Mixed Doubles",
};

function parseFile(file: File) {
  const filename = file.name.toLowerCase();
  return file.arrayBuffer().then((arrayBuffer) => {
    const buffer = Buffer.from(arrayBuffer);
    if (filename.endsWith(".csv")) {
      return parseCsv(buffer);
    }
    if (filename.endsWith(".xlsx")) {
      return parseXlsx(buffer);
    }
    throw new Error("Unsupported file type. Use CSV or XLSX.");
  });
}

function categoryCode(value: string) {
  const code = value.trim().toUpperCase();
  if (code === "MD" || code === "WD" || code === "XD") {
    return code;
  }
  return null;
}

function teamKey(categoryId: string, playerIds: [string, string]) {
  const sorted = [...playerIds].sort();
  return `${categoryId}:${sorted.join(":")}`;
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("file");

  if (!file || !(file instanceof File)) {
    return Response.json({ error: "File is required." }, { status: 400 });
  }

  let sheet;
  try {
    sheet = await parseFile(file);
  } catch (error) {
    return Response.json(
      { error: (error as Error).message },
      { status: 400 }
    );
  }

  const headerMap = mapHeaders(sheet.headers, HEADER_ALIASES);
  const missingHeaders = REQUIRED_HEADERS.filter(
    (header) => !headerMap.has(header)
  );

  if (missingHeaders.length > 0) {
    return Response.json({
      created: 0,
      skipped: 0,
      errors: [
        {
          row: 1,
          message: `Missing required headers: ${missingHeaders.join(", ")}.`,
        },
      ],
    });
  }

  const players = await prisma.player.findMany({
    select: { id: true, name: true, gender: true },
  });
  const playersByName = new Map(
    players.map((player) => [player.name.trim().toLowerCase(), player])
  );

  const categories = await Promise.all(
    (["MD", "WD", "XD"] as const).map((code) =>
      prisma.category.upsert({
        where: { code },
        update: {},
        create: { code, name: CATEGORY_NAMES[code] },
      })
    )
  );
  const categoryIds = new Map(categories.map((category) => [category.code, category.id]));

  const existingTeams = await prisma.team.findMany({
    select: {
      categoryId: true,
      members: { select: { playerId: true } },
    },
  });

  const existingTeamKeys = new Set<string>();
  const playerCategoryMap = new Map<string, Set<string>>();

  existingTeams.forEach((team) => {
    const memberIds = team.members.map((member) => member.playerId);
    if (memberIds.length === 2) {
      existingTeamKeys.add(teamKey(team.categoryId, [memberIds[0], memberIds[1]]));
    }
    memberIds.forEach((playerId) => {
      const categoriesForPlayer = playerCategoryMap.get(playerId) ?? new Set<string>();
      categoriesForPlayer.add(team.categoryId);
      playerCategoryMap.set(playerId, categoriesForPlayer);
    });
  });

  const pendingTeamKeys = new Set<string>();
  const pendingPlayerCategory = new Map<string, Set<string>>();
  const errors: { row: number; message: string }[] = [];
  const teamsToCreate: {
    name: string;
    categoryId: string;
    player1Id: string;
    player2Id: string;
  }[] = [];
  let skipped = 0;

  sheet.rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const isEmpty = row.every((cell) => cell.trim() === "");
    if (isEmpty) {
      return;
    }
    const player1Raw = getMappedValue(row, headerMap, "player1");
    const player2Raw = getMappedValue(row, headerMap, "player2");
    const categoryRaw = getMappedValue(row, headerMap, "category");
    const player1Name = player1Raw.trim();
    const player2Name = player2Raw.trim();
    const category = categoryCode(categoryRaw);

    if (!player1Name || !player2Name) {
      errors.push({
        row: rowNumber,
        message: "Player 1 and Player 2 are required.",
      });
      return;
    }

    if (!category) {
      errors.push({
        row: rowNumber,
        message: "Category must be MD, WD, or XD.",
      });
      return;
    }

    const player1 = playersByName.get(player1Name.toLowerCase());
    const player2 = playersByName.get(player2Name.toLowerCase());

    if (!player1 || !player2) {
      errors.push({
        row: rowNumber,
        message: "Both players must exist.",
      });
      return;
    }

    if (player1.id === player2.id) {
      errors.push({
        row: rowNumber,
        message: "Players must be different.",
      });
      return;
    }

    if (category === "MD") {
      if (player1.gender !== "MALE" || player2.gender !== "MALE") {
        errors.push({
          row: rowNumber,
          message: "Men's Doubles requires two male players.",
        });
        return;
      }
    }

    if (category === "WD") {
      if (player1.gender !== "FEMALE" || player2.gender !== "FEMALE") {
        errors.push({
          row: rowNumber,
          message: "Women's Doubles requires two female players.",
        });
        return;
      }
    }

    if (category === "XD") {
      const genders = [player1.gender, player2.gender];
      if (!(genders.includes("MALE") && genders.includes("FEMALE"))) {
        errors.push({
          row: rowNumber,
          message: "Mixed Doubles requires one male and one female player.",
        });
        return;
      }
    }

    const categoryId = categoryIds.get(category);
    if (!categoryId) {
      errors.push({
        row: rowNumber,
        message: "Category is not available.",
      });
      return;
    }

    const newTeamKey = teamKey(categoryId, [player1.id, player2.id]);
    if (existingTeamKeys.has(newTeamKey) || pendingTeamKeys.has(newTeamKey)) {
      skipped += 1;
      return;
    }

    const hasConflict = (playerId: string) => {
      const existing = playerCategoryMap.get(playerId);
      if (existing?.has(categoryId)) return true;
      const pending = pendingPlayerCategory.get(playerId);
      return pending?.has(categoryId) ?? false;
    };

    if (hasConflict(player1.id) || hasConflict(player2.id)) {
      errors.push({
        row: rowNumber,
        message: "A player is already on another team in this category.",
      });
      return;
    }

    pendingTeamKeys.add(newTeamKey);
    [player1.id, player2.id].forEach((playerId) => {
      const pending = pendingPlayerCategory.get(playerId) ?? new Set<string>();
      pending.add(categoryId);
      pendingPlayerCategory.set(playerId, pending);
    });

    teamsToCreate.push({
      name: `${player1.name} + ${player2.name}`,
      categoryId,
      player1Id: player1.id,
      player2Id: player2.id,
    });
  });

  let created = 0;
  if (teamsToCreate.length > 0) {
    await prisma.$transaction(async (tx) => {
      for (const team of teamsToCreate) {
        const createdTeam = await tx.team.create({
          data: { name: team.name, categoryId: team.categoryId },
        });
        await tx.teamMember.createMany({
          data: [
            { teamId: createdTeam.id, playerId: team.player1Id },
            { teamId: createdTeam.id, playerId: team.player2Id },
          ],
        });
        created += 1;
      }
    });
  }

  return Response.json({
    created,
    skipped,
    errors: errors.slice(0, 20),
  });
}
