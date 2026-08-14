/**
 * Compatibility barrel - prefer importing from `@/features/<domain>/api`.
 * Kept so gradual migrations and greps never miss a symbol.
 */
export {
  AUTH_REQUIRED_EVENT, AuthRequiredError, getStoredProfile, isLoggedIn, type LoginProfile
} from "@/lib/http";

export {
  fetchMe, getWorkspacePrefs, listMembers, addMember, updateMember, removeMember, login,
  logout, requestPasswordReset,
  resetPassword, setWorkspacePrefs,
  type ApiMember, type WorkspacePrefs
} from "@/features/auth/api";

export {
  createCase, deleteCases, listAllCases, listCases, previewDeleteCases, updateCase,
  updateCaseStage, type ApiCase, type BulkDeleteResult, type CaseDeletePreview, type CreateCaseInput,
  type ListCasesOpts, type PageResult, type UpdateCaseInput
} from "@/features/cases/api";

export {
  addCaseComment, confirmSuggestion,
  dismissSuggestion, fetchDocumentContent, getCase, getCaseConversation, getCaseEvents, getCaseMessages,
  getChecklist, pauseNudges, reclassifyDocument, removeDocument, requestDocuments, resumeNudges, reviewDocument, uploadDocument, type ApiCaseDetail,
  type ApiCaseEvent,
  type ApiCaseMessage, type ApiChecklist,
  type ApiChecklistItem, type ApiConversationEntry, type ApiDocument,
  type ApiDocumentRow,
  type ApiUnclassifiedDocument, type ChecklistItemStatus,
  type ClassificationConfidence, type DocumentStatus, type NudgeChannelResult, type NudgeResult
} from "@/features/case-detail/api";

export {
  deleteContacts, listContacts,
  previewDeleteContacts, type ApiContact,
  type ContactDeletePreview, type ListContactsOpts
} from "@/features/contacts/api";

export { listChannels, pollChannel, type ApiChannel } from "@/features/channels/api";

export {
  listConversations,
  type ApiConversationThread
} from "@/features/conversations/api";

export { listFollowUps, type ApiFollowUp } from "@/features/follow-ups/api";

export {
  assignUnmatched,
  discardUnmatched, listUnmatched, type ApiUnmatchedDocument
} from "@/features/unmatched/api";

export {
  canEditWorkflows,
  createWorkflow,
  deleteWorkflow,
  getWorkflow,
  listFields,
  listRequirements,
  listStages,
  listWorkflows,
  putFields,
  putRequirements,
  putStages,
  updateWorkflow,
  type ApiFieldDef,
  type ApiRequirement,
  type ApiStage,
  type ApiWorkflow
} from "@/features/workflows/api";

export {
  getOverview, type ApiAttentionItem, type ApiOverview
} from "@/features/overview/api";

