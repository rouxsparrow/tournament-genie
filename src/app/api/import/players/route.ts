import { prisma } from "@/lib/prisma";
import {
  getMappedValue,
  mapHeaders,
  parseCsv,
  parseXlsx,
} from "@/lib/import-utils";

export const runtime = "nodejs";

const HEADER_ALIASES: Record<string, string> = {
  playername: "name",
  name: "name",
  player: "name",
  gender: "gender",
  sex: "gender",
};

const REQUIRED_HEADERS = ["name", "gender"];

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

  const existingPlayers = await prisma.player.findMany({
    select: { name: true },
  });
  const existingNames = new Set(
    existingPlayers.map((player) => player.name.trim().toLowerCase())
  );

  const plannedNames = new Set<string>();
  const toCreate: { name: string; gender: "MALE" | "FEMALE" }[] = [];
  const errors: { row: number; message: string }[] = [];
  let skipped = 0;

  sheet.rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const isEmpty = row.every((cell) => cell.trim() === "");
    if (isEmpty) {
      return;
    }
    const nameRaw = getMappedValue(row, headerMap, "name");
    const genderRaw = getMappedValue(row, headerMap, "gender");
    const name = nameRaw.trim();
    const gender = genderRaw.trim().toUpperCase();

    if (!name) {
      errors.push({ row: rowNumber, message: "Player name is required." });
      return;
    }

    if (!gender) {
      errors.push({ row: rowNumber, message: "Gender is required." });
      return;
    }

    if (gender !== "MALE" && gender !== "FEMALE") {
      errors.push({
        row: rowNumber,
        message: "Gender must be MALE or FEMALE.",
      });
      return;
    }

    const nameKey = name.toLowerCase();
    if (existingNames.has(nameKey) || plannedNames.has(nameKey)) {
      skipped += 1;
      return;
    }

    plannedNames.add(nameKey);
    toCreate.push({ name, gender: gender as "MALE" | "FEMALE" });
  });

  const created =
    toCreate.length > 0
      ? (await prisma.player.createMany({ data: toCreate })).count
      : 0;

  return Response.json({
    created,
    skipped,
    errors: errors.slice(0, 20),
  });
}
