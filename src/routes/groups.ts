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

// ── POST /api/groups/:orgId/create ──────────────────────────────
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

// ── POST /api/groups/:orgId/:groupJid/add ───────────────────────
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

// ── POST /api/groups/:orgId/:groupJid/remove ────────────────────
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

// ── POST /api/groups/:orgId/:groupJid/promote ───────────────────
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

// ── POST /api/groups/:orgId/:groupJid/demote ────────────────────
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

// ── POST /api/groups/:orgId/:groupJid/send ──────────────────────
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

// ── GET /api/groups/:orgId/:groupJid/metadata ───────────────────
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

// ── GET /api/groups/:orgId/admined ──────────────────────────────
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

export default router
