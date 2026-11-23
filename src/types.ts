export interface Role { id: number; name: string; isAuditor: boolean; permissions: string[] }
export interface User {
  id: number; username: string; fullName: string; email: string | null;
  mustChangePassword: boolean; terminatorScope: number[]; roles: Role[]; permissions: string[];
}
export interface Terminator { id: number; code?: string; name: string; isActive: boolean }
export interface ReconStatus { id: number; name: string; isActive: boolean }
export interface Session {
  user: User; terminators: Terminator[]; statuses: ReconStatus[]; timezone: string; maxUploadBytes: number;
}
export interface Filters {
  transId?: string; transIds?: string; transFrom?: string; transTo?: string; reconFrom?: string; reconTo?: string;
  tags?: string[]; terminatorIds?: number[]; exceptionStatus?: string[]; reconStatusIds?: number[]; uploaderIds?: number[];
  followUp?: string; batchId?: number; onlyExceptions?: boolean; includeSuperseded?: boolean; outstandingOnly?: boolean; sort?: string;
}
export const EXC_STATUS_LABEL: Record<string, string> = {
  open: "Open", investigating: "Investigating", resolution_submitted: "Resolution submitted", closed: "Closed", reopened: "Reopened",
};
export const TAGS = ["P2S", "P2F", "F2S", "S2F"] as const;
export const TAG_MEANING: Record<string, string> = {
  P2S: "Pending → Success", P2F: "Pending → Failed", F2S: "Failed → Success (exception)", S2F: "Success → Failed (exception)",
};
