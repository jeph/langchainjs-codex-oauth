import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

import { defaultHomeDir } from "../auth/store.js"
import { getEnvironmentVariable } from "../utils/env.js"
import type { InstructionsMode } from "./types.js"
import { asString, isRecord } from "../utils/json.js"
import { normalizeModel } from "../converters/messages.js"

const GITHUB_API_RELEASES =
  "https://api.github.com/repos/openai/codex/releases/latest"
const GITHUB_HTML_RELEASES = "https://github.com/openai/codex/releases/latest"
const INSTRUCTIONS_MODE_ENV = "LANGCHAINJS_CODEX_OAUTH_INSTRUCTIONS_MODE"

const BUNDLED_CODEX_INSTRUCTIONS = `You are Codex, based on GPT-5. You are running as a coding agent in the Codex CLI on a user's computer.

## General

- When searching for text or files, prefer using \`rg\` or \`rg --files\` respectively because \`rg\` is much faster than alternatives like \`grep\`. (If the \`rg\` command is not found, then use alternatives.)

## Editing constraints

- Default to ASCII when editing or creating files. Only introduce non-ASCII or other Unicode characters when there is a clear justification and the file already uses them.
- Add succinct code comments that explain what is going on if code is not self-explanatory. You should not add comments like "Assigns the value to the variable", but a brief comment might be useful ahead of a complex code block that the user would otherwise have to spend time parsing out. Usage of these comments should be rare.
- Try to use apply_patch for single file edits, but it is fine to explore other options to make the edit if it does not work well. Do not use apply_patch for changes that are auto-generated (i.e. generating package.json or running a lint or format command like gofmt) or when scripting is more efficient (such as search and replacing a string across a codebase).
- You may be in a dirty git worktree.
    * NEVER revert existing changes you did not make unless explicitly requested, since these changes were made by the user.
    * If asked to make a commit or code edits and there are unrelated changes to your work or changes that you didn't make in those files, don't revert those changes.
    * If the changes are in files you've touched recently, you should read carefully and understand how you can work with the changes rather than reverting them.
    * If the changes are in unrelated files, just ignore them and don't revert them.
- Do not amend a commit unless explicitly requested to do so.
- While you are working, you might notice unexpected changes that you didn't make. If this happens, STOP IMMEDIATELY and ask the user how they would like to proceed.
- **NEVER** use destructive commands like \`git reset --hard\` or \`git checkout --\` unless specifically requested or approved by the user.

## Plan tool

When using the planning tool:
- Skip using the planning tool for straightforward tasks (roughly the easiest 25%).
- Do not make single-step plans.
- When you made a plan, update it after having performed one of the sub-tasks that you shared on the plan.

## Special user requests

- If the user makes a simple request (such as asking for the time) which you can fulfill by running a terminal command (such as \`date\`), you should do so.
- If the user asks for a "review", default to a code review mindset: prioritise identifying bugs, risks, behavioural regressions, and missing tests. Findings must be the primary focus of the response - keep summaries or overviews brief and only after enumerating the issues. Present findings first (ordered by severity with file/line references), follow with open questions or assumptions, and offer a change-summary only as a secondary detail. If no findings are discovered, state that explicitly and mention any residual risks or testing gaps.

## Presenting your work and final message

You are producing plain text that will later be styled by the CLI. Follow these rules exactly. Formatting should make results easy to scan, but not feel mechanical. Use judgment to decide how much structure adds value.

- Default: be very concise; friendly coding teammate tone.
- Ask only when needed; suggest ideas; mirror the user's style.
- For substantial work, summarize clearly; follow final-answer formatting.
- Skip heavy formatting for simple confirmations.
- Don't dump large files you've written; reference paths only.
- No "save/copy this file" - User is on the same machine.
- Offer logical next steps (tests, commits, build) briefly; add verify steps if you couldn't do something.
- For code changes:
  * Lead with a quick explanation of the change, and then give more details on the context covering where and why a change was made. Do not start this explanation with "summary", just jump right in.
  * If there are natural next steps the user may want to take, suggest them at the end of your response. Do not make suggestions if there are no natural next steps.
  * When suggesting multiple options, use numeric lists for the suggestions so the user can quickly respond with a single number.
- The user does not command execution outputs. When asked to show the output of a command (e.g. \`git show\`), relay the important details in your answer or summarize the key lines so the user understands the result.
`

interface PromptFamily {
  family: string
  promptFile: string
  cacheFile: string
}

const FAMILIES: PromptFamily[] = [
  {
    family: "gpt-5.2-codex",
    promptFile: "gpt-5.2-codex_prompt.md",
    cacheFile: "gpt-5.2-codex-instructions.md",
  },
  {
    family: "codex-max",
    promptFile: "gpt-5.1-codex-max_prompt.md",
    cacheFile: "codex-max-instructions.md",
  },
  {
    family: "codex",
    promptFile: "gpt_5_codex_prompt.md",
    cacheFile: "codex-instructions.md",
  },
  {
    family: "gpt-5.2",
    promptFile: "gpt_5_2_prompt.md",
    cacheFile: "gpt-5.2-instructions.md",
  },
  {
    family: "gpt-5.1",
    promptFile: "gpt_5_1_prompt.md",
    cacheFile: "gpt-5.1-instructions.md",
  },
]

function cacheDir(): string {
  return path.join(defaultHomeDir(), "cache")
}

function instructionsMode(): InstructionsMode {
  const raw = getEnvironmentVariable(INSTRUCTIONS_MODE_ENV)
    ?.trim()
    .toLowerCase()

  if (
    raw === "auto" ||
    raw === "cache" ||
    raw === "github" ||
    raw === "bundled"
  ) {
    return raw
  }

  return "auto"
}

function promptFamily(model: string): PromptFamily {
  const id = normalizeModel(model).toLowerCase()

  if (id.includes("gpt-5.2-codex") || id.includes("gpt 5.2 codex")) {
    return FAMILIES[0]!
  }

  if (id.includes("codex-max")) {
    return FAMILIES[1]!
  }

  if (id.includes("codex") || id.startsWith("codex-")) {
    return FAMILIES[2]!
  }

  if (id.includes("gpt-5.2")) {
    return FAMILIES[3]!
  }

  return FAMILIES[4]!
}

async function latestReleaseTag(fetchFn: typeof fetch): Promise<string> {
  try {
    const api = await fetchFn(GITHUB_API_RELEASES, {
      signal: AbortSignal.timeout(15_000),
    })

    if (api.ok) {
      const body: unknown = await api.json()

      if (isRecord(body)) {
        const tag = asString(body.tag_name)

        if (tag) {
          return tag
        }
      }
    }
  } catch {
    // Fall through.
  }

  const html = await fetchFn(GITHUB_HTML_RELEASES, {
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  })

  if (!html.ok) {
    throw new Error(
      `Failed to determine latest Codex release tag (HTTP ${html.status}).`,
    )
  }

  if (html.url.includes("/tag/")) {
    const tag = html.url.split("/tag/").at(-1)

    if (tag && !tag.includes("/")) {
      return tag
    }
  }

  const text = await html.text()
  const match = text.match(/\/openai\/codex\/releases\/tag\/([^"/]+)/u)

  if (match?.[1]) {
    return match[1]
  }

  throw new Error("Failed to determine latest Codex release tag.")
}

async function writeCache(input: {
  cachePath: string
  metaPath: string
  tag: string
  url: string
  etag: string | undefined
  text: string
}): Promise<void> {
  await mkdir(path.dirname(input.cachePath), { recursive: true })
  await writeFile(input.cachePath, input.text, "utf8")
  await writeFile(
    input.metaPath,
    `${JSON.stringify(
      {
        etag: input.etag,
        tag: input.tag,
        last_checked_ms: Date.now(),
        url: input.url,
      },
      null,
      2,
    )}\n`,
    "utf8",
  )
}

export async function getCodexInstructions(
  model: string,
  fetchFn: typeof fetch = fetch,
): Promise<string> {
  const mode = instructionsMode()
  const family = promptFamily(model)
  const dir = cacheDir()
  const cachePath = path.join(dir, family.cacheFile)
  const metaPath = path.join(
    dir,
    family.cacheFile.replace(/\.md$/u, "-meta.json"),
  )

  if (mode === "auto" || mode === "cache") {
    try {
      return await readFile(cachePath, "utf8")
    } catch {
      if (mode === "cache") {
        throw new Error(
          `Instructions cache is missing (${cachePath}). Set ${INSTRUCTIONS_MODE_ENV}=github or bundled.`,
        )
      }
    }
  }

  if (mode === "bundled") {
    return BUNDLED_CODEX_INSTRUCTIONS
  }

  try {
    const tag = await latestReleaseTag(fetchFn)
    const url = `https://raw.githubusercontent.com/openai/codex/${tag}/codex-rs/core/${family.promptFile}`
    const response = await fetchFn(url, {
      signal: AbortSignal.timeout(30_000),
    })

    if (!response.ok) {
      throw new Error(`Failed to fetch instructions (HTTP ${response.status}).`)
    }

    const text = await response.text()
    await writeCache({
      cachePath,
      metaPath,
      tag,
      url,
      etag: response.headers.get("etag") ?? undefined,
      text,
    })
    return text
  } catch {
    if (mode === "github") {
      throw new Error("Failed to fetch Codex instructions from GitHub.")
    }

    return BUNDLED_CODEX_INSTRUCTIONS
  }
}

export { BUNDLED_CODEX_INSTRUCTIONS, INSTRUCTIONS_MODE_ENV }
