export type KerjanTicket = {
  id: number
  key: string
  workspace_id?: number
  kind: string
  title: string
  status: string
  sprint_id?: number | null
  sprint_name?: string
  story_id?: number | null
  story_key?: string | null
  story_title?: string | null
  task_type?: string | null
  assignee_id?: number | null
  assignee_name?: string | null
  estimate?: number | null
  done_at?: string | null
  canceled_at?: string | null
  created_at?: string | null
  severity?: string | null
  description?: string | null
}

export type KerjanComment = {
  id?: number
  body: string
  author_id?: number
  author_name?: string
  created_at?: string
}

export type KerjanStorySummary = {
  id: number
  key: string
  title: string
  status: string
  tasks?: KerjanTicket[]
}

export type KerjanSprintReport = {
  stories: number
  stories_done: number
  tasks: number
  tasks_done: number
  hours: number
  hours_done: number
}

export type KerjanSprintItem = {
  id: number
  name: string
  state: string
  category?: string
  goal?: string
  start_date?: string | null
  end_date?: string | null
  report?: KerjanSprintReport | null
}

export type KerjanProductItem = {
  id: number
  name: string
}

export type KerjanEpicItem = {
  id: number
  key: string
  title: string
  product_id?: number | null
}

export type KerjanMemberItem = {
  id: number
  name: string
}

export type KerjanStoryItem = KerjanTicket & {
  product_id?: number | null
  product_name?: string
  epic_id?: number | null
  tasks?: KerjanTicket[]
}

export type KerjanTicketDetail = {
  ticket: KerjanTicket
  story?: KerjanStorySummary | null
  comments: KerjanComment[]
  error?: string
}

export type OrcaProjectItem = {
  id: string
  name: string
  hostId: string | null
  path: string
}

export type KerjanClientConfigSummary = {
  apiUrl: string
  hasToken: boolean
  tokenPreview: string
}

export type KerjanDashboardData = {
  tickets: KerjanTicket[]
  projects: OrcaProjectItem[]
  sprints?: KerjanSprintItem[]
  products?: KerjanProductItem[]
  defaultSprintId?: number | null
  defaultProductId?: number | null
  workspaceCode: string
  assigneeId: number
  counts: {
    inProgress: number
    todo: number
    done: number
  }
  fetchedAt: number
  fromCache?: boolean
  needsSetup?: boolean
  config?: KerjanClientConfigSummary
  error?: string
  currentVersion?: string
  latestVersion?: string
  hasUpdate?: boolean
}

declare module 'orca' {
  interface PluginRequests {
    'kerjan.dashboard': { input: { force?: boolean } | undefined; output: KerjanDashboardData }
    'kerjan.saveConfig': {
      input: {
        apiUrl: string
        apiToken?: string
      }
      output: {
        ok: boolean
        error?: string
        userName?: string
        userId?: number
        dashboard?: KerjanDashboardData
      }
    }
    'kerjan.clearConfig': {
      input: Record<string, never> | undefined
      output: { ok: boolean; dashboard: KerjanDashboardData }
    }
    'kerjan.detail': { input: { key: string }; output: KerjanTicketDetail }
    'kerjan.sprintTickets': {
      input: { sprintId: number }
      output: { sprintId: number; stories: KerjanStoryItem[]; error?: string }
    }
    'kerjan.backlogTickets': {
      input: { productId?: number | null } | undefined
      output: { stories: KerjanStoryItem[]; error?: string }
    }
    'kerjan.moveTask': {
      input: { key: string; status: string; comment?: string }
      output: { ok: boolean; error?: string }
    }
    'kerjan.addComment': {
      input: { key: string; body: string }
      output: { ok: boolean; error?: string }
    }
    'kerjan.createWorktree': {
      input: {
        ticketKey: string
        ticketTitle: string
        projectId: string
        hostId?: string | null
      }
      output: { ok: boolean; workspaceId?: string; branch?: string; error?: string }
    }
    'kerjan.epics': {
      input: { productId?: number | null } | undefined
      output: { epics: KerjanEpicItem[]; error?: string }
    }
    'kerjan.members': {
      input: Record<string, never> | undefined
      output: { members: KerjanMemberItem[]; error?: string }
    }
    'kerjan.createStory': {
      input: {
        epicId: number
        title: string
        description?: string
        sprintId?: number | null
      }
      output: { ok: boolean; key?: string; error?: string }
    }
    'kerjan.addTask': {
      input: {
        storyKey: string
        type: string
        title: string
        estimate?: number | null
        assigneeId?: number | null
        description?: string
      }
      output: { ok: boolean; key?: string; error?: string }
    }
    'kerjan.updateTask': {
      input: {
        key: string
        title?: string
        description?: string
        estimate?: number | null
        assigneeId?: number | null
      }
      output: { ok: boolean; error?: string }
    }
  }
  interface PluginPanelEvents {
    'kerjan.refreshed': KerjanDashboardData
  }
}
