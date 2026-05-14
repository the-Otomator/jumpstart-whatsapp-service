import { Router, Request, Response } from 'express'
import { getBaileysSocket, getStatus } from '../sessionManager'
import {
  validateBody,
  validateParams,
  orgIdParamsSchema,
  groupParamsSchema,
  groupCreateSchema,
  groupParticipantsSchema,
  groupSendSchema,
  groupDescriptionSchema,
  groupSubjectSchema,
  groupIconSchema,
  groupSendPermissionSchema,
  groupEditInfoPermissionSchema,
  groupApprovalModeSchema,
  groupMemberAddModeSchema,
} from '../middleware/validate'
import { toJid, jidToPhone } from '../lib/phone'
import { orgLogger } from '../lib/logger'
import type {
  GroupCreateRequest,
  GroupParticipantsRequest,
  GroupCreateResponse,
  GroupParticipantResult,
  GroupMetadataParticipant,
  AdminedGroup,
  GroupDescriptionRequest,
  GroupSubjectRequest,
  GroupIconRequest,
  GroupSendPermissionRequest,
  GroupEditInfoPermissionRequest,
  GroupApprovalModeRequest,
  GroupMemberAddModeRequest,
} from '../types'

const router = Router()

/** Resolve and validate a Baileys socket, returning 404/503 if not ready. */
function requireSocket(orgId: string, res: Response) {
  const session = getStatus(orgId)
  if (!session || session.status !== 'connected') {
    res.status(404).json({ error: `Session ${orgId} not connected`, code: 'SESSION_NOT_CONNECTED' })
    return null
  }
  const sock = getBaileysSocket(orgId)
  if (!sock) {
    res.status(503).json({ error: `Baileys socket unavailable for ${orgId}`, code: 'SOCKET_UNAVAILABLE' })
    return null
  }
  return sock
}

// ΓöÇΓöÇ POST /api/groups/:orgId/create ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
router.post(
  '/:orgId/create',
  validateParams(orgIdParamsSchema),
  validateBody(groupCreateSchema),
  async (req: Request, res: Response) => {
    const { orgId } = req.params
    const body = req.body as GroupCreateRequest
    const log = orgLogger(orgId)

    const sock = requireSocket(orgId, res)
    if (!sock) return

    try {
      const participantJids = body.participants.map(toJid)
      const group = await sock.groupCreate(body.subject, participantJids)
      const groupJid = group.id

      // Set description if provided
      if (body.description) {
        try {
          await sock.groupUpdateDescription(groupJid, body.description)
        } catch (err) {
          log.warn({ groupJid, err: (err as Error).message }, 'Failed to set group description')
        }
      }

      // Set icon if URL provided
      if (body.iconUrl) {
        try {
          const resp = await fetch(body.iconUrl)
          if (resp.ok) {
            const buf = Buffer.from(await resp.arrayBuffer())
            await sock.updateProfilePicture(groupJid, buf)
          }
        } catch (err) {
          log.warn({ groupJid, err: (err as Error).message }, 'Failed to set group icon')
        }
      }

      // Fetch invite link
      let inviteLink = ''
      try {
        const code = await sock.groupInviteCode(groupJid)
        inviteLink = `https://chat.whatsapp.com/${code}`
      } catch (err) {
        log.warn({ groupJid, err: (err as Error).message }, 'Failed to fetch invite code')
      }

      // Build per-participant status from group metadata
      const participantResults: GroupParticipantResult[] = (group.participants ?? []).map((p: any) => ({
        phone: jidToPhone(p.id),
        status: 'added',
      }))

      const response: GroupCreateResponse = {
        groupJid,
        inviteLink,
        participants: participantResults,
      }

      log.info({ groupJid, subject: body.subject, memberCount: participantResults.length }, 'Group created')
      res.json(response)
    } catch (err) {
      log.error({ err: (err as Error).message }, 'Failed to create group')
      res.status(500).json({ error: (err as Error).message, code: 'GROUP_CREATE_FAILED' })
    }
  }
)

// ΓöÇΓöÇ POST /api/groups/:orgId/:groupJid/add ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
router.post(
  '/:orgId/:groupJid/add',
  validateParams(groupParamsSchema),
  validateBody(groupParticipantsSchema),
  async (req: Request, res: Response) => {
    const { orgId, groupJid } = req.params
    const body = req.body as GroupParticipantsRequest
    const log = orgLogger(orgId)

    const sock = requireSocket(orgId, res)
    if (!sock) return

    try {
      const jids = body.participants.map(toJid)
      const result = await sock.groupParticipantsUpdate(groupJid, jids, 'add')

      const participantResults: GroupParticipantResult[] = []

      for (const item of result ?? []) {
        const phone = jidToPhone(item.jid ?? '')
        const status = item.status ?? 'unknown'

        // On privacy rejection (408), generate invite fallback
        if (status === '408' || status === 'error') {
          let inviteFallback: string | undefined
          try {
            const code = await sock.groupInviteCode(groupJid)
            inviteFallback = `https://chat.whatsapp.com/${code}`
          } catch {
            // best effort
          }
          participantResults.push({ phone, status: 'rejected', inviteFallback })
        } else {
          participantResults.push({ phone, status: status === '200' ? 'added' : status })
        }
      }

      log.info({ groupJid, count: participantResults.length }, 'Participants add attempted')
      res.json({ participants: participantResults })
    } catch (err) {
      log.error({ groupJid, err: (err as Error).message }, 'Failed to add participants')
      res.status(500).json({ error: (err as Error).message, code: 'GROUP_ADD_FAILED' })
    }
  }
)

// ΓöÇΓöÇ POST /api/groups/:orgId/:groupJid/remove ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
router.post(
  '/:orgId/:groupJid/remove',
  validateParams(groupParamsSchema),
  validateBody(groupParticipantsSchema),
  async (req: Request, res: Response) => {
    const { orgId, groupJid } = req.params
    const body = req.body as GroupParticipantsRequest
    const log = orgLogger(orgId)

    const sock = requireSocket(orgId, res)
    if (!sock) return

    try {
      const jids = body.participants.map(toJid)
      await sock.groupParticipantsUpdate(groupJid, jids, 'remove')
      log.info({ groupJid, count: jids.length }, 'Participants removed')
      res.json({ success: true, removed: body.participants })
    } catch (err) {
      log.error({ groupJid, err: (err as Error).message }, 'Failed to remove participants')
      res.status(500).json({ error: (err as Error).message, code: 'GROUP_REMOVE_FAILED' })
    }
  }
)

// ΓöÇΓöÇ POST /api/groups/:orgId/:groupJid/promote ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
router.post(
  '/:orgId/:groupJid/promote',
  validateParams(groupParamsSchema),
  validateBody(groupParticipantsSchema),
  async (req: Request, res: Response) => {
    const { orgId, groupJid } = req.params
    const body = req.body as GroupParticipantsRequest
    const log = orgLogger(orgId)

    const sock = requireSocket(orgId, res)
    if (!sock) return

    try {
      const jids = body.participants.map(toJid)
      await sock.groupParticipantsUpdate(groupJid, jids, 'promote')
      log.info({ groupJid, count: jids.length }, 'Participants promoted to admin')
      res.json({ success: true, promoted: body.participants })
    } catch (err) {
      log.error({ groupJid, err: (err as Error).message }, 'Failed to promote participants')
      res.status(500).json({ error: (err as Error).message, code: 'GROUP_PROMOTE_FAILED' })
    }
  }
)

// ΓöÇΓöÇ POST /api/groups/:orgId/:groupJid/demote ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
router.post(
  '/:orgId/:groupJid/demote',
  validateParams(groupParamsSchema),
  validateBody(groupParticipantsSchema),
  async (req: Request, res: Response) => {
    const { orgId, groupJid } = req.params
    const body = req.body as GroupParticipantsRequest
    const log = orgLogger(orgId)

    const sock = requireSocket(orgId, res)
    if (!sock) return

    try {
      const jids = body.participants.map(toJid)
      await sock.groupParticipantsUpdate(groupJid, jids, 'demote')
      log.info({ groupJid, count: jids.length }, 'Participants demoted from admin')
      res.json({ success: true, demoted: body.participants })
    } catch (err) {
      log.error({ groupJid, err: (err as Error).message }, 'Failed to demote participants')
      res.status(500).json({ error: (err as Error).message, code: 'GROUP_DEMOTE_FAILED' })
    }
  }
)

// ΓöÇΓöÇ POST /api/groups/:orgId/:groupJid/send ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
router.post(
  '/:orgId/:groupJid/send',
  validateParams(groupParamsSchema),
  validateBody(groupSendSchema),
  async (req: Request, res: Response) => {
    const { orgId, groupJid } = req.params
    const { text, media, mediaType } = req.body as { text?: string; media?: string; mediaType?: string }
    const log = orgLogger(orgId)

    const sock = requireSocket(orgId, res)
    if (!sock) return

    try {
      let content: any

      if (text && !media) {
        content = { text }
      } else if (media && mediaType) {
        content = { [mediaType]: { url: media }, caption: text }
      } else {
        content = { text: text ?? '' }
      }

      const result = await sock.sendMessage(groupJid, content)
      log.info({ groupJid, messageId: result?.key?.id }, 'Message sent to group')
      res.json({ success: true, messageId: result?.key?.id ?? '' })
    } catch (err) {
      log.error({ groupJid, err: (err as Error).message }, 'Failed to send group message')
      res.status(500).json({ error: (err as Error).message, code: 'GROUP_SEND_FAILED' })
    }
  }
)

// ΓöÇΓöÇ GET /api/groups/:orgId/:groupJid/metadata ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
router.get(
  '/:orgId/:groupJid/metadata',
  validateParams(groupParamsSchema),
  async (req: Request, res: Response) => {
    const { orgId, groupJid } = req.params
    const log = orgLogger(orgId)

    const sock = requireSocket(orgId, res)
    if (!sock) return

    try {
      const meta = await sock.groupMetadata(groupJid)

      const participants: GroupMetadataParticipant[] = meta.participants.map((p: any) => ({
        phone: jidToPhone(p.id),
        isAdmin: p.admin === 'admin' || p.admin === 'superadmin',
        isSuperAdmin: p.admin === 'superadmin',
      }))

      res.json({
        subject: meta.subject,
        description: meta.desc ?? null,
        participants,
        owner: meta.owner ? jidToPhone(meta.owner) : null,
      })
    } catch (err) {
      log.error({ groupJid, err: (err as Error).message }, 'Failed to fetch group metadata')
      res.status(500).json({ error: (err as Error).message, code: 'GROUP_METADATA_FAILED' })
    }
  }
)

// ΓöÇΓöÇ GET /api/groups/:orgId/admined ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
router.get(
  '/:orgId/admined',
  validateParams(orgIdParamsSchema),
  async (req: Request, res: Response) => {
    const { orgId } = req.params
    const log = orgLogger(orgId)

    const sock = requireSocket(orgId, res)
    if (!sock) return

    try {
      const systemJid = sock.user?.id ?? ''
      const allGroups = await sock.groupFetchAllParticipating()

      const admined: AdminedGroup[] = []

      for (const [groupJid, meta] of Object.entries(allGroups)) {
        const self = meta.participants.find((p: any) => p.id === systemJid)
        if (!self || !self.admin) continue

        const admins = meta.participants
          .filter((p: any) => p.admin != null)
          .map((p: any) => jidToPhone(p.id))

        admined.push({
          groupJid,
          subject: meta.subject,
          memberCount: meta.participants.length,
          admins,
        })
      }

      log.info({ count: admined.length }, 'Listed admined groups')
      res.json({ groups: admined, count: admined.length })
    } catch (err) {
      log.error({ err: (err as Error).message }, 'Failed to list admined groups')
      res.status(500).json({ error: (err as Error).message, code: 'GROUP_LIST_FAILED' })
    }
  }
)

// ── GET /api/groups/:orgId/:groupJid/invite-code ─────────────────────────────
router.get(
  '/:orgId/:groupJid/invite-code',
  validateParams(groupParamsSchema),
  async (req: Request, res: Response) => {
    const { orgId, groupJid } = req.params
    const log = orgLogger(orgId)

    const sock = requireSocket(orgId, res)
    if (!sock) return

    try {
      const code = await sock.groupInviteCode(groupJid)
      res.json({ code, inviteLink: `https://chat.whatsapp.com/${code}` })
    } catch (err) {
      log.error({ groupJid, err: (err as Error).message }, 'Failed to fetch group invite code')
      res.status(500).json({ error: (err as Error).message, code: 'GROUP_INVITE_CODE_FAILED' })
    }
  }
)

// ── POST /api/groups/:orgId/:groupJid/subject ────────────────────────────────
router.post(
  '/:orgId/:groupJid/subject',
  validateParams(groupParamsSchema),
  validateBody(groupSubjectSchema),
  async (req: Request, res: Response) => {
    const { orgId, groupJid } = req.params
    const { subject } = req.body as GroupSubjectRequest
    const log = orgLogger(orgId)

    const sock = requireSocket(orgId, res)
    if (!sock) return

    try {
      await sock.groupUpdateSubject(groupJid, subject)
      log.info({ groupJid, subject }, 'Group subject updated')
      res.json({ ok: true })
    } catch (err) {
      log.error({ groupJid, err: (err as Error).message }, 'Failed to update group subject')
      res.status(500).json({ error: (err as Error).message, code: 'GROUP_SUBJECT_FAILED' })
    }
  }
)

// ΓöÇΓöÇ POST /api/groups/:orgId/:groupJid/description ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
router.post(
  '/:orgId/:groupJid/description',
  validateParams(groupParamsSchema),
  validateBody(groupDescriptionSchema),
  async (req: Request, res: Response) => {
    const { orgId, groupJid } = req.params
    const { description } = req.body as GroupDescriptionRequest
    const log = orgLogger(orgId)

    const sock = requireSocket(orgId, res)
    if (!sock) return

    try {
      await sock.groupUpdateDescription(groupJid, description)
      log.info({ groupJid }, 'Group description updated')
      res.json({ ok: true })
    } catch (err) {
      log.error({ groupJid, err: (err as Error).message }, 'Failed to update group description')
      res.status(500).json({ error: (err as Error).message, code: 'GROUP_DESCRIPTION_FAILED' })
    }
  }
)

// ΓöÇΓöÇ POST /api/groups/:orgId/:groupJid/icon ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
router.post(
  '/:orgId/:groupJid/icon',
  validateParams(groupParamsSchema),
  validateBody(groupIconSchema),
  async (req: Request, res: Response) => {
    const { orgId, groupJid } = req.params
    const { url } = req.body as GroupIconRequest
    const log = orgLogger(orgId)

    const sock = requireSocket(orgId, res)
    if (!sock) return

    try {
      const imgRes = await fetch(url)
      if (!imgRes.ok) {
        res.status(400).json({ error: 'Failed to fetch icon URL', code: 'ICON_FETCH_FAILED' })
        return
      }
      const contentType = imgRes.headers.get('content-type') ?? ''
      if (!contentType.startsWith('image/')) {
        res.status(400).json({ error: 'URL must point to an image', code: 'ICON_INVALID_CONTENT_TYPE' })
        return
      }
      const contentLength = Number(imgRes.headers.get('content-length') ?? 0)
      if (contentLength > 5_000_000) {
        res.status(400).json({ error: 'Image exceeds 5 MB limit', code: 'ICON_TOO_LARGE' })
        return
      }
      const buf = Buffer.from(await imgRes.arrayBuffer())
      if (buf.length > 5_000_000) {
        res.status(400).json({ error: 'Image exceeds 5 MB limit', code: 'ICON_TOO_LARGE' })
        return
      }
      await sock.updateProfilePicture(groupJid, buf)
      log.info({ groupJid, url }, 'Group icon updated')
      res.json({ ok: true })
    } catch (err) {
      log.error({ groupJid, err: (err as Error).message }, 'Failed to update group icon')
      res.status(500).json({ error: (err as Error).message, code: 'GROUP_ICON_FAILED' })
    }
  }
)

// ΓöÇΓöÇ POST /api/groups/:orgId/:groupJid/send-permission ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
router.post(
  '/:orgId/:groupJid/send-permission',
  validateParams(groupParamsSchema),
  validateBody(groupSendPermissionSchema),
  async (req: Request, res: Response) => {
    const { orgId, groupJid } = req.params
    const { mode } = req.body as GroupSendPermissionRequest
    const log = orgLogger(orgId)

    const sock = requireSocket(orgId, res)
    if (!sock) return

    try {
      const setting = mode === 'admins' ? 'announcement' : 'not_announcement'
      await sock.groupSettingUpdate(groupJid, setting)
      log.info({ groupJid, mode }, 'Group send permission updated')
      res.json({ ok: true })
    } catch (err) {
      log.error({ groupJid, err: (err as Error).message }, 'Failed to update group send permission')
      res.status(500).json({ error: (err as Error).message, code: 'GROUP_SEND_PERMISSION_FAILED' })
    }
  }
)

// ΓöÇΓöÇ POST /api/groups/:orgId/:groupJid/edit-info-permission ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
router.post(
  '/:orgId/:groupJid/edit-info-permission',
  validateParams(groupParamsSchema),
  validateBody(groupEditInfoPermissionSchema),
  async (req: Request, res: Response) => {
    const { orgId, groupJid } = req.params
    const { mode } = req.body as GroupEditInfoPermissionRequest
    const log = orgLogger(orgId)

    const sock = requireSocket(orgId, res)
    if (!sock) return

    try {
      const setting = mode === 'admins' ? 'locked' : 'unlocked'
      await sock.groupSettingUpdate(groupJid, setting)
      log.info({ groupJid, mode }, 'Group edit-info permission updated')
      res.json({ ok: true })
    } catch (err) {
      log.error({ groupJid, err: (err as Error).message }, 'Failed to update group edit-info permission')
      res.status(500).json({ error: (err as Error).message, code: 'GROUP_EDIT_INFO_PERMISSION_FAILED' })
    }
  }
)

// ΓöÇΓöÇ POST /api/groups/:orgId/:groupJid/approval-mode ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
router.post(
  '/:orgId/:groupJid/approval-mode',
  validateParams(groupParamsSchema),
  validateBody(groupApprovalModeSchema),
  async (req: Request, res: Response) => {
    const { orgId, groupJid } = req.params
    const { enabled } = req.body as GroupApprovalModeRequest
    const log = orgLogger(orgId)

    const sock = requireSocket(orgId, res)
    if (!sock) return

    try {
      await sock.groupJoinApprovalMode(groupJid, enabled ? 'on' : 'off')
      log.info({ groupJid, enabled }, 'Group approval mode updated')
      res.json({ ok: true })
    } catch (err) {
      log.error({ groupJid, err: (err as Error).message }, 'Failed to update group approval mode')
      res.status(500).json({ error: (err as Error).message, code: 'GROUP_APPROVAL_MODE_FAILED' })
    }
  }
)

// ΓöÇΓöÇ POST /api/groups/:orgId/:groupJid/member-add-mode ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
router.post(
  '/:orgId/:groupJid/member-add-mode',
  validateParams(groupParamsSchema),
  validateBody(groupMemberAddModeSchema),
  async (req: Request, res: Response) => {
    const { orgId, groupJid } = req.params
    const { mode } = req.body as GroupMemberAddModeRequest
    const log = orgLogger(orgId)

    const sock = requireSocket(orgId, res)
    if (!sock) return

    try {
      const baileysMode = mode === 'admins' ? 'admin_add' : 'all_member_add'
      await sock.groupMemberAddMode(groupJid, baileysMode)
      log.info({ groupJid, mode }, 'Group member-add mode updated')
      res.json({ ok: true })
    } catch (err) {
      log.error({ groupJid, err: (err as Error).message }, 'Failed to update group member-add mode')
      res.status(500).json({ error: (err as Error).message, code: 'GROUP_MEMBER_ADD_MODE_FAILED' })
    }
  }
)

// ── GET /api/groups/:orgId/invite-info/:inviteCode ────────────────────────────
// Resolves a WhatsApp invite code to group JID + subject without requiring
// the bot to be inside the group. Used to register externally-created groups.
router.get(
  '/:orgId/invite-info/:inviteCode',
  validateParams(orgIdParamsSchema),
  async (req: Request, res: Response) => {
    const { orgId, inviteCode } = req.params
    const log = orgLogger(orgId)

    const sock = requireSocket(orgId, res)
    if (!sock) return

    try {
      const info = await (sock as any).groupGetInviteInfo(inviteCode)
      log.info({ inviteCode, groupJid: info?.id }, 'Resolved invite code')
      res.json({
        groupJid: info?.id ?? null,
        subject: info?.subject ?? null,
        size: info?.size ?? null,
      })
    } catch (err) {
      log.error({ inviteCode, err: (err as Error).message }, 'Failed to resolve invite code')
      res.status(500).json({ error: (err as Error).message, code: 'INVITE_INFO_FAILED' })
    }
  }
)

export default router
