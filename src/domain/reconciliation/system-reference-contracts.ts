import { z } from 'zod'

export const systemReferenceItemSchema=z.object({
 codigo:z.string().trim().min(1),
 referenceType:z.enum(['SERIAL','PARTIDA','LEGACY']),
 referenceValue:z.string().trim().min(1).nullable(),
 quantity:z.number().int().nonnegative(),
})
export type SystemReferenceItem=z.infer<typeof systemReferenceItemSchema>

export const systemReferenceIssueSchema=z.object({
 sheet:z.string(),
 rowNumber:z.number().int().nonnegative(),
 codigo:z.string(),
 referenceValue:z.string().nullable(),
 severity:z.enum(['ERROR','WARNING']),
 message:z.string().min(1),
})
export type SystemReferenceIssue=z.infer<typeof systemReferenceIssueSchema>

export const systemReferencePreviewSchema=z.object({
 fileName:z.string().min(1),
 fileSha256:z.string().regex(/^[a-f0-9]{64}$/i),
 totalSourceRows:z.number().int().nonnegative(),
 itemCount:z.number().int().nonnegative(),
 serialItems:z.number().int().nonnegative(),
 batchItems:z.number().int().nonnegative(),
 legacyItems:z.number().int().nonnegative(),
 unidentifiedBatchCodes:z.array(z.string()).default([]),
 issues:z.array(systemReferenceIssueSchema),
 items:z.array(systemReferenceItemSchema),
})
export type SystemReferencePreview=z.infer<typeof systemReferencePreviewSchema>

export function hasBlockingSystemReferenceIssues(preview:SystemReferencePreview){
 return preview.issues.some(issue=>issue.severity==='ERROR')
}
