import type { Disposable, JsonValue, OrcaWorkerApi } from 'orca/worker'
import type {
  KerjanClientConfigSummary,
  KerjanComment,
  KerjanDashboardData,
  KerjanEpicItem,
  KerjanMemberItem,
  KerjanProductItem,
  KerjanSprintItem,
  KerjanStoryItem,
  KerjanStorySummary,
  KerjanTicket,
  KerjanTicketDetail,
  OrcaProjectItem
} from './protocol'
import './protocol'

const DEFAULT_API_URL = ''
const DEFAULT_API_TOKEN = ''
const PREFERRED_PRODUCT_ID = 24
const CACHE_KEY = 'cachedDashboard'
const CONFIG_STORAGE_KEY = 'kerjanConfig'
const SECRET_TOKEN_KEY = 'apiToken'
const POLL_INTERVAL_MS = 5 * 60 * 1000
const BACKLOG_LIMIT = 80

type KerjanConfig = {
  apiUrl: string
  apiToken: string
}

let startupTimer: ReturnType<typeof setTimeout> | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null
let activeAbort: AbortController | null = null
let cachedMemberMap: Map<number, string> | null = null
let cachedMemberMapAt = 0
let cachedWorkspaceCode = ''
let cachedAssigneeId = 0
let suppressSettingsReload = false
const disposables: Disposable[] = []

function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message
  return String(err)
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
}

function maskToken(token: string): string {
  if (!token) return ''
  if (token.length <= 12) return '••••••••'
  return `${token.slice(0, 8)}••••${token.slice(-4)}`
}

async function readConfig(orca: OrcaWorkerApi): Promise<KerjanConfig> {
  let rawSettings: Record<string, JsonValue> = {}
  let secretToken: string | null = null
  let rawStored: Record<string, JsonValue> = {}

  try {
    const res = await orca.settings.get()
    rawSettings = res ?? {}
  } catch {
    rawSettings = {}
  }

  try {
    if (orca.secrets) {
      secretToken = await orca.secrets.get(SECRET_TOKEN_KEY)
    }
  } catch {
    secretToken = null
  }

  try {
    const stored = await orca.storage.get(CONFIG_STORAGE_KEY)
    if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
      rawStored = stored as Record<string, JsonValue>
    }
  } catch {
    rawStored = {}
  }

  const storedUrl =
    typeof rawStored.apiUrl === 'string' && rawStored.apiUrl.trim() ? rawStored.apiUrl.trim() : ''
  const settingUrl =
    typeof rawSettings.apiUrl === 'string' && rawSettings.apiUrl.trim()
      ? rawSettings.apiUrl.trim()
      : ''
  const apiUrl = storedUrl || settingUrl || DEFAULT_API_URL

  const trimmedSecret = typeof secretToken === 'string' ? secretToken.trim() : ''
  const settingToken =
    typeof rawSettings.apiToken === 'string' && rawSettings.apiToken.trim()
      ? rawSettings.apiToken.trim()
      : ''
  const storedToken =
    typeof rawStored.apiToken === 'string' && rawStored.apiToken.trim()
      ? rawStored.apiToken.trim()
      : ''
  const apiToken = trimmedSecret || settingToken || storedToken || DEFAULT_API_TOKEN

  return { apiUrl, apiToken }
}

function parseRpcPayload(rawBody: string): Record<string, unknown> {
  const trimmed = rawBody.trim()
  if (!trimmed) {
    throw new Error('Empty response from Kerjan MCP server')
  }
  if (trimmed.startsWith('event:') || trimmed.startsWith('data:')) {
    const dataLines = trimmed
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .filter(Boolean)
    const lastPayload = dataLines[dataLines.length - 1]
    if (!lastPayload) {
      throw new Error('Malformed SSE response from Kerjan MCP server')
    }
    return JSON.parse(lastPayload) as Record<string, unknown>
  }
  return JSON.parse(trimmed) as Record<string, unknown>
}

async function callKerjanTool<T = unknown>(
  config: KerjanConfig,
  toolName: string,
  args: Record<string, unknown>,
  signal?: AbortSignal
): Promise<T> {
  const response = await fetch(config.apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream'
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: { name: toolName, arguments: args }
    }),
    signal
  })

  const rawText = await response.text()
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${rawText.slice(0, 200) || response.statusText}`)
  }

  const rpc = parseRpcPayload(rawText)
  if (rpc.error && typeof rpc.error === 'object') {
    const errObj = rpc.error as { message?: string }
    throw new Error(errObj.message || JSON.stringify(rpc.error))
  }

  const result = (rpc.result ?? {}) as {
    isError?: boolean
    content?: { type?: string; text?: string }[]
  }
  const contentText = result.content?.[0]?.text ?? ''

  if (result.isError) {
    throw new Error(contentText || `Kerjan tool ${toolName} failed`)
  }

  if (!contentText) {
    return result as unknown as T
  }

  try {
    return JSON.parse(contentText) as T
  } catch {
    return contentText as unknown as T
  }
}

async function listGitProjects(orca: OrcaWorkerApi): Promise<OrcaProjectItem[]> {
  if (!orca.host.has('project.list')) return []
  try {
    const res = await orca.host.call('project.list')
    return res.projects
      .filter((p) => p.kind === 'git' && !p.hidden)
      .map((p) => ({
        id: p.id,
        name: p.name,
        hostId: p.hostId,
        path: p.path
      }))
  } catch {
    return []
  }
}

function statusSortOrder(status: string): number {
  if (status === 'in_progress') return 0
  if (status === 'todo') return 1
  if (status === 'done') return 3
  return 2
}

function sprintStateOrder(state: string): number {
  if (state === 'active') return 0
  if (state === 'planned') return 1
  if (state === 'closed') return 2
  return 3
}

function normalizeSprints(raw: unknown): KerjanSprintItem[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { sprints?: unknown }).sprints)
      ? (raw as { sprints: unknown[] }).sprints
      : []

  return (list as KerjanSprintItem[])
    .filter((s) => s && typeof s.id === 'number' && typeof s.name === 'string')
    .map((s) => ({
      id: s.id,
      name: s.name,
      state: typeof s.state === 'string' ? s.state : 'unknown',
      ...(s.category ? { category: s.category } : {}),
      ...(s.goal ? { goal: s.goal } : {}),
      start_date: s.start_date ?? null,
      end_date: s.end_date ?? null,
      report: s.report ?? null
    }))
    .sort((a, b) => {
      const stateDiff = sprintStateOrder(a.state) - sprintStateOrder(b.state)
      if (stateDiff !== 0) return stateDiff
      return b.id - a.id
    })
}

function normalizeProducts(raw: unknown): KerjanProductItem[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { products?: unknown }).products)
      ? (raw as { products: unknown[] }).products
      : []

  return (list as KerjanProductItem[])
    .filter((p) => p && typeof p.id === 'number' && typeof p.name === 'string')
    .map((p) => ({ id: p.id, name: p.name }))
}

function normalizeEpics(raw: unknown): KerjanEpicItem[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { tickets?: unknown }).tickets)
      ? (raw as { tickets: unknown[] }).tickets
      : []

  return (list as Array<KerjanTicket & { product_id?: number }>)
    .filter(
      (e) =>
        e &&
        typeof e.id === 'number' &&
        typeof e.title === 'string' &&
        !e.canceled_at &&
        e.status !== 'canceled'
    )
    .map((e) => ({
      id: e.id,
      key: e.key,
      title: e.title,
      product_id: e.product_id ?? null
    }))
    .sort((a, b) => a.title.localeCompare(b.title))
}

function normalizeMembers(raw: unknown): KerjanMemberItem[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { members?: unknown }).members)
      ? (raw as { members: unknown[] }).members
      : []

  return (list as KerjanMemberItem[])
    .filter((m) => m && typeof m.id === 'number' && typeof m.name === 'string')
    .map((m) => ({ id: m.id, name: m.name }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

function withAssigneeName<T extends KerjanTicket>(ticket: T, memberMap: Map<number, string>): T {
  if (ticket.assignee_name || typeof ticket.assignee_id !== 'number') return ticket
  const name = memberMap.get(ticket.assignee_id)
  return name ? { ...ticket, assignee_name: name } : ticket
}

async function getMemberMap(
  config: KerjanConfig,
  signal?: AbortSignal
): Promise<Map<number, string>> {
  const now = Date.now()
  if (cachedMemberMap && now - cachedMemberMapAt < POLL_INTERVAL_MS) {
    return cachedMemberMap
  }
  try {
    const raw = await callKerjanTool<unknown>(config, 'list_members', {}, signal)
    const list = Array.isArray(raw)
      ? raw
      : raw && typeof raw === 'object' && Array.isArray((raw as { members?: unknown }).members)
        ? (raw as { members: unknown[] }).members
        : []
    const map = new Map<number, string>()
    for (const item of list as Array<{ id?: number; name?: string }>) {
      if (item && typeof item.id === 'number' && typeof item.name === 'string') {
        map.set(item.id, item.name)
      }
    }
    if (map.size > 0) {
      cachedMemberMap = map
      cachedMemberMapAt = now
    }
    return map
  } catch {
    return cachedMemberMap ?? new Map<number, string>()
  }
}

function normalizeStories(raw: unknown, memberMap: Map<number, string>): KerjanStoryItem[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { tickets?: unknown }).tickets)
      ? (raw as { tickets: unknown[] }).tickets
      : []

  return (list as KerjanStoryItem[])
    .filter((s) => s && !s.canceled_at && s.status !== 'canceled')
    .map((s) => ({
      ...withAssigneeName(s, memberMap),
      tasks: Array.isArray(s.tasks)
        ? s.tasks
            .filter((t) => t && !t.canceled_at && t.status !== 'canceled')
            .map((t) => withAssigneeName(t, memberMap))
        : []
    }))
}

function pickDefaultSprintId(
  sprints: readonly KerjanSprintItem[],
  tickets: readonly KerjanTicket[]
): number | null {
  if (sprints.length === 0) return null
  const activeSprints = sprints.filter((s) => s.state === 'active')
  const userSprintMatch = activeSprints.find((s) => tickets.some((t) => t.sprint_id === s.id))
  if (userSprintMatch) return userSprintMatch.id
  if (activeSprints.length > 0) return activeSprints[0].id
  return sprints[0].id
}

function pickDefaultProductId(products: readonly KerjanProductItem[]): number | null {
  const preferred = products.find((p) => p.id === PREFERRED_PRODUCT_ID)
  return preferred ? preferred.id : null
}

async function updateStatusBar(orca: OrcaWorkerApi, data: KerjanDashboardData): Promise<void> {
  if (!orca.host.has('statusBar.update')) return
  const { inProgress, todo, done } = data.counts
  const text = data.needsSetup
    ? 'Kerjan: Setup'
    : data.error
      ? 'Kerjan: Offline'
      : `Kerjan: ${inProgress} WIP · ${todo} Todo`
  const tone = data.needsSetup
    ? 'neutral'
    : data.error
      ? 'warning'
      : inProgress > 0
        ? 'accent'
        : 'neutral'
  const tooltip = data.needsSetup
    ? 'Open the Kerjan panel to configure your MCP URL and API Key'
    : data.error
      ? `Kerjan error: ${data.error}`
      : `Kerjan (${data.workspaceCode}): ${inProgress} In Progress, ${todo} To Do, ${done} Done`
  try {
    await orca.host.call('statusBar.update', {
      id: 'kerjan-status',
      text,
      tone,
      tooltip
    })
  } catch {
    // Status bar is desktop-only and may be unavailable in headless tests.
  }
}

async function readCachedDashboard(orca: OrcaWorkerApi): Promise<KerjanDashboardData | null> {
  try {
    const cached = await orca.storage.get(CACHE_KEY)
    if (cached && typeof cached === 'object' && !Array.isArray(cached)) {
      const obj = cached as Partial<KerjanDashboardData>
      if (Array.isArray(obj.tickets) && obj.counts) {
        return obj as KerjanDashboardData
      }
    }
  } catch {
    // Ignore storage read failures.
  }
  return null
}

function buildConfigSummary(config: KerjanConfig): KerjanClientConfigSummary {
  return {
    apiUrl: config.apiUrl,
    hasToken: Boolean(config.apiToken),
    tokenPreview: maskToken(config.apiToken)
  }
}

async function resolveIdentityAndWorkspace(
  config: KerjanConfig,
  signal?: AbortSignal
): Promise<{ assigneeId: number; workspaceCode: string; userName?: string }> {
  const [me, rawWorkspaces] = await Promise.all([
    callKerjanTool<{ id?: number; name?: string }>(config, 'whoami', {}, signal).catch(
      () => undefined
    ),
    callKerjanTool<unknown>(config, 'list_workspaces', {}, signal).catch(() => [])
  ])

  const assigneeId = typeof me?.id === 'number' && me.id > 0 ? Math.floor(me.id) : cachedAssigneeId

  const wsList = Array.isArray(rawWorkspaces)
    ? rawWorkspaces
    : rawWorkspaces &&
        typeof rawWorkspaces === 'object' &&
        Array.isArray((rawWorkspaces as { workspaces?: unknown }).workspaces)
      ? (rawWorkspaces as { workspaces: unknown[] }).workspaces
      : []

  let workspaceCode = cachedWorkspaceCode
  for (const item of wsList as Array<{ code?: unknown }>) {
    if (item && typeof item.code === 'string' && item.code.trim()) {
      workspaceCode = item.code.trim().toUpperCase()
      break
    }
  }

  cachedAssigneeId = assigneeId
  cachedWorkspaceCode = workspaceCode

  return {
    assigneeId,
    workspaceCode,
    userName: typeof me?.name === 'string' ? me.name : undefined
  }
}

async function fetchDashboard(
  orca: OrcaWorkerApi,
  signal?: AbortSignal
): Promise<KerjanDashboardData> {
  const [config, projects] = await Promise.all([readConfig(orca), listGitProjects(orca)])
  const configSummary = buildConfigSummary(config)

  if (!config.apiUrl || !config.apiToken) {
    const setupData: KerjanDashboardData = {
      tickets: [],
      projects,
      sprints: [],
      products: [],
      defaultSprintId: null,
      defaultProductId: null,
      workspaceCode: '',
      assigneeId: 0,
      counts: { inProgress: 0, todo: 0, done: 0 },
      fetchedAt: Date.now(),
      needsSetup: true,
      config: configSummary
    }
    await updateStatusBar(orca, setupData)
    return setupData
  }

  try {
    const identity = await resolveIdentityAndWorkspace(config, signal)
    const assigneeId = identity.assigneeId
    let detectedWorkspace = identity.workspaceCode
    const wsFilter = detectedWorkspace ? { workspace: detectedWorkspace } : {}

    const [rawTickets, rawSprints, rawProducts, memberMap] = await Promise.all([
      callKerjanTool<KerjanTicket[] | { tickets?: KerjanTicket[] }>(
        config,
        'list_tickets',
        assigneeId > 0 ? { assignee_id: assigneeId } : {},
        signal
      ),
      callKerjanTool<unknown>(config, 'list_sprints', wsFilter, signal),
      callKerjanTool<unknown>(config, 'list_products', wsFilter, signal).catch(() => []),
      getMemberMap(config, signal)
    ])

    const ticketArray = Array.isArray(rawTickets)
      ? rawTickets
      : Array.isArray(rawTickets?.tickets)
        ? rawTickets.tickets
        : []
    const sprints = normalizeSprints(rawSprints)
    const products = normalizeProducts(rawProducts)

    const sprintMap = new Map<number, string>()
    for (const s of sprints) {
      sprintMap.set(s.id, s.name)
    }

    const activeTickets = ticketArray
      .filter((t) => !t.canceled_at)
      .map((t) =>
        withAssigneeName(
          {
            ...t,
            sprint_name:
              t.sprint_name ??
              (typeof t.sprint_id === 'number' ? sprintMap.get(t.sprint_id) : undefined)
          },
          memberMap
        )
      )
      .sort((a, b) => {
        const orderDiff = statusSortOrder(a.status) - statusSortOrder(b.status)
        if (orderDiff !== 0) return orderDiff
        return (b.id ?? 0) - (a.id ?? 0)
      })

    if (!detectedWorkspace && activeTickets.length > 0) {
      const inferred = activeTickets[0].key?.split('-')[0]?.trim().toUpperCase() ?? ''
      if (inferred) {
        detectedWorkspace = inferred
        cachedWorkspaceCode = inferred
      }
    }

    const counts = {
      inProgress: activeTickets.filter((t) => t.status === 'in_progress').length,
      todo: activeTickets.filter((t) => t.status === 'todo').length,
      done: activeTickets.filter((t) => t.status === 'done').length
    }

    const data: KerjanDashboardData = {
      tickets: activeTickets,
      projects,
      sprints,
      products,
      defaultSprintId: pickDefaultSprintId(sprints, activeTickets),
      defaultProductId: pickDefaultProductId(products),
      workspaceCode: detectedWorkspace || 'KERJAN',
      assigneeId,
      counts,
      fetchedAt: Date.now(),
      needsSetup: false,
      config: configSummary
    }

    try {
      await orca.storage.set(CACHE_KEY, JSON.parse(JSON.stringify(data)) as JsonValue)
    } catch {
      // Cache persistence is best-effort and must not fail a successful fetch.
    }
    await updateStatusBar(orca, data)
    return data
  } catch (err) {
    const message = errorMessage(err)
    orca.log(`Kerjan dashboard fetch failed: ${message}`)
    const cached = await readCachedDashboard(orca)
    const fallback: KerjanDashboardData = cached
      ? {
          ...cached,
          projects,
          fromCache: true,
          needsSetup: false,
          config: configSummary,
          error: message
        }
      : {
          tickets: [],
          projects,
          sprints: [],
          products: [],
          defaultSprintId: null,
          defaultProductId: null,
          workspaceCode: cachedWorkspaceCode || 'KERJAN',
          assigneeId: cachedAssigneeId,
          counts: { inProgress: 0, todo: 0, done: 0 },
          fetchedAt: Date.now(),
          needsSetup: false,
          config: configSummary,
          error: message
        }
    await updateStatusBar(orca, fallback)
    return fallback
  }
}

export default function activate(orca: OrcaWorkerApi): void {
  orca.panels.handle('kerjan.dashboard', async (_input, { signal }) => {
    return fetchDashboard(orca, signal)
  })

  orca.panels.handle('kerjan.saveConfig', async (input, { signal }) => {
    const current = await readConfig(orca)
    const apiUrl = (input.apiUrl ?? '').trim() || current.apiUrl
    const apiToken = (input.apiToken ?? '').trim() || current.apiToken

    if (!apiUrl) {
      return { ok: false, error: 'Kerjan MCP URL is required.' }
    }

    if (!apiToken) {
      return { ok: false, error: 'API Key / MCP Token is required.' }
    }

    const nextConfig: KerjanConfig = {
      apiUrl,
      apiToken
    }

    let me: { id?: number; name?: string } | undefined
    try {
      me = await callKerjanTool<{ id?: number; name?: string }>(nextConfig, 'whoami', {}, signal)
    } catch (err) {
      const message = errorMessage(err)
      orca.log(`Kerjan saveConfig connection check failed: ${message}`)
      return { ok: false, error: message }
    }

    let secretsSaved = false
    try {
      if (orca.secrets) {
        await orca.secrets.set(SECRET_TOKEN_KEY, apiToken)
        secretsSaved = true
      }
    } catch {
      // OS keyring may be unavailable in headless or test environments.
    }

    suppressSettingsReload = true
    try {
      await orca.settings.set('apiUrl', apiUrl)
    } catch {
      // Optional in mock environments.
    } finally {
      suppressSettingsReload = false
    }

    try {
      await orca.storage.set(CONFIG_STORAGE_KEY, {
        apiUrl,
        ...(secretsSaved ? {} : { apiToken })
      })
    } catch {
      // Storage persistence is best-effort.
    }

    cachedMemberMap = null
    cachedMemberMapAt = 0
    cachedWorkspaceCode = ''
    cachedAssigneeId = 0

    const dashboard = await fetchDashboard(orca, signal)
    orca.panels.post('kerjan.refreshed', dashboard)

    return {
      ok: true,
      userName: typeof me?.name === 'string' ? me.name : undefined,
      userId: typeof me?.id === 'number' ? me.id : undefined,
      dashboard
    }
  })

  orca.panels.handle('kerjan.clearConfig', async (_input, { signal }) => {
    try {
      if (orca.secrets) {
        await orca.secrets.delete(SECRET_TOKEN_KEY)
      }
    } catch {
      // OS keyring may be unavailable in headless or test environments.
    }

    suppressSettingsReload = true
    try {
      await orca.settings.set('apiUrl', '')
      await orca.settings.set('apiToken', '')
    } catch {
      // Optional in mock environments.
    } finally {
      suppressSettingsReload = false
    }

    try {
      await orca.storage.delete(CONFIG_STORAGE_KEY)
      await orca.storage.delete(CACHE_KEY)
    } catch {
      // Storage cleanup is best-effort.
    }

    cachedMemberMap = null
    cachedMemberMapAt = 0
    cachedWorkspaceCode = ''
    cachedAssigneeId = 0

    const dashboard = await fetchDashboard(orca, signal)
    orca.panels.post('kerjan.refreshed', dashboard)
    return { ok: true, dashboard }
  })

  orca.panels.handle('kerjan.detail', async ({ key }, { signal }): Promise<KerjanTicketDetail> => {
    const config = await readConfig(orca)
    try {
      const [raw, memberMap] = await Promise.all([
        callKerjanTool<{
          ticket?: KerjanTicket & { tasks?: KerjanTicket[] }
          story?: KerjanStorySummary | null
          comments?: KerjanComment[]
        }>(config, 'get_ticket', { key }, signal),
        getMemberMap(config, signal)
      ])
      if (!raw?.ticket) {
        throw new Error(`Ticket ${key} not found`)
      }
      const ticketTasks = Array.isArray(raw.ticket.tasks)
        ? raw.ticket.tasks
            .filter((t) => t && !t.canceled_at && t.status !== 'canceled')
            .map((t) => withAssigneeName(t, memberMap))
        : undefined
      const resolvedTicket = withAssigneeName(
        {
          ...raw.ticket,
          ...(ticketTasks ? { tasks: ticketTasks } : {})
        },
        memberMap
      )
      const storySummary = raw.story
        ? {
            ...raw.story,
            tasks: Array.isArray(raw.story.tasks)
              ? raw.story.tasks
                  .filter((t) => t && !t.canceled_at && t.status !== 'canceled')
                  .map((t) => withAssigneeName(t, memberMap))
              : undefined
          }
        : raw.ticket.kind === 'story' && ticketTasks
          ? {
              id: raw.ticket.id,
              key: raw.ticket.key,
              title: raw.ticket.title,
              status: raw.ticket.status,
              tasks: ticketTasks
            }
          : null

      return {
        ticket: resolvedTicket,
        story: storySummary,
        comments: Array.isArray(raw.comments) ? raw.comments : []
      }
    } catch (err) {
      const message = errorMessage(err)
      orca.log(`Kerjan get_ticket(${key}) failed: ${message}`)
      return {
        ticket: { id: 0, key, kind: 'task', title: key, status: 'unknown' },
        story: null,
        comments: [],
        error: message
      }
    }
  })

  orca.panels.handle('kerjan.sprintTickets', async ({ sprintId }, { signal }) => {
    const config = await readConfig(orca)
    try {
      const [raw, memberMap] = await Promise.all([
        callKerjanTool<unknown>(
          config,
          'list_tickets',
          { sprint_id: sprintId, ...(cachedWorkspaceCode ? { workspace: cachedWorkspaceCode } : {}) },
          signal
        ),
        getMemberMap(config, signal)
      ])
      return {
        sprintId,
        stories: normalizeStories(raw, memberMap)
      }
    } catch (err) {
      const message = errorMessage(err)
      orca.log(`Kerjan sprintTickets(${sprintId}) failed: ${message}`)
      return {
        sprintId,
        stories: [],
        error: message
      }
    }
  })

  orca.panels.handle('kerjan.backlogTickets', async (input, { signal }) => {
    const config = await readConfig(orca)
    const productId = input?.productId
    try {
      const args: Record<string, unknown> = {
        backlog: true,
        kind: 'story',
        ...(cachedWorkspaceCode ? { workspace: cachedWorkspaceCode } : {})
      }
      if (typeof productId === 'number' && productId > 0) {
        args.product_id = productId
      }
      const [raw, memberMap] = await Promise.all([
        callKerjanTool<unknown>(config, 'list_tickets', args, signal),
        getMemberMap(config, signal)
      ])
      const stories = normalizeStories(raw, memberMap).slice(0, BACKLOG_LIMIT)
      return { stories }
    } catch (err) {
      const message = errorMessage(err)
      orca.log(`Kerjan backlogTickets(${productId ?? 'all'}) failed: ${message}`)
      return {
        stories: [],
        error: message
      }
    }
  })

  orca.panels.handle('kerjan.moveTask', async ({ key, status, comment }, { signal }) => {
    const config = await readConfig(orca)
    try {
      await callKerjanTool(
        config,
        'move_task',
        comment ? { key, status, comment } : { key, status },
        signal
      )
      const data = await fetchDashboard(orca, signal)
      orca.panels.post('kerjan.refreshed', data)
      return { ok: true }
    } catch (err) {
      const message = errorMessage(err)
      orca.log(`Kerjan move_task(${key} -> ${status}) failed: ${message}`)
      return { ok: false, error: message }
    }
  })

  orca.panels.handle('kerjan.addComment', async ({ key, body }, { signal }) => {
    const config = await readConfig(orca)
    try {
      await callKerjanTool(config, 'add_comment', { key, body }, signal)
      return { ok: true }
    } catch (err) {
      const message = errorMessage(err)
      orca.log(`Kerjan add_comment(${key}) failed: ${message}`)
      return { ok: false, error: message }
    }
  })

  orca.panels.handle(
    'kerjan.createWorktree',
    async ({ ticketKey, ticketTitle, projectId, hostId }) => {
      try {
        const slug = slugify(ticketTitle).slice(0, 32)
        const branch = slug
          ? `feature/${ticketKey.toLowerCase()}-${slug}`
          : `feature/${ticketKey.toLowerCase()}`
        const created = await orca.host.call('workspace.create', {
          projectId,
          ...(hostId ? { hostId } : {}),
          name: branch,
          open: true
        })
        if (orca.host.has('workspace.open')) {
          try {
            await orca.host.call('workspace.open', { workspaceId: created.workspaceId })
          } catch {
            // Best-effort focus when open:true already handled it or desktop is hidden.
          }
        }
        if (orca.host.has('notifications.show')) {
          try {
            await orca.host.call('notifications.show', {
              title: 'Kerjan Worktree Created',
              body: `${ticketKey} → ${branch}`
            })
          } catch {
            // Optional notification.
          }
        }
        return { ok: true, workspaceId: created.workspaceId, branch }
      } catch (err) {
        const message = errorMessage(err)
        orca.log(`Kerjan createWorktree(${ticketKey}) failed: ${message}`)
        return { ok: false, error: message }
      }
    }
  )

  orca.panels.handle('kerjan.epics', async (input, { signal }) => {
    const config = await readConfig(orca)
    try {
      const args: Record<string, unknown> = {
        kind: 'epic',
        ...(cachedWorkspaceCode ? { workspace: cachedWorkspaceCode } : {})
      }
      if (typeof input?.productId === 'number' && input.productId > 0) {
        args.product_id = input.productId
      }
      const raw = await callKerjanTool<unknown>(config, 'list_tickets', args, signal)
      return { epics: normalizeEpics(raw) }
    } catch (err) {
      const message = errorMessage(err)
      orca.log(`Kerjan list_tickets(epic) failed: ${message}`)
      return { epics: [], error: message }
    }
  })

  orca.panels.handle('kerjan.members', async (_input, { signal }) => {
    const config = await readConfig(orca)
    try {
      const raw = await callKerjanTool<unknown>(config, 'list_members', {}, signal)
      return { members: normalizeMembers(raw) }
    } catch (err) {
      const message = errorMessage(err)
      orca.log(`Kerjan list_members failed: ${message}`)
      return { members: [], error: message }
    }
  })

  orca.panels.handle(
    'kerjan.createStory',
    async ({ epicId, title, description, sprintId }, { signal }) => {
      const config = await readConfig(orca)
      try {
        const args: Record<string, unknown> = {
          epic_id: epicId,
          title: title.trim(),
          ...(cachedWorkspaceCode ? { workspace: cachedWorkspaceCode } : {})
        }
        if (description?.trim()) {
          args.description = description.trim()
        }
        if (typeof sprintId === 'number' && sprintId > 0) {
          args.sprint_id = sprintId
        }
        const res = await callKerjanTool<any>(config, 'create_story', args, signal)
        const storyKey =
          res?.key ??
          (typeof res === 'object' && res?.ticket?.key ? res.ticket.key : undefined)
        const data = await fetchDashboard(orca, signal)
        orca.panels.post('kerjan.refreshed', data)
        return { ok: true, key: storyKey }
      } catch (err) {
        const message = errorMessage(err)
        orca.log(`Kerjan create_story failed: ${message}`)
        return { ok: false, error: message }
      }
    }
  )

  orca.panels.handle(
    'kerjan.addTask',
    async ({ storyKey, type, title, estimate, assigneeId, description }, { signal }) => {
      const config = await readConfig(orca)
      try {
        const args: Record<string, unknown> = {
          key: storyKey,
          type: type || 'dev',
          title: title.trim()
        }
        if (typeof estimate === 'number' && !Number.isNaN(estimate)) {
          args.estimate = estimate
        }
        if (typeof assigneeId === 'number' && assigneeId > 0) {
          args.assignee_id = assigneeId
        }
        if (description?.trim()) {
          args.description = description.trim()
        }
        const res = await callKerjanTool<any>(config, 'add_task', args, signal)
        const taskKey =
          res?.key ??
          (typeof res === 'object' && res?.ticket?.key ? res.ticket.key : undefined)
        const data = await fetchDashboard(orca, signal)
        orca.panels.post('kerjan.refreshed', data)
        return { ok: true, key: taskKey }
      } catch (err) {
        const message = errorMessage(err)
        orca.log(`Kerjan add_task(${storyKey}) failed: ${message}`)
        return { ok: false, error: message }
      }
    }
  )

  orca.panels.handle(
    'kerjan.updateTask',
    async ({ key, title, description, estimate, assigneeId }, { signal }) => {
      const config = await readConfig(orca)
      try {
        if (title !== undefined || description !== undefined) {
          const updateArgs: Record<string, unknown> = { key }
          if (title !== undefined) updateArgs.title = title.trim()
          if (description !== undefined) updateArgs.description = description.trim()
          await callKerjanTool(config, 'update_ticket', updateArgs, signal)
        }
        if (estimate !== undefined && estimate !== null && !Number.isNaN(estimate)) {
          await callKerjanTool(config, 'set_estimate', { key, estimate }, signal)
        }
        if (assigneeId !== undefined) {
          await callKerjanTool(config, 'set_assignee', { key, assignee_id: assigneeId }, signal)
        }

        const data = await fetchDashboard(orca, signal)
        orca.panels.post('kerjan.refreshed', data)
        return { ok: true }
      } catch (err) {
        const message = errorMessage(err)
        orca.log(`Kerjan updateTask(${key}) failed: ${message}`)
        return { ok: false, error: message }
      }
    }
  )

  disposables.push(
    orca.commands.register('kerjan.refresh', async (_args, { signal }) => {
      const data = await fetchDashboard(orca, signal)
      orca.panels.post('kerjan.refreshed', data)
      if (data.error) {
        return `Kerjan refresh error: ${data.error}`
      }
      return `Kerjan: ${data.counts.inProgress} WIP, ${data.counts.todo} Todo`
    })
  )

  disposables.push(
    orca.settings.onDidChange((change) => {
      if (suppressSettingsReload) return
      void (async () => {
        try {
          const updatedValue = await orca.settings.get(change.key)
          if (change.key === 'apiToken' && typeof updatedValue === 'string' && updatedValue.trim()) {
            try {
              if (orca.secrets) {
                await orca.secrets.set(SECRET_TOKEN_KEY, updatedValue.trim())
              }
            } catch {
              // Ignore keyring write error.
            }
          }
          if (change.key === 'apiUrl' && updatedValue !== undefined) {
            const existing = await orca.storage.get(CONFIG_STORAGE_KEY)
            const nextStored =
              existing && typeof existing === 'object' && !Array.isArray(existing)
                ? { ...(existing as Record<string, JsonValue>), apiUrl: updatedValue }
                : { apiUrl: updatedValue }
            await orca.storage.set(CONFIG_STORAGE_KEY, nextStored)
          }
        } catch {
          // Ignore sync failures.
        }
        cachedMemberMap = null
        cachedMemberMapAt = 0
        cachedWorkspaceCode = ''
        cachedAssigneeId = 0
        activeAbort?.abort()
        activeAbort = new AbortController()
        const data = await fetchDashboard(orca, activeAbort.signal)
        orca.panels.post('kerjan.refreshed', data)
      })()
    })
  )

  startupTimer = setTimeout(() => {
    startupTimer = null
    activeAbort?.abort()
    activeAbort = new AbortController()
    void fetchDashboard(orca, activeAbort.signal).then((data) => {
      orca.panels.post('kerjan.refreshed', data)
    })
  }, 1500)
  startupTimer.unref?.()

  pollTimer = setInterval(() => {
    activeAbort?.abort()
    activeAbort = new AbortController()
    void fetchDashboard(orca, activeAbort.signal).then((data) => {
      orca.panels.post('kerjan.refreshed', data)
    })
  }, POLL_INTERVAL_MS)
  pollTimer.unref?.()
}

export function deactivate(): void {
  cachedMemberMap = null
  cachedMemberMapAt = 0
  cachedWorkspaceCode = ''
  cachedAssigneeId = 0
  if (startupTimer) {
    clearTimeout(startupTimer)
    startupTimer = null
  }
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  activeAbort?.abort()
  activeAbort = null
  while (disposables.length > 0) {
    disposables.pop()?.dispose()
  }
}
