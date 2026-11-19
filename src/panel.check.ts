import { defineCheck } from 'orca/testing'

const mockSprints = [
  {
    id: 107,
    name: 'CRM - CPAAS - SPRINT 7',
    state: 'active',
    category: 'development',
    start_date: '2026-11-03T02:00:00Z',
    end_date: '2026-11-24T02:00:00Z',
    goal: 'Menghadirkan AI Report Generator dan integrasi PDS.'
  }
]

const mockProducts = [{ id: 24, name: 'CPaaS - Omnix PBX' }]

const mockSprintStories = [
  {
    id: 6559,
    key: 'PRD-2407',
    kind: 'story',
    title: 'Integrasi OmniX PBX untuk PDS di Omnix Sales',
    status: 'in_progress',
    sprint_id: 107,
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
  }
]

const mockBacklogStories = [
  {
    id: 6384,
    key: 'PRD-2232',
    kind: 'story',
    title: 'AI Report Generator',
    status: 'todo',
    product_id: 24,
    estimate: 0,
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

export default defineCheck({
  setupRequired: {
    requests: {
      'kerjan.dashboard': {
        tickets: [],
        projects: [],
        sprints: [],
        products: [],
        defaultSprintId: null,
        defaultProductId: null,
        workspaceCode: '',
        assigneeId: 0,
        counts: { inProgress: 0, todo: 0, done: 0 },
        fetchedAt: 0,
        needsSetup: true,
        config: {
          apiUrl: '',
          hasToken: false,
          tokenPreview: ''
        }
      }
    }
  },
  empty: {
    requests: {
      'kerjan.dashboard': {
        tickets: [],
        projects: [],
        sprints: [],
        products: [],
        defaultSprintId: null,
        defaultProductId: null,
        workspaceCode: 'PRD',
        assigneeId: 35,
        counts: { inProgress: 0, todo: 0, done: 0 },
        fetchedAt: 0
      }
    }
  },
  loaded: {
    requests: {
      'kerjan.dashboard': {
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
            story_title: 'Integrasi OmniX PBX untuk PDS',
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
        ],
        projects: [
          {
            id: 'git:github.com/example/cpaas-voice',
            name: 'cpaas-voice',
            hostId: 'local',
            path: '/tmp/cpaas-voice'
          }
        ],
        sprints: mockSprints,
        products: mockProducts,
        defaultSprintId: 107,
        defaultProductId: 24,
        workspaceCode: 'PRD',
        assigneeId: 35,
        counts: { inProgress: 1, todo: 1, done: 0 },
        fetchedAt: 0
      }
    }
  },
  sprintView: {
    persisted: { plugin: { viewMode: 'sprints' } },
    requests: {
      'kerjan.dashboard': {
        tickets: [],
        projects: [],
        sprints: mockSprints,
        products: mockProducts,
        defaultSprintId: 107,
        defaultProductId: 24,
        workspaceCode: 'PRD',
        assigneeId: 35,
        counts: { inProgress: 0, todo: 0, done: 0 },
        fetchedAt: 0
      },
      'kerjan.sprintTickets': {
        sprintId: 107,
        stories: mockSprintStories
      }
    }
  },
  backlogView: {
    persisted: { plugin: { viewMode: 'backlog' } },
    requests: {
      'kerjan.dashboard': {
        tickets: [],
        projects: [],
        sprints: mockSprints,
        products: mockProducts,
        defaultSprintId: 107,
        defaultProductId: 24,
        workspaceCode: 'PRD',
        assigneeId: 35,
        counts: { inProgress: 0, todo: 0, done: 0 },
        fetchedAt: 0
      },
      'kerjan.backlogTickets': {
        stories: mockBacklogStories
      }
    }
  },
  error: {
    requests: {
      'kerjan.dashboard': {
        tickets: [],
        projects: [],
        sprints: [],
        products: [],
        defaultSprintId: null,
        defaultProductId: null,
        workspaceCode: 'PRD',
        assigneeId: 35,
        counts: { inProgress: 0, todo: 0, done: 0 },
        fetchedAt: 0,
        error: 'HTTP 502: Bad Gateway'
      }
    }
  }
})
