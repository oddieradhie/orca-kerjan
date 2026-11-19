import {
  atom,
  Badge,
  Box,
  Button,
  Callout,
  Card,
  Code,
  Collapsible,
  EmptyState,
  Heading,
  IconButton,
  Image,
  Input,
  Markdown,
  plugin,
  Progress,
  read,
  Row,
  Select,
  Separator,
  set,
  shell,
  Spinner,
  Stack,
  Switch,
  Tab,
  Tabs,
  Text,
  Textarea,
  type PanelContext,
  type Tone
} from 'orca'
import type {
  KerjanDashboardData,
  KerjanProductItem,
  KerjanSprintItem,
  KerjanStoryItem,
  KerjanTicket,
  KerjanTicketDetail,
  OrcaProjectItem
} from './protocol'
import './protocol'

type FeedbackState = {
  tone: Tone
  title: string
  message: string
} | null

type ViewMode = 'tasks' | 'sprints' | 'backlog'

const dashboardAtom = atom<KerjanDashboardData | null>(null)
const loadingAtom = atom<boolean>(true)
const viewModeAtom = atom<ViewMode>('viewMode', 'tasks', { persist: 'plugin' })
const searchAtom = atom<string>('')
const statusTabAtom = atom('statusTab', 'active', { persist: 'plugin' })

const selectedTicketAtom = atom<KerjanTicket | null>(null)
const ticketDetailAtom = atom<KerjanTicketDetail | null>(null)
const detailLoadingAtom = atom<boolean>(false)
const selectedProjectAtom = atom('selectedProject', '', { persist: 'plugin' })
const commentDraftAtom = atom<string>('')
const busyActionAtom = atom<string | null>(null)
const feedbackAtom = atom<FeedbackState>(null)

const selectedSprintIdAtom = atom<number | null>('selectedSprintId', null, { persist: 'plugin' })
const sprintStoriesAtom = atom<KerjanStoryItem[]>([])
const sprintLoadedIdAtom = atom<number | null>(null)
const sprintLoadingAtom = atom<boolean>(false)
const sprintErrorAtom = atom<string | null>(null)
const sprintSearchAtom = atom<string>('')
const sprintOnlyMineAtom = atom('sprintOnlyMine', false, { persist: 'plugin' })

const selectedProductIdAtom = atom<number>('selectedProductId', 0, { persist: 'plugin' })
const backlogStoriesAtom = atom<KerjanStoryItem[]>([])
const backlogLoadedProductAtom = atom<number | null>(null)
const backlogLoadingAtom = atom<boolean>(false)
const backlogErrorAtom = atom<string | null>(null)
const backlogSearchAtom = atom<string>('')

const showSettingsAtom = atom<boolean>(false)
const configUrlAtom = atom<string>('')
const configTokenAtom = atom<string>('')

let activeSignal: AbortSignal | null = null

function isAborted(): boolean {
  return Boolean(activeSignal?.aborted)
}

function statusTone(status: string): Tone {
  if (status === 'done') return 'success'
  if (status === 'in_progress' || status === 'ready_for_qa') return 'accent'
  if (status === 'todo') return 'warning'
  return 'neutral'
}

function statusBadgeText(status: string): string {
  if (status === 'done') return 'DONE'
  if (status === 'in_progress') return 'IN PROGRESS'
  if (status === 'todo') return 'TO DO'
  if (status === 'ready_for_qa') return 'READY FOR QA'
  return status.toUpperCase()
}

function taskTypeTone(taskType?: string | null, severity?: string | null): Tone {
  if (taskType === 'bug' || severity === 'high' || severity === 'critical') return 'danger'
  if (taskType === 'qa') return 'accent'
  return 'neutral'
}

function sprintStateTone(state: string): Tone {
  if (state === 'active') return 'accent'
  if (state === 'done' || state === 'closed') return 'success'
  if (state === 'planned') return 'warning'
  return 'neutral'
}

function assigneeTone(ticketAssigneeId?: number | null, currentUserId = 0): Tone {
  if (currentUserId > 0 && ticketAssigneeId === currentUserId) return 'accent'
  return 'neutral'
}

function statusLabel(status: string): string {
  if (status === 'in_progress') return 'In Progress'
  if (status === 'todo') return 'To Do'
  if (status === 'done') return 'Done'
  if (status === 'ready_for_qa') return 'Ready for QA'
  return status
}

function ticketIcon(ticket: KerjanTicket): 'bug' | 'check' | 'play' | 'flag' {
  if (ticket.task_type === 'bug') return 'bug'
  if (ticket.status === 'done') return 'check'
  if (ticket.status === 'in_progress') return 'play'
  return 'flag'
}

function formatDateRange(start?: string | null, end?: string | null): string | undefined {
  const s = start ? start.slice(0, 10) : ''
  const e = end ? end.slice(0, 10) : ''
  if (s && e) return `${s} → ${e}`
  if (s) return `Starts ${s}`
  if (e) return `Ends ${e}`
  return undefined
}

function guessProjectId(title: string, projects: readonly OrcaProjectItem[]): string {
  if (projects.length === 0) return ''
  const lowerTitle = title.toLowerCase()
  const matched = projects.find((p) => lowerTitle.includes(p.name.toLowerCase()))
  return matched ? matched.id : projects[0].id
}

function syncProjectSelection(data: KerjanDashboardData, ticket: KerjanTicket | null): void {
  const projects = data.projects
  if (projects.length === 0) {
    set(selectedProjectAtom, '')
    return
  }
  const current = read(selectedProjectAtom)
  const stillExists = projects.some((p) => p.id === current)
  if (ticket) {
    const guessed = guessProjectId(ticket.title, projects)
    if (guessed && (guessed !== projects[0].id || !stillExists)) {
      set(selectedProjectAtom, guessed)
      return
    }
  }
  if (!stillExists) {
    set(selectedProjectAtom, projects[0].id)
  }
}

function resolveSprintSelection(data: KerjanDashboardData): number | null {
  const sprints = data.sprints ?? []
  if (sprints.length === 0) return null
  const current = read(selectedSprintIdAtom)
  if (current !== null && sprints.some((s) => s.id === current)) {
    return current
  }
  const next = data.defaultSprintId ?? sprints[0].id
  set(selectedSprintIdAtom, next)
  return next
}

function resolveProductSelection(data: KerjanDashboardData): number {
  const products = data.products ?? []
  const current = read(selectedProductIdAtom)
  if (current === 0 || products.some((p) => p.id === current)) {
    if (current === 0 && data.defaultProductId && read(backlogLoadedProductAtom) === null) {
      set(selectedProductIdAtom, data.defaultProductId)
      return data.defaultProductId
    }
    return current
  }
  const next = data.defaultProductId ?? 0
  set(selectedProductIdAtom, next)
  return next
}

async function loadSprintTickets(sprintId: number): Promise<void> {
  set(sprintLoadingAtom, true)
  set(sprintErrorAtom, null)
  try {
    const res = await plugin.request('kerjan.sprintTickets', { sprintId })
    if (isAborted()) return
    set(sprintStoriesAtom, res.stories)
    set(sprintLoadedIdAtom, res.sprintId)
    if (res.error) set(sprintErrorAtom, res.error)
  } catch (err) {
    if (isAborted()) return
    set(sprintErrorAtom, err instanceof Error ? err.message : String(err))
  } finally {
    if (!isAborted()) set(sprintLoadingAtom, false)
  }
}

async function loadBacklogTickets(productId: number): Promise<void> {
  set(backlogLoadingAtom, true)
  set(backlogErrorAtom, null)
  try {
    const res = await plugin.request('kerjan.backlogTickets', {
      productId: productId > 0 ? productId : null
    })
    if (isAborted()) return
    set(backlogStoriesAtom, res.stories)
    set(backlogLoadedProductAtom, productId)
    if (res.error) set(backlogErrorAtom, res.error)
  } catch (err) {
    if (isAborted()) return
    set(backlogErrorAtom, err instanceof Error ? err.message : String(err))
  } finally {
    if (!isAborted()) set(backlogLoadingAtom, false)
  }
}

function populateConfigForm(data: KerjanDashboardData | null): void {
  const cfg = data?.config
  set(configUrlAtom, cfg?.apiUrl ?? '')
  set(configTokenAtom, '')
}

function toggleSettingsView(): void {
  const data = read(dashboardAtom)
  if (data?.needsSetup) {
    populateConfigForm(data)
    return
  }
  if (!read(showSettingsAtom)) {
    populateConfigForm(data)
    set(showSettingsAtom, true)
    set(feedbackAtom, null)
  } else {
    set(showSettingsAtom, false)
  }
}

async function submitConfig(): Promise<void> {
  const apiUrl = read(configUrlAtom).trim()
  const apiToken = read(configTokenAtom).trim()

  set(busyActionAtom, 'saveConfig')
  set(feedbackAtom, null)
  try {
    const res = await plugin.request('kerjan.saveConfig', {
      apiUrl,
      ...(apiToken ? { apiToken } : {})
    })
    if (isAborted()) return
    if (!res.ok) {
      set(feedbackAtom, {
        tone: 'danger',
        title: 'Connection failed',
        message: res.error || 'Could not connect to Kerjan MCP server.'
      })
      return
    }
    if (res.dashboard) {
      set(dashboardAtom, res.dashboard)
      syncProjectSelection(res.dashboard, read(selectedTicketAtom))
      resolveSprintSelection(res.dashboard)
      resolveProductSelection(res.dashboard)
    }
    set(configTokenAtom, '')
    set(showSettingsAtom, false)
    set(feedbackAtom, {
      tone: 'success',
      title: 'Connected to Kerjan',
      message: res.userName
        ? `Authenticated as ${res.userName}.`
        : 'Settings saved locally in Orca.'
    })
  } catch (err) {
    if (isAborted()) return
    set(feedbackAtom, {
      tone: 'danger',
      title: 'Connection failed',
      message: err instanceof Error ? err.message : String(err)
    })
  } finally {
    if (!isAborted()) set(busyActionAtom, null)
  }
}

async function disconnectConfig(): Promise<void> {
  set(busyActionAtom, 'clearConfig')
  set(feedbackAtom, null)
  try {
    const res = await plugin.request('kerjan.clearConfig', {})
    if (isAborted()) return
    set(dashboardAtom, res.dashboard)
    populateConfigForm(res.dashboard)
    set(showSettingsAtom, false)
    set(selectedTicketAtom, null)
    set(ticketDetailAtom, null)
    set(feedbackAtom, {
      tone: 'neutral',
      title: 'Disconnected',
      message: 'Local API credentials have been cleared.'
    })
  } catch (err) {
    if (isAborted()) return
    set(feedbackAtom, {
      tone: 'danger',
      title: 'Failed to clear credentials',
      message: err instanceof Error ? err.message : String(err)
    })
  } finally {
    if (!isAborted()) set(busyActionAtom, null)
  }
}

async function refreshDashboard(force = false): Promise<void> {
  set(loadingAtom, true)
  try {
    const data = await plugin.request('kerjan.dashboard', { force })
    if (isAborted()) return
    set(dashboardAtom, data)
    if (data.needsSetup) {
      populateConfigForm(data)
    }
    const active = read(selectedTicketAtom)
    if (active) {
      const updated = data.tickets.find((t) => t.key === active.key)
      if (updated) set(selectedTicketAtom, updated)
    }
    syncProjectSelection(data, read(selectedTicketAtom))

    const sprintId = resolveSprintSelection(data)
    const productId = resolveProductSelection(data)
    const mode = read(viewModeAtom)
    if (mode === 'sprints' && sprintId !== null) {
      void loadSprintTickets(sprintId)
    } else if (mode === 'backlog') {
      void loadBacklogTickets(productId)
    }
  } catch (err) {
    if (isAborted()) return
    const message = err instanceof Error ? err.message : String(err)
    set(feedbackAtom, {
      tone: 'danger',
      title: 'Failed to load Kerjan tickets',
      message
    })
  } finally {
    if (!isAborted()) set(loadingAtom, false)
  }
}

function switchViewMode(mode: ViewMode): void {
  set(viewModeAtom, mode)
  set(selectedTicketAtom, null)
  set(ticketDetailAtom, null)
  set(feedbackAtom, null)
  const data = read(dashboardAtom)
  if (!data) return
  if (mode === 'sprints') {
    const sprintId = resolveSprintSelection(data)
    if (sprintId !== null && read(sprintLoadedIdAtom) !== sprintId) {
      void loadSprintTickets(sprintId)
    }
  } else if (mode === 'backlog') {
    const productId = resolveProductSelection(data)
    if (read(backlogLoadedProductAtom) !== productId) {
      void loadBacklogTickets(productId)
    }
  }
}

async function openTicketDetail(ticket: KerjanTicket): Promise<void> {
  set(selectedTicketAtom, ticket)
  set(ticketDetailAtom, null)
  set(detailLoadingAtom, true)
  set(feedbackAtom, null)
  const data = read(dashboardAtom)
  if (data) syncProjectSelection(data, ticket)

  try {
    const detail = await plugin.request('kerjan.detail', { key: ticket.key })
    if (isAborted()) return
    set(ticketDetailAtom, detail)
  } catch (err) {
    if (isAborted()) return
    const message = err instanceof Error ? err.message : String(err)
    set(ticketDetailAtom, {
      ticket,
      story: null,
      comments: [],
      error: message
    })
  } finally {
    if (!isAborted()) set(detailLoadingAtom, false)
  }
}

async function moveTicketStatus(key: string, nextStatus: string): Promise<void> {
  set(busyActionAtom, `move:${nextStatus}`)
  set(feedbackAtom, null)
  try {
    const res = await plugin.request('kerjan.moveTask', { key, status: nextStatus })
    if (isAborted()) return
    if (!res.ok) {
      set(feedbackAtom, {
        tone: 'danger',
        title: `Failed to update status for ${key}`,
        message: res.error || 'Request rejected by Kerjan.'
      })
      return
    }
    set(feedbackAtom, {
      tone: 'success',
      title: 'Status updated',
      message: `${key} → ${statusLabel(nextStatus)}`
    })
    const active = read(selectedTicketAtom)
    if (active && active.key === key) {
      set(selectedTicketAtom, { ...active, status: nextStatus })
      void openTicketDetail({ ...active, status: nextStatus })
    }
    await refreshDashboard(true)
  } catch (err) {
    if (isAborted()) return
    set(feedbackAtom, {
      tone: 'danger',
      title: `Failed to update status for ${key}`,
      message: err instanceof Error ? err.message : String(err)
    })
  } finally {
    if (!isAborted()) set(busyActionAtom, null)
  }
}

async function submitComment(key: string): Promise<void> {
  const body = read(commentDraftAtom).trim()
  if (!body) return
  set(busyActionAtom, 'comment')
  set(feedbackAtom, null)
  try {
    const res = await plugin.request('kerjan.addComment', { key, body })
    if (isAborted()) return
    if (!res.ok) {
      set(feedbackAtom, {
        tone: 'danger',
        title: `Failed to post comment on ${key}`,
        message: res.error || 'Request rejected by Kerjan.'
      })
      return
    }
    set(commentDraftAtom, '')
    set(feedbackAtom, {
      tone: 'success',
      title: 'Comment posted',
      message: `Comment added to ${key}.`
    })
    const active = read(selectedTicketAtom)
    if (active) {
      await openTicketDetail(active)
    }
  } catch (err) {
    if (isAborted()) return
    set(feedbackAtom, {
      tone: 'danger',
      title: `Failed to post comment on ${key}`,
      message: err instanceof Error ? err.message : String(err)
    })
  } finally {
    if (!isAborted()) set(busyActionAtom, null)
  }
}

async function createWorktreeFromTicket(ticket: KerjanTicket): Promise<void> {
  const data = read(dashboardAtom)
  const projectId = read(selectedProjectAtom)
  const project = data?.projects.find((p) => p.id === projectId)
  if (!project) {
    set(feedbackAtom, {
      tone: 'warning',
      title: 'Select a repository',
      message: 'Add or select a Git repository in Orca first.'
    })
    return
  }

  set(busyActionAtom, 'worktree')
  set(feedbackAtom, null)
  try {
    const res = await plugin.request('kerjan.createWorktree', {
      ticketKey: ticket.key,
      ticketTitle: ticket.title,
      projectId: project.id,
      hostId: project.hostId
    })
    if (isAborted()) return
    if (!res.ok) {
      set(feedbackAtom, {
        tone: 'danger',
        title: 'Failed to create worktree',
        message: res.error || 'Could not create a worktree from this ticket.'
      })
      return
    }
    set(feedbackAtom, {
      tone: 'success',
      title: 'Worktree created',
      message: `${project.name} → ${res.branch}`
    })
  } catch (err) {
    if (isAborted()) return
    set(feedbackAtom, {
      tone: 'danger',
      title: 'Failed to create worktree',
      message: err instanceof Error ? err.message : String(err)
    })
  } finally {
    if (!isAborted()) set(busyActionAtom, null)
  }
}

function filterTickets(
  tickets: readonly KerjanTicket[],
  tab: string,
  query: string
): KerjanTicket[] {
  const normalizedQuery = query.trim().toLowerCase()
  return tickets.filter((t) => {
    if (tab === 'active' && t.status !== 'in_progress' && t.status !== 'todo') return false
    if (tab === 'in_progress' && t.status !== 'in_progress') return false
    if (tab === 'todo' && t.status !== 'todo') return false
    if (tab === 'done' && t.status !== 'done') return false
    if (!normalizedQuery) return true
    return (
      t.key.toLowerCase().includes(normalizedQuery) ||
      t.title.toLowerCase().includes(normalizedQuery) ||
      (t.story_key?.toLowerCase().includes(normalizedQuery) ?? false) ||
      (t.story_title?.toLowerCase().includes(normalizedQuery) ?? false)
    )
  })
}

function TicketCard({
  ticket,
  busyAction,
  showQuickActions = true,
  showAssignee = false
}: {
  ticket: KerjanTicket
  busyAction: string | null
  showQuickActions?: boolean
  showAssignee?: boolean
}) {
  const tone = statusTone(ticket.status)
  const isBusy = busyAction !== null
  const currentUserId = read(dashboardAtom)?.assigneeId ?? 0

  return (
    <Box border={true} background="card" radius="md" padding="sm" gap="xs">
      <Row justify="between" align="center" wrap>
        <Row gap="xs" align="center" wrap>
          <Button
            size="xs"
            variant="outline"
            icon={ticketIcon(ticket)}
            onPress={() => void openTicketDetail(ticket)}
          >
            {ticket.key}
          </Button>
          <Badge tone={tone}>{statusBadgeText(ticket.status)}</Badge>
          {ticket.task_type ? (
            <Badge tone={taskTypeTone(ticket.task_type, ticket.severity)}>
              {ticket.task_type.toUpperCase()}
            </Badge>
          ) : null}
          {typeof ticket.estimate === 'number' && ticket.estimate > 0 ? (
            <Badge tone="neutral">{`${ticket.estimate}h`}</Badge>
          ) : null}
          {showAssignee && ticket.assignee_name ? (
            <Badge tone={assigneeTone(ticket.assignee_id, currentUserId)}>
              {ticket.assignee_name}
            </Badge>
          ) : null}
        </Row>
        {showQuickActions && ticket.kind === 'task' && ticket.status === 'todo' ? (
          <Button
            size="xs"
            tone="accent"
            variant="ghost"
            icon="play"
            disabled={isBusy}
            onPress={() => void moveTicketStatus(ticket.key, 'in_progress')}
          >
            Start
          </Button>
        ) : showQuickActions && ticket.kind === 'task' && ticket.status === 'in_progress' ? (
          <Button
            size="xs"
            tone="success"
            variant="ghost"
            icon="check"
            disabled={isBusy}
            onPress={() => void moveTicketStatus(ticket.key, 'done')}
          >
            Done
          </Button>
        ) : null}
      </Row>

      <Text size="sm" weight="medium">
        {ticket.title}
      </Text>

      {ticket.story_key || ticket.sprint_name ? (
        <Row gap="xs" align="center" wrap>
          {ticket.story_key ? (
            <Text size="xs" muted>
              Story <Code>{ticket.story_key}</Code>
            </Text>
          ) : null}
          {ticket.sprint_name ? (
            <Text size="xs" muted>
              {ticket.story_key ? `· ${ticket.sprint_name}` : ticket.sprint_name}
            </Text>
          ) : null}
        </Row>
      ) : null}
    </Box>
  )
}

function TicketListView({
  tickets,
  tab,
  query,
  loading,
  busyAction
}: {
  tickets: readonly KerjanTicket[]
  tab: string
  query: string
  loading: boolean
  busyAction: string | null
}) {
  const filtered = filterTickets(tickets, tab, query)
  if (loading && tickets.length === 0) {
    return (
      <Row gap="sm" align="center">
        <Spinner label="Loading Kerjan tickets" />
        <Text muted size="sm">
          Fetching tickets from Kerjan...
        </Text>
      </Row>
    )
  }
  if (filtered.length === 0) {
    return (
      <EmptyState
        title="No tickets"
        description={
          query.trim()
            ? 'No tickets match your search.'
            : 'No tickets in this status filter.'
        }
        icon="layers"
      />
    )
  }
  return (
    <Stack gap="xs">
      {filtered.map((t) => (
        <TicketCard key={t.key} ticket={t} busyAction={busyAction} />
      ))}
    </Stack>
  )
}

function SprintView({
  sprints,
  selectedSprintId,
  stories,
  loading,
  error,
  query,
  onlyMine,
  assigneeId,
  busyAction
}: {
  sprints: readonly KerjanSprintItem[]
  selectedSprintId: number | null
  stories: readonly KerjanStoryItem[]
  loading: boolean
  error: string | null
  query: string
  onlyMine: boolean
  assigneeId: number
  busyAction: string | null
}) {
  if (sprints.length === 0) {
    return (
      <EmptyState
        title="No sprints found"
        description="Sprints will appear once workspace data finishes loading."
        icon="calendar"
      />
    )
  }

  const activeSprint = sprints.find((s) => s.id === selectedSprintId) ?? sprints[0]
  const sprintOptions = sprints.map((s) => ({
    value: String(s.id),
    label: `[${s.state.toUpperCase()}] ${s.name}`
  }))

  const allTasks = stories.flatMap((s) => s.tasks ?? [])
  const totalStories = stories.length > 0 ? stories.length : (activeSprint.report?.stories ?? 0)
  const totalTasks = allTasks.length > 0 ? allTasks.length : (activeSprint.report?.tasks ?? 0)
  const doneTasks =
    allTasks.length > 0
      ? allTasks.filter((t) => t.status === 'done').length
      : (activeSprint.report?.tasks_done ?? 0)
  const totalHours =
    allTasks.length > 0
      ? Math.round(allTasks.reduce((sum, t) => sum + (t.estimate ?? 0), 0) * 10) / 10
      : Math.round((activeSprint.report?.hours ?? 0) * 10) / 10
  const sprintPct = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0
  const periodText = formatDateRange(activeSprint.start_date, activeSprint.end_date) ?? '-'
  const stateTone = sprintStateTone(activeSprint.state)

  const normalizedQuery = query.trim().toLowerCase()
  const filteredStories = stories.filter((story) => {
    const tasks = story.tasks ?? []
    if (onlyMine && !tasks.some((t) => t.assignee_id === assigneeId)) {
      return false
    }
    if (!normalizedQuery) return true
    if (
      story.key.toLowerCase().includes(normalizedQuery) ||
      story.title.toLowerCase().includes(normalizedQuery)
    ) {
      return true
    }
    return tasks.some(
      (t) =>
        t.key.toLowerCase().includes(normalizedQuery) ||
        t.title.toLowerCase().includes(normalizedQuery)
    )
  })

  return (
    <Stack gap="sm">
      <Select
        label="Select Sprint"
        options={sprintOptions}
        value={String(activeSprint.id)}
        disabled={loading}
        onChange={(value) => {
          const nextId = Number(value)
          if (!Number.isFinite(nextId)) return
          set(selectedSprintIdAtom, nextId)
          void loadSprintTickets(nextId)
        }}
      />

      <Box border={true} background="card" radius="md" padding="sm" gap="sm">
        <Row justify="between" align="center" wrap>
          <Heading level={3}>{activeSprint.name}</Heading>
          <Badge tone={stateTone}>{activeSprint.state.toUpperCase()}</Badge>
        </Row>

        <Text size="xs" muted>
          {activeSprint.category
            ? `${periodText} · ${activeSprint.category}`
            : periodText}
        </Text>

        <Progress label={`Sprint Progress (${sprintPct}%)`} value={sprintPct} />

        <Box columns={3} gap="xs">
          <Box border={true} background="muted" radius="sm" padding="xs" align="center">
            <Text weight="semibold" size="md">
              {String(totalStories)}
            </Text>
            <Text size="xs" muted>
              Stories
            </Text>
          </Box>
          <Box border={true} background="muted" radius="sm" padding="xs" align="center">
            <Text weight="semibold" size="md">
              {`${doneTasks}/${totalTasks}`}
            </Text>
            <Text size="xs" muted>
              Tasks Done
            </Text>
          </Box>
          <Box border={true} background="muted" radius="sm" padding="xs" align="center">
            <Text weight="semibold" size="md">
              {`${totalHours}h`}
            </Text>
            <Text size="xs" muted>
              Estimate
            </Text>
          </Box>
        </Box>

        {activeSprint.goal?.trim() ? (
          <Collapsible title="Sprint Goal">
            <Markdown content={activeSprint.goal.slice(0, 4000)} />
          </Collapsible>
        ) : null}
      </Box>

      <Input
        label="Search in sprint"
        labelHidden
        type="search"
        placeholder="Search story or task in sprint..."
        value={query}
        onChange={(value) => set(sprintSearchAtom, value)}
      />

      <Switch
        label="Only stories with my tasks"
        checked={onlyMine}
        onChange={(checked) => set(sprintOnlyMineAtom, checked)}
      />

      {error ? (
        <Callout tone="warning" title="Failed to load sprint" icon="warning">
          {error}
        </Callout>
      ) : null}

      {loading ? (
        <Row gap="sm" align="center">
          <Spinner label="Loading sprint items" />
          <Text muted size="sm">
            Fetching sprint stories and tasks...
          </Text>
        </Row>
      ) : filteredStories.length === 0 ? (
        <EmptyState
          title="No stories"
          description={
            onlyMine || normalizedQuery
              ? 'No stories match your filter in this sprint.'
              : 'No stories in this sprint yet.'
          }
          icon="calendar"
        />
      ) : (
        <Stack gap="xs">
          {filteredStories.slice(0, 40).map((story) => {
            const allStoryTasks = story.tasks ?? []
            const visibleTasks = onlyMine
              ? allStoryTasks.filter((t) => t.assignee_id === assigneeId)
              : allStoryTasks
            const doneCount = allStoryTasks.filter((t) => t.status === 'done').length
            const hasMine = allStoryTasks.some((t) => t.assignee_id === assigneeId)
            const storyTone = statusTone(story.status)
            const allDone = allStoryTasks.length > 0 && doneCount === allStoryTasks.length

            return (
              <Box key={story.key} border={true} background="card" radius="md" padding="xs" gap="xs">
                <Row gap="xs" align="center" wrap>
                  <Badge tone={storyTone}>{statusBadgeText(story.status)}</Badge>
                  <Badge tone={allDone ? 'success' : 'neutral'}>
                    {`${doneCount}/${allStoryTasks.length} Tasks Done`}
                  </Badge>
                  {typeof story.estimate === 'number' && story.estimate > 0 ? (
                    <Badge tone="neutral">{`${story.estimate}h`}</Badge>
                  ) : null}
                </Row>
                <Collapsible
                  title={`${story.key} · ${story.title.slice(0, 90)}`}
                  defaultOpen={hasMine}
                >
                  <Stack gap="xs">
                    <Button
                      size="xs"
                      variant="outline"
                      icon="info"
                      onPress={() => void openTicketDetail(story)}
                    >
                      {`Story Details (${story.key})`}
                    </Button>
                    {visibleTasks.length > 0 ? (
                      <Stack gap="xs">
                        {visibleTasks.map((t) => (
                          <TicketCard
                            key={t.key}
                            ticket={t}
                            busyAction={busyAction}
                            showAssignee
                          />
                        ))}
                      </Stack>
                    ) : (
                      <Text muted size="xs">
                        No tasks in this story yet.
                      </Text>
                    )}
                  </Stack>
                </Collapsible>
              </Box>
            )
          })}
        </Stack>
      )}
    </Stack>
  )
}

function BacklogView({
  products,
  selectedProductId,
  stories,
  loading,
  error,
  query
}: {
  products: readonly KerjanProductItem[]
  selectedProductId: number
  stories: readonly KerjanStoryItem[]
  loading: boolean
  error: string | null
  query: string
}) {
  const productMap = new Map<number, string>()
  for (const p of products) {
    productMap.set(p.id, p.name)
  }

  const productOptions = [
    { value: '0', label: 'All Products' },
    ...products.map((p) => ({ value: String(p.id), label: p.name }))
  ]

  const normalizedQuery = query.trim().toLowerCase()
  const filteredStories = stories.filter((story) => {
    if (!normalizedQuery) return true
    return (
      story.key.toLowerCase().includes(normalizedQuery) ||
      story.title.toLowerCase().includes(normalizedQuery)
    )
  })

  return (
    <Stack gap="sm">
      <Select
        label="Product Filter"
        options={productOptions}
        value={String(selectedProductId)}
        disabled={loading}
        onChange={(value) => {
          const nextProductId = Number(value)
          if (!Number.isFinite(nextProductId)) return
          set(selectedProductIdAtom, nextProductId)
          void loadBacklogTickets(nextProductId)
        }}
      />

      <Row gap="xs" align="center" justify="between">
        <Badge tone="neutral">{`${filteredStories.length} Backlog Stories`}</Badge>
        <Text muted size="xs">
          Unscheduled stories
        </Text>
      </Row>

      <Input
        label="Search backlog"
        labelHidden
        type="search"
        placeholder="Search story key or title..."
        value={query}
        onChange={(value) => set(backlogSearchAtom, value)}
      />

      {error ? (
        <Callout tone="warning" title="Failed to load backlog" icon="warning">
          {error}
        </Callout>
      ) : null}

      {loading ? (
        <Row gap="sm" align="center">
          <Spinner label="Loading backlog" />
          <Text muted size="sm">
            Fetching backlog stories...
          </Text>
        </Row>
      ) : filteredStories.length === 0 ? (
        <EmptyState
          title="Backlog is empty"
          description={
            normalizedQuery
              ? 'No backlog stories match your search.'
              : 'No backlog stories for this product filter.'
          }
          icon="layers"
        />
      ) : (
        <Stack gap="xs">
          {filteredStories.map((story) => {
            const productName =
              typeof story.product_id === 'number' ? productMap.get(story.product_id) : undefined
            const taskCount = story.tasks?.length ?? 0
            const storyTone = statusTone(story.status)

            return (
              <Box key={story.key} border={true} background="card" radius="md" padding="sm" gap="xs">
                <Row gap="xs" align="center" wrap>
                  <Button
                    size="xs"
                    variant="outline"
                    icon="layers"
                    onPress={() => void openTicketDetail(story)}
                  >
                    {story.key}
                  </Button>
                  <Badge tone={storyTone}>{statusBadgeText(story.status)}</Badge>
                  {productName ? <Badge tone="accent">{productName}</Badge> : null}
                  <Badge tone="neutral">{`${taskCount} ${taskCount === 1 ? 'Task' : 'Tasks'}`}</Badge>
                  {typeof story.estimate === 'number' && story.estimate > 0 ? (
                    <Badge tone="neutral">{`${story.estimate}h`}</Badge>
                  ) : null}
                </Row>
                <Text size="sm" weight="medium">
                  {story.title}
                </Text>
              </Box>
            )
          })}
        </Stack>
      )}
    </Stack>
  )
}

function TicketDetailView({
  ticket,
  detail,
  detailLoading,
  projects,
  selectedProjectId,
  commentDraft,
  busyAction
}: {
  ticket: KerjanTicket
  detail: KerjanTicketDetail | null
  detailLoading: boolean
  projects: readonly OrcaProjectItem[]
  selectedProjectId: string
  commentDraft: string
  busyAction: string | null
}) {
  const activeTicket = detail?.ticket ?? ticket
  const isBusy = busyAction !== null
  const isTask = activeTicket.kind === 'task'
  const tone = statusTone(activeTicket.status)
  const storyTasks =
    detail?.story?.tasks ?? (activeTicket as KerjanStoryItem).tasks ?? ([] as KerjanTicket[])
  const projectOptions =
    projects.length > 0
      ? projects.map((p) => ({ value: p.id, label: p.name }))
      : [{ value: '__none__', label: 'No Git repositories in Orca', disabled: true }]

  const descriptionText = activeTicket.description?.trim()
    ? activeTicket.description.slice(0, 12000)
    : '*No description provided for this ticket.*'

  const webOrigin = resolveWebOrigin(read(dashboardAtom)?.config?.apiUrl)
  const currentUserId = read(dashboardAtom)?.assigneeId ?? 0

  return (
    <Stack gap="md">
      <Row justify="between" align="center">
        <Button
          size="xs"
          variant="ghost"
          icon="close"
          onPress={() => {
            set(selectedTicketAtom, null)
            set(ticketDetailAtom, null)
            set(feedbackAtom, null)
          }}
        >
          Back
        </Button>
        {webOrigin ? (
          <Button
            size="xs"
            variant="ghost"
            icon="open-external"
            onPress={() => void shell.openExternal(webOrigin)}
          >
            Open Web
          </Button>
        ) : null}
      </Row>

      <Box border={true} background="card" radius="md" padding="sm" gap="sm">
        <Row gap="xs" align="center" wrap>
          <Badge tone={tone}>{statusBadgeText(activeTicket.status)}</Badge>
          <Badge tone={taskTypeTone(activeTicket.task_type, activeTicket.severity)}>
            {(activeTicket.task_type ?? activeTicket.kind ?? 'TASK').toUpperCase()}
          </Badge>
          {typeof activeTicket.estimate === 'number' && activeTicket.estimate > 0 ? (
            <Badge tone="neutral">{`${activeTicket.estimate}h`}</Badge>
          ) : null}
          <Badge tone="neutral">
            {ticket.sprint_name ??
              (activeTicket.sprint_id ? `Sprint #${activeTicket.sprint_id}` : 'Backlog')}
          </Badge>
          {activeTicket.assignee_name ? (
            <Badge tone={assigneeTone(activeTicket.assignee_id, currentUserId)}>
              {activeTicket.assignee_name}
            </Badge>
          ) : null}
        </Row>

        <Heading level={3}>{`${activeTicket.key} · ${activeTicket.title.slice(0, 200)}`}</Heading>

        {detail?.story && activeTicket.kind !== 'story' ? (
          <Text size="xs" muted>
            Story <Code>{detail.story.key}</Code> · {detail.story.title}
          </Text>
        ) : activeTicket.story_key ? (
          <Text size="xs" muted>
            Story <Code>{activeTicket.story_key}</Code> · {activeTicket.story_title ?? ''}
          </Text>
        ) : null}

        {isTask ? (
          <Row gap="xs" wrap>
            {activeTicket.status !== 'in_progress' && activeTicket.status !== 'done' ? (
              <Button
                size="xs"
                tone="accent"
                icon="play"
                disabled={isBusy}
                onPress={() => void moveTicketStatus(activeTicket.key, 'in_progress')}
              >
                Start (In Progress)
              </Button>
            ) : null}
            {activeTicket.status !== 'done' ? (
              <Button
                size="xs"
                tone="success"
                icon="check"
                disabled={isBusy}
                onPress={() => void moveTicketStatus(activeTicket.key, 'done')}
              >
                Mark Done
              </Button>
            ) : null}
            {activeTicket.status === 'in_progress' ? (
              <Button
                size="xs"
                variant="outline"
                icon="flag"
                disabled={isBusy}
                onPress={() => void moveTicketStatus(activeTicket.key, 'todo')}
              >
                Move to To Do
              </Button>
            ) : null}
          </Row>
        ) : (
          <Text muted size="xs">
            Story status is computed automatically from its tasks.
          </Text>
        )}
      </Box>

      {storyTasks.length > 0 ? (
        <Collapsible
          title={`Story Tasks (${storyTasks.length})`}
          defaultOpen={activeTicket.kind === 'story'}
        >
          <Stack gap="xs">
            {storyTasks.map((t) => (
              <Box
                key={t.key}
                border={true}
                background="card"
                radius="sm"
                padding="xs"
                gap="xs"
              >
                <Row gap="xs" align="center" wrap>
                  <Button
                    size="xs"
                    variant="outline"
                    icon={ticketIcon(t)}
                    onPress={() => void openTicketDetail(t)}
                  >
                    {t.key}
                  </Button>
                  <Badge tone={statusTone(t.status)}>{statusBadgeText(t.status)}</Badge>
                  {t.task_type ? (
                    <Badge tone={taskTypeTone(t.task_type, t.severity)}>
                      {t.task_type.toUpperCase()}
                    </Badge>
                  ) : null}
                  {typeof t.estimate === 'number' && t.estimate > 0 ? (
                    <Badge tone="neutral">{`${t.estimate}h`}</Badge>
                  ) : null}
                  {t.assignee_name ? (
                    <Badge tone={assigneeTone(t.assignee_id, currentUserId)}>
                      {t.assignee_name}
                    </Badge>
                  ) : null}
                </Row>
                <Text size="xs" weight="medium">
                  {t.title}
                </Text>
              </Box>
            ))}
          </Stack>
        </Collapsible>
      ) : null}

      <Card
        title="Create Worktree in Orca"
        description="Create a new feature branch worktree from this ticket."
      >
        <Stack gap="sm">
          <Select
            label="Target Repository"
            options={projectOptions}
            value={selectedProjectId || projectOptions[0].value}
            disabled={projects.length === 0 || isBusy}
            onChange={(value) => set(selectedProjectAtom, value)}
          />
          <Button
            size="sm"
            variant="outline"
            icon="branch"
            disabled={projects.length === 0 || isBusy}
            onPress={() => void createWorktreeFromTicket(activeTicket)}
          >
            {busyAction === 'worktree' ? 'Creating Worktree...' : 'Create Worktree'}
          </Button>
        </Stack>
      </Card>

      <Card title="Description & Comments">
        {detailLoading ? (
          <Row gap="sm" align="center">
            <Spinner label="Loading ticket details" />
            <Text muted size="sm">
              Fetching details from Kerjan...
            </Text>
          </Row>
        ) : (
          <Stack gap="sm">
            {detail?.error ? (
              <Callout tone="warning" title="Failed to load details" icon="warning">
                {detail.error}
              </Callout>
            ) : null}
            <Markdown content={descriptionText} />
            <Separator />
            <Heading level={3}>{`Comments (${detail?.comments.length ?? 0})`}</Heading>
            {detail?.comments.length ? (
              <Stack gap="xs">
                {detail.comments.slice(-5).map((c, idx) => (
                  <Card
                    key={c.id ?? idx}
                    title={c.author_name ?? `Member #${c.author_id ?? '-'}`}
                    description={
                      c.created_at ? c.created_at.slice(0, 16).replace('T', ' ') : undefined
                    }
                  >
                    <Markdown content={c.body.slice(0, 4000)} />
                  </Card>
                ))}
              </Stack>
            ) : (
              <Text muted size="xs">
                No comments yet.
              </Text>
            )}
            <Textarea
              label="Add Comment"
              placeholder={`Write a comment for ${activeTicket.key}...`}
              rows={3}
              value={commentDraft}
              disabled={isBusy}
              onChange={(value) => set(commentDraftAtom, value)}
              onSubmit={() => void submitComment(activeTicket.key)}
            />
            <Button
              size="sm"
              icon="add"
              disabled={!commentDraft.trim() || isBusy}
              onPress={() => void submitComment(activeTicket.key)}
            >
              {busyAction === 'comment' ? 'Posting...' : 'Post Comment'}
            </Button>
          </Stack>
        )}
      </Card>
    </Stack>
  )
}

function resolveWebOrigin(apiUrl?: string): string | null {
  if (!apiUrl) return null
  try {
    return new URL(apiUrl).origin
  } catch {
    return null
  }
}

function SettingsView({
  data,
  configUrl,
  configToken,
  busyAction,
  canCancel
}: {
  data: KerjanDashboardData | null
  configUrl: string
  configToken: string
  busyAction: string | null
  canCancel: boolean
}) {
  const isSaving = busyAction === 'saveConfig'
  const isClearing = busyAction === 'clearConfig'
  const isBusy = isSaving || isClearing
  const hasToken = Boolean(data?.config?.hasToken)
  const tokenPreview = data?.config?.tokenPreview ?? ''

  return (
    <Stack gap="md">
      {data?.needsSetup ? (
        <Callout tone="accent" title="Welcome to Kerjan for Orca" icon="info">
          Enter your Kerjan MCP URL and API Key to get started. Workspace and Member ID are
          detected automatically from your API Key.
        </Callout>
      ) : null}

      <Box border={true} background="card" radius="md" padding="sm" gap="sm">
        <Row justify="between" align="center" wrap>
          <Heading level={3}>{data?.needsSetup ? 'Initial Setup' : 'Connection Settings'}</Heading>
          <Badge tone={hasToken ? 'success' : 'warning'}>
            {hasToken ? 'Connected' : 'Setup Required'}
          </Badge>
        </Row>

        <Input
          label="Kerjan MCP URL"
          placeholder="https://your-kerjan-host/api/v1/mcp"
          value={configUrl}
          disabled={isBusy}
          onChange={(value) => set(configUrlAtom, value)}
          onSubmit={() => void submitConfig()}
        />

        <Input
          label="API Key / MCP Token"
          type="password"
          placeholder={
            hasToken
              ? `Saved (${tokenPreview}) — enter new key to replace`
              : 'Paste your kjp_... token'
          }
          value={configToken}
          disabled={isBusy}
          onChange={(value) => set(configTokenAtom, value)}
          onSubmit={() => void submitConfig()}
        />

        {hasToken && tokenPreview ? (
          <Text size="xs" muted>
            Active token: <Code>{tokenPreview}</Code> (leave blank to keep current key)
          </Text>
        ) : null}

        <Row gap="xs" justify="between" align="center" wrap>
          {canCancel ? (
            <Button
              size="sm"
              tone="danger"
              variant="outline"
              icon="delete"
              disabled={isBusy}
              onPress={() => void disconnectConfig()}
            >
              {isClearing ? 'Disconnecting...' : 'Disconnect'}
            </Button>
          ) : (
            <Box />
          )}
          <Row gap="xs" wrap>
            {canCancel ? (
              <Button
                size="sm"
                variant="ghost"
                icon="close"
                disabled={isBusy}
                onPress={() => set(showSettingsAtom, false)}
              >
                Cancel
              </Button>
            ) : null}
            <Button
              size="sm"
              tone="accent"
              icon="check"
              disabled={isBusy}
              onPress={() => void submitConfig()}
            >
              {isSaving ? 'Connecting...' : 'Save & Connect'}
            </Button>
          </Row>
        </Row>
      </Box>
    </Stack>
  )
}

export function setup(ctx: PanelContext): void {
  activeSignal = ctx.signal
  set(showSettingsAtom, false)
  ctx.subscriptions.push(
    plugin.on('kerjan.refreshed', (data) => {
      if (isAborted()) return
      const prevNeedsSetup = Boolean(read(dashboardAtom)?.needsSetup)
      set(dashboardAtom, data)
      set(loadingAtom, false)
      if (data.needsSetup) {
        populateConfigForm(data)
      } else if (prevNeedsSetup) {
        set(showSettingsAtom, false)
        populateConfigForm(data)
      }
      syncProjectSelection(data, read(selectedTicketAtom))
      resolveSprintSelection(data)
      resolveProductSelection(data)
    })
  )
  void refreshDashboard(false)
}

export default function Panel() {
  const data = read(dashboardAtom)
  const loading = read(loadingAtom)
  const viewMode = read(viewModeAtom)
  const query = read(searchAtom)
  const tab = read(statusTabAtom)
  const selectedTicket = read(selectedTicketAtom)
  const detail = read(ticketDetailAtom)
  const detailLoading = read(detailLoadingAtom)
  const selectedProjectId = read(selectedProjectAtom)
  const commentDraft = read(commentDraftAtom)
  const busyAction = read(busyActionAtom)
  const feedback = read(feedbackAtom)

  const selectedSprintId = read(selectedSprintIdAtom)
  const sprintStories = read(sprintStoriesAtom)
  const sprintLoading = read(sprintLoadingAtom)
  const sprintError = read(sprintErrorAtom)
  const sprintQuery = read(sprintSearchAtom)
  const onlyMine = read(sprintOnlyMineAtom)

  const selectedProductId = read(selectedProductIdAtom)
  const backlogStories = read(backlogStoriesAtom)
  const backlogLoading = read(backlogLoadingAtom)
  const backlogError = read(backlogErrorAtom)
  const backlogQuery = read(backlogSearchAtom)

  const showSettings = read(showSettingsAtom)
  const configUrl = read(configUrlAtom)
  const configToken = read(configTokenAtom)

  const isInitialLoading = loading && data === null
  const isSettingsOpen = showSettings || Boolean(data?.needsSetup)
  const showDashboardChrome = data !== null && !data.needsSetup && !isSettingsOpen
  const tickets = data?.tickets ?? []
  const counts = data?.counts ?? { inProgress: 0, todo: 0, done: 0 }
  const totalTickets = counts.inProgress + counts.todo + counts.done
  const donePct = totalTickets > 0 ? Math.round((counts.done / totalTickets) * 100) : 0

  return (
    <Stack gap="md">
      <Row justify="between" align="center">
        <Row gap="xs" align="center">
          <Box width={22} height={22} shrink={false}>
            <Image src="assets/kerjan-logo.png" alt="Kerjan" size="full" fit="contain" rounded />
          </Box>
          <Heading level={2}>Kerjan</Heading>
          {showDashboardChrome ? (
            <Badge tone="accent">{data.workspaceCode}</Badge>
          ) : null}
          {showDashboardChrome && data.fromCache ? <Badge tone="warning">Cached</Badge> : null}
        </Row>
        {showDashboardChrome ? (
          <Row gap="xs" align="center">
            <Button
              size="xs"
              variant="ghost"
              icon="refresh"
              disabled={loading || sprintLoading || backlogLoading}
              onPress={() => void refreshDashboard(true)}
            >
              Refresh
            </Button>
            <IconButton
              icon="settings"
              label="Settings"
              tooltip="Connection Settings (API Key & URL)"
              size="xs"
              variant="ghost"
              tone="neutral"
              onPress={() => toggleSettingsView()}
            />
          </Row>
        ) : data !== null && !data.needsSetup ? (
          <IconButton
            icon="settings"
            label="Settings"
            tooltip="Connection Settings (API Key & URL)"
            size="xs"
            variant={isSettingsOpen ? 'solid' : 'ghost'}
            tone={isSettingsOpen ? 'accent' : 'neutral'}
            onPress={() => toggleSettingsView()}
          />
        ) : null}
      </Row>

      {showDashboardChrome ? (
        <>
          <Box columns={3} gap="xs">
            <Box border={true} background="card" radius="md" padding="xs" align="center">
              <Text weight="semibold" size="md" tone="accent">
                {String(counts.inProgress)}
              </Text>
              <Text size="xs" muted>
                In Progress
              </Text>
            </Box>
            <Box border={true} background="card" radius="md" padding="xs" align="center">
              <Text weight="semibold" size="md" tone="warning">
                {String(counts.todo)}
              </Text>
              <Text size="xs" muted>
                To Do
              </Text>
            </Box>
            <Box border={true} background="card" radius="md" padding="xs" align="center">
              <Text weight="semibold" size="md" tone="success">
                {String(counts.done)}
              </Text>
              <Text size="xs" muted>
                Done
              </Text>
            </Box>
          </Box>

          <Progress label={`Task Completion (${donePct}%)`} value={donePct} />

          <Row gap="xs" wrap>
            <Button
              size="xs"
              icon="check"
              variant={viewMode === 'tasks' ? 'solid' : 'outline'}
              tone={viewMode === 'tasks' ? 'accent' : 'neutral'}
              onPress={() => switchViewMode('tasks')}
            >
              My Tasks
            </Button>
            <Button
              size="xs"
              icon="calendar"
              variant={viewMode === 'sprints' ? 'solid' : 'outline'}
              tone={viewMode === 'sprints' ? 'accent' : 'neutral'}
              onPress={() => switchViewMode('sprints')}
            >
              Sprints
            </Button>
            <Button
              size="xs"
              icon="layers"
              variant={viewMode === 'backlog' ? 'solid' : 'outline'}
              tone={viewMode === 'backlog' ? 'accent' : 'neutral'}
              onPress={() => switchViewMode('backlog')}
            >
              Backlog
            </Button>
          </Row>
        </>
      ) : null}

      {data?.error ? (
        <Callout tone="warning" title="Kerjan connection issue" icon="warning">
          {data.error}
        </Callout>
      ) : null}

      {feedback ? (
        <Callout tone={feedback.tone} title={feedback.title}>
          {feedback.message}
        </Callout>
      ) : null}

      {isInitialLoading ? (
        <Row gap="sm" align="center">
          <Spinner label="Loading Kerjan" />
          <Text muted size="sm">
            Connecting to Kerjan...
          </Text>
        </Row>
      ) : isSettingsOpen ? (
        <SettingsView
          data={data}
          configUrl={configUrl}
          configToken={configToken}
          busyAction={busyAction}
          canCancel={!data?.needsSetup}
        />
      ) : selectedTicket ? (
        <TicketDetailView
          ticket={selectedTicket}
          detail={detail}
          detailLoading={detailLoading}
          projects={data?.projects ?? []}
          selectedProjectId={selectedProjectId}
          commentDraft={commentDraft}
          busyAction={busyAction}
        />
      ) : viewMode === 'sprints' ? (
        <SprintView
          sprints={data?.sprints ?? []}
          selectedSprintId={selectedSprintId}
          stories={sprintStories}
          loading={sprintLoading}
          error={sprintError}
          query={sprintQuery}
          onlyMine={onlyMine}
          assigneeId={data?.assigneeId ?? 0}
          busyAction={busyAction}
        />
      ) : viewMode === 'backlog' ? (
        <BacklogView
          products={data?.products ?? []}
          selectedProductId={selectedProductId}
          stories={backlogStories}
          loading={backlogLoading}
          error={backlogError}
          query={backlogQuery}
        />
      ) : (
        <Stack gap="sm">
          <Input
            label="Search tickets"
            labelHidden
            type="search"
            placeholder="Search key, title, or story..."
            value={query}
            onChange={(value) => set(searchAtom, value)}
          />
          <Tabs label="Status Filter" value={tab} onChange={(value) => set(statusTabAtom, value)}>
            <Tab value="active" label={`Active (${counts.inProgress + counts.todo})`}>
              <TicketListView
                tickets={tickets}
                tab="active"
                query={query}
                loading={loading}
                busyAction={busyAction}
              />
            </Tab>
            <Tab value="in_progress" label={`WIP (${counts.inProgress})`}>
              <TicketListView
                tickets={tickets}
                tab="in_progress"
                query={query}
                loading={loading}
                busyAction={busyAction}
              />
            </Tab>
            <Tab value="todo" label={`To Do (${counts.todo})`}>
              <TicketListView
                tickets={tickets}
                tab="todo"
                query={query}
                loading={loading}
                busyAction={busyAction}
              />
            </Tab>
            <Tab value="done" label={`Done (${counts.done})`}>
              <TicketListView
                tickets={tickets}
                tab="done"
                query={query}
                loading={loading}
                busyAction={busyAction}
              />
            </Tab>
          </Tabs>
        </Stack>
      )}
    </Stack>
  )
}
