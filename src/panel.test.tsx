import { afterEach, assert, mockHost, mount, test, type TestPanel } from 'orca/testing'
import * as panel from './panel'
import type { KerjanTicket } from './protocol'

let view: TestPanel | undefined

afterEach(async () => {
  await view?.unmount()
  view = undefined
})

test('filters tickets, opens detail, and updates status without refusals', async () => {
  let tickets: KerjanTicket[] = [
    {
      id: 6628,
      key: 'PRD-2476',
      kind: 'task',
      title: '[BE] [cpaas-voice] E2E dev full flow PDS',
      status: 'in_progress',
      sprint_id: 107,
      sprint_name: 'CRM - CPAAS - SPRINT 7',
      story_key: 'PRD-2407',
      story_title: 'Integrasi OmniX PBX',
      task_type: 'dev',
      estimate: 5
    },
    {
      id: 6646,
      key: 'PRD-2494',
      kind: 'task',
      title: '[FE] [internal-app] Softphone screen-pop',
      status: 'todo',
      sprint_id: 107,
      sprint_name: 'CRM - CPAAS - SPRINT 7',
      story_key: 'PRD-2407',
      task_type: 'dev',
      estimate: 3
    }
  ]

  let movedCall: { key: string; status: string } | null = null
  let commentCall: { key: string; body: string } | null = null

  const host = mockHost({
    requests: {
      'kerjan.dashboard': () => ({
        tickets,
        projects: [
          {
            id: 'git:github.com/example/cpaas-voice',
            name: 'cpaas-voice',
            hostId: 'local',
            path: '/tmp/cpaas-voice'
          }
        ],
        sprints: [],
        products: [],
        defaultSprintId: null,
        defaultProductId: null,
        workspaceCode: 'PRD',
        assigneeId: 35,
        counts: {
          inProgress: tickets.filter((t) => t.status === 'in_progress').length,
          todo: tickets.filter((t) => t.status === 'todo').length,
          done: tickets.filter((t) => t.status === 'done').length
        },
        fetchedAt: 1000
      }),
      'kerjan.detail': ({ key }) => {
        const found = tickets.find((t) => t.key === key) ?? tickets[0]
        return {
          ticket: { ...found, description: 'Detail checklist E2E PDS.' },
          story: { id: 6559, key: 'PRD-2407', title: 'Integrasi OmniX PBX', status: 'in_progress' },
          comments: []
        }
      },
      'kerjan.moveTask': ({ key, status }) => {
        movedCall = { key, status }
        tickets = tickets.map((t) => (t.key === key ? { ...t, status } : t))
        return { ok: true }
      },
      'kerjan.addComment': ({ key, body }) => {
        commentCall = { key, body }
        return { ok: true }
      }
    }
  })

  view = await mount(panel, { host })
  assert.ok(view.find({ text: /PRD-2476/ }))
  assert.ok(view.find({ text: /PRD-2494/ }))

  // Filter by status tab
  await view.select({ label: 'Status Filter' }, 'todo')
  assert.equal(view.find({ text: /PRD-2476/ }), null)
  assert.ok(view.find({ text: /PRD-2494/ }))

  // Switch back to active and filter by search input
  await view.select({ label: 'Status Filter' }, 'active')
  await view.type({ label: 'Search tickets' }, '2476')
  assert.ok(view.find({ text: /PRD-2476/ }))
  assert.equal(view.find({ text: /PRD-2494/ }), null)

  // Open detail and mark done
  await view.press({ text: /PRD-2476/ })
  assert.ok(view.find({ text: /Detail checklist E2E PDS/ }))

  await view.press({ text: 'Mark Done' })
  assert.deepEqual(movedCall, { key: 'PRD-2476', status: 'done' })

  // Add comment
  await view.type({ label: 'Add Comment' }, 'Sudah diverifikasi di dev')
  await view.press({ text: 'Post Comment' })
  assert.deepEqual(commentCall, { key: 'PRD-2476', body: 'Sudah diverifikasi di dev' })

  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.warnings, [])
  assert.deepEqual(view.refusals, [])
})

test('navigates Sprint and Backlog views and opens story detail', async () => {
  const sprintCalls: number[] = []
  const backlogCalls: Array<number | null | undefined> = []

  const host = mockHost({
    requests: {
      'kerjan.dashboard': () => ({
        tickets: [],
        projects: [],
        sprints: [
          {
            id: 107,
            name: 'CRM - CPAAS - SPRINT 7',
            state: 'active',
            category: 'development',
            start_date: '2026-11-03T02:00:00Z',
            end_date: '2026-11-24T02:00:00Z',
            goal: 'Fokus PDS & Voicebot.'
          },
          {
            id: 111,
            name: 'Remediasi Pentest OmniX, CPaaS & PBX',
            state: 'active',
            category: 'improvement'
          }
        ],
        products: [
          { id: 24, name: 'CPaaS - Omnix PBX' },
          { id: 22, name: 'OmniX' }
        ],
        defaultSprintId: 107,
        defaultProductId: 24,
        workspaceCode: 'PRD',
        assigneeId: 35,
        counts: { inProgress: 0, todo: 0, done: 0 },
        fetchedAt: 1000
      }),
      'kerjan.sprintTickets': ({ sprintId }) => {
        sprintCalls.push(sprintId)
        if (sprintId === 111) {
          return {
            sprintId,
            stories: [
              {
                id: 7001,
                key: 'PRD-2600',
                kind: 'story',
                title: 'Pentest Hardening OTP',
                status: 'in_progress',
                estimate: 8,
                tasks: []
              }
            ]
          }
        }
        return {
          sprintId,
          stories: [
            {
              id: 6559,
              key: 'PRD-2407',
              kind: 'story',
              title: 'Integrasi OmniX PBX untuk PDS',
              status: 'in_progress',
              estimate: 108,
              tasks: [
                {
                  id: 6628,
                  key: 'PRD-2476',
                  kind: 'task',
                  title: '[BE] [E2E] E2E dev full flow PDS',
                  status: 'todo',
                  task_type: 'dev',
                  assignee_id: 35,
                  estimate: 5
                }
              ]
            },
            {
              id: 6582,
              key: 'PRD-2430',
              kind: 'story',
              title: 'Story Tim Lain',
              status: 'todo',
              estimate: 12,
              tasks: [
                {
                  id: 6680,
                  key: 'PRD-2525',
                  kind: 'task',
                  title: 'Task orang lain',
                  status: 'todo',
                  assignee_id: 99,
                  estimate: 2
                }
              ]
            }
          ]
        }
      },
      'kerjan.backlogTickets': (input) => {
        backlogCalls.push(input?.productId)
        if (input?.productId === 22) {
          return {
            stories: [
              {
                id: 4067,
                key: 'PRD-40',
                kind: 'story',
                title: 'IT Helpdesk Portal | KMS AI',
                status: 'todo',
                product_id: 22,
                tasks: []
              }
            ]
          }
        }
        return {
          stories: [
            {
              id: 6384,
              key: 'PRD-2232',
              kind: 'story',
              title: 'AI Report Generator',
              status: 'todo',
              product_id: 24,
              tasks: [
                {
                  id: 6385,
                  key: 'PRD-2233',
                  kind: 'task',
                  title: 'Create Test Plan',
                  status: 'todo',
                  task_type: 'qa',
                  estimate: 0
                }
              ]
            }
          ]
        }
      },
      'kerjan.detail': ({ key }) => ({
        ticket: {
          id: 6384,
          key,
          kind: 'story',
          title: 'AI Report Generator',
          status: 'todo',
          description: '## User Story\nDetail AI Report Generator.'
        },
        story: {
          id: 6384,
          key,
          title: 'AI Report Generator',
          status: 'todo',
          tasks: [
            {
              id: 6385,
              key: 'PRD-2233',
              kind: 'task',
              title: 'Create Test Plan',
              status: 'todo',
              task_type: 'qa',
              estimate: 0
            }
          ]
        },
        comments: []
      })
    }
  })

  view = await mount(panel, { host })

  // Switch to Sprint view
  await view.press({ text: 'Sprints' })
  assert.deepEqual(sprintCalls, [107])
  assert.ok(view.find({ text: /PRD-2407/ }))
  assert.ok(view.find({ text: /PRD-2430/ }))

  // Filter only my tasks in sprint
  await view.toggle({ label: 'Only stories with my tasks' })
  assert.ok(view.find({ text: /PRD-2407/ }))
  assert.equal(view.find({ text: /PRD-2430/ }), null)

  // Switch sprint
  await view.select({ label: 'Select Sprint' }, '111')
  assert.deepEqual(sprintCalls, [107, 111])
  assert.equal(view.find({ text: /PRD-2600/ }), null) // onlyMine still active, PRD-2600 has no task for user 35
  await view.toggle({ label: 'Only stories with my tasks' })
  assert.ok(view.find({ text: /PRD-2600/ }))

  // Switch to Backlog view
  await view.press({ text: 'Backlog' })
  assert.deepEqual(backlogCalls, [24])
  assert.ok(view.find({ text: /PRD-2232/ }))

  // Switch product filter
  await view.select({ label: 'Product Filter' }, '22')
  assert.deepEqual(backlogCalls, [24, 22])
  assert.ok(view.find({ text: /PRD-40/ }))

  // Switch back to product 24 and open story detail
  await view.select({ label: 'Product Filter' }, '24')
  await view.press({ text: /PRD-2232/ })
  assert.ok(view.find({ text: /Detail AI Report Generator/ }))
  assert.ok(view.find({ text: /PRD-2233/ }))

  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.warnings, [])
  assert.deepEqual(view.refusals, [])
})

test('prompts for initial setup when unconfigured and toggles settings via gear button', async () => {
  let savedConfig: {
    apiUrl: string
    apiToken?: string
  } | null = null

  const connectedDashboard = {
    tickets: [
      {
        id: 6628,
        key: 'PRD-2476',
        kind: 'task',
        title: '[BE] [E2E] E2E dev full flow PDS',
        status: 'in_progress',
        sprint_id: 107,
        sprint_name: 'CRM - CPAAS - SPRINT 7',
        story_key: 'PRD-2407',
        task_type: 'dev',
        estimate: 5
      }
    ],
    projects: [],
    sprints: [],
    products: [],
    defaultSprintId: null,
    defaultProductId: null,
    workspaceCode: 'PRD',
    assigneeId: 35,
    counts: { inProgress: 1, todo: 0, done: 0 },
    fetchedAt: 1000,
    needsSetup: false,
    config: {
      apiUrl: 'https://kerjan.example.dev/api/v1/mcp',
      hasToken: true,
      tokenPreview: 'kjp_demo••••cdef'
    }
  }

  const host = mockHost({
    requests: {
      'kerjan.dashboard': () => ({
        tickets: [],
        projects: [],
        sprints: [],
        products: [],
        defaultSprintId: null,
        defaultProductId: null,
        workspaceCode: '',
        assigneeId: 0,
        counts: { inProgress: 0, todo: 0, done: 0 },
        fetchedAt: 1000,
        needsSetup: true,
        config: {
          apiUrl: '',
          hasToken: false,
          tokenPreview: ''
        }
      }),
      'kerjan.saveConfig': (input) => {
        savedConfig = input
        return {
          ok: true,
          userName: 'Fathur Radhie',
          userId: 35,
          dashboard: connectedDashboard
        }
      },
      'kerjan.clearConfig': () => ({
        ok: true,
        dashboard: {
          tickets: [],
          projects: [],
          sprints: [],
          products: [],
          defaultSprintId: null,
          defaultProductId: null,
          workspaceCode: '',
          assigneeId: 0,
          counts: { inProgress: 0, todo: 0, done: 0 },
          fetchedAt: 1000,
          needsSetup: true,
          config: {
            apiUrl: '',
            hasToken: false,
            tokenPreview: ''
          }
        }
      })
    }
  })

  view = await mount(panel, { host })

  // Shows initial setup form automatically and hides all dashboard chrome
  assert.ok(view.find({ text: /Initial Setup/ }))
  assert.ok(view.find({ text: /Welcome to Kerjan for Orca/ }))
  assert.equal(view.find({ label: 'Workspace Code' }), null)
  assert.equal(view.find({ label: /Assignee ID/ }), null)
  assert.equal(view.find({ text: 'In Progress' }), null)
  assert.equal(view.find({ text: 'To Do' }), null)
  assert.equal(view.find({ text: 'Done' }), null)
  assert.equal(view.find({ text: /Task Completion/ }), null)
  assert.equal(view.find({ text: 'My Tasks' }), null)
  assert.equal(view.find({ text: 'Sprints' }), null)
  assert.equal(view.find({ text: 'Backlog' }), null)
  assert.equal(view.find({ text: 'Refresh' }), null)
  assert.equal(view.find({ label: 'Settings' }), null)

  await view.type(
    { label: 'Kerjan MCP URL' },
    'https://kerjan.example.dev/api/v1/mcp',
    { replace: true }
  )
  await view.type({ label: 'API Key / MCP Token' }, 'kjp_demo_token_abcdef', { replace: true })
  await view.press({ text: 'Save & Connect' })

  assert.deepEqual(savedConfig, {
    apiUrl: 'https://kerjan.example.dev/api/v1/mcp',
    apiToken: 'kjp_demo_token_abcdef'
  })

  // Dashboard loads and onboarding disappears
  assert.equal(view.find({ text: /Initial Setup/ }), null)
  assert.ok(view.find({ text: 'My Tasks' }))
  assert.ok(view.find({ text: 'Sprints' }))
  assert.ok(view.find({ text: /PRD-2476/ }))
  assert.ok(view.find({ text: /Authenticated as Fathur Radhie/ }))

  // Gear button opens Connection Settings cleanly without dashboard chrome
  await view.press({ label: 'Settings' })
  assert.ok(view.find({ text: /Connection Settings/ }))
  assert.ok(view.find({ text: /kjp_demo••••cdef/ }))
  assert.equal(view.find({ text: 'In Progress' }), null)
  assert.equal(view.find({ text: /Task Completion/ }), null)
  assert.equal(view.find({ text: 'My Tasks' }), null)
  assert.equal(view.find({ text: 'Sprints' }), null)

  // Cancel returns to the dashboard
  await view.press({ text: 'Cancel' })
  assert.equal(view.find({ text: /Connection Settings/ }), null)
  assert.ok(view.find({ text: 'My Tasks' }))
  assert.ok(view.find({ text: /PRD-2476/ }))

  // Disconnect clears config and returns to Initial Setup
  await view.press({ label: 'Settings' })
  await view.press({ text: 'Disconnect' })
  assert.ok(view.find({ text: /Initial Setup/ }))
  assert.equal(view.find({ text: 'My Tasks' }), null)

  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.warnings, [])
  assert.deepEqual(view.refusals, [])
})
