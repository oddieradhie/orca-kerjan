import { afterEach, assert, mockHost, mountWorker, test, type TestWorker } from 'orca/testing'
import * as main from './worker'

const originalFetch = globalThis.fetch
let activeWorker: TestWorker | undefined

afterEach(async () => {
  globalThis.fetch = originalFetch
  await activeWorker?.deactivate()
  activeWorker = undefined
})

test('creates a worktree from a Kerjan ticket without refusals', async () => {
  const host = mockHost({
    results: {
      'workspace.create': { workspaceId: 'repo-1::/tmp/wt-prd-2476' },
      'workspace.open': { opened: true },
      'notifications.show': { delivered: true }
    }
  })

  activeWorker = await mountWorker(main, { host })
  const res = await activeWorker.request('kerjan.createWorktree', {
    ticketKey: 'PRD-2476',
    ticketTitle: '[BE] [E2E] E2E dev full flow PDS!',
    projectId: 'git:github.com/example/cpaas-voice',
    hostId: 'local'
  })

  assert.equal(res.ok, true)
  assert.equal(res.workspaceId, 'repo-1::/tmp/wt-prd-2476')
  assert.equal(res.branch, 'feature/prd-2476-be-e2e-e2e-dev-full-flow-pds')
  assert.deepEqual(host.callsOf('workspace.create'), [
    {
      projectId: 'git:github.com/example/cpaas-voice',
      hostId: 'local',
      name: 'feature/prd-2476-be-e2e-e2e-dev-full-flow-pds',
      open: true
    }
  ])
  assert.deepEqual(host.callsOf('workspace.open'), [
    { workspaceId: 'repo-1::/tmp/wt-prd-2476' }
  ])
  assert.deepEqual(activeWorker.refusals, [])
})

test('fetches dashboard, sprints, products, sprintTickets, and backlogTickets cleanly', async () => {
  const seenCalls: Array<{ name: string; args: Record<string, unknown> }> = []

  globalThis.fetch = (async (_url: unknown, init?: { body?: unknown }) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as {
      params?: { name?: string; arguments?: Record<string, unknown> }
    }
    const toolName = body.params?.name ?? ''
    const args = body.params?.arguments ?? {}
    seenCalls.push({ name: toolName, args })

    let payload: unknown = []
    if (toolName === 'list_tickets' && typeof args.sprint_id === 'number') {
      payload = [
        {
          id: 6559,
          key: 'PRD-2407',
          kind: 'story',
          title: 'Integrasi OmniX PBX',
          status: 'in_progress',
          sprint_id: 107,
          canceled_at: null,
          tasks: [
            {
              id: 6628,
              key: 'PRD-2476',
              kind: 'task',
              title: '[BE] E2E PDS',
              status: 'todo',
              canceled_at: null
            },
            {
              id: 6629,
              key: 'PRD-2477',
              kind: 'task',
              title: 'Canceled task',
              status: 'todo',
              canceled_at: '2026-11-05T00:00:00Z'
            }
          ]
        },
        {
          id: 6560,
          key: 'PRD-2408',
          kind: 'story',
          title: 'Canceled story',
          status: 'canceled',
          canceled_at: '2026-11-05T00:00:00Z',
          tasks: []
        }
      ]
    } else if (toolName === 'list_tickets' && args.backlog === true) {
      payload = [
        {
          id: 6384,
          key: 'PRD-2232',
          kind: 'story',
          title: 'AI Report Generator',
          status: 'todo',
          product_id: 24,
          canceled_at: null,
          tasks: []
        },
        {
          id: 4043,
          key: 'PRD-16',
          kind: 'story',
          title: 'Merged story',
          status: 'canceled',
          canceled_at: '2026-09-25T06:40:15Z',
          tasks: []
        }
      ]
    } else if (toolName === 'list_tickets') {
      payload = [
        {
          id: 6628,
          key: 'PRD-2476',
          kind: 'task',
          title: '[BE] E2E PDS',
          status: 'todo',
          sprint_id: 107,
          canceled_at: null
        },
        {
          id: 5308,
          key: 'PRD-1178',
          kind: 'task',
          title: 'Canceled task',
          status: 'todo',
          sprint_id: 107,
          canceled_at: '2026-10-05T02:38:17Z'
        }
      ]
    } else if (toolName === 'list_workspaces') {
      payload = [{ id: 1, code: 'PRD', name: 'Product Development' }]
    } else if (toolName === 'whoami') {
      payload = { id: 35, name: 'Fathur Radhie' }
    } else if (toolName === 'list_sprints') {
      payload = [
        { id: 95, name: 'CRM - CPAAS - SPRINT 6', state: 'closed' },
        { id: 111, name: 'Remediasi Pentest', state: 'active' },
        { id: 107, name: 'CRM - CPAAS - SPRINT 7', state: 'active' }
      ]
    } else if (toolName === 'list_products') {
      payload = [
        { id: 22, name: 'OmniX' },
        { id: 24, name: 'CPaaS - Omnix PBX' }
      ]
    }

    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        result: {
          content: [{ type: 'text', text: JSON.stringify(payload) }]
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }) as typeof fetch

  const host = mockHost({
    settings: {
      apiUrl: 'https://kerjan.example.dev/api/v1/mcp',
      apiToken: 'test-token'
    },
    results: {
      'project.list': {
        projects: [
          {
            id: 'git:github.com/example/cpaas-voice',
            name: 'cpaas-voice',
            kind: 'git',
            hostId: 'local',
            path: '/tmp/cpaas-voice'
          }
        ],
        truncated: false
      },
      'statusBar.update': { ok: true }
    }
  })

  activeWorker = await mountWorker(main, { host })

  const data = await activeWorker.request('kerjan.dashboard', { force: true })
  assert.equal(data.tickets.length, 1)
  assert.equal(data.tickets[0].key, 'PRD-2476')
  assert.equal(data.tickets[0].sprint_name, 'CRM - CPAAS - SPRINT 7')
  assert.equal(data.defaultSprintId, 107)
  assert.equal(data.defaultProductId, 24)
  assert.equal(data.sprints?.length, 3)
  assert.equal(data.sprints?.[0].state, 'active')
  assert.equal(data.products?.length, 2)
  assert.deepEqual(data.counts, { inProgress: 0, todo: 1, done: 0 })

  const sprintRes = await activeWorker.request('kerjan.sprintTickets', { sprintId: 107 })
  assert.equal(sprintRes.sprintId, 107)
  assert.equal(sprintRes.stories.length, 1)
  assert.equal(sprintRes.stories[0].key, 'PRD-2407')
  assert.equal(sprintRes.stories[0].tasks?.length, 1)
  assert.equal(sprintRes.stories[0].tasks?.[0].key, 'PRD-2476')

  const backlogRes = await activeWorker.request('kerjan.backlogTickets', { productId: 24 })
  assert.equal(backlogRes.stories.length, 1)
  assert.equal(backlogRes.stories[0].key, 'PRD-2232')
  assert.ok(
    seenCalls.some(
      (c) =>
        c.name === 'list_tickets' &&
        c.args.backlog === true &&
        c.args.kind === 'story' &&
        c.args.product_id === 24
    )
  )

  assert.deepEqual(activeWorker.refusals, [])
})

test('returns needsSetup when unconfigured and persists credentials cleanly via saveConfig', async () => {
  let fetchCalls = 0
  const seenAuthHeaders: string[] = []

  globalThis.fetch = (async (_url: unknown, init?: { headers?: unknown; body?: unknown }) => {
    fetchCalls += 1
    const headers = (init?.headers ?? {}) as Record<string, string>
    if (headers.Authorization) {
      seenAuthHeaders.push(headers.Authorization)
    }
    const body = JSON.parse(String(init?.body ?? '{}')) as {
      params?: { name?: string; arguments?: Record<string, unknown> }
    }
    const toolName = body.params?.name ?? ''

    let payload: unknown = []
    if (toolName === 'whoami') {
      payload = { id: 35, name: 'Fathur Radhie' }
    } else if (toolName === 'list_workspaces') {
      payload = [{ id: 1, code: 'PRD', name: 'Product Development' }]
    } else if (toolName === 'list_tickets') {
      payload = [
        {
          id: 6628,
          key: 'PRD-2476',
          kind: 'task',
          title: '[BE] E2E PDS',
          status: 'in_progress',
          sprint_id: 107,
          canceled_at: null
        }
      ]
    } else if (toolName === 'list_sprints') {
      payload = [{ id: 107, name: 'CRM - CPAAS - SPRINT 7', state: 'active' }]
    } else if (toolName === 'list_products') {
      payload = [{ id: 24, name: 'CPaaS - Omnix PBX' }]
    } else if (toolName === 'list_members') {
      payload = [{ id: 35, name: 'Fathur Radhie' }]
    }

    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        result: {
          content: [{ type: 'text', text: JSON.stringify(payload) }]
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }) as typeof fetch

  const host = mockHost({
    results: {
      'statusBar.update': { ok: true }
    }
  })

  activeWorker = await mountWorker(main, { host })

  const setupRes = await activeWorker.request('kerjan.dashboard', { force: true })
  assert.equal(setupRes.needsSetup, true)
  assert.equal(setupRes.config?.hasToken, false)
  assert.equal(setupRes.tickets.length, 0)
  assert.equal(fetchCalls, 0)

  const saveRes = await activeWorker.request('kerjan.saveConfig', {
    apiUrl: 'https://kerjan.example.dev/api/v1/mcp',
    apiToken: 'kjp_test_token_123456'
  })

  assert.equal(saveRes.ok, true)
  assert.equal(saveRes.userName, 'Fathur Radhie')
  assert.equal(saveRes.userId, 35)
  assert.equal(saveRes.dashboard?.needsSetup, false)
  assert.equal(saveRes.dashboard?.config?.hasToken, true)
  assert.equal(saveRes.dashboard?.workspaceCode, 'PRD')
  assert.equal(saveRes.dashboard?.assigneeId, 35)
  assert.equal(saveRes.dashboard?.tickets.length, 1)
  assert.equal(host.data().secrets.apiToken, 'kjp_test_token_123456')
  assert.equal(host.data().settings.apiUrl, 'https://kerjan.example.dev/api/v1/mcp')
  assert.ok(seenAuthHeaders.every((h) => h === 'Bearer kjp_test_token_123456'))

  const clearRes = await activeWorker.request('kerjan.clearConfig', {})
  assert.equal(clearRes.ok, true)
  assert.equal(clearRes.dashboard.needsSetup, true)
  assert.equal(clearRes.dashboard.config?.hasToken, false)
  assert.equal(host.data().secrets.apiToken, undefined)

  assert.deepEqual(activeWorker.refusals, [])
})
