import { existsSync } from "node:fs"

import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from "@langchain/core/messages"
import {
  END,
  MessagesAnnotation,
  START,
  StateGraph,
} from "@langchain/langgraph"
import { ToolNode } from "@langchain/langgraph/prebuilt"
import { createAgent, tool } from "langchain"
import { describe, expect, test } from "vitest"
import { z } from "zod"

import { defaultAuthPath } from "../../src/auth/store.js"
import { ChatCodexOAuth } from "../../src/chat_models/index.js"

const hasAuth = existsSync(defaultAuthPath())
const modelName = process.env.LANGCHAINJS_CODEX_OAUTH_MODEL ?? "gpt-5.2-codex"
const inventoryKeys = ["alpha", "beta", "gamma"] as const
const inventoryValues = {
  alpha: 11,
  beta: 17,
  gamma: 14,
}

function textOf(content: unknown): string {
  return typeof content === "string" ? content : JSON.stringify(content)
}

function createModel(
  overrides: ConstructorParameters<typeof ChatCodexOAuth>[0] = {},
): ChatCodexOAuth {
  return new ChatCodexOAuth({
    model: modelName,
    maxTokens: 320,
    ...overrides,
  })
}

function createAddTool(log: string[] = []) {
  return tool(
    async ({ a, b }) => {
      log.push(`add:${a}+${b}`)
      return `${a + b}`
    },
    {
      name: "add_numbers",
      description: "Add two integers and return the total.",
      schema: z.object({
        a: z.number().int(),
        b: z.number().int(),
      }),
    },
  )
}

function createLookupInventoryTool(log: string[] = []) {
  return tool(
    async ({ key }) => {
      log.push(`lookup:${key}`)
      return `${inventoryValues[key]}`
    },
    {
      name: "lookup_inventory",
      description: "Look up the integer inventory value for a known key.",
      schema: z.object({
        key: z.enum(inventoryKeys),
      }),
    },
  )
}

type ExtendedTool =
  | ReturnType<typeof createAddTool>
  | ReturnType<typeof createLookupInventoryTool>

type ToolRunner = {
  name: string
  invoke(input: unknown): Promise<unknown>
}

function buildLongMarkerPrompt(marker: string, sectionCount = 16): string {
  const sections = Array.from({ length: sectionCount }, (_, index) => {
    const sectionId = index + 1
    const priority = sectionId % 3 === 0 ? "urgent" : "routine"

    return [
      `Section ${sectionId}`,
      `The operations desk reviewed shipment cluster ${sectionId} with ${priority} follow-up requirements.`,
      `Analysts compared incident counts, routing changes, hold notes, and reconciliation summaries for warehouse lane ${sectionId}.`,
      `Use this section only as background context while reading the full brief.`,
    ].join("\n")
  })

  return [
    "Read the entire brief before answering.",
    ...sections,
    `Final instruction: respond with exactly ${marker} and nothing else.`,
  ].join("\n\n")
}

function buildLongSummaryPrompt(anchorA: string, anchorB: string): string {
  const sections = Array.from({ length: 22 }, (_, index) => {
    const sectionId = index + 1
    const anchor =
      sectionId === 3 ? anchorA : sectionId === 20 ? anchorB : undefined

    return [
      `Dossier section ${sectionId}`,
      `The review team recorded dispatch delays, queue depth, staffing adjustments, and quality-control notes for cycle ${sectionId}.`,
      `Escalation detail ${sectionId}: reconcile inventory snapshots, vendor messages, and exception counts before the next handoff.`,
      anchor ? `Important anchor for the final summary: ${anchor}.` : undefined,
    ]
      .filter((line): line is string => typeof line === "string")
      .join("\n")
  })

  return [
    "Summarize the dossier in at least five sentences.",
    `Your final line must be exactly ANCHORS=${anchorA}|${anchorB}.`,
    ...sections,
  ].join("\n\n")
}

function buildLargeAuditDocument() {
  const records = [
    {
      id: "REC-101",
      owner: "Avery Stone",
      email: "avery.stone@example.com",
      action: "IGNORE",
      marker: "SKIP-REC-101",
    },
    {
      id: "REC-102",
      owner: "Blair Moss",
      email: "blair.moss@example.com",
      action: "FOLLOW_UP",
      marker: "FOLLOW-UP-REC-102",
    },
    {
      id: "REC-103",
      owner: "Casey Vale",
      email: "casey.vale@example.com",
      action: "IGNORE",
      marker: "SKIP-REC-103",
    },
    {
      id: "REC-104",
      owner: "Devon Hart",
      email: "devon.hart@example.com",
      action: "IGNORE",
      marker: "SKIP-REC-104",
    },
    {
      id: "REC-105",
      owner: "Elliot Finch",
      email: "elliot.finch@example.com",
      action: "FOLLOW_UP",
      marker: "FOLLOW-UP-REC-105",
    },
    {
      id: "REC-106",
      owner: "Harper Lane",
      email: "harper.lane@example.com",
      action: "IGNORE",
      marker: "SKIP-REC-106",
    },
    {
      id: "REC-107",
      owner: "Indigo Park",
      email: "indigo.park@example.com",
      action: "FOLLOW_UP",
      marker: "FOLLOW-UP-REC-107",
    },
    {
      id: "REC-108",
      owner: "Jules North",
      email: "jules.north@example.com",
      action: "IGNORE",
      marker: "SKIP-REC-108",
    },
    {
      id: "REC-109",
      owner: "Kai Rivers",
      email: "kai.rivers@example.com",
      action: "IGNORE",
      marker: "SKIP-REC-109",
    },
    {
      id: "REC-110",
      owner: "Logan Reed",
      email: "logan.reed@example.com",
      action: "FOLLOW_UP",
      marker: "FOLLOW-UP-REC-110",
    },
    {
      id: "REC-111",
      owner: "Morgan Skye",
      email: "morgan.skye@example.com",
      action: "IGNORE",
      marker: "SKIP-REC-111",
    },
    {
      id: "REC-112",
      owner: "Nico Frost",
      email: "nico.frost@example.com",
      action: "FOLLOW_UP",
      marker: "FOLLOW-UP-REC-112",
    },
  ] as const
  const selected = records.filter((record) => record.action === "FOLLOW_UP")
  const document = [
    "Audit protocol: extract only records explicitly marked ACTION=FOLLOW_UP.",
    "Ignore every other record, even if its notes sound important.",
    ...records.map((record, index) =>
      [
        `Record ${index + 1}`,
        `ID: ${record.id}`,
        `Owner: ${record.owner}`,
        `Email: ${record.email}`,
        `Region: zone-${(index % 4) + 1}`,
        `ACTION: ${record.action}`,
        `Evidence marker: ${record.marker}`,
        `Notes: This record contains reconciliation notes, shipment variance comments, and partner follow-up context for audit lane ${index + 1}.`,
      ].join("\n"),
    ),
    "Produce structured output only from the records marked for follow up.",
  ].join("\n\n")

  return {
    document,
    selectedIds: selected.map((record) => record.id),
    selectedEmails: selected.map((record) => record.email),
  }
}

function expectUsage(message: AIMessage) {
  expect(message.usage_metadata?.total_tokens).toBeGreaterThan(0)
}

async function runManualToolLoop({
  model,
  tools,
  systemPrompt,
  userPrompt,
  maxTurns = 8,
}: {
  model: ChatCodexOAuth
  tools: ExtendedTool[]
  systemPrompt: string
  userPrompt: string
  maxTurns?: number
}): Promise<{ final: AIMessage; history: BaseMessage[] }> {
  const boundModel = model.bindTools(tools)
  const toolMap = new Map<string, ToolRunner>(
    tools.map((currentTool) => [currentTool.name, currentTool as ToolRunner]),
  )
  const history: BaseMessage[] = [
    new SystemMessage(systemPrompt),
    new HumanMessage(userPrompt),
  ]

  for (let turn = 0; turn < maxTurns; turn += 1) {
    const response = await boundModel.invoke(history)

    history.push(response)

    if ((response.tool_calls?.length ?? 0) === 0) {
      return { final: response, history }
    }

    for (const call of response.tool_calls ?? []) {
      const currentTool = toolMap.get(call.name)

      if (!currentTool) {
        throw new Error(`Missing tool for call ${call.name}`)
      }

      const output = await currentTool.invoke(call)
      history.push(
        new ToolMessage({
          content: typeof output === "string" ? output : JSON.stringify(output),
          tool_call_id: call.id!,
        }),
      )
    }
  }

  throw new Error(`Tool loop exceeded ${maxTurns} turns`)
}

describe.skipIf(!hasAuth)("ChatCodexOAuth extended live integration", () => {
  test("streams a long summary from a large dossier", async () => {
    const anchorA = "ANCHOR_ALPHA_203"
    const anchorB = "ANCHOR_OMEGA_917"
    const model = createModel({ maxTokens: 500 })
    const parts: string[] = []

    for await (const chunk of await model.stream([
      new SystemMessage("You are a careful operations summarizer."),
      new HumanMessage(buildLongSummaryPrompt(anchorA, anchorB)),
    ])) {
      if (typeof chunk.content === "string" && chunk.content.length > 0) {
        parts.push(chunk.content)
      }
    }

    const output = parts.join("")

    expect(output.length).toBeGreaterThan(220)
    expect(output).toContain(`ANCHORS=${anchorA}|${anchorB}`)
  })

  test("reuses one model across many sequential long invokes", async () => {
    const model = createModel({ maxTokens: 90 })
    const markers = ["FOCUS-271A", "FOCUS-982B", "FOCUS-554C", "FOCUS-118D"]
    const seenMarkers: string[] = []

    for (const marker of markers) {
      const result = await model.invoke([
        new SystemMessage(
          "Read the full brief and then return only the final focus marker.",
        ),
        new HumanMessage(buildLongMarkerPrompt(marker, 18)),
      ])
      const output = textOf(result.content)

      expect(output).toContain(marker)
      for (const previousMarker of seenMarkers) {
        expect(output).not.toContain(previousMarker)
      }
      expectUsage(result)
      seenMarkers.push(marker)
    }
  })

  test("handles a larger mixed batch without cross-prompt bleed", async () => {
    const model = createModel({ maxTokens: 120 })
    const markers = [
      "BATCH-301A",
      "BATCH-301B",
      "BATCH-301C",
      "BATCH-301D",
      "BATCH-301E",
    ]
    const results = await model.batch(
      markers.map((marker, index) => [
        new HumanMessage(buildLongMarkerPrompt(marker, 14 + index)),
      ]),
    )

    expect(results).toHaveLength(markers.length)

    for (const [index, result] of results.entries()) {
      const marker = markers[index]!
      const output = textOf(result.content)

      expect(output).toContain(marker)
      for (const otherMarker of markers) {
        if (otherMarker !== marker) {
          expect(output).not.toContain(otherMarker)
        }
      }
      expectUsage(result)
    }
  })

  test("supports a multi-step manual tool loop across repeated invocations", async () => {
    const lookupLog: string[] = []
    const addLog: string[] = []
    const lookupInventory = createLookupInventoryTool(lookupLog)
    const addNumbers = createAddTool(addLog)
    const { final, history } = await runManualToolLoop({
      model: createModel({ maxTokens: 220 }),
      tools: [lookupInventory, addNumbers],
      systemPrompt:
        "Never guess inventory values. Use lookup_inventory to fetch alpha, beta, and gamma. Use add_numbers for every addition step until you have the final total.",
      userPrompt:
        "Fetch alpha, beta, and gamma, then compute their total. Return the final answer in the format TOTAL=<number>.",
    })
    const toolCalls = history.flatMap((message) =>
      AIMessage.isInstance(message) ? (message.tool_calls ?? []) : [],
    )
    const toolIds = toolCalls.map((call) => call.id)

    expect(lookupLog.length).toBeGreaterThanOrEqual(3)
    expect(addLog.length).toBeGreaterThanOrEqual(2)
    expect(toolIds).toHaveLength(new Set(toolIds).size)
    expect(
      history.filter((message) => ToolMessage.isInstance(message)).length,
    ).toBeGreaterThanOrEqual(5)
    expect(textOf(final.content)).toContain("42")
  })

  test("parses a large nested structured output payload", async () => {
    const { document, selectedEmails, selectedIds } = buildLargeAuditDocument()
    const AuditSchema = z.object({
      summary: z.string(),
      totalSelected: z.number().int(),
      selectedRecords: z.array(
        z.object({
          recordId: z.string(),
          owner: z.string(),
          email: z.string().email(),
          evidence: z.object({
            marker: z.string(),
            action: z.string(),
          }),
        }),
      ),
    })
    const model = createModel({ maxTokens: 700 }).withStructuredOutput(
      AuditSchema,
      { includeRaw: true },
    )
    const result = await model.invoke([
      new SystemMessage(
        "Extract only the records marked ACTION=FOLLOW_UP and preserve their explicit marker/action strings.",
      ),
      new HumanMessage(document),
    ])
    const parsedIds = result.parsed.selectedRecords
      .map((record) => record.recordId)
      .sort()
    const parsedEmails = result.parsed.selectedRecords
      .map((record) => record.email)
      .sort()

    expect(AIMessage.isInstance(result.raw)).toBe(true)
    expect(
      AIMessage.isInstance(result.raw)
        ? result.raw.tool_calls?.[0]?.name
        : null,
    ).toBe("extract")
    expect(result.parsed.totalSelected).toBe(selectedIds.length)
    expect(parsedIds).toEqual([...selectedIds].sort())
    expect(parsedEmails).toEqual([...selectedEmails].sort())
    expect(
      result.parsed.selectedRecords.every(
        (record) => record.evidence.action === "FOLLOW_UP",
      ),
    ).toBe(true)
    expect(
      result.parsed.selectedRecords.every((record) =>
        record.evidence.marker.startsWith("FOLLOW-UP-"),
      ),
    ).toBe(true)
  })

  test("runs a two-tool LangChain agent across multiple steps", async () => {
    const lookupLog: string[] = []
    const addLog: string[] = []
    const lookupInventory = createLookupInventoryTool(lookupLog)
    const addNumbers = createAddTool(addLog)
    const agent = createAgent({
      model: createModel({ maxTokens: 260 }),
      tools: [lookupInventory, addNumbers],
      systemPrompt:
        "Never invent values. Use lookup_inventory for alpha, beta, and gamma, then use add_numbers for every addition step. Return the final answer as TOTAL=<number>.",
    })
    const result = await agent.invoke({
      messages:
        "Retrieve alpha, beta, and gamma from the inventory tools, add them step by step, and return only TOTAL=<number>.",
    })
    const last = result.messages.at(-1)

    expect(lookupLog.length).toBeGreaterThanOrEqual(3)
    expect(addLog.length).toBeGreaterThanOrEqual(2)
    expect(result.messages.length).toBeGreaterThanOrEqual(8)
    expect(textOf(last?.content)).toContain("42")
  })

  test("runs a raw LangGraph loop with repeated tool use and a final synthesis node", async () => {
    const lookupLog: string[] = []
    const addLog: string[] = []
    const lookupInventory = createLookupInventoryTool(lookupLog)
    const addNumbers = createAddTool(addLog)
    const planner = createModel({ maxTokens: 220 }).bindTools([
      lookupInventory,
      addNumbers,
    ])
    const synthesizer = createModel({ maxTokens: 120 })
    const graph = new StateGraph(MessagesAnnotation)
      .addNode("planner", async (state) => ({
        messages: [
          await planner.invoke([
            new SystemMessage(
              "Use lookup_inventory for alpha, beta, and gamma. Use add_numbers for every addition step until the total is known.",
            ),
            ...state.messages,
          ]),
        ],
      }))
      .addNode("tools", new ToolNode([lookupInventory, addNumbers]))
      .addNode("synthesizer", async (state) => ({
        messages: [
          await synthesizer.invoke([
            new SystemMessage(
              "Rewrite the latest numerical answer as GRAPH_TOTAL=<number> and keep it to one line.",
            ),
            ...state.messages,
          ]),
        ],
      }))
      .addEdge(START, "planner")
      .addConditionalEdges("planner", (state) => {
        const last = state.messages.at(-1)

        if (AIMessage.isInstance(last) && (last.tool_calls?.length ?? 0) > 0) {
          return "tools"
        }

        return "synthesizer"
      })
      .addEdge("tools", "planner")
      .addEdge("synthesizer", END)
      .compile()
    const result = await graph.invoke({
      messages: [
        new HumanMessage(
          "Get alpha, beta, and gamma from inventory, add them step by step, and finish with the synthesized graph total.",
        ),
      ],
    })
    const last = result.messages.at(-1)

    expect(lookupLog.length).toBeGreaterThanOrEqual(3)
    expect(addLog.length).toBeGreaterThanOrEqual(2)
    expect(
      result.messages.filter((message: BaseMessage) =>
        ToolMessage.isInstance(message),
      ).length,
    ).toBeGreaterThanOrEqual(5)
    expect(result.messages.length).toBeGreaterThanOrEqual(9)
    expect(textOf(last?.content)).toContain("GRAPH_TOTAL=42")
  })
})
