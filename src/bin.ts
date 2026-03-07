import { main as runCli } from "./cli.js"

export async function main(
  argv: string[] = process.argv.slice(2),
): Promise<void> {
  process.exitCode = await runCli(argv)
}
