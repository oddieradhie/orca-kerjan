import { defineCheck } from 'orca/testing'

const mockSprints = [
  {
    id: 107,
    name: 'Sprint 1 - Core Platform',
    state: 'active',
    category: 'development',
    start_date: '2026-11-03T02:00:00Z',
    end_date: '2026-11-24T02:00:00Z',
    goal: 'Deliver OAuth2 authentication and core API improvements.'
  }
]

const mockProducts = [{ id: 24, name: 'Core Platform' }]

const mockSprintStories = [
  {
    id: 6559,
    key: 'PRD-2407',
    kind: 'story',
    title: 'User Authentication Flow',
    status: 'in_progress',
    sprint_id: 107,
    estimate: 24,
    tasks: [
      {
        id: 6628,
        key: 'PRD-2476',
        kind: 'task',
        title: '[BE] Implement OAuth2 token refresh',
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
            title: '[BE] Implement OAuth2 token refresh',
            status: 'in_progress',
            sprint_id: 107,
            sprint_name: 'Sprint 1 - Core Platform',
            story_key: 'PRD-2407',
            story_title: 'User Authentication Flow',
            task_type: 'dev',
            estimate: 5
          },
          {
            id: 6646,
            key: 'PRD-2494',
            kind: 'task',
            title: '[FE] Add login session timeout dialog',
            status: 'todo',
            sprint_id: 107,
            sprint_name: 'Sprint 1 - Core Platform',
            story_key: 'PRD-2407',
            task_type: 'dev',
            estimate: 3
          }
        ],
        projects: [
          {
            id: 'git:github.com/example/core-api',
            name: 'core-api',
            hostId: 'local',
            path: '/tmp/core-api'
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
