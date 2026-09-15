import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

function parseArguments(argv) {
  const options = { positional: [] };
  for (const argument of argv) {
    if (!argument.startsWith("--")) {
      options.positional.push(argument);
      continue;
    }
    const [key, ...rest] = argument.slice(2).split("=");
    options[key] = rest.join("=");
  }
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const characterClass = String(options.class ?? "").trim();
  const outputPath = resolve(String(options.output ?? ""));
  if (!characterClass || !options.output || !options.positional.length) {
    throw new Error("--class, --output과 점유율 JSON 경로가 필요합니다.");
  }
  const records = [];
  for (const inputPath of options.positional) {
    const payload = JSON.parse(await readFile(resolve(inputPath), "utf8"));
    const profile = payload?.latestNormalProfile;
    if (!Array.isArray(profile?.skillShares) || !profile.skillShares.length) {
      continue;
    }
    records.push({
      characterClass,
      characterName: String(payload?.characterName ?? "").trim(),
      result: {
        register_date: profile.register_date ?? null,
        total_play_time: profile.total_play_time,
        end_type: profile.end_type,
        skillShares: profile.skillShares.map(({ source, weight }) => ({
          source: String(source ?? "").trim(),
          weight: Number(weight),
        })),
      },
    });
  }
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    records.map((record) => JSON.stringify(record)).join("\n") + "\n",
    { encoding: "utf8", flag: "wx" },
  );
  process.stdout.write(`정규화 점유율 ${records.length}건: ${outputPath}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
