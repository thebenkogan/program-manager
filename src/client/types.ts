import type {
  Client,
  ProgramDocument,
  ProgramFile,
  SyncState,
  FileStatus,
  ParsedDiff,
  VersionInfo,
  SyncStatus,
} from '../shared/types'

export interface ProgramSummary extends ProgramFile {
  docHash: string
  errors: string[]
  valid: boolean
  hasPendingDiff: boolean
  pendingStats: { added: number; removed: number } | null
  committedDoc: ProgramDocument | null
  syncStatus: SyncStatus
  sync: SyncState | null
}

export interface CoachData {
  clients: Client[]
  programs: ProgramSummary[]
  pendingFiles: FileStatus[]
}

export type View =
  | { kind: 'dashboard' }
  | { kind: 'program'; id: string }

export type { Client, ProgramFile, SyncState, FileStatus, ParsedDiff, VersionInfo, SyncStatus }
