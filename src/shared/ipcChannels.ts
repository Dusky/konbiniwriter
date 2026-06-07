// shared/ipcChannels.ts — typed IPC channel name constants

export const IPC = {
  PROJECT_CREATE: 'project:create',
  PROJECT_OPEN:   'project:open',
  PROJECT_RECENTS:'project:recents',
  PROJECT_CLOSE:  'project:close',
  PROJECT_REMOVE_RECENT: 'project:removeRecent',
  PROJECT_SHOW_OPEN_DIALOG: 'project:showOpenDialog',
  PROJECT_SHOW_SAVE_DIALOG: 'project:showSaveDialog',

  DOC_READ:  'doc:read',
  DOC_WRITE: 'doc:write',

  NODE_MUTATE: 'node:mutate',

  SNAPSHOT_TAKE:    'snapshot:take',
  SNAPSHOT_RESTORE: 'snapshot:restore',
  SNAPSHOT_LIST:    'snapshot:list',
  SNAPSHOT_DELETE:  'snapshot:delete',

  COMPILE_RUN: 'compile:run',

  SHELL_MINIMIZE:     'shell:minimize',
  SHELL_MAXIMIZE:     'shell:maximize',
  SHELL_CLOSE:        'shell:close',
  SHELL_IS_MAXIMIZED: 'shell:isMaximized',
} as const
