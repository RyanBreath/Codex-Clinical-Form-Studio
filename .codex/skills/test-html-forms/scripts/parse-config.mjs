import path from "node:path";
import { parseArgs, readConfig, writeJson } from "./qa-core.mjs";

const args = parseArgs(process.argv.slice(2));
if (!args.output) throw new Error("Missing --output.");

const config = args.input ? await readConfig(path.resolve(args.input)) : {};
await writeJson(path.resolve(args.output), config);
console.log(JSON.stringify(config));
